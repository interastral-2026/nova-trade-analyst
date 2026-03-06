
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const envPaths = [
  path.join(process.cwd(), '.env.local'),
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '.env.local'),
  path.join(__dirname, '.env')
];

envPaths.forEach(envPath => {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log(`[ENV] Successfully loaded: ${envPath}`);
  }
});

const API_KEY = (process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
fs.appendFileSync('debug.log', `[INIT] API_KEY starts with: ${API_KEY.substring(0, 5)}... (Length: ${API_KEY.length})\n`);
const CB_API_KEY = (process.env.CB_API_KEY || "").trim();
const CB_API_SECRET = process.env.CB_API_SECRET 
  ? process.env.CB_API_SECRET.replace(/^"|"$/g, '').replace(/\\n/g, '\n').trim() 
  : "";

const WATCHLIST = ['SOL', 'AVAX', 'LINK', 'NEAR', 'MATIC', 'XRP', 'DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK', 'FLOKI', 'RNDR', 'INJ', 'FET', 'TIA'];
const STATE_FILE = './ghost_state.json';
const FEE_RATE = 0.005; // 0.5% round-trip fee (0.25% buy + 0.25% sell, assuming advanced trade tier)
const MIN_NET_PROFIT = 0.003; // 0.3% minimum net profit after fees (Total required move = 0.8%)

let availableEurPairs: string[] = [];

// --- TRADING ENGINE LOGIC ---

let isScanning = false;
let isMonitoring = false;
let isAiMonitoring = false;

async function listAvailableProducts() {
  const token = generateCoinbaseJWT('GET', '/api/v3/brokerage/products');
  if (!token) return;
  try {
    const response = await axios.get('https://api.coinbase.com/api/v3/brokerage/products?product_type=SPOT', {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000
    });
    const products = response.data?.products || [];
    availableEurPairs = products
      .filter(p => p.quote_currency_id === 'EUR' && p.is_disabled === false)
      .map(p => p.product_id);
    console.log("--------------------------------------------------");
    console.log("✅ VALID EUR TRADING PAIRS FOR YOUR ACCOUNT:");
    console.log(availableEurPairs.join(', '));
    console.log("--------------------------------------------------");
  } catch (e: any) {
    console.warn("[PRODUCTS ERROR] Could not fetch valid pairs:", e.message);
  }
}

function generateCoinbaseJWT(request_method, request_path) {
  if (!CB_API_KEY || !CB_API_SECRET) return null;
  try {
    const request_host = 'api.coinbase.com';
    const uri = request_method + ' ' + request_host + request_path;
    const payload = {
      iss: "cdp",
      nbf: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 120,
      sub: CB_API_KEY,
      uri: uri,
    };
    const header = {
      alg: "ES256",
      kid: CB_API_KEY,
      nonce: crypto.randomBytes(16).toString("hex"),
    };
    return jwt.sign(payload, CB_API_SECRET, { algorithm: 'ES256', header });
  } catch (e) {
    console.error("JWT Error:", e.message);
    return null;
  }
}

async function syncCoinbaseBalance() {
  if (ghostState.isPaperMode) {
    if (ghostState.liquidity.eur < 10) ghostState.liquidity.eur = 1000; // Auto-refill paper money
    if (ghostState.liquidity.usdc < 10) ghostState.liquidity.usdc = 1000;
    return true;
  }

  const token = generateCoinbaseJWT('GET', '/api/v3/brokerage/accounts');
  if (!token) return false;
  try {
    const response = await axios.get('https://api.coinbase.com/api/v3/brokerage/accounts', {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000
    });
    const accounts = response.data?.accounts || [];
    const newBalances = {}; 
    accounts.forEach((acc) => {
      const currency = acc.currency;
      const amount = parseFloat(acc.available_balance?.value || 0);
      if (currency === 'EUR') ghostState.liquidity.eur = amount;
      else if (currency === 'USDC' || currency === 'USD' || currency === 'EURC') ghostState.liquidity.usdc = amount;
      else if (amount > 0.00000001) newBalances[currency] = amount;
    });
    ghostState.actualBalances = newBalances;
    console.log(`[SYNC] Coinbase Balance Updated. EUR: ${ghostState.liquidity.eur}, Assets: ${Object.keys(newBalances).join(', ')}`);
    return true;
  } catch (e) {
    console.error("[SYNC ERROR] Failed to fetch Coinbase balances:", e.message);
    return false;
  }
}

async function executeTrade(symbol, side, amount, quantity) {
  if (ghostState.isPaperMode) {
    console.log(`[PAPER TRADE SUCCESS] ${side} ${symbol} (Amount: ${amount}, Qty: ${quantity})`);
    return { success: true };
  }

  const productId = symbol.includes('-') ? symbol : `${symbol}-EUR`;
  
  if (!ghostState.isPaperMode && availableEurPairs.length > 0 && !availableEurPairs.includes(productId)) {
    console.error(`[REAL TRADE ERROR] Invalid product ID: ${productId}`);
    return { success: false, reason: `INVALID_PRODUCT: ${productId}` };
  }
  
  if (!CB_API_KEY || !CB_API_SECRET) {
    console.error("[REAL TRADE ERROR] Missing Coinbase API credentials.");
    return { success: false, reason: "MISSING_API_KEYS" };
  }

  const token = generateCoinbaseJWT('POST', '/api/v3/brokerage/orders');
  if (!token) {
    console.error("[REAL TRADE ERROR] Failed to generate JWT.");
    return { success: false, reason: "JWT_GENERATION_FAILED" };
  }

  try {
    let finalQty = Number(quantity);
    
    // If real trading and selling, ensure we don't exceed actual balance to avoid INSUFFICIENT_FUND
    if (!ghostState.isPaperMode && side === 'SELL') {
      // Force sync balance before selling to get the exact available amount
      await syncCoinbaseBalance();
      const actual = ghostState.actualBalances[symbol] || 0;
      
      if (actual <= 0) {
        console.error(`[REAL TRADE REJECTED] No actual balance found for ${symbol} on Coinbase.`);
        return { success: false, reason: "NO_BALANCE_ON_EXCHANGE" };
      }
      
      if (finalQty > actual) {
        console.log(`[TRADE] Adjusting SELL quantity for ${symbol}: ${finalQty} -> ${actual} (Max Available)`);
        finalQty = actual;
      }
    }

    // Truncate instead of round to avoid INSUFFICIENT_FUND
    const quoteSizeStr = (Math.floor(Number(amount) * 100) / 100).toFixed(2);
    // Convert to string and truncate to 8 decimal places max without rounding up
    const baseSizeStr = finalQty.toString().match(/^-?\d+(?:\.\d{0,8})?/)[0];

    const orderConfig = side === 'BUY' 
      ? { market_market_ioc: { quote_size: quoteSizeStr } }
      : { market_market_ioc: { base_size: baseSizeStr } };
    
    const payload = {
      client_order_id: crypto.randomUUID(),
      product_id: productId,
      side: side,
      order_configuration: orderConfig
    };

    const response = await axios.post('https://api.coinbase.com/api/v3/brokerage/orders', payload, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 15000
    });

    // Check if order was actually created or rejected by Coinbase
    if (response.data?.success === false || response.data?.error_response) {
      const errorResponse = response.data?.error_response;
      const errorMsg = errorResponse?.message || errorResponse?.error || response.data?.failure_reason || "COINBASE_REJECTION";
      
      if (errorMsg === 'INSUFFICIENT_FUND' || (typeof errorMsg === 'string' && errorMsg.includes('INSUFFICIENT'))) {
        console.error("[REAL TRADE REJECTED] Insufficient funds on Coinbase.");
        return { success: false, reason: "INSUFFICIENT_FUNDS_ON_COINBASE" };
      }
      
      console.error("[REAL TRADE REJECTED]", response.data);
      return { success: false, reason: `CB_REJECT: ${errorMsg}` };
    }

    console.log(`[REAL TRADE SUCCESS] ${side} ${productId}`);
    return { success: true };
  } catch (e: any) {
    const errorData = e.response?.data;
    let errorMsg = errorData?.message || errorData?.error || e.message || "UNKNOWN_API_ERROR";
    
    console.error("[REAL TRADE API ERROR]", errorData || e.message);
    
    // Check for specific "insufficient funds" errors from Coinbase
    const lowerError = errorMsg.toLowerCase();
    if (lowerError.includes('insufficient') || lowerError.includes('balance') || lowerError.includes('funds')) {
      return { success: false, reason: "INSUFFICIENT_FUNDS_ON_COINBASE" };
    }

    if (lowerError.includes('401') || lowerError.includes('unauthorized')) {
      return { success: false, reason: "INVALID_API_KEYS" };
    }
    
    return { success: false, reason: `API_ERR: ${errorMsg}` };
  }
}

async function getAdvancedAnalysis(symbol, price, candles, entryPrice = null) {
  if (!API_KEY || API_KEY.startsWith('MY_GE') || API_KEY === 'YOUR_API_KEY') {
    return {
      side: "NEUTRAL",
      analysis: "خطا: کلید API هوش مصنوعی نامعتبر است. لطفاً کلید معتبر خود را در تنظیمات وارد کنید.",
      symbol,
      timestamp: new Date().toISOString(),
      confidence: 0,
      potentialRoi: 0,
      id: crypto.randomUUID()
    };
  }

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const history = (candles || []).slice(-30).map(c => ({ h: c.high, l: c.low, c: c.close }));
  
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('AI_TIMEOUT')), 45000);
  });

  try {
    ghostState.currentStatus = `AI_REQ_${symbol}`;
    const aiPromise = ai.models.generateContent({
      model: 'gemini-3-flash-preview', 
      contents: [{ parts: [{ text: `SMC_ANALYSIS_SCAN: ${symbol} @ ${price} EUR. HISTORY_30M: ${JSON.stringify(history)}. CURRENT_DAILY_PROFIT: ${ghostState.dailyStats.profit} EUR.` }] }],
      config: {
        systemInstruction: `YOU ARE THE GHOST_SMC_BOT, A HIGH-FREQUENCY AI SCALPER.
Use Smart Money Concepts (SMC), FVG, and MSS. 
Goal: Capture quick 1.5% - 5% ROI scalps. 
Speed and liquidity are everything. Do not hold for long-term. DO NOT WASTE TIME.
Factor in ${FEE_RATE * 100}% round-trip fees. A trade is only valid if potential net profit > 0.5%.

CRITICAL DIRECTIVES:
- BE EXTREMELY CONSERVATIVE. ACT LIKE A SNIPER. ONLY TAKE HIGH-PROBABILITY A+ SETUPS.
- DO NOT OVERTRADE. If the market is choppy, ranging, or unclear, YOU MUST CHOOSE 'NEUTRAL'.
- DO NOT LET CAPITAL SLEEP. If a position is stagnant or moving against us, cut it (SELL) and free up liquidity for better opportunities.
- ACTIVE POSITIONS: If we are in profit, be ruthless about taking it before the market reverses. If we are stuck in a slow market, exit to find a faster one.

INTERNAL REASONING PROTOCOL:
For every analysis, you MUST provide a "Step-by-step Thought Process" in the 'analysis' field.
1. Market Context: Trend (Bullish/Bearish/Sideways) and Momentum.
2. SMC Evidence: Liquidity sweeps, FVG gaps, Order Blocks.
3. Decision Logic: Why you are choosing BUY, SELL, or WAIT.
4. If WAIT: Explicitly state what is missing (e.g., "Waiting for MSS confirmation", "No clear FVG", "Spread too high").

Only issue BUY if you see a clear institutional "Discount Zone" or "Liquidity Sweep" with strong upward momentum.
Issue SELL early if you see "Distribution" or "SFP" (Swing Failure Pattern) to lock in profit before reversals.
BE SMART: Avoid "Bull Traps" and "Bear Traps" set by exchanges.
NEVER RECOMMEND A TRADE THAT DOES NOT COVER FEES.

${entryPrice ? `CURRENT POSITION: You bought ${symbol} at ${entryPrice}. Current price is ${price}. 
Break-even price (including fees) is ${entryPrice * (1 + FEE_RATE)}.
If we are above break-even, be very sensitive to any sign of reversal and issue SELL to secure gains. 
If we are in loss, look for MSS to decide if we should hold or cut loss early (only if trend is clearly broken).` : ''}

STRATEGY:
1. Identify "Liquidity Sweeps" and "Market Structure Shifts" (MSS).
2. If we hold a position, look for "Liquidity Targets" or "Reversal Signs" to issue a SELL signal.
3. If we don't hold, look for "Discount Zones" or "FVG" for a BUY signal.
4. ALWAYS prioritize liquidity. If the market looks stagnant, exit and wait for better volatility.

IMPORTANT: You MUST write the "analysis" field in PERSIAN (Farsi).
Return valid JSON with side (BUY/SELL/NEUTRAL), tp, sl, entryPrice, confidence (0-100), potentialRoi, analysis.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ['BUY', 'SELL', 'NEUTRAL'] },
            tp: { type: Type.NUMBER },
            sl: { type: Type.NUMBER },
            entryPrice: { type: Type.NUMBER },
            confidence: { type: Type.NUMBER },
            potentialRoi: { type: Type.NUMBER },
            analysis: { type: Type.STRING }
          },
          required: ['side', 'tp', 'sl', 'entryPrice', 'confidence', 'potentialRoi', 'analysis']
        },
        temperature: 0.1
      }
    });

    const response: any = await Promise.race([aiPromise, timeoutPromise]);
    const rawText = response.text?.trim() || '{}';
    ghostState.currentStatus = `AI_RESP_${symbol}_LEN_${rawText.length}`;
    const result = JSON.parse(rawText);
    if (result.confidence !== undefined && result.confidence > 0 && result.confidence <= 1) {
      result.confidence = Math.round(result.confidence * 100);
    }
    return { ...result, id: crypto.randomUUID(), symbol, timestamp: new Date().toISOString() };
  } catch (e: any) { 
    let errorMsg = e.message;
    if (errorMsg.includes('API_KEY_INVALID') || errorMsg.includes('API key not valid')) {
      errorMsg = "کلید API نامعتبر است. لطفاً کلید معتبر وارد کنید.";
    } else if (errorMsg.includes('AI_TIMEOUT')) {
      errorMsg = "پاسخ هوش مصنوعی بیش از حد طول کشید (تایم‌اوت).";
    }
    
    console.error(`[AI ERROR] ${symbol}:`, errorMsg);
    return {
      side: "NEUTRAL",
      analysis: `خطا در تحلیل هوش مصنوعی برای ${symbol}: ${errorMsg}`,
      symbol,
      timestamp: new Date().toISOString(),
      confidence: 0,
      potentialRoi: 0,
      id: crypto.randomUUID()
    }; 
  }
}

function loadState() {
  const defaults = {
    isEngineActive: true, autoPilot: true, isPaperMode: false,
    settings: { confidenceThreshold: 70, defaultTradeSize: 50.0, minRoi: 1.5 },
    thoughts: [], executionLogs: [], activePositions: [],
    liquidity: { eur: 0, usdc: 0 }, actualBalances: {}, 
    dailyStats: { trades: 0, profit: 0, dailyGoal: 50.0, lastResetDate: "" },
    totalProfit: 0,
    currentStatus: "INITIALIZING", scanIndex: 0
  };
  try { 
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return { 
        ...defaults, 
        ...parsed,
        settings: { ...defaults.settings, ...(parsed.settings || {}) }
      };
    }
  } catch (e) {}
  return defaults;
}

let ghostState = loadState();

// --- MIGRATION: CLEAN SYMBOLS (e.g., SOL-EUR -> SOL) ---
if (ghostState.activePositions && ghostState.activePositions.length > 0) {
  ghostState.activePositions = ghostState.activePositions.map(pos => {
    if (pos.symbol && pos.symbol.includes('-')) {
      const base = pos.symbol.split('-')[0];
      console.log(`[MIGRATION] Cleaning symbol: ${pos.symbol} -> ${base}`);
      return { ...pos, symbol: base };
    }
    return pos;
  });
}

async function monitorPositionsAI() {
  if (isAiMonitoring || !ghostState.isEngineActive || ghostState.activePositions.length === 0) return;
  isAiMonitoring = true;
  
  console.log(`[AI-MONITOR] Checking ${ghostState.activePositions.length} active positions...`);
  
  try {
    for (let i = ghostState.activePositions.length - 1; i >= 0; i--) {
      const pos = ghostState.activePositions[i];
      try {
        const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${pos.symbol}&tsym=EUR&limit=30`, { timeout: 8000 });
        const candles = res.data?.Data?.Data || [];
        if (candles.length === 0) continue;
        
        const price = candles[candles.length - 1].close;
        const analysis = await getAdvancedAnalysis(pos.symbol, price, candles, pos.entryPrice);
        
        if (analysis && analysis.side === 'SELL') {
          const breakEvenPrice = pos.entryPrice * (1 + FEE_RATE);
          const isProfitable = price > (breakEvenPrice * (1 + MIN_NET_PROFIT));
          
          // AI SELL SIGNAL: Exit if profitable or if confidence is very high for a drop (emergency exit)
          // Be more aggressive: if confidence > 80, cut the loss to free liquidity.
          if (isProfitable || analysis.confidence >= 80) {
            const tradePnl = (price - pos.entryPrice) * pos.quantity;
            const netPnl = tradePnl - (pos.amount * FEE_RATE);
            console.log(`[AI-MONITOR] AI SELL for ${pos.symbol}. Net PNL: ${netPnl.toFixed(2)} EUR. Reason: ${analysis.analysis}`);
            
            const tradeResult = await executeTrade(pos.symbol, 'SELL', 0, pos.quantity);
            if (tradeResult.success) {
              ghostState.dailyStats.profit += tradePnl;
              ghostState.totalProfit += tradePnl;
              ghostState.executionLogs.unshift({
                id: crypto.randomUUID(),
                symbol: pos.symbol,
                action: 'SELL',
                price,
                pnl: tradePnl,
                status: 'SUCCESS',
                details: `AI_EXIT_CONF_${analysis.confidence}%`,
                timestamp: new Date().toISOString()
              });
              ghostState.activePositions.splice(i, 1);
              saveState();
            } else if (tradeResult.reason && (tradeResult.reason.includes('INSUFFICIENT_FUND') || tradeResult.reason.includes('NO_BALANCE_ON_EXCHANGE'))) {
              console.log(`[AI-MONITOR] Removing ${pos.symbol} due to missing balance on exchange.`);
              ghostState.activePositions.splice(i, 1);
              saveState();
            }
          }
        }
      } catch (e: any) {
        console.error(`[AI-MONITOR] Error checking ${pos.symbol}:`, e.message);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  } finally {
    isAiMonitoring = false;
  }
}

async function scanWatchlist() {
  if (isScanning || !ghostState.isEngineActive) return;
  isScanning = true;
  
  try {
    // Use availableEurPairs if we have them, otherwise fallback to WATCHLIST
    const currentWatchlist = availableEurPairs.length > 0 
      ? availableEurPairs.map(p => p.split('-')[0]) 
      : WATCHLIST;

    // Scan 6 symbols per cycle for stability
    for (let i = 0; i < 6; i++) {
      const symbol = currentWatchlist[ghostState.scanIndex % currentWatchlist.length];
      ghostState.scanIndex++;
      
      if (ghostState.activePositions.some(p => p.symbol === symbol)) {
        fs.appendFileSync('debug.log', `[${new Date().toISOString()}] Skipping ${symbol}: Active position exists\n`);
        continue;
      }

      const productId = `${symbol}-EUR`;
      if (!ghostState.isPaperMode && availableEurPairs.length > 0 && !availableEurPairs.includes(productId)) {
        fs.appendFileSync('debug.log', `[${new Date().toISOString()}] Skipping ${symbol}: ${productId} not in availableEurPairs. First 3: ${availableEurPairs.slice(0,3).join(',')}\n`);
        continue;
      }

      ghostState.currentStatus = `ANALYZING_${symbol}_SMC`;
      try {
        const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${symbol}&tsym=EUR&limit=30`, { timeout: 8000 });
        const candles = res.data?.Data?.Data || [];
        if (candles.length === 0) {
          fs.appendFileSync('debug.log', `[${new Date().toISOString()}] Skipping ${symbol}: No candles from Cryptocompare\n`);
          continue;
        }
        
        const price = candles[candles.length - 1].close;
        const analysis = await getAdvancedAnalysis(symbol, price, candles);
        
        if (analysis && analysis.side === 'BUY' && analysis.confidence >= ghostState.settings.confidenceThreshold && ghostState.autoPilot) {
          // Ensure potential ROI covers fees + minimum net profit (0.5% fee + 0.3% net = 0.8%)
          const isProfitableEnough = analysis.potentialRoi >= ((FEE_RATE * 100) + (MIN_NET_PROFIT * 100));
          
          if (isProfitableEnough) {
            // Calculate available liquidity for this specific trade
            const totalEur = ghostState.liquidity.eur;
            // Be conservative: use up to 20% of available liquidity per trade to minimize risk
            const maxPerTrade = totalEur * 0.20;
            let tradeAmount = Math.max(10, Math.min(ghostState.settings.defaultTradeSize, maxPerTrade));
            
            if (totalEur >= (tradeAmount * 1.015) && tradeAmount >= 5) { 
              const qty = tradeAmount / (price || 1);
              const tradeResult = await executeTrade(symbol, 'BUY', tradeAmount, qty);
              
              if (tradeResult.success) {
                analysis.decision = `EXECUTED: BUY_${symbol}_AT_${price}`;
                ghostState.activePositions.push({
                  symbol, entryPrice: price, currentPrice: price, amount: tradeAmount, quantity: qty,
                  tp: analysis.tp, sl: analysis.sl, confidence: analysis.confidence, potentialRoi: analysis.potentialRoi,
                  pnl: 0, pnlPercent: 0, isPaper: ghostState.isPaperMode, timestamp: new Date().toISOString()
                });
                
                ghostState.liquidity.eur -= tradeAmount;

                ghostState.executionLogs.unshift({ 
                  id: crypto.randomUUID(), 
                  symbol, 
                  action: 'BUY', 
                  price, 
                  status: 'SUCCESS', 
                  details: `LIQUIDITY_BUY_CONF_${analysis.confidence}%`,
                  timestamp: new Date().toISOString() 
                });
                ghostState.dailyStats.trades++;
              } else {
                analysis.decision = `FAILED: ${tradeResult.reason}`;
              }
            } else {
              analysis.decision = `SKIPPED: INSUFFICIENT_LIQUIDITY (Need: ${tradeAmount.toFixed(2)}, Have: ${totalEur.toFixed(2)})`;
            }
          } else {
            analysis.decision = `SKIPPED: ROI_TOO_LOW (Expected: ${analysis.potentialRoi}%, Min Required: ${((FEE_RATE * 100) + (MIN_NET_PROFIT * 100)).toFixed(2)}%)`;
          }
        }
        if (analysis) {
          const thoughtCount = ghostState.thoughts.length;
          ghostState.currentStatus = `THOUGHT_OK_${symbol}_${analysis.side}_TC_${thoughtCount}`;
          ghostState.lastThought = { symbol, side: analysis.side, time: new Date().toISOString() };
          ghostState.thoughts.unshift(analysis);
          if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();
          saveState();
        } else {
          ghostState.currentStatus = `THOUGHT_NULL_${symbol}`;
          saveState();
        }
        
        fs.appendFileSync('debug.log', `[${new Date().toISOString()}] Analyzed ${symbol}: ${analysis ? analysis.side : 'NULL'}\n`);
        
        await new Promise(r => setTimeout(r, 2000));
      } catch (e: any) {
        fs.appendFileSync('debug.log', `[${new Date().toISOString()}] Error scanning ${symbol}: ${e.message}\n`);
        ghostState.currentStatus = `SCAN_ERR_${symbol}_${e.message.slice(0, 20)}`;
        saveState();
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  } finally {
    fs.appendFileSync('debug.log', `[${new Date().toISOString()}] Batch done. ScanIndex: ${ghostState.scanIndex}\n`);
    isScanning = false;
    // We keep the last status for a bit longer
    setTimeout(() => {
       if (ghostState.currentStatus.startsWith("SCAN_BATCH_DONE")) {
          ghostState.currentStatus = "IDLE_SCAN_COMPLETE";
          saveState();
       }
    }, 5000);
    ghostState.currentStatus = `SCAN_BATCH_DONE_${ghostState.scanIndex}`;
    saveState();
  }
}

async function monitor() {
  if (isMonitoring) return;
  isMonitoring = true;

  try {
    await syncCoinbaseBalance();
    const today = new Date().toISOString().split('T')[0];
    if (ghostState.dailyStats.lastResetDate !== today) {
      ghostState.dailyStats.profit = 0; ghostState.dailyStats.trades = 0; ghostState.dailyStats.lastResetDate = today;
    }
    
    // Reconcile active positions with actual Coinbase balances (ONLY IN REAL MODE)
    if (!ghostState.isPaperMode) {
      for (let i = ghostState.activePositions.length - 1; i >= 0; i--) {
        const pos = ghostState.activePositions[i];
        const actualQty = ghostState.actualBalances[pos.symbol] || 0;
        
        if (actualQty < (pos.quantity * 0.1)) {
          console.log(`[RECONCILE] Removing ${pos.symbol} - Position no longer exists on Coinbase.`);
          ghostState.executionLogs.unshift({
            id: crypto.randomUUID(),
            symbol: pos.symbol,
            action: 'SELL',
            price: pos.currentPrice,
            pnl: pos.pnl,
            status: 'SUCCESS',
            details: `EXTERNAL_EXIT_DETECTED`,
            timestamp: new Date().toISOString()
          });
          if (ghostState.executionLogs.length > 50) ghostState.executionLogs.pop();
          ghostState.dailyStats.profit += pos.pnl; 
          ghostState.totalProfit += pos.pnl;
          ghostState.activePositions.splice(i, 1);
        }
      }

      // ADOPT MISSING POSITIONS: If Coinbase has it but we don't track it, add it.
      for (const symbol of Object.keys(ghostState.actualBalances)) {
        if (!ghostState.activePositions.some(p => p.symbol === symbol)) {
          const qty = ghostState.actualBalances[symbol];
          const productId = `${symbol}-EUR`;
          
          // ONLY adopt if we can actually trade it against EUR
          const canTrade = availableEurPairs.length === 0 || availableEurPairs.includes(productId);
          
          if (qty > 0.00001 && canTrade) {
            console.log(`[RECONCILE] Adopting position: ${symbol} (${qty})`);
            ghostState.activePositions.push({
              symbol,
              entryPrice: 0, 
              currentPrice: 0,
              amount: 0,
              quantity: qty,
              tp: 0,
              sl: 0,
              confidence: 100,
              potentialRoi: 0,
              pnl: 0,
              pnlPercent: 0,
              isPaper: false,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
    }

    if (ghostState.activePositions.length === 0) return;
    const symbols = ghostState.activePositions.map((p) => p.symbol).join(',');
    try {
      const res = await axios.get(`https://min-api.cryptocompare.com/data/pricemulti?fsyms=${symbols}&tsyms=EUR`, { timeout: 8000 });
      const prices = res.data;
      for (let i = ghostState.activePositions.length - 1; i >= 0; i--) {
        const pos = ghostState.activePositions[i];
        const curPrice = prices[pos.symbol]?.EUR;
        if (!curPrice) continue;
        
        // If it's a newly adopted position, set initial prices and default targets
        if (pos.entryPrice === 0) {
          pos.entryPrice = curPrice;
          pos.tp = curPrice * 1.03; // Default 3% TP
          pos.sl = curPrice * 0.98; // Default 2% SL
        }

        pos.currentPrice = curPrice;
        const pnlPercent = ((curPrice - pos.entryPrice) / (pos.entryPrice || 1)) * 100;
        pos.pnlPercent = pnlPercent;
        pos.pnl = (curPrice - pos.entryPrice) * pos.quantity;
        
        const breakEvenPrice = pos.entryPrice * (1 + FEE_RATE);
        const netPnlPercent = pnlPercent - (FEE_RATE * 100);

        // Dynamic Trailing Stop & Break Even
        if (netPnlPercent > 0.2 && pos.sl < breakEvenPrice) {
          pos.sl = breakEvenPrice * (1 + MIN_NET_PROFIT);
          console.log(`[MONITOR] Break-Even + Profit Buffer activated for ${pos.symbol} @ ${pos.sl.toFixed(2)}`);
        }

        if (netPnlPercent > 0.8) {
          const newSl = curPrice * 0.997; // 0.3% trailing stop once in 0.8% net profit
          if (newSl > pos.sl) {
            pos.sl = newSl;
            console.log(`[MONITOR] Trailing Stop moved for ${pos.symbol} @ ${newSl.toFixed(2)}`);
          }
        }

        // EARLY EXIT: If price reaches 80% of TP
        const tpDistance = pos.tp - pos.entryPrice;
        const earlyExitPrice = pos.entryPrice + (tpDistance * 0.8);
        const canExitSafely = curPrice > (breakEvenPrice * (1 + MIN_NET_PROFIT));

        // Trigger SELL if:
        // 1. Reached TP
        // 2. Reached SL (Hard stop loss, must execute even if in loss)
        // 3. Reached 80% of TP and is safe to exit
        if (curPrice >= pos.tp || curPrice <= pos.sl || (tpDistance > 0 && curPrice >= earlyExitPrice && netPnlPercent > 0.4 && canExitSafely)) {
          const reason = curPrice >= pos.tp ? 'TAKE_PROFIT' : (curPrice <= pos.sl ? 'STOP_LOSS' : 'EARLY_EXIT_80%_TP');
          const tradeResult = await executeTrade(pos.symbol, 'SELL', 0, pos.quantity);
          
          if (tradeResult.success) {
            ghostState.dailyStats.profit += pos.pnl;
            ghostState.totalProfit += pos.pnl;
            ghostState.executionLogs.unshift({ 
              id: crypto.randomUUID(), 
              symbol: pos.symbol, 
              action: 'SELL', 
              price: curPrice, 
              pnl: pos.pnl, 
              status: 'SUCCESS', 
              details: `EXIT_${reason}_PNL_${pos.pnl.toFixed(2)}`,
              timestamp: new Date().toISOString() 
            });
            if (ghostState.executionLogs.length > 50) ghostState.executionLogs.pop();
            ghostState.activePositions.splice(i, 1);
          } else if (tradeResult.reason && (tradeResult.reason.includes('INSUFFICIENT_FUND') || tradeResult.reason.includes('NO_BALANCE_ON_EXCHANGE'))) {
            console.log(`[MONITOR] Removing ${pos.symbol} due to missing balance on exchange.`);
            ghostState.activePositions.splice(i, 1);
          }
        }
      }
    } catch (e) {}
  } finally {
    isMonitoring = false;
    saveState();
  }
}

function saveState() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {} }

// --- SERVER SETUP ---

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.get('/api/ping', (req, res) => res.json({ status: 'pong', timestamp: new Date().toISOString() }));
  app.get('/api/ghost/state', (req, res) => res.json(ghostState));
  app.post('/api/ghost/toggle', (req, res) => {
    if (req.body.engine !== undefined) ghostState.isEngineActive = !!req.body.engine;
    if (req.body.auto !== undefined) ghostState.autoPilot = !!req.body.auto;
    if (req.body.paper !== undefined) ghostState.isPaperMode = !!req.body.paper;
    saveState();
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api')) res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 UNIFIED SERVER RUNNING ON PORT ${PORT}`);
    
    // Start trading engine
    listAvailableProducts();
    monitor();
    monitorPositionsAI();
    scanWatchlist();
    
    setInterval(monitor, 3000);           // Hard TP/SL check (3s)
    setInterval(monitorPositionsAI, 15000); // AI Position Analysis (15s)
    setInterval(scanWatchlist, 15000);      // New Signal Scanning (15s)
    setInterval(listAvailableProducts, 300000); // Refresh products every 5m
  });
}

startServer();
