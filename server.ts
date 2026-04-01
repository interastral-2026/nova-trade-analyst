
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
import { GhostState } from './types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Global Error Handlers for Diagnostics
process.on('uncaughtException', (err) => {
  fs.appendFileSync('debug.log', `[CRASH] Uncaught Exception: ${err.stack}\n`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, _promise) => {
  fs.appendFileSync('debug.log', `[CRASH] Unhandled Rejection: ${reason}\n`);
});

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

fs.appendFileSync('debug.log', `[INIT] Coinbase API Key: ${CB_API_KEY ? 'PRESENT' : 'MISSING'}, Secret: ${CB_API_SECRET ? 'PRESENT' : 'MISSING'}\n`);

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'LINK', 'MATIC', 'XRP', 'AVAX', 'LTC'];
const STATE_FILE = path.join(process.cwd(), 'ghost_state.json');
const FEE_RATE = 0.008; // 0.8% round-trip fee (0.4% per side)
const MIN_NET_PROFIT = 0.003; // 0.3% minimum net profit after fees

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
      .filter((p: any) => p.quote_currency_id === 'EUR' && p.is_disabled === false)
      .map((p: any) => p.product_id);
    console.log("--------------------------------------------------");
    console.log("✅ VALID EUR TRADING PAIRS FOR YOUR ACCOUNT:");
    console.log(availableEurPairs.join(', '));
    console.log("--------------------------------------------------");
  } catch (e: any) {
    console.warn("[PRODUCTS ERROR] Could not fetch valid pairs:", e.message);
  }
}

function generateCoinbaseJWT(request_method: string, request_path: string) {
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
  } catch (e: any) {
    console.error("JWT Error:", e.message);
    return null;
  }
}

async function get24hStats(symbol) {
  try {
    let tsym = 'EUR';
    let fsym = symbol.toUpperCase().trim();
    
    // Commodity Mapping
    if (fsym === 'XAU') fsym = 'PAXG';
    if (fsym === 'WTI') fsym = 'OIL';
    
    if (fsym === 'PAXG' || fsym === 'OIL') tsym = 'USD';

    const response = await axios.get(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${fsym}&tsyms=${tsym}`, {
      timeout: 5000,
      headers: { 'User-Agent': 'GhostSMCBot/1.0' }
    });
    
    let data = response.data?.RAW?.[fsym]?.[tsym];
    
    // Fallback if EUR failed
    if (!data && tsym === 'EUR') {
      tsym = 'USD';
      const fallbackRes = await axios.get(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${symbol}&tsyms=USD`, { timeout: 5000 });
      data = fallbackRes.data?.RAW?.[symbol]?.['USD'];
    }

    if (!data) return null;

    const conversionRate = tsym === 'USD' ? 1 / 1.08 : 1;

    return {
      open: data.OPEN24HOUR * conversionRate,
      high: data.HIGH24HOUR * conversionRate,
      low: data.LOW24HOUR * conversionRate,
      volume: data.VOLUME24HOUR,
      last: data.PRICE * conversionRate,
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
  } catch (e: any) {
    console.error("[SYNC ERROR] Failed to fetch Coinbase balances:", e.message);
    return false;
  }
}

async function executeTrade(symbol: string, side: string, amount: number, quantity: number) {
  if (ghostState.isPaperMode) {
    console.log(`[PAPER TRADE SUCCESS] ${side} ${symbol} (Amount: ${amount}, Qty: ${quantity})`);
    return { success: true };
  }

  const baseSymbol = symbol.includes('-') ? symbol.split('-')[0] : symbol;
  let productId = `${baseSymbol}-EUR`;
  
  // Special handling for PAXG: if PAXG-EUR is not in available pairs, try PAXG-USD or PAXG-USDC
  if (baseSymbol === 'PAXG' && !ghostState.isPaperMode && availableEurPairs.length > 0 && !availableEurPairs.includes(productId)) {
    if (availableEurPairs.includes('PAXG-USD')) productId = 'PAXG-USD';
    else if (availableEurPairs.includes('PAXG-USDC')) productId = 'PAXG-USDC';
    else {
      // If no PAXG pair found in our list, let's try to find ANY PAXG pair
      const anyPaxgPair = availableEurPairs.find(p => p.startsWith('PAXG-'));
      if (anyPaxgPair) productId = anyPaxgPair;
    }
    console.log(`[TRADE] PAXG-EUR not found, using fallback: ${productId}`);
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
const QUOTA_COOLDOWN_MS = 120000; // 2 minute cooldown on 429

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

async function getAdvancedAnalysis(symbol: string, price: number, candles: any[], _entryPrice: number | null = null) {
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

  const history = (candles || []).slice(-100).map(c => ({ h: c.high, l: c.low, c: c.close }));
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
        systemInstruction: `You are a SENIOR QUANTITATIVE STRATEGIST specializing in Smart Money Concepts (SMC) and Institutional Order Flow.
Your goal: Identify high-probability institutional setups on 15-minute charts for short-term profitable trades.

CORE ANALYSIS PROTOCOL:
1. Market Structure: Identify the current swing high/low. Look for Break of Structure (BOS) or Change of Character (ChoCH).
2. Liquidity & Gaps: Locate Fair Value Gaps (FVG) and Liquidity Pools (Buy-side/Sell-side).
3. Institutional Footprints: Identify valid Order Blocks (OB) that led to a strong displacement.
4. Confluence: Suggest a trade if there is a clear Market Structure Shift (MSS) aligned with RSI momentum and EMA200 trend.

SCORING LOGIC:
- 80-100%: A-Grade Setup. Clear MSS + FVG fill + OB bounce.
- 70-79%: B-Grade Setup. Strong trend and momentum, good for quick scalps.
- 50-69%: Neutral/Consolidation. High risk of "choppiness".
- 0-49%: No clear edge.

OUTPUT RULES:
- If confidence < 70%, side MUST be NEUTRAL.
- Analysis MUST be in PERSIAN (Farsi) and explain the specific SMC elements found.
- ROI and Confidence must be REALISTIC based on the 15m volatility. Aim for at least 1.5% ROI.
- potentialRoi MUST be calculated as: ((tp - price) / price) * 100 for BUY, or ((price - tp) / price) * 100 for SELL.
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
    fs.appendFileSync('debug.log', `[AI_RAW] ${symbol}: ${rawText.substring(0, 150)}...\n`);
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
    fs.appendFileSync('debug.log', `[AI ERROR] ${symbol}: ${errorMsg} | Original: ${e.message}\n`);
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

function loadState(): GhostState {
  fs.appendFileSync('debug.log', `[INIT] Loading state from ${STATE_FILE}...\n`);
  const defaults: GhostState = {
    isEngineActive: true, autoPilot: true, isPaperMode: true,
    settings: { confidenceThreshold: 75, defaultTradeSize: 100.0, minRoi: 1.5, maxDailyDrawdown: -50.0, dailyProfitTargetPercent: 5.0, riskPerTradePercent: 100 },
    thoughts: [], executionLogs: [], activePositions: [],
    liquidity: { eur: 1000, usdc: 1000 }, actualBalances: {}, 
    dailyStats: { trades: 0, profit: 0, dailyGoal: 50.0, lastResetDate: "" },
    totalProfit: 0,
    currentStatus: "INITIALIZING", scanIndex: 0
  };
  try { 
    if (fs.existsSync(STATE_FILE)) {
      const content = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(content);
      fs.appendFileSync('debug.log', `[INIT] State file loaded successfully.\n`);
      return { 
        ...defaults, 
        ...parsed,
        settings: { ...defaults.settings, ...(parsed.settings || {}) }
      };
    } else {
      fs.appendFileSync('debug.log', `[INIT] State file not found, using defaults.\n`);
    }
  } catch (e: any) {
    fs.appendFileSync('debug.log', `[INIT] Error loading state: ${e.message}\n`);
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
      if (i < ghostState.activePositions.length - 1) await new Promise(r => setTimeout(r, 5000));
      const pos = ghostState.activePositions[i];
      try {
        let tsym = 'EUR';
        let fsym = pos.symbol.toUpperCase().trim();
        
        // Commodity Mapping
        if (fsym === 'XAU') fsym = 'PAXG';
        if (fsym === 'WTI') fsym = 'OIL';
        
        if (fsym === 'PAXG' || fsym === 'OIL') tsym = 'USD';

        let apiUrl = `https://min-api.cryptocompare.com/data/v2/histominute?fsym=${fsym}&tsym=${tsym}&limit=60`;
        let res = await axios.get(apiUrl, { timeout: 8000 });
        
        if (res.data?.Response === 'Error' && tsym === 'EUR') {
          tsym = 'USD';
          apiUrl = `https://min-api.cryptocompare.com/data/v2/histominute?fsym=${fsym}&tsym=USD&limit=60`;
          res = await axios.get(apiUrl, { timeout: 8000 });
        }

        const candles = res.data?.Data?.Data || [];
        if (candles.length === 0) continue;
        
        let price = candles[candles.length - 1].close;
        if (tsym === 'USD') {
          price = price / 1.08; // Convert to EUR
        }

        const analysis = await getAdvancedAnalysis(pos.symbol, price, candles, pos.entryPrice);
        
        const isOppositeSignal = (pos.side === 'BUY' && analysis.side === 'SELL') || (pos.side === 'SELL' && analysis.side === 'BUY');

        if (analysis && isOppositeSignal) {
          const pnlPercent = pos.side === 'SELL'
            ? ((pos.entryPrice - price) / pos.entryPrice) * 100
            : ((price - pos.entryPrice) / pos.entryPrice) * 100;
          
          const netPnlPercent = pnlPercent - (FEE_RATE * 100);
          const isProfitable = netPnlPercent > MIN_NET_PROFIT;
          
          // AI OPPOSITE SIGNAL: Exit if profitable or if confidence is very high (emergency exit)
          if (isProfitable || analysis.confidence >= 80) {
            const tradePnl = pos.side === 'SELL'
              ? (pos.entryPrice - price) * pos.quantity
              : (price - pos.entryPrice) * pos.quantity;
            
            console.log(`[AI-MONITOR] AI ${analysis.side} (Exit) for ${pos.symbol} ${pos.side}. Net PNL: ${tradePnl.toFixed(2)} EUR. Reason: ${analysis.analysis}`);
            
            const exitSide = pos.side === 'BUY' ? 'SELL' : 'BUY';
            const tradeResult = await executeTrade(pos.symbol, exitSide, 0, pos.quantity);
            if (tradeResult.success) {
              ghostState.dailyStats.profit += tradePnl;
              ghostState.totalProfit += tradePnl;
              ghostState.liquidity.eur += (pos.amount + tradePnl);
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
    const totalBalance = (ghostState.liquidity.eur || 0) + (ghostState.activePositions.reduce((sum: number, p) => sum + (p.amount || 0), 0));
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
      if (i > 0) await new Promise(r => setTimeout(r, 5000));
      
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
        let fsym = symbol.toUpperCase().trim();
        // PAXG, XAU, and WTI should always use USD for maximum data reliability
        let tsym = (fsym === 'PAXG' || fsym === 'XAU' || fsym === 'WTI') ? 'USD' : 'EUR';
        
        // Fallback for Gold: Use PAXG (Gold-backed crypto) which has much better API support
        if (fsym === 'XAU') {
          console.log(`[SCAN] Using PAXG as a reliable proxy for XAU (Gold)`);
          fsym = 'PAXG';
          tsym = 'USD';
        }
        
        // Fallback for Oil: Use OIL index
        if (fsym === 'WTI') {
          console.log(`[SCAN] Using OIL as a reliable proxy for WTI (Oil)`);
          fsym = 'OIL';
          tsym = 'USD';
        }

        let apiUrl = `https://min-api.cryptocompare.com/data/v2/histominute?fsym=${fsym}&tsym=${tsym}&limit=100&aggregate=15`;
        console.log(`[SCAN] Fetching data for ${symbol} (as ${fsym}): ${apiUrl}`);
        let res = await axios.get(apiUrl, { timeout: 8000 });
        
        // If still error, try without aggregate or different tsym
        if (res.data?.Response === 'Error') {
          console.log(`[SCAN] Primary fetch failed for ${fsym}, trying simple minute data...`);
          apiUrl = `https://min-api.cryptocompare.com/data/histominute?fsym=${fsym}&tsym=USD&limit=100`;
          res = await axios.get(apiUrl, { timeout: 8000 });
        }

        const candles = res.data?.Data?.Data || res.data?.Data || [];
        
        if (candles.length === 0 || res.data?.Response === 'Error') {
          console.warn(`[SCAN] No candle data for ${symbol}. API Response:`, JSON.stringify(res.data).substring(0, 200));
          continue;
        }

        // If we used USD, we need to convert the price to EUR for consistency in the bot
        let price = candles[candles.length - 1].close;
        if (tsym === 'USD') {
          // Approximate conversion if we don't have a live rate handy
          // In a real app, we'd fetch EUR-USD rate. For now, let's assume 1.08
          price = price / 1.08; 
          console.log(`[SCAN] Converted ${symbol} price from USD to EUR: ${price}`);
        }
        const analysis = await getAdvancedAnalysis(symbol, price, candles);
        
        const minConfidence = ghostState.settings.highPrecision ? 85 : (ghostState.settings.confidenceThreshold || 78);
        const minNetProfit = ghostState.settings.highPrecision ? 0.006 : MIN_NET_PROFIT;

        if (analysis && (analysis.side === 'BUY' || analysis.side === 'SELL') && analysis.confidence >= minConfidence) {
          const isProfitableEnough = analysis.potentialRoi >= ((FEE_RATE * 100) + (minNetProfit * 100));
          if (isProfitableEnough) {
            candidates.push({ symbol, price, analysis });
          }
        }

        if (analysis) {
          ghostState.thoughts.unshift(analysis);
          if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();
        }
      } catch (e: any) {
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
        const tradeResult = await executeTrade(symbol, analysis.side, tradeAmount, qty);
        
        if (tradeResult.success) {
          ghostState.activePositions.push({
            symbol, side: analysis.side, entryPrice: price, currentPrice: price, peakPrice: price, amount: tradeAmount, quantity: qty,
            tp: analysis.tp, sl: analysis.sl, confidence: analysis.confidence, potentialRoi: analysis.potentialRoi,
            estimatedTimeMinutes: analysis.estimatedTimeMinutes,
            analysis: analysis.analysis,
            pnl: 0, pnlPercent: 0, isPaper: ghostState.isPaperMode, timestamp: new Date().toISOString()
          });
          
          if (analysis.side === 'BUY') {
            ghostState.liquidity.eur -= tradeAmount;
          } else {
            // For SELL (Short), we technically "borrow" or sell first. 
            // In spot, this is complex, but for the bot's logic, we track it.
            ghostState.liquidity.eur -= tradeAmount; 
          }

          ghostState.executionLogs.unshift({ 
            id: crypto.randomUUID(), 
            symbol, 
            action: analysis.side, 
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
              side: 'BUY',
              entryPrice: 0, 
              currentPrice: 0,
              peakPrice: 0,
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
    const symbolsList = ghostState.activePositions.map((p) => p.symbol);
    
    try {
      // Prepare symbols for price fetching
      const mappedSymbols = symbolsList.map(s => {
        const up = s.toUpperCase().trim();
        if (up === 'XAU') return 'PAXG';
        if (up === 'WTI') return 'OIL';
        return up;
      });

      const resEur = await axios.get(`https://min-api.cryptocompare.com/data/pricemulti?fsyms=${mappedSymbols.join(',')}&tsyms=EUR`, { timeout: 8000 });
      const resUsd = await axios.get(`https://min-api.cryptocompare.com/data/pricemulti?fsyms=${mappedSymbols.join(',')}&tsyms=USD`, { timeout: 8000 });
      
      const pricesEur = resEur.data || {};
      const pricesUsd = resUsd.data || {};

      for (let i = ghostState.activePositions.length - 1; i >= 0; i--) {
        const pos = ghostState.activePositions[i];
        const s = pos.symbol.toUpperCase().trim();
        let fsym = s;
        if (s === 'XAU') fsym = 'PAXG';
        if (s === 'WTI') fsym = 'OIL';
        
        let curPrice = pricesEur[fsym]?.EUR;
        
        // Fallback to USD if EUR not available or if it's a commodity
        if (!curPrice || fsym === 'PAXG' || fsym === 'OIL') {
          const usdPrice = pricesUsd[fsym]?.USD;
          if (usdPrice) {
            curPrice = usdPrice / 1.08; // Convert to EUR
          }
        }

        if (!curPrice) continue;
        
        // If it's a newly adopted position, set initial prices and default targets
        if (pos.entryPrice === 0) {
          pos.entryPrice = curPrice;
          pos.tp = curPrice * 1.03; // Default 3% TP
          pos.sl = curPrice * 0.98; // Default 2% SL
        }

        pos.currentPrice = curPrice;
        
        // Update peak price for trailing stop logic
        if (pos.side === 'SELL') {
          if (curPrice < (pos.peakPrice || Infinity)) pos.peakPrice = curPrice;
        } else {
          if (curPrice > (pos.peakPrice || 0)) pos.peakPrice = curPrice;
        }

        const pnlPercent = pos.side === 'SELL'
          ? ((pos.entryPrice - curPrice) / (pos.entryPrice || 1)) * 100
          : ((curPrice - pos.entryPrice) / (pos.entryPrice || 1)) * 100;
        
        pos.pnlPercent = pnlPercent;
        pos.pnl = pos.side === 'SELL'
          ? (pos.entryPrice - curPrice) * pos.quantity
          : (curPrice - pos.entryPrice) * pos.quantity;
        
        const breakEvenPrice = pos.side === 'SELL'
          ? pos.entryPrice * (1 - FEE_RATE)
          : pos.entryPrice * (1 + FEE_RATE);
        
        const netPnlPercent = pnlPercent - (FEE_RATE * 100);
        
        // Define isStagnant: Trade open > 30m with minimal movement
        const startTime = new Date(pos.timestamp).getTime();
        const elapsedMinutes = (Date.now() - startTime) / 60000;
        const isStagnant = elapsedMinutes > 30 && Math.abs(netPnlPercent) < 0.1;

        // Dynamic Trailing Stop & Break Even (Aggressive for Scalping)
        if (netPnlPercent > 0.15) {
          if (pos.side === 'BUY' && pos.sl < breakEvenPrice) {
            pos.sl = breakEvenPrice * (1 + 0.001); // BE + 0.1% profit buffer
            console.log(`[MONITOR] Break-Even activated for ${pos.symbol} BUY @ ${pos.sl.toFixed(2)}`);
          } else if (pos.side === 'SELL' && pos.sl > breakEvenPrice) {
            pos.sl = breakEvenPrice * (1 - 0.001); // BE + 0.1% profit buffer
            console.log(`[MONITOR] Break-Even activated for ${pos.symbol} SELL @ ${pos.sl.toFixed(2)}`);
          }
        }

        if (netPnlPercent > 0.4) {
          const newSl = pos.side === 'SELL' ? curPrice * 1.0015 : curPrice * 0.9985;
          if ((pos.side === 'BUY' && newSl > pos.sl) || (pos.side === 'SELL' && newSl < pos.sl)) {
            pos.sl = newSl;
            console.log(`[MONITOR] Aggressive Trailing Stop moved for ${pos.symbol} ${pos.side} @ ${newSl.toFixed(2)}`);
          }
        }

        // EARLY EXIT: If price reaches 80% of TP
        const tpDistance = Math.abs(pos.tp - pos.entryPrice);
        const earlyExitPrice = pos.side === 'SELL' 
          ? pos.entryPrice - (tpDistance * 0.8)
          : pos.entryPrice + (tpDistance * 0.8);
        
        const canExitSafely = curPrice > (breakEvenPrice * (1 + MIN_NET_PROFIT));

        // PROFIT SATURATION EXIT
        const dropFromPeak = pos.peakPrice 
          ? (Math.abs(pos.peakPrice - curPrice) / pos.peakPrice) * 100 
          : 0;
        const isProfitSaturated = netPnlPercent > 0.5 && dropFromPeak > 0.15;

        // Trigger Exit if:
        const isTpReached = pos.side === 'SELL' ? curPrice <= pos.tp : curPrice >= pos.tp;
        const isSlReached = pos.side === 'SELL' ? curPrice >= pos.sl : curPrice <= pos.sl;
        const isEarlyExitReached = pos.side === 'SELL' ? curPrice <= earlyExitPrice : curPrice >= earlyExitPrice;

        if (isTpReached || isSlReached || (tpDistance > 0 && isEarlyExitReached && netPnlPercent > 0.4 && canExitSafely) || isStagnant || isProfitSaturated) {
          let reason = isTpReached ? 'TAKE_PROFIT' : (isSlReached ? 'STOP_LOSS' : 'EARLY_EXIT_80%_TP');
          if (isStagnant) reason = 'TIME_STAGNATION_30M';
          if (isProfitSaturated) reason = 'MOMENTUM_FADE_EXIT';
          
          const exitSide = pos.side === 'BUY' ? 'SELL' : 'BUY';
          const tradeResult = await executeTrade(pos.symbol, exitSide, 0, pos.quantity);
          
          if (tradeResult.success) {
            ghostState.dailyStats.profit += pos.pnl;
            ghostState.totalProfit += pos.pnl;
            ghostState.liquidity.eur += (pos.amount + pos.pnl); // Return capital + profit
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
  fs.appendFileSync('debug.log', `[STARTUP] Starting server initialization...\n`);
  const app = express();
  const PORT = 3000;

  app.use((req, res, next) => {
    fs.appendFileSync('debug.log', `[REQ] ${req.method} ${req.url} from ${req.ip}\n`);
    next();
  });

  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
  }));
  app.use(express.json());

  // API Router
  const apiRouter = express.Router();

  apiRouter.use((req, res, next) => {
    fs.appendFileSync('debug.log', `[API_REQ] ${req.method} ${req.url} from ${req.ip}\n`);
    next();
  });

  apiRouter.get('/ping', (req, res) => res.json({ status: 'pong', timestamp: new Date().toISOString() }));
  
  apiRouter.get(['/ghost/state', '/ghost/state/'], (req, res) => {
    try {
      fs.appendFileSync('debug.log', `[API] GET /api/ghost/state - Sending response\n`);
      res.json(ghostState);
    } catch (err: any) {
      fs.appendFileSync('debug.log', `[API_ERROR] Failed to send ghost state: ${err.message}\n`);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  });

  apiRouter.get(['/ghost/pending-analysis', '/ghost/pending-analysis/'], (req, res) => res.json([]));
  
  apiRouter.post(['/ghost/toggle', '/ghost/toggle/'], (req, res) => {
    if (req.body.engine !== undefined) ghostState.isEngineActive = !!req.body.engine;
    if (req.body.auto !== undefined) ghostState.autoPilot = !!req.body.auto;
    if (req.body.paper !== undefined) ghostState.isPaperMode = !!req.body.paper;
    saveState();
    res.json({ success: true });
  });

  apiRouter.post(['/ghost/settings', '/ghost/settings/'], (req, res) => {
    if (req.body.settings) {
      ghostState.settings = { ...ghostState.settings, ...req.body.settings };
      saveState();
    }
    res.json({ success: true, settings: ghostState.settings });
  });

  apiRouter.post(['/ghost/refill', '/ghost/refill/'], (req, res) => {
    if (ghostState.isPaperMode) {
      ghostState.liquidity.eur = 1000;
      ghostState.liquidity.usdc = 1000;
      saveState();
      return res.json({ success: true, liquidity: ghostState.liquidity });
    }
    res.status(400).json({ success: false, error: "Only available in Paper Mode" });
  });

  apiRouter.post(['/ghost/reset', '/ghost/reset/'], (req, res) => {
    ghostState.totalProfit = 0;
    ghostState.dailyStats.profit = 0;
    ghostState.dailyStats.trades = 0;
    ghostState.executionLogs = [];
    ghostState.thoughts = [];
    ghostState.activePositions = []; // Also clear active positions to start fresh
    if (ghostState.isPaperMode) {
      ghostState.liquidity.eur = 1000;
      ghostState.liquidity.usdc = 1000;
    }
    saveState();
    res.json({ success: true });
  });

  apiRouter.post(['/ghost/api-key', '/ghost/api-key/'], (req, res) => {
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

  apiRouter.post(['/trade', '/trade/'], async (req, res) => {
    const { symbol, side, amount_eur } = req.body;
    const result = await executeTrade(symbol, side, amount_eur, 0);
    res.json(result);
  });

  // Catch-all for /api routes that don't match
  apiRouter.all('*', (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
  });

  app.use('/api', apiRouter);

  fs.appendFileSync('debug.log', `[STARTUP] Middleware and routes configured.\n`);

  // Global Error Handler for API
  app.use('/api', (err: any, req: any, res: any, _next: any) => {
    console.error(`[API ERROR HANDLER] ${req.method} ${req.url}:`, err);
    fs.appendFileSync('debug.log', `[API ERROR HANDLER] ${req.method} ${req.url}: ${err.message}\n`);
    res.status(err.status || 500).json({ 
      error: 'Internal Server Error', 
      message: err.message,
      path: req.url
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    fs.appendFileSync('debug.log', `[STARTUP] Initializing Vite middleware...\n`);
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      fs.appendFileSync('debug.log', `[STARTUP] Vite middleware initialized.\n`);
    } catch (e: any) {
      fs.appendFileSync('debug.log', `[FATAL] Vite initialization failed: ${e.message}\n`);
      throw e;
    }
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'API route not found' });
      }
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 UNIFIED SERVER RUNNING ON PORT ${PORT}`);
    fs.appendFileSync('debug.log', `[STARTUP] Unified server listening on port ${PORT}\n`);
    
    // Start trading engine
    listAvailableProducts();
    monitor();
    monitorPositionsAI();
    scanWatchlist();
    
    setInterval(monitor, 5000);           // Hard TP/SL check (5s)
    setInterval(monitorPositionsAI, 120000); // AI Position Analysis (2m)
    setInterval(scanWatchlist, 120000);      // New Signal Scanning (2m)
    setInterval(listAvailableProducts, 600000); // Refresh products every 10m
  });
}

startServer().catch(err => {
  fs.appendFileSync('debug.log', `[FATAL] Startup failed: ${err.stack}\n`);
  console.error("Startup failed:", err);
  process.exit(1);
});
