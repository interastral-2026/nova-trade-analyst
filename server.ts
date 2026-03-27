
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

const getBestApiKey = () => {
  const keys = [
    { name: "GEMINI_API_KEY", val: (process.env.GEMINI_API_KEY || "").trim() },
    { name: "API_KEY", val: (process.env.API_KEY || "").trim() }
  ];

  // Look for a key that starts with AIza (typical for Google APIs)
  const validKey = keys.find(k => k.val.startsWith('AIza'));
  if (validKey) return { val: validKey.val, source: validKey.name };

  // Fallback to any non-empty key that isn't a known placeholder
  const fallbackKey = keys.find(k => k.val && !k.val.startsWith('MY_GE') && k.val !== 'your_gemini_api_key_here');
  if (fallbackKey) return { val: fallbackKey.val, source: fallbackKey.name };

  // Absolute fallback
  return { val: keys[0].val || keys[1].val || "", source: keys[0].val ? keys[0].name : (keys[1].val ? keys[1].name : "NONE") };
};

let { val: API_KEY, source: API_KEY_SOURCE } = getBestApiKey();

fs.appendFileSync('debug.log', `[INIT] API_KEY Source: ${API_KEY_SOURCE}, Starts with: ${API_KEY.substring(0, 5)}... (Length: ${API_KEY.length})\n`);
const CB_API_KEY = (process.env.CB_API_KEY || "").trim();
const CB_API_SECRET = process.env.CB_API_SECRET 
  ? process.env.CB_API_SECRET.replace(/^"|"$/g, '').replace(/\\n/g, '\n').trim() 
  : "";

const WATCHLIST = ['XAU', 'WTI', 'GBP'];
const STATE_FILE = './ghost_state.json';
const FEE_RATE = 0.012; // 1.2% round-trip fee (0.6% per side)
const MIN_NET_PROFIT = 0.005; // 0.5% minimum net profit after fees

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

async function get24hStats(symbol) {
  try {
    const response = await axios.get(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${symbol}&tsyms=EUR`, {
      timeout: 5000,
      headers: { 'User-Agent': 'GhostSMCBot/1.0' }
    });
    const data = response.data?.RAW?.[symbol]?.['EUR'];
    if (!data) return null;
    return {
      open: data.OPEN24HOUR,
      high: data.HIGH24HOUR,
      low: data.LOW24HOUR,
      volume: data.VOLUME24HOUR,
      last: data.PRICE,
      volume_30day: data.VOLUME24HOUR * 30 // Mock 30d volume
    };
  } catch {
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
    
    // Improved truncation: handle integers and ensure we don't round up
    let baseSizeStr = finalQty.toFixed(8);
    const parts = baseSizeStr.split('.');
    if (parts.length > 1) {
      baseSizeStr = parts[0] + '.' + parts[1].substring(0, 8);
    }
    // Remove trailing zeros for cleaner API call
    baseSizeStr = parseFloat(baseSizeStr).toString();

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

let lastQuotaExhaustedTime = 0;
const QUOTA_COOLDOWN_MS = 60000; // 1 minute cooldown on 429

// --- TECHNICAL INDICATORS ---
function calculateEMA(data: number[], period: number) {
  if (data.length < period) return data[data.length - 1];
  const k = 2 / (period + 1);
  let ema = data[0];
  for (let i = 1; i < data.length; i++) {
    ema = (data[i] * k) + (ema * (1 - k));
  }
  return ema;
}

function calculateRSI(data: number[], period: number = 14) {
  if (data.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = data[i] - data[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

async function getAdvancedAnalysis(symbol, price, candles, _entryPrice = null) {
  // Add a small random delay (0-3s) to prevent simultaneous bursts
  await new Promise(r => setTimeout(r, Math.random() * 3000));

  if (Date.now() - lastQuotaExhaustedTime < QUOTA_COOLDOWN_MS) {
    return {
      side: "NEUTRAL",
      analysis: "وضعیت: در حال انتظار برای بازنشانی سهمیه API (Rate Limit Cooldown)",
      symbol,
      timestamp: new Date().toISOString(),
      confidence: 0,
      potentialRoi: 0,
      id: crypto.randomUUID()
    };
  }
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
  const closes = (candles || []).map(c => c.close);
  const rsi = calculateRSI(closes, 14);
  const ema20 = calculateEMA(closes, 20);
  const ema200 = calculateEMA(closes, 200);
  const trend = price > ema200 ? "BULLISH" : "BEARISH";

  const history = (candles || []).slice(-60).map(c => ({ h: c.high, l: c.low, c: c.close }));
  const stats24h = await get24hStats(symbol);
  
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('AI_TIMEOUT')), 45000);
  });

  try {
    ghostState.currentStatus = `AI_REQ_${symbol}`;
    const aiPromise = ai.models.generateContent({
      model: 'gemini-3.1-flash-lite-preview', 
      contents: [{ parts: [{ text: `SMC_ANALYSIS_SCAN: ${symbol} @ ${price} EUR (15M TIMEFRAME). 
TECHNICAL_INDICATORS: RSI=${rsi.toFixed(2)}, EMA20=${ema20.toFixed(2)}, EMA200=${ema200.toFixed(2)}, TREND=${trend}.
HISTORY_15M_CANDLES: ${JSON.stringify(history)}. 
STATS_24H: ${JSON.stringify(stats24h)}.
CURRENT_DAILY_PROFIT: ${ghostState.dailyStats.profit} EUR.` }] }],
      config: {
        systemInstruction: `You are an ELITE SCALPING AI specializing in Gold (XAU), Oil (WTI), and Pound (GBP) on 15-minute charts.
Your goal: Identify 2-3 high-quality trades per day with 80%+ confidence.

CORE STRATEGY (Triple Confirmation):
1. Trend Alignment: If price > EMA200, prefer BUY. If price < EMA200, prefer SELL.
2. Momentum (RSI): Look for RSI reversals (oversold < 30, overbought > 70) or strong momentum (RSI > 50 for BUY).
3. SMC Confluence: Look for Order Blocks, Fair Value Gaps (FVG), and Market Structure Shifts (MSS).
4. Session Awareness: You are most aggressive during London (08:00-16:30 UTC) and New York (13:00-21:00 UTC) sessions.

HOW YOU WORK (Explain this in your analysis):
- You scan the 15m chart every few minutes.
- You calculate EMA200 to determine the "Big Trend".
- You check RSI to see if the move is exhausted or just starting.
- You look for "Smart Money" footprints (FVG/Order Blocks) where big banks enter.
- You only suggest a trade if all 3 confluences align.

CONFIDENCE SCORING:
- 85-100%: Perfect Triple Confirmation setup. High volume, clear trend, clear SMC entry.
- 80-84%: Strong setup, but slightly lower volume or minor resistance nearby.
- 60-79%: Choppy or ranging market. "Observing" state.
- 0-59%: High uncertainty. DO NOT TRADE.

OUTPUT RULES:
- If confidence < 80%, side MUST be NEUTRAL.
- Analysis MUST be in PERSIAN (Farsi).
- Explain EXACTLY why you are waiting if confidence is low.
- Return ONLY JSON.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ["BUY", "SELL", "NEUTRAL"] },
            confidence: { type: Type.INTEGER, description: "0-100" },
            potentialRoi: { type: Type.NUMBER, description: "Expected net profit %" },
            sl: { type: Type.NUMBER, description: "Stop loss price" },
            tp: { type: Type.NUMBER, description: "Take profit price" },
            analysis: { type: Type.STRING, description: "Detailed reasoning in PERSIAN" }
          },
          required: ["side", "confidence", "potentialRoi", "sl", "tp", "analysis"]
        },
        temperature: 0.1
      }
    });

    const response: any = await Promise.race([aiPromise, timeoutPromise]);
    const rawText = response.text?.trim() || '{}';
    ghostState.currentStatus = `AI_RESP_${symbol}_LEN_${rawText.length}`;
    const result = JSON.parse(rawText);
    console.log(`[AI ANALYSIS] ${symbol}: ${result.side} (${result.confidence}%)`);
    if (result.confidence !== undefined && result.confidence > 0 && result.confidence <= 1) {
      result.confidence = Math.round(result.confidence * 100);
    }
    return { ...result, id: crypto.randomUUID(), symbol, timestamp: new Date().toISOString() };
  } catch (e: any) { 
    let errorMsg = e.message;
    
    if (errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
      lastQuotaExhaustedTime = Date.now();
      errorMsg = "سهمیه API تمام شده است. ۱ دقیقه صبر کنید...";
    } else if (errorMsg.includes('API_KEY_INVALID') || errorMsg.includes('API key not valid')) {
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
    isEngineActive: true, autoPilot: true, isPaperMode: true,
    settings: { confidenceThreshold: 80, defaultTradeSize: 100.0, minRoi: 1.5, maxDailyDrawdown: -50.0, dailyProfitTargetPercent: 5.0, riskPerTradePercent: 100 },
    thoughts: [], executionLogs: [], activePositions: [],
    liquidity: { eur: 1000, usdc: 1000 }, actualBalances: {}, 
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
    console.error("Failed to load state");
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
  
  console.log(`[AI-MONITOR] Checking ${ghostState.activePositions.length} active positions...`);
  
  try {
    for (let i = ghostState.activePositions.length - 1; i >= 0; i--) {
      const pos = ghostState.activePositions[i];
      try {
        const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${pos.symbol}&tsym=EUR&limit=60`, { timeout: 8000 });
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
    const now = new Date();
    const hourUtc = now.getUTCHours();
    
    // London Session: 08:00 - 16:30 UTC
    // New York Session: 13:00 - 21:00 UTC
    // Overlap: 13:00 - 16:30 UTC (Highest Volatility)
    const isLondon = hourUtc >= 8 && hourUtc <= 16;
    const isNewYork = hourUtc >= 13 && hourUtc <= 21;
    const isHighVolatilitySession = isLondon || isNewYork;
    
    // Clear old errors if API key is now valid
    if (ghostState.thoughts.length > 0 && ghostState.thoughts[0].confidence === 0 && ghostState.thoughts[0].analysis.includes('API')) {
      ghostState.thoughts = [];
    }

    // Check Daily Profit Target
    const totalBalance = (ghostState.liquidity.eur || 0) + (ghostState.activePositions.reduce((sum, p) => sum + (p.amount || 0), 0));
    const profitTarget = totalBalance * ((ghostState.settings.dailyProfitTargetPercent || 2.0) / 100);
    if (ghostState.dailyStats.profit >= profitTarget && ghostState.dailyStats.profit > 0) {
      console.log(`[SCAN] Daily profit target reached (${ghostState.dailyStats.profit.toFixed(2)} EUR). Resting for today.`);
      ghostState.currentStatus = "DAILY_TARGET_REACHED";
      return;
    }

    const currentWatchlist = (availableEurPairs.length > 0 && !ghostState.isPaperMode)
      ? availableEurPairs.map(p => p.split('-')[0]) 
      : WATCHLIST;
    
    console.log(`[SCAN] Watchlist: ${currentWatchlist.join(', ')} (Paper: ${ghostState.isPaperMode})`);

    const batchSize = 3; 
    const candidates: any[] = [];

    for (let i = 0; i < batchSize; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 2000));
      
      const symbol = currentWatchlist[ghostState.scanIndex % currentWatchlist.length];
      ghostState.scanIndex++;
      
      if (ghostState.activePositions.some(p => p.symbol === symbol)) continue;

      // Skip scanning if outside high volatility hours (only if highPrecision is ON)
      if (ghostState.settings.highPrecision && !isHighVolatilitySession && !ghostState.isPaperMode) {
        console.log(`[SCAN] Low volatility session (${hourUtc} UTC). Skipping ${symbol} for High Precision.`);
        continue;
      }

      const productId = `${symbol}-EUR`;
      if (!ghostState.isPaperMode && availableEurPairs.length > 0 && !availableEurPairs.includes(productId)) continue;

      try {
        const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${symbol}&tsym=EUR&limit=60&aggregate=15`, { timeout: 8000 });
        const candles = res.data?.Data?.Data || [];
        if (candles.length === 0) continue;
        
        const price = candles[candles.length - 1].close;
        const analysis = await getAdvancedAnalysis(symbol, price, candles);
        
        const minConfidence = ghostState.settings.highPrecision ? 90 : (ghostState.settings.confidenceThreshold || 80);
        const minNetProfit = ghostState.settings.highPrecision ? 0.008 : MIN_NET_PROFIT;

        if (analysis && analysis.side === 'BUY' && analysis.confidence >= minConfidence) {
          const isProfitableEnough = analysis.potentialRoi >= ((FEE_RATE * 100) + (minNetProfit * 100));
          if (isProfitableEnough) {
            candidates.push({ symbol, price, analysis });
          }
        }

        if (analysis) {
          ghostState.thoughts.unshift(analysis);
          if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();
        }
      } catch (e) {
        console.error(`[SCAN ERROR] ${symbol}:`, e.message);
      }
    }

    // Pick the BEST candidate if any
    if (candidates.length > 0 && ghostState.activePositions.length < 4 && ghostState.autoPilot) {
      // Sort by confidence * potentialRoi to find the "best" setup
      candidates.sort((a, b) => (b.analysis.confidence * b.analysis.potentialRoi) - (a.analysis.confidence * a.analysis.potentialRoi));
      
      const best = candidates[0];
      const { symbol, price, analysis } = best;

      // SYSTEM LEVEL RISK MANAGEMENT: Clamp Stop Loss to max 3% loss
      const maxSlPrice = price * 0.97;
      if (analysis.sl < maxSlPrice) {
        analysis.sl = maxSlPrice;
      }

      const totalEur = ghostState.liquidity.eur;
      const minTradeSize = 5; // Lowered to 5 EUR for smaller accounts
      const riskPercent = (ghostState.settings.riskPerTradePercent || 15) / 100;
      const maxPerTrade = totalEur * riskPercent;
      const tradeAmount = Math.max(minTradeSize, Math.min(ghostState.settings.defaultTradeSize || 50, maxPerTrade));

      if (totalEur < minTradeSize) {
        console.warn(`[TRADE] Insufficient funds: ${totalEur} EUR (Min: ${minTradeSize})`);
        return;
      }

      if (totalEur - tradeAmount < 0.5) { // Leave at least 0.5 EUR for fees
        console.warn(`[TRADE] Risk too high for current balance. Balance: ${totalEur}, Trade: ${tradeAmount}`);
        return;
      }
        const qty = tradeAmount / (price || 1);
        const tradeResult = await executeTrade(symbol, 'BUY', tradeAmount, qty);
        
        if (tradeResult.success) {
          ghostState.activePositions.push({
            symbol, entryPrice: price, currentPrice: price, peakPrice: price, amount: tradeAmount, quantity: qty,
            tp: analysis.tp, sl: analysis.sl, confidence: analysis.confidence, potentialRoi: analysis.potentialRoi,
            estimatedTimeMinutes: analysis.estimatedTimeMinutes,
            analysis: analysis.analysis,
            pnl: 0, pnlPercent: 0, isPaper: ghostState.isPaperMode, timestamp: new Date().toISOString()
          });
          
          ghostState.liquidity.eur -= tradeAmount;

          ghostState.executionLogs.unshift({ 
            id: crypto.randomUUID(), 
            symbol, 
            action: 'BUY', 
            price, 
            status: 'SUCCESS', 
            details: `BEST_CANDIDATE_CONF_${analysis.confidence}%`,
            timestamp: new Date().toISOString() 
          });
          ghostState.dailyStats.trades++;
          saveState();
        }
      }
    } finally {
      isScanning = false;
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
        if (curPrice > (pos.peakPrice || 0)) {
          pos.peakPrice = curPrice;
        }
        const pnlPercent = ((curPrice - pos.entryPrice) / (pos.entryPrice || 1)) * 100;
        pos.pnlPercent = pnlPercent;
        pos.pnl = (curPrice - pos.entryPrice) * pos.quantity;
        
        const breakEvenPrice = pos.entryPrice * (1 + FEE_RATE);
        const netPnlPercent = pnlPercent - (FEE_RATE * 100);

        // Dynamic Trailing Stop & Break Even (Aggressive for Scalping)
        if (netPnlPercent > 0.15 && pos.sl < breakEvenPrice) {
          pos.sl = breakEvenPrice * (1 + 0.001); // BE + 0.1% profit buffer
          console.log(`[MONITOR] Break-Even activated for ${pos.symbol} @ ${pos.sl.toFixed(2)}`);
        }

        if (netPnlPercent > 0.4) {
          const newSl = curPrice * 0.9985; // 0.15% trailing stop once in 0.4% net profit
          if (newSl > pos.sl) {
            pos.sl = newSl;
            console.log(`[MONITOR] Aggressive Trailing Stop moved for ${pos.symbol} @ ${newSl.toFixed(2)}`);
          }
        }

        if (netPnlPercent > 1.0) {
          const newSl = curPrice * 0.995; // 0.5% trailing stop once in 1% net profit
          if (newSl > pos.sl) {
            pos.sl = newSl;
          }
        }

        // EARLY EXIT: If price reaches 80% of TP
        const tpDistance = pos.tp - pos.entryPrice;
        const earlyExitPrice = pos.entryPrice + (tpDistance * 0.8);
        const canExitSafely = curPrice > (breakEvenPrice * (1 + MIN_NET_PROFIT));

        // TIME-BASED EXIT: Scalping focus (15m candles). If no profit after ~2 candles (30 mins), exit.
        const tradeAgeMs = new Date().getTime() - new Date(pos.timestamp).getTime();
        const tradeAgeMins = tradeAgeMs / (1000 * 60);
        const isStagnant = tradeAgeMins > 30 && netPnlPercent < 0.2;

        // PROFIT SATURATION EXIT: If in good profit (>0.5% net) and price drops 0.15% from peak, exit to lock gains.
        const dropFromPeak = pos.peakPrice ? ((pos.peakPrice - curPrice) / pos.peakPrice) * 100 : 0;
        const isProfitSaturated = netPnlPercent > 0.5 && dropFromPeak > 0.15;

        // Trigger SELL if:
        // 1. Reached TP
        // 2. Reached SL
        // 3. Reached 80% of TP and is safe to exit
        // 4. Trade is stagnant (time-based exit)
        // 5. Profit is saturated (momentum fade)
        if (curPrice >= pos.tp || curPrice <= pos.sl || (tpDistance > 0 && curPrice >= earlyExitPrice && netPnlPercent > 0.4 && canExitSafely) || isStagnant || isProfitSaturated) {
          let reason = curPrice >= pos.tp ? 'TAKE_PROFIT' : (curPrice <= pos.sl ? 'STOP_LOSS' : 'EARLY_EXIT_80%_TP');
          if (isStagnant) reason = 'TIME_STAGNATION_30M';
          if (isProfitSaturated) reason = 'MOMENTUM_FADE_EXIT';
          
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
    } catch (e: any) {
      console.error("[MONITOR ERROR] Failed to monitor positions:", e.message);
    }
  } catch (e: any) {
    console.error("[MONITOR FATAL ERROR]:", e.message);
  } finally {
    isMonitoring = false;
    saveState();
  }
}

function saveState() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch { console.error("Failed to save state"); } }

// --- SERVER SETUP ---

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.get('/api/ping', (req, res) => res.json({ status: 'pong', timestamp: new Date().toISOString() }));
  app.get('/api/ghost/state', (req, res) => res.json(ghostState));
  app.get('/api/ghost/pending-analysis', (req, res) => res.json([]));
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

  app.post('/api/ghost/refill', (req, res) => {
    if (ghostState.isPaperMode) {
      ghostState.liquidity.eur = 1000;
      ghostState.liquidity.usdc = 1000;
      saveState();
      return res.json({ success: true, liquidity: ghostState.liquidity });
    }
    res.status(400).json({ success: false, error: "Only available in Paper Mode" });
  });

  app.post('/api/ghost/api-key', (req, res) => {
    const { key } = req.body;
    if (key && key.startsWith('AIza')) {
      API_KEY = key;
      API_KEY_SOURCE = "USER_INPUT";
      console.log(`[API] API Key updated manually from UI`);
      res.json({ status: 'ok' });
    } else {
      res.status(400).json({ error: 'Invalid API key format' });
    }
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
    setInterval(scanWatchlist, 45000);      // New Signal Scanning (45s)
    setInterval(listAvailableProducts, 300000); // Refresh products every 5m
  });
}

startServer();
