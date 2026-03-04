
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

const API_KEY = process.env.API_KEY ? process.env.API_KEY.trim() : null;
const CB_API_KEY = process.env.CB_API_KEY ? process.env.CB_API_KEY.trim() : null;
const CB_API_SECRET = process.env.CB_API_SECRET 
  ? process.env.CB_API_SECRET.replace(/^"|"$/g, '').replace(/\\n/g, '\n').trim() 
  : null;

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'DOT', 'ADA', 'NEAR', 'MATIC', 'XRP', 'LTC', 'BCH', 'SHIB', 'DOGE', 'UNI', 'AAVE'];
const STATE_FILE = './ghost_state.json';

let availableEurPairs: string[] = [];

// --- TRADING ENGINE LOGIC ---

async function listAvailableProducts() {
  const token = generateCoinbaseJWT('GET', '/api/v3/brokerage/products');
  if (!token) return;
  try {
    const response = await axios.get('https://api.coinbase.com/api/v3/brokerage/products?product_type=SPOT', {
      headers: { 'Authorization': `Bearer ${token}` }
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
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const accounts = response.data?.accounts || [];
    const newBalances = {}; 
    accounts.forEach((acc) => {
      const currency = acc.currency;
      const amount = parseFloat(acc.available_balance?.value || 0);
      if (currency === 'EUR') ghostState.liquidity.eur = amount;
      else if (currency === 'USDC' || currency === 'USD') ghostState.liquidity.usdc = amount;
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
    const orderConfig = side === 'BUY' 
      ? { market_market_ioc: { quote_size: Number(amount).toFixed(2).toString() } }
      : { market_market_ioc: { base_size: Number(quantity).toFixed(6).toString() } };
    
    const payload = {
      client_order_id: crypto.randomUUID(),
      product_id: productId,
      side: side,
      order_configuration: orderConfig
    };

    const response = await axios.post('https://api.coinbase.com/api/v3/brokerage/orders', payload, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    // Check if order was actually created or rejected by Coinbase
    if (response.data?.success === false || response.data?.error_response) {
      const errorResponse = response.data?.error_response;
      const errorMsg = errorResponse?.message || errorResponse?.error || response.data?.failure_reason || "COINBASE_REJECTION";
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
  if (!API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const history = (candles || []).slice(-30).map(c => ({ h: c.high, l: c.low, c: c.close }));
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `SMC_ANALYSIS_SCAN: ${symbol} @ ${price} EUR. HISTORY_30M: ${JSON.stringify(history)}. CURRENT_DAILY_PROFIT: ${ghostState.dailyStats.profit} EUR.` }] }],
      config: {
        systemInstruction: `YOU ARE THE GHOST_SMC_BOT, A HIGH-FREQUENCY AI SCALPER.
Use Smart Money Concepts (SMC), FVG, and MSS. 
Goal: Capture quick 1% - 2% ROI scalps. 
Speed and liquidity are everything. Do not hold for long-term.
Factor in 0.6% round-trip fees. A 1% price move is actually ~0.4% net profit.
Only issue BUY if you see a clear institutional "Discount Zone" or "Liquidity Sweep".
Issue SELL early if you see "Distribution" or "SFP" (Swing Failure Pattern) to lock in profit before reversals.
BE SMART: Avoid "Bull Traps" and "Bear Traps" set by exchanges.

${entryPrice ? `CURRENT POSITION: You bought ${symbol} at ${entryPrice}. Current price is ${price}. 
If we are in profit (>0.5%), be very sensitive to any sign of reversal and issue SELL to secure gains. 
If we are in loss, look for MSS to decide if we should hold or cut loss early.` : ''}

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
    const result = JSON.parse(response.text?.trim() || '{}');
    // Normalize confidence if AI returns decimal (e.g. 0.85 -> 85)
    if (result.confidence !== undefined && result.confidence > 0 && result.confidence <= 1) {
      result.confidence = Math.round(result.confidence * 100);
    }
    return { ...result, id: crypto.randomUUID(), symbol, timestamp: new Date().toISOString() };
  } catch (e) { return null; }
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
  if (!ghostState.isEngineActive || ghostState.activePositions.length === 0) return;
  
  console.log(`[AI-MONITOR] Checking ${ghostState.activePositions.length} active positions...`);
  
  for (let i = ghostState.activePositions.length - 1; i >= 0; i--) {
    const pos = ghostState.activePositions[i];
    try {
      const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${pos.symbol}&tsym=EUR&limit=30`);
      const candles = res.data?.Data?.Data || [];
      if (candles.length === 0) continue;
      
      const price = candles[candles.length - 1].close;
      const analysis = await getAdvancedAnalysis(pos.symbol, price, candles, pos.entryPrice);
      
      if (analysis && analysis.side === 'SELL') {
        const pnlPercent = ((price - pos.entryPrice) / pos.entryPrice) * 100;
        
        // AI SELL SIGNAL: Exit if profitable or if confidence is very high for a drop
        if (pnlPercent > 0.2 || analysis.confidence > 85) {
          const tradePnl = (price - pos.entryPrice) * pos.quantity;
          console.log(`[AI-MONITOR] AI SELL for ${pos.symbol}. PNL: ${pnlPercent.toFixed(2)}%. Reason: ${analysis.analysis}`);
          
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
          }
        }
      }
    } catch (e) {
      console.error(`[AI-MONITOR] Error checking ${pos.symbol}:`, e.message);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function scanWatchlist() {
  if (!ghostState.isEngineActive) return;
  
  // Use availableEurPairs if we have them, otherwise fallback to WATCHLIST
  const currentWatchlist = availableEurPairs.length > 0 
    ? availableEurPairs.map(p => p.split('-')[0]) 
    : WATCHLIST;

  // Scan 5 symbols per cycle for faster discovery
  for (let i = 0; i < 5; i++) {
    const symbol = currentWatchlist[ghostState.scanIndex % currentWatchlist.length];
    ghostState.scanIndex++;
    
    if (ghostState.activePositions.some(p => p.symbol === symbol)) continue;

    const productId = `${symbol}-EUR`;
    if (!ghostState.isPaperMode && availableEurPairs.length > 0 && !availableEurPairs.includes(productId)) continue;

    ghostState.currentStatus = `SCANNING_${symbol}`;
    try {
      const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${symbol}&tsym=EUR&limit=30`);
      const candles = res.data?.Data?.Data || [];
      if (candles.length === 0) continue;
      
      const price = candles[candles.length - 1].close;
      const analysis = await getAdvancedAnalysis(symbol, price, candles);
      
      if (analysis && analysis.side === 'BUY' && analysis.confidence >= ghostState.settings.confidenceThreshold && ghostState.autoPilot) {
        const isProfitableEnough = analysis.potentialRoi >= (ghostState.settings.minRoi || 1.0);
        
        if (isProfitableEnough) {
          // Calculate available liquidity for this specific trade
          // We allow using up to 33% of total EUR per trade to allow multiple concurrent trades (up to 3)
          const totalEur = ghostState.liquidity.eur;
          const maxPerTrade = totalEur * 0.33;
          const tradeAmount = Math.max(10, Math.min(ghostState.settings.defaultTradeSize, maxPerTrade));
          
          if (totalEur >= tradeAmount && tradeAmount >= 5) { 
            const qty = tradeAmount / (price || 1);
            const tradeResult = await executeTrade(symbol, 'BUY', tradeAmount, qty);
            
            if (tradeResult.success) {
              analysis.decision = `EXECUTED: BUY_${symbol}_AT_${price}`;
              ghostState.activePositions.push({
                symbol, entryPrice: price, currentPrice: price, amount: tradeAmount, quantity: qty,
                tp: analysis.tp, sl: analysis.sl, confidence: analysis.confidence, potentialRoi: analysis.potentialRoi,
                pnl: 0, pnlPercent: 0, isPaper: ghostState.isPaperMode, timestamp: new Date().toISOString()
              });
              
              // Optimistically update liquidity so next scan in this loop knows we spent money
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
            }
          }
        }
      }
      if (analysis) {
        ghostState.thoughts.unshift(analysis);
        if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 500)); // Reduced delay
  }
  saveState();
}

async function monitor() {
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
        if (qty > 0.00001) {
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
    const res = await axios.get(`https://min-api.cryptocompare.com/data/pricemulti?fsyms=${symbols}&tsyms=EUR`);
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

      // Dynamic Trailing Stop: If profit > 0.8%, move SL to entry + 0.4% to lock in fees
      if (pnlPercent > 0.8) {
        const newSl = pos.entryPrice * 1.004;
        if (newSl > pos.sl) {
          pos.sl = newSl;
          console.log(`[MONITOR] Trailing Stop activated for ${pos.symbol} @ ${newSl.toFixed(2)}`);
        }
      }

      // EARLY EXIT: If price reaches 90% of TP, exit to ensure execution before reversal
      const tpDistance = pos.tp - pos.entryPrice;
      const earlyExitPrice = pos.entryPrice + (tpDistance * 0.9);

      if (curPrice >= pos.tp || curPrice <= pos.sl || (tpDistance > 0 && curPrice >= earlyExitPrice && pnlPercent > 1.0)) {
        const reason = curPrice >= pos.tp ? 'TAKE_PROFIT' : (curPrice <= pos.sl ? 'STOP_LOSS' : 'EARLY_EXIT_90%_TP');
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
        } else {
          console.error(`[MONITOR] Failed to exit ${pos.symbol}: ${tradeResult.reason}`);
          // Don't remove from activePositions so we can retry next loop
        }
      }
    }
  } catch (e) {}
  saveState();
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
    
    setInterval(monitor, 5000);           // Hard TP/SL check (5s)
    setInterval(monitorPositionsAI, 15000); // AI Position Analysis (15s)
    setInterval(scanWatchlist, 10000);      // New Signal Scanning (10s)
    setInterval(listAvailableProducts, 300000); // Refresh products every 5m
  });
}

startServer();
