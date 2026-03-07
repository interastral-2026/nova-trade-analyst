
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
const FEE_RATE = 0.012; // 1.2% round-trip fee (0.6% buy + 0.6% sell, assuming advanced trade tier taker fees)
const MIN_NET_PROFIT = 0.005; // 0.5% minimum net profit after fees (Total required move = 1.7%)

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

    const orderId = response.data?.order_id || response.data?.success_response?.order_id;
    console.log(`[REAL TRADE SUCCESS] ${side} ${productId} | OrderID: ${orderId}`);
    return { success: true, orderId };
  } catch (e: any) {
    const errorData = e.response?.data;
    const errorMsg = errorData?.message || errorData?.error || e.message || "UNKNOWN_API_ERROR";
    
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

async function getActualFillPrice(orderId) {
  if (!orderId || ghostState.isPaperMode) return null;
  const token = generateCoinbaseJWT('GET', `/api/v3/brokerage/orders/historical/${orderId}`);
  if (!token) return null;
  
  try {
    // Wait a bit for the order to fill
    await new Promise(r => setTimeout(r, 2000));
    const response = await axios.get(`https://api.coinbase.com/api/v3/brokerage/orders/historical/${orderId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000
    });
    
    const order = response.data?.order;
    if (order && order.status === 'FILLED') {
      return Number(order.avg_fill_price);
    }
    return null;
  } catch (e: any) {
    console.warn(`[FILL_PRICE_ERROR] Could not fetch fill price for ${orderId}:`, e.message);
    return null;
  }
}

async function getLastFillPrice(symbol) {
  if (ghostState.isPaperMode) return null;
  const productId = `${symbol}-EUR`;
  const token = generateCoinbaseJWT('GET', `/api/v3/brokerage/orders/historical/fills?product_id=${productId}`);
  if (!token) return null;
  
  try {
    const response = await axios.get(`https://api.coinbase.com/api/v3/brokerage/orders/historical/fills?product_id=${productId}&limit=1`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000
    });
    
    const fills = response.data?.fills || [];
    if (fills.length > 0) {
      const lastFill = fills[0];
      if (lastFill.side === 'BUY') {
        return Number(lastFill.price);
      }
    }
    return null;
  } catch (e: any) {
    console.warn(`[LAST_FILL_ERROR] Could not fetch last fill for ${symbol}:`, e.message);
    return null;
  }
}

async function getAdvancedAnalysis(symbol, price, candles, entryPrice = null) {
  const isInvalidKey = !API_KEY || 
                       API_KEY.startsWith('MY_GE') || 
                       API_KEY === 'YOUR_API_KEY' || 
                       API_KEY.length < 20;

  if (isInvalidKey) {
    return {
      side: "NEUTRAL",
      analysis: "خطا: کلید API هوش مصنوعی (Gemini) یافت نشد یا نامعتبر است. لطفاً یک کلید معتبر در فایل .env تنظیم کنید.",
      symbol,
      timestamp: new Date().toISOString(),
      confidence: 0,
      potentialRoi: 0,
      estimatedTime: "--",
      liquidityAnalysis: "عدم دسترسی به هوش مصنوعی",
      marketMonitoring: "سیستم پایش غیرفعال است",
      id: crypto.randomUUID()
    };
  }

  const maxRetries = 2;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const history = (candles || []).slice(-40).map(c => ({ h: c.high, l: c.low, c: c.close }));
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('AI_TIMEOUT')), 90000);
    });

    try {
      ghostState.currentStatus = `AI_REQ_${symbol}_ATTEMPT_${attempt + 1}`;
      const aiPromise = ai.models.generateContent({
        model: 'gemini-flash-latest', 
        contents: [{ parts: [{ text: `SMC_ANALYSIS_SCAN: ${symbol} @ ${price} EUR. HISTORY_15M_CANDLES: ${JSON.stringify(history)}. CURRENT_DAILY_PROFIT: ${ghostState.dailyStats.profit} EUR.` }] }],
        config: {
          systemInstruction: `YOU ARE THE GHOST_SMC_BOT, AN ELITE, HIGHLY CONSERVATIVE AI SCALPER.
You hunt for A+ setups with high volatility and clear momentum. You DO NOT trade in choppy, sideways, or unpredictable markets.

Your goal is to maximize pure profit (soode khales) and NEVER lose money unnecessarily.
Fee Calculation is MANDATORY: You must account for a ${FEE_RATE * 100}% round-trip fee. 
Break-even = Entry Price * (1 + ${FEE_RATE}). A trade is ONLY valid if the target price is significantly higher than the break-even price.

CRITICAL DIRECTIVES FOR CAPITAL PRESERVATION:
- RULE #1: PURE PROFIT ONLY. Calculate fees precisely. If the move isn't big enough to cover fees and yield at least 1.0% net profit, DO NOT BUY.
- RULE #2: NO AMATEUR TRADES. Do not FOMO into massive green candles. Buy the dip (Discount Zones) or the breakout (MSS with volume).
- RULE #3: AVOID CHOPPY MARKETS. If the last 15 hours of data show no clear trend, stay NEUTRAL.
- RULE #4: RUTHLESS EXITS. If price stalls near resistance or shows weakness, SELL. BUT DO NOT PANIC SELL on tiny 0.2% - 1% drops if the trend is still intact.
- RULE #5: PROTECT THE ENTRY. If we are in a trade and in profit, your stop-loss logic must move to break-even + fees as soon as possible.

INTERNAL REASONING PROTOCOL:
For every analysis, you MUST provide:
1. Liquidity Analysis: Focus on sweeps, FVG gaps, and Order Blocks.
2. Market Monitoring: Current trend, momentum, and potential reversal signs.
3. Estimated Time: How long until target is reached.
4. Overall Analysis: Step-by-step summary of decision logic.

${entryPrice ? `CURRENT POSITION: You bought ${symbol} at ${entryPrice}. Current price is ${price}. 
Break-even price (including fees) is ${entryPrice * (1 + FEE_RATE)}.
If current price > break-even, you MUST protect this profit. If momentum slows, issue SELL.
If we are in loss, DO NOT PANIC SELL on tiny drops (less than 1.5%). Only issue SELL if the thesis is completely broken and we are heading for a crash.` : ''}

STRATEGY:
1. Identify "Liquidity Sweeps" and "Market Structure Shifts" (MSS).
2. If we hold a position, look for "Liquidity Targets" or "Reversal Signs" to issue a SELL signal.
3. If we don't hold, look for "Discount Zones" or "FVG" for a BUY signal.
4. ALWAYS prioritize liquidity. If the market looks stagnant, exit and wait for better volatility.
5. If you issue a BUY signal, your confidence MUST be at least 85%. If you are not 85% sure, issue NEUTRAL.
6. Estimate the time it will take to reach the Take Profit (TP) target (e.g., "30m", "2h", "6h", "1d").

IMPORTANT: You MUST write the "analysis", "liquidityAnalysis", and "marketMonitoring" fields in PERSIAN (Farsi).
Return valid JSON with side (BUY/SELL/NEUTRAL), tp, sl, entryPrice, confidence (0-100), potentialRoi, tradePercentage (1-100), estimatedTime, liquidityAnalysis, marketMonitoring, analysis.`,
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
              tradePercentage: { type: Type.NUMBER, description: "Percentage of available capital to use (1-100)" },
              estimatedTime: { type: Type.STRING, description: "Estimated time to reach target (e.g. 2h, 4h)" },
              liquidityAnalysis: { type: Type.STRING },
              marketMonitoring: { type: Type.STRING },
              analysis: { type: Type.STRING }
            },
            required: ['side', 'tp', 'sl', 'entryPrice', 'confidence', 'potentialRoi', 'analysis', 'estimatedTime', 'liquidityAnalysis', 'marketMonitoring']
          },
          temperature: 0.1
        }
      });

      const response: any = await Promise.race([aiPromise, timeoutPromise]);
      const rawText = response.text?.trim() || '{}';
      ghostState.currentStatus = `AI_RESP_${symbol}_LEN_${rawText.length}`;
      const result = JSON.parse(rawText);
      if (!result.estimatedTime) result.estimatedTime = "--";
      if (result.confidence !== undefined && result.confidence > 0 && result.confidence <= 1) {
        result.confidence = Math.round(result.confidence * 100);
      }
      return { ...result, id: crypto.randomUUID(), symbol, timestamp: new Date().toISOString() };
    } catch (e: any) { 
      lastError = e.message;
      console.warn(`[AI RETRY] ${symbol} Attempt ${attempt + 1} failed: ${lastError}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000)); // Wait 2s before retry
        continue;
      }
    }
  }

  // Final failure after retries
  let errorMsg = lastError;
  if (errorMsg.includes('AI_TIMEOUT')) {
    errorMsg = "پاسخ هوش مصنوعی بیش از حد طول کشید (تایم‌اوت).";
  } else if (errorMsg.includes('API_KEY_INVALID') || errorMsg.includes('API key not valid')) {
    errorMsg = "کلید API نامعتبر است.";
  }
  
  return {
    side: "NEUTRAL",
    analysis: `خطا در تحلیل هوش مصنوعی برای ${symbol}: ${errorMsg}`,
    liquidityAnalysis: "خطا در دریافت داده‌های نقدینگی",
    marketMonitoring: "خطا در نظارت بر بازار",
    symbol,
    timestamp: new Date().toISOString(),
    confidence: 0,
    potentialRoi: 0,
    estimatedTime: "--",
    id: crypto.randomUUID()
  }; 
}

function loadState() {
  const defaults = {
    isEngineActive: true, autoPilot: true, isPaperMode: false,
    settings: { confidenceThreshold: 70, minRoi: 1.5, maxDailyDrawdown: -20.0 },
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
  } catch {
    console.warn("[STATE] Failed to load state, using defaults.");
  }
  return defaults;
}

const ghostState = loadState();

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
  ghostState.currentStatus = "MONITORING_HUNTS";
  saveState();
  
  console.log(`[AI-MONITOR] Checking ${ghostState.activePositions.length} active positions...`);
  
  try {
    // Process all positions in parallel with a small stagger
    await Promise.all(ghostState.activePositions.map(async (pos, index) => {
      try {
        await new Promise(r => setTimeout(r, index * 1500)); // Stagger AI requests
        ghostState.currentStatus = `ANALYZING_HUNT_${pos.symbol}`;
        saveState();
        const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${pos.symbol}&tsym=EUR&limit=100&aggregate=15`, { timeout: 8000 });
        const candles = res.data?.Data?.Data || [];
        if (candles.length === 0) return;
        
        const price = candles[candles.length - 1].close;
        const roundTripFee = FEE_RATE;
        const breakEvenPrice = pos.entryPrice * (1 + roundTripFee);
        const currentProfitPercent = (price - breakEvenPrice) / (breakEvenPrice || 1);
        
        if (currentProfitPercent > 0.03) {
          const newSl = breakEvenPrice * 1.02;
          if (pos.sl < newSl) pos.sl = newSl;
        } else if (currentProfitPercent > 0.02) {
          const newSl = breakEvenPrice * 1.01;
          if (pos.sl < newSl) pos.sl = newSl;
        } else if (currentProfitPercent > 0.01) {
          const newSl = breakEvenPrice * 1.002;
          if (pos.sl < newSl) pos.sl = newSl;
        }
        
        if (price <= pos.sl && pos.sl > pos.entryPrice) {
            const tradePnl = (price - pos.entryPrice) * pos.quantity;
            const netPnl = tradePnl - (pos.amount * roundTripFee);
            console.log(`[AI-MONITOR] Trailing Stop Hit for ${pos.symbol}. Net PNL: ${netPnl.toFixed(2)} EUR.`);
            
            const tradeResult = await executeTrade(pos.symbol, 'SELL', 0, pos.quantity);
            if (tradeResult.success) {
              ghostState.dailyStats.profit += netPnl;
              ghostState.totalProfit += netPnl;
              ghostState.liquidity.eur += (pos.amount + netPnl);
              ghostState.executionLogs.unshift({
                id: crypto.randomUUID(),
                symbol: pos.symbol,
                action: 'SELL',
                price,
                pnl: netPnl,
                status: 'SUCCESS',
                details: `TRAILING_STOP_PROFIT`,
                timestamp: new Date().toISOString()
              });
              const idx = ghostState.activePositions.findIndex(p => p.symbol === pos.symbol);
              if (idx !== -1) ghostState.activePositions.splice(idx, 1);
              saveState();
            }
            return;
        }

        const analysis = await getAdvancedAnalysis(pos.symbol, price, candles, pos.entryPrice);
        
        if (analysis) {
          console.log(`[AI-MONITOR] Analysis for ${pos.symbol}: ${analysis.side} (Conf: ${analysis.confidence}%)`);
          pos.lastAnalysis = analysis.analysis;
          pos.liquidityAnalysis = analysis.liquidityAnalysis;
          pos.marketMonitoring = analysis.marketMonitoring;
          pos.lastDecision = analysis.side;
          pos.lastConfidence = analysis.confidence;
          pos.lastChecked = new Date().toISOString();
          pos.estimatedTime = analysis.estimatedTime;
          
          // Update targets if AI suggests new ones and they are logically better
          if (analysis.tp > 0 && (pos.tp === 0 || analysis.tp > pos.tp)) {
            console.log(`[AI-MONITOR] Updating TP for ${pos.symbol}: ${pos.tp} -> ${analysis.tp}`);
            pos.tp = analysis.tp;
          }
          if (analysis.sl > 0 && (pos.sl === 0 || (analysis.sl > pos.sl && analysis.sl < price))) {
            console.log(`[AI-MONITOR] Updating SL for ${pos.symbol}: ${pos.sl} -> ${analysis.sl}`);
            pos.sl = analysis.sl;
          }
          
          saveState();
        } else {
          console.warn(`[AI-MONITOR] Failed to get analysis for ${pos.symbol}`);
          pos.lastChecked = new Date().toISOString(); // Still mark as checked
          saveState();
        }
        
        if (analysis && analysis.side === 'SELL') {
          const isProfitable = price > (breakEvenPrice * (1 + 0.01)); 
          const isSignificantLoss = price < (pos.entryPrice * 0.97); 
          
          if (isProfitable || (analysis.confidence >= 90 && isSignificantLoss)) {
            const tradePnl = (price - pos.entryPrice) * pos.quantity;
            const netPnl = tradePnl - (pos.amount * roundTripFee);
            console.log(`[AI-MONITOR] AI SELL for ${pos.symbol}. Net PNL: ${netPnl.toFixed(2)} EUR. Reason: ${analysis.analysis}`);
            
            const tradeResult = await executeTrade(pos.symbol, 'SELL', 0, pos.quantity);
            if (tradeResult.success) {
              ghostState.dailyStats.profit += netPnl;
              ghostState.totalProfit += netPnl;
              ghostState.liquidity.eur += (pos.amount + netPnl);
              ghostState.executionLogs.unshift({
                id: crypto.randomUUID(),
                symbol: pos.symbol,
                action: 'SELL',
                price,
                pnl: netPnl,
                status: 'SUCCESS',
                details: `AI_EXIT_CONF_${analysis.confidence}%`,
                timestamp: new Date().toISOString()
              });
              const idx = ghostState.activePositions.findIndex(p => p.symbol === pos.symbol);
              if (idx !== -1) ghostState.activePositions.splice(idx, 1);
              saveState();
            } else if (tradeResult.reason && (tradeResult.reason.includes('INSUFFICIENT_FUND') || tradeResult.reason.includes('NO_BALANCE_ON_EXCHANGE'))) {
              console.log(`[AI-MONITOR] Removing ${pos.symbol} due to missing balance on exchange.`);
              const idx = ghostState.activePositions.findIndex(p => p.symbol === pos.symbol);
              if (idx !== -1) ghostState.activePositions.splice(idx, 1);
              saveState();
            }
          }
        }
      } catch (_e: any) {
        console.error(`[AI-MONITOR] Error checking ${pos.symbol}:`, _e.message);
      }
    }));
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

    // Check for minimum liquidity before scanning
    if (ghostState.liquidity.eur < 10) {
      console.log(`[SCAN] Low liquidity (${ghostState.liquidity.eur.toFixed(2)} EUR). Scanning for signals only (No execution).`);
      ghostState.currentStatus = "SCANNING_LOW_LIQUIDITY";
    } else {
      ghostState.currentStatus = "SCANNING_MARKET";
    }
    saveState();

    console.log(`[SCAN] Starting full market scan to find the absolute BEST opportunity...`);
    const potentialTrades = [];
    
    // Scan up to 10 symbols per cycle to avoid API congestion
    const scanLimit = Math.min(10, currentWatchlist.length);
    const scanBatch = [];
    
    for (let i = 0; i < scanLimit; i++) {
      const symbol = currentWatchlist[ghostState.scanIndex % currentWatchlist.length];
      ghostState.scanIndex++;
      
      if (ghostState.activePositions.some(p => p.symbol === symbol)) {
        continue;
      }

      const productId = `${symbol}-EUR`;
      if (!ghostState.isPaperMode && availableEurPairs.length > 0 && !availableEurPairs.includes(productId)) {
        continue;
      }
      scanBatch.push(symbol);
    }

    // Process batch in parallel with a 1s delay between requests
    const results = await Promise.all(scanBatch.map(async (symbol, index) => {
      try {
        await new Promise(r => setTimeout(r, index * 1000)); // Stagger requests
        ghostState.currentStatus = `ANALYZING_${symbol}_SMC`;
        const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${symbol}&tsym=EUR&limit=100&aggregate=15`, { timeout: 8000 });
        const candles = res.data?.Data?.Data || [];
        if (candles.length === 0) return null;
        
        const price = candles[candles.length - 1].close;
        const analysis = await getAdvancedAnalysis(symbol, price, candles);
        return { symbol, price, analysis };
      } catch {
        return null;
      }
    }));

    for (const res of results) {
      if (!res) continue;
      const { symbol, price, analysis } = res;
      
      // Enforce a minimum confidence of 85% for BUY signals
      const requiredConfidence = Math.max(85, ghostState.settings.confidenceThreshold || 85);
      
      if (analysis && analysis.side === 'BUY' && analysis.confidence >= requiredConfidence && ghostState.autoPilot) {
        // Ensure potential ROI covers fees + minimum net profit (0.5% fee + 1.0% net = 1.5%)
        const isProfitableEnough = analysis.potentialRoi >= ((FEE_RATE * 100) + 1.0);
        
        if (isProfitableEnough) {
          potentialTrades.push({ symbol, price, analysis });
          console.log(`[SCAN] Found potential BUY for ${symbol} (Confidence: ${analysis.confidence}%, ROI: ${analysis.potentialRoi}%)`);
        } else {
          analysis.decision = `SKIPPED: ROI_TOO_LOW (Expected: ${analysis.potentialRoi}%, Min Required: ${((FEE_RATE * 100) + 1.0).toFixed(2)}%)`;
        }
      }
      
      if (analysis) {
        ghostState.thoughts.unshift(analysis);
        if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();
      }
    }
    
    if (potentialTrades.length > 0) {
      // Sort by confidence first, then by potential ROI
      potentialTrades.sort((a, b) => {
        if (b.analysis.confidence !== a.analysis.confidence) {
          return b.analysis.confidence - a.analysis.confidence;
        }
        return b.analysis.potentialRoi - a.analysis.potentialRoi;
      });
      
      const bestTrade = potentialTrades[0];
      console.log(`[SCAN] Selected BEST trade: ${bestTrade.symbol} (Conf: ${bestTrade.analysis.confidence}%, ROI: ${bestTrade.analysis.potentialRoi}%)`);
      
      const { symbol, price, analysis } = bestTrade;
      
      // SYSTEM LEVEL RISK MANAGEMENT: Clamp Stop Loss
      const maxSlPrice = price * 0.95; // Maximum 5% loss (wider for 15m timeframe)
      const minSlPrice = price * 0.98; // Minimum 2% loss (give it room to breathe)
      
      if (analysis.sl < maxSlPrice) {
        console.log(`[RISK] Clamping SL for ${symbol} from ${analysis.sl} to ${maxSlPrice} (Max 5% loss)`);
        analysis.sl = maxSlPrice;
      } else if (analysis.sl > minSlPrice) {
        console.log(`[RISK] Widening SL for ${symbol} from ${analysis.sl} to ${minSlPrice} (Min 2% loss to avoid noise)`);
        analysis.sl = minSlPrice;
      }

      // Calculate available liquidity for this specific trade
      const totalEur = ghostState.liquidity.eur;
      
      // Dynamic sizing: Use 20% of available capital per trade to allow up to 5 concurrent trades
      let tradeAmount = totalEur * 0.20;
      
      // Ensure minimum trade size of 10 EUR as requested for better selectivity and fee efficiency
      tradeAmount = Math.max(10, tradeAmount);
      if (tradeAmount > totalEur) tradeAmount = totalEur;
      
      // If we have less than 10 EUR, don't trade
      if (tradeAmount < 10) {
        console.log(`[SCAN] Insufficient liquidity for trade: ${tradeAmount.toFixed(2)} EUR (Min 10 required)`);
        return;
      }
      
      if (totalEur >= (tradeAmount * 1.01) && tradeAmount >= 10) { 
        const qty = tradeAmount / (price || 1);
        const tradeResult = await executeTrade(symbol, 'BUY', tradeAmount, qty);
        
        if (tradeResult.success) {
          let finalEntryPrice = price;
          if (tradeResult.orderId) {
            const actualPrice = await getActualFillPrice(tradeResult.orderId);
            if (actualPrice) {
              console.log(`[REAL_FILL] Actual entry price for ${symbol}: ${actualPrice} EUR`);
              finalEntryPrice = actualPrice;
            }
          }

          analysis.decision = `EXECUTED: BUY_${symbol}_AT_${finalEntryPrice}`;
          ghostState.activePositions.push({
            symbol, entryPrice: finalEntryPrice, currentPrice: finalEntryPrice, amount: tradeAmount, quantity: qty,
            tp: analysis.tp, sl: analysis.sl, confidence: analysis.confidence, potentialRoi: analysis.potentialRoi,
            pnl: 0, pnlPercent: 0, isPaper: ghostState.isPaperMode, timestamp: new Date().toISOString(),
            estimatedTime: analysis.estimatedTime,
            lastAnalysis: analysis.analysis,
            liquidityAnalysis: analysis.liquidityAnalysis,
            marketMonitoring: analysis.marketMonitoring
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
      
      // Update the thought for the executed trade
      const thoughtIndex = ghostState.thoughts.findIndex(t => t.symbol === symbol && t.side === 'BUY');
      if (thoughtIndex !== -1) {
        ghostState.thoughts[thoughtIndex].decision = analysis.decision;
      }
      saveState();
    } else {
      console.log(`[SCAN] No suitable trades found in this cycle.`);
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
    
    // KILL SWITCH: Daily Drawdown Limit
    const maxDrawdown = ghostState.settings.maxDailyDrawdown || -20.0;
    if (ghostState.dailyStats.profit <= maxDrawdown && ghostState.isEngineActive) {
      console.log(`[KILL SWITCH] Daily drawdown limit reached (${ghostState.dailyStats.profit.toFixed(2)} <= ${maxDrawdown}). Pausing engine.`);
      ghostState.isEngineActive = false;
      ghostState.currentStatus = "PAUSED_MAX_DRAWDOWN";
      saveState();
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
          ghostState.liquidity.eur += (pos.amount + pos.pnl);
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
            const lastFillPrice = await getLastFillPrice(symbol);
            
            ghostState.activePositions.push({
              symbol,
              entryPrice: lastFillPrice || 0, 
              currentPrice: 0,
              amount: (lastFillPrice || 0) * qty,
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
            saveState();
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
          pos.amount = curPrice * pos.quantity;
          pos.tp = curPrice * 1.03; // Default 3% TP
          pos.sl = curPrice * 0.98; // Default 2% SL
        }

        pos.currentPrice = curPrice;
        const pnlPercent = ((curPrice - pos.entryPrice) / (pos.entryPrice || 1)) * 100;
        pos.pnlPercent = pnlPercent;
        
        // Calculate net PNL (subtracting round-trip fees)
        const grossPnl = (curPrice - pos.entryPrice) * pos.quantity;
        const feeAmount = pos.amount * FEE_RATE;
        pos.pnl = grossPnl - feeAmount;
        
        const breakEvenPrice = pos.entryPrice * (1 + FEE_RATE);
        const netPnlPercent = pnlPercent - (FEE_RATE * 100);

        // Dynamic Trailing Stop & Break Even
        if (netPnlPercent > (MIN_NET_PROFIT * 100) && pos.sl < breakEvenPrice) {
          pos.sl = breakEvenPrice * 1.001; // Lock in 0.1% pure profit
          console.log(`[MONITOR] Break-Even + Profit Buffer activated for ${pos.symbol} @ ${pos.sl.toFixed(2)}`);
        }

        if (netPnlPercent > 1.5) {
          const newSl = curPrice * 0.995; // 0.5% trailing stop once in 1.5% net profit
          if (newSl > pos.sl) {
            pos.sl = newSl;
            console.log(`[MONITOR] Trailing Stop moved for ${pos.symbol} @ ${newSl.toFixed(2)}`);
          }
        }

        // EARLY EXIT: If price reaches 80% of TP
        const tpDistance = pos.tp - pos.entryPrice;
        const earlyExitPrice = pos.entryPrice + (tpDistance * 0.8);
        const canExitSafely = curPrice > (breakEvenPrice * (1 + MIN_NET_PROFIT));

        // TIME-BASED EXIT: If trade is open for > 3 hours and not in significant profit, close it to free liquidity
        const tradeAgeMs = new Date().getTime() - new Date(pos.timestamp).getTime();
        const tradeAgeHours = tradeAgeMs / (1000 * 60 * 60);
        // Only exit stagnant trades if we are at least at break-even (don't force a loss just for time)
        const isStagnant = tradeAgeHours > 3 && netPnlPercent < 0.5 && curPrice > breakEvenPrice;

        // Trigger SELL if:
        // 1. Reached TP
        // 2. Reached SL (Hard stop loss, must execute even if in loss)
        // 3. Reached 80% of TP and is safe to exit
        // 4. Trade is stagnant (time-based exit)
        if (curPrice >= pos.tp || curPrice <= pos.sl || (tpDistance > 0 && curPrice >= earlyExitPrice && netPnlPercent > 0.4 && canExitSafely) || isStagnant) {
          let reason = curPrice >= pos.tp ? 'TAKE_PROFIT' : (curPrice <= pos.sl ? 'STOP_LOSS' : 'EARLY_EXIT_80%_TP');
          if (isStagnant && curPrice < pos.tp && curPrice > pos.sl) reason = 'TIME_STAGNATION_EXIT';
          
          const tradeResult = await executeTrade(pos.symbol, 'SELL', 0, pos.quantity);
          
          if (tradeResult.success) {
            ghostState.dailyStats.profit += pos.pnl;
            ghostState.totalProfit += pos.pnl;
            ghostState.liquidity.eur += (pos.amount + pos.pnl);
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
    } catch (e) {
      console.error("[MONITOR ERROR]", e);
    }
  } finally {
    isMonitoring = false;
    saveState();
  }
}

function saveState() { 
  try { 
    fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); 
  } catch (e) {
    console.error("[STATE SAVE ERROR]", e);
  } 
}

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

  app.post('/api/ghost/settings', (req, res) => {
    if (req.body.settings) {
      ghostState.settings = { ...ghostState.settings, ...req.body.settings };
      saveState();
    }
    res.json({ success: true, settings: ghostState.settings });
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
    setInterval(monitorPositionsAI, 45000); // AI Position Analysis (45s)
    setInterval(scanWatchlist, 60000);      // New Signal Scanning (60s)
    setInterval(listAvailableProducts, 300000); // Refresh products every 5m
  });
}

startServer();
