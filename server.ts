
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

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX'];
const STATE_FILE = './ghost_state.json';

// --- TRADING ENGINE LOGIC ---

async function listAvailableProducts() {
  const token = generateCoinbaseJWT('GET', '/api/v3/brokerage/products');
  if (!token) return;
  try {
    const response = await axios.get('https://api.coinbase.com/api/v3/brokerage/products?product_type=SPOT', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const products = response.data?.products || [];
    const eurPairs = products
      .filter(p => p.quote_currency_id === 'EUR' && p.is_disabled === false)
      .map(p => p.product_id);
    console.log("--------------------------------------------------");
    console.log("✅ VALID EUR TRADING PAIRS FOR YOUR ACCOUNT:");
    console.log(eurPairs.join(', '));
    console.log("--------------------------------------------------");
  } catch (e) {
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
    return true;
  } catch (e) {
    return false;
  }
}

async function executeTrade(symbol, side, amount, quantity) {
  const productId = symbol.includes('-') ? symbol : `${symbol}-EUR`;
  const token = generateCoinbaseJWT('POST', '/api/v3/brokerage/orders');
  if (!token) return false;
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
    console.log(`[REAL TRADE SUCCESS] ${side} ${productId}`);
    return true;
  } catch (e) {
    console.error("[REAL TRADE ERROR]", e.response?.data || e.message);
    return false;
  }
}

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const history = (candles || []).slice(-30).map(c => ({ h: c.high, l: c.low, c: c.close }));
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `SMC_ANALYSIS_SCAN: ${symbol} @ ${price} EUR. HISTORY_30M: ${JSON.stringify(history)}. CURRENT_DAILY_PROFIT: ${ghostState.dailyStats.profit} EUR.` }] }],
      config: {
        systemInstruction: `YOU ARE THE GHOST_SMC_BOT, AN AGGRESSIVE AI SCALPER.
Use Smart Money Concepts (SMC), FVG, and MSS. 
Goal: High profit in short time. Be aggressive but factor in 0.6% round-trip fees.
Identify high-probability scalping opportunities.
Return valid JSON with side (BUY/SELL/NEUTRAL), tp, sl, entryPrice, confidence, potentialRoi, analysis.`,
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
    return { ...result, id: crypto.randomUUID(), symbol, timestamp: new Date().toISOString() };
  } catch (e) { return null; }
}

function loadState() {
  const defaults = {
    isEngineActive: true, autoPilot: true, isPaperMode: false,
    settings: { confidenceThreshold: 75, defaultTradeSize: 50.0 },
    thoughts: [], executionLogs: [], activePositions: [],
    liquidity: { eur: 0, usdc: 0 }, actualBalances: {}, dailyStats: { trades: 0, profit: 0, dailyGoal: 50.0, lastResetDate: "" },
    currentStatus: "INITIALIZING", scanIndex: 0
  };
  try { 
    if (fs.existsSync(STATE_FILE)) return { ...defaults, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
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

async function loop() {
  if (!ghostState.isEngineActive) return;
  const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
  ghostState.scanIndex++;
  ghostState.currentStatus = `SNIPING_${symbol}`;
  try {
    const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${symbol}&tsym=EUR&limit=30`);
    const candles = res.data?.Data?.Data || [];
    if (candles.length === 0) return;
    const price = candles[candles.length - 1].close;
    const analysis = await getAdvancedAnalysis(symbol, price, candles);
    if (analysis) {
      if (analysis.side === 'BUY' && analysis.confidence >= ghostState.settings.confidenceThreshold && ghostState.autoPilot) {
        if (!ghostState.activePositions.some((p) => p.symbol === symbol)) {
          const availableEur = ghostState.liquidity.eur * 0.98; 
          const tradeAmount = Math.min(ghostState.settings.defaultTradeSize, availableEur);
          if (tradeAmount >= 5) { 
            const qty = tradeAmount / (price || 1);
            if (await executeTrade(symbol, 'BUY', tradeAmount, qty)) {
              ghostState.activePositions.push({
                symbol, entryPrice: price, currentPrice: price, amount: tradeAmount, quantity: qty,
                tp: analysis.tp, sl: analysis.sl, confidence: analysis.confidence, potentialRoi: analysis.potentialRoi,
                pnl: 0, pnlPercent: 0, isPaper: false, timestamp: new Date().toISOString()
              });
              ghostState.executionLogs.unshift({ 
                id: crypto.randomUUID(), 
                symbol, 
                action: 'BUY', 
                price, 
                status: 'SUCCESS', 
                details: `SMC_BUY_CONF_${analysis.confidence}%`,
                timestamp: new Date().toISOString() 
              });
              if (ghostState.executionLogs.length > 50) ghostState.executionLogs.pop();
              ghostState.dailyStats.trades++;
            }
          }
        }
      }
      ghostState.thoughts.unshift(analysis);
      if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();
    }
  } catch (e) {}
  saveState();
}

async function monitor() {
  await syncCoinbaseBalance();
  const today = new Date().toISOString().split('T')[0];
  if (ghostState.dailyStats.lastResetDate !== today) {
    ghostState.dailyStats.profit = 0; ghostState.dailyStats.trades = 0; ghostState.dailyStats.lastResetDate = today;
  }
  
  // Reconcile active positions with actual Coinbase balances
  for (let i = ghostState.activePositions.length - 1; i >= 0; i--) {
    const pos = ghostState.activePositions[i];
    const actualQty = ghostState.actualBalances[pos.symbol] || 0;
    
    // If Coinbase says we don't have this asset anymore, remove it from active hunts
    if (actualQty < (pos.quantity * 0.1)) { // Less than 10% of expected quantity remains
      console.log(`[RECONCILE] Removing ${pos.symbol} - Position no longer exists on Coinbase.`);
      ghostState.executionLogs.unshift({ 
        id: crypto.randomUUID(), 
        symbol: pos.symbol, 
        action: 'SYNC_EXIT', 
        price: pos.currentPrice, 
        status: 'SUCCESS', 
        details: `EXTERNAL_EXIT_DETECTED`,
        timestamp: new Date().toISOString() 
      });
      if (ghostState.executionLogs.length > 50) ghostState.executionLogs.pop();
      ghostState.activePositions.splice(i, 1);
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
      pos.currentPrice = curPrice;
      pos.pnlPercent = ((curPrice - pos.entryPrice) / (pos.entryPrice || 1)) * 100;
      pos.pnl = (curPrice - pos.entryPrice) * pos.quantity;
      if (curPrice >= pos.tp || curPrice <= pos.sl) {
        const reason = curPrice >= pos.tp ? 'TAKE_PROFIT' : 'STOP_LOSS';
        if (await executeTrade(pos.symbol, 'SELL', 0, pos.quantity)) {
          ghostState.dailyStats.profit += pos.pnl;
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
    loop();
    setInterval(monitor, 10000);
    setInterval(loop, 30000);
  });
}

startServer();
