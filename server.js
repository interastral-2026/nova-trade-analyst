
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import { GoogleGenAI } from "@google/genai";

const app = express();
const STATE_FILE = './ghost_state.json';
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const API_KEY = process.env.API_KEY ? process.env.API_KEY.trim() : null;
const CB_CONFIG = {
  apiKey: (process.env.CB_API_KEY || '').trim(), 
  apiSecret: (process.env.CB_API_SECRET || '').replace(/\\n/g, '\n').replace(/"/g, '').replace(/'/g, '').trim(),
  hostname: 'api.coinbase.com'
};

const DAILY_GOAL_EUR = 50.0;
const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'NEAR', 'FET'];

// Internal Engine State
let isRateLimited = false;
let retryAfter = 0;
let lastHeartbeat = Date.now();

function getCoinbaseAuthHeader(method, path) {
  if (!CB_CONFIG.apiKey || !CB_CONFIG.apiSecret || CB_CONFIG.apiSecret.length < 30) return {};
  try {
    const header = { alg: 'ES256', typ: 'JWT', kid: CB_CONFIG.apiKey };
    const now = Math.floor(Date.now() / 1000);
    const cleanPath = path.split('?')[0];
    const uriClaim = `${method.toUpperCase()} ${CB_CONFIG.hostname}${cleanPath}`;
    const payload = { iss: 'coinbase-cloud', nbf: now - 5, iat: now - 5, exp: now + 60, sub: CB_CONFIG.apiKey, uri: uriClaim };
    const unsignedToken = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
    let key = CB_CONFIG.apiSecret;
    if (!key.includes('-----BEGIN')) {
      const raw = key.replace(/\s/g, '');
      const lines = raw.match(/.{1,64}/g) || [];
      key = `-----BEGIN EC PRIVATE KEY-----\n${lines.join('\n')}\n-----END EC PRIVATE KEY-----`;
    }
    const signature = crypto.sign('sha256', Buffer.from(unsignedToken), { key: key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return { 'Authorization': `Bearer ${unsignedToken}.${signature}` };
  } catch (error) { return {}; }
}

async function fetchRealBalances() {
  if (!CB_CONFIG.apiKey.includes('organizations/')) return null;
  const path = '/api/v3/brokerage/accounts';
  try {
    const response = await axios.get(`https://${CB_CONFIG.hostname}${path}`, {
      headers: { ...getCoinbaseAuthHeader('GET', path), 'Content-Type': 'application/json' },
      timeout: 10000
    });
    const accounts = response.data?.accounts || [];
    let eurVal = 0, usdcVal = 0;
    for (const acc of accounts) {
      const currency = acc.currency || acc.available_balance?.currency;
      const value = parseFloat(acc.available_balance?.value || 0);
      if (currency === 'EUR') eurVal += value;
      if (currency === 'USDC') usdcVal += value;
    }
    return { eur: eurVal, usdc: usdcVal };
  } catch (e) { return null; }
}

async function placeRealOrder(symbol, side, size, isPaper) {
  if (isPaper) return { success: true, isPaper: true };
  const productId = `${symbol}-EUR`;
  const path = '/api/v3/brokerage/orders';
  const orderConfig = side === 'BUY' 
    ? { market_market_ioc: { quote_size: size.toFixed(2).toString() } }
    : { market_market_ioc: { base_size: size.toFixed(8).toString() } };

  try {
    const response = await axios.post(`https://${CB_CONFIG.hostname}${path}`, {
      client_order_id: crypto.randomUUID(), product_id: productId, side, order_configuration: orderConfig
    }, { headers: { ...getCoinbaseAuthHeader('POST', path), 'Content-Type': 'application/json' } });
    return { success: true, data: response.data, isPaper: false };
  } catch (e) {
    return { success: false, error: e.response?.data || e.message };
  }
}

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!API_KEY) return { side: "NEUTRAL", analysis: "API_KEY_MISSING", confidence: 0, tp: 0, sl: 0, entryPrice: price };
  if (isRateLimited && Date.now() < retryAfter) return { side: "NEUTRAL", analysis: "AI_COOLDOWN_ACTIVE", confidence: 0, tp: 0, sl: 0, entryPrice: price };

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const historicalData = candles.slice(-48).map(c => ({ 
    h: c.high, l: c.low, c: c.close, v: c.volumeto 
  }));
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `INSTANT_EXECUTION_SCAN: ${symbol} @ ${price} EUR. DATA: ${JSON.stringify(historicalData)}` }] }],
      config: {
        systemInstruction: `SYSTEM_ROLE: PREDATOR_INSTANT_BUYER_V27. 
MISSION: ACHIEVE 50 EUR PROFIT DAILY. 
DIRECTIVE: YOU MUST OUTPUT FULL SIGNAL DATA INCLUDING TP, SL, AND CONFIDENCE.
SMC STRATEGY:
1. Identify Liquidity Sweep & Market Structure Shift (MSS).
2. Entry at FVG or OB. 
3. Take Profit (TP) must be the NEXT major liquidity level. 
4. Stop Loss (SL) must be below the swing low or displacement candle.
OUTPUT JSON: { "side": "BUY"|"SELL"|"NEUTRAL", "tp": number, "sl": number, "entryPrice": number, "confidence": number, "analysis": "string" }.
MANDATORY: ALWAYS provide numeric values for tp, sl, entryPrice and confidence.`,
        responseMimeType: "application/json",
        temperature: 0.1
      }
    });
    isRateLimited = false;
    const result = JSON.parse(response.text.trim());
    // Ensure all numeric fields exist
    result.tp = result.tp || 0;
    result.sl = result.sl || 0;
    result.confidence = result.confidence || 0;
    result.entryPrice = result.entryPrice || price;
    return result;
  } catch (e) { 
    if (e.message.includes('429')) {
      isRateLimited = true;
      retryAfter = Date.now() + 10000;
    }
    return { side: "NEUTRAL", analysis: "AI_ERROR: " + e.message, confidence: 0, tp: 0, sl: 0, entryPrice: price };
  }
}

function loadState() {
  const defaults = {
    isEngineActive: true, autoPilot: true, isPaperMode: true,
    settings: { confidenceThreshold: 75, defaultTradeSize: 60.0 },
    thoughts: [], executionLogs: [], activePositions: [],
    liquidity: { eur: 1000, usdc: 500 }, dailyStats: { trades: 0, profit: 0, dailyGoal: DAILY_GOAL_EUR },
    currentStatus: "IDLE", scanIndex: 0, diag: "V27_PREDATOR_ULTRA"
  };
  try { 
    if (fs.existsSync(STATE_FILE)) {
      let state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (!state.dailyStats) state.dailyStats = defaults.dailyStats;
      if (!state.liquidity || state.liquidity.eur === 0) state.liquidity = defaults.liquidity;
      return { ...defaults, ...state };
    } 
  } catch (e) {}
  return defaults;
}

let ghostState = loadState();

async function monitorPositions() {
  if (ghostState.activePositions.length === 0) return;
  
  const symbols = [...new Set(ghostState.activePositions.map(p => p.symbol))].join(',');
  try {
    const res = await axios.get(`https://min-api.cryptocompare.com/data/pricemulti?fsyms=${symbols}&tsyms=EUR`);
    const prices = res.data;

    for (let i = ghostState.activePositions.length - 1; i >= 0; i--) {
      const pos = ghostState.activePositions[i];
      const currentPrice = prices[pos.symbol]?.EUR;
      if (!currentPrice) continue;

      pos.currentPrice = currentPrice;
      pos.pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
      pos.pnl = (currentPrice - pos.entryPrice) * (pos.quantity || (pos.amount / pos.entryPrice));

      const isTP = currentPrice >= pos.tp;
      const isSL = currentPrice <= pos.sl;

      if (isTP || isSL) {
        const order = await placeRealOrder(pos.symbol, 'SELL', pos.quantity, pos.isPaper);
        if (order.success) {
          ghostState.dailyStats.profit += pos.pnl;
          ghostState.dailyStats.trades += 1;
          ghostState.executionLogs.unshift({
            id: crypto.randomUUID(), symbol: pos.symbol, action: 'SELL', price: currentPrice,
            status: 'SUCCESS', details: pos.isPaper ? `[SIM_${isTP?'TP':'SL'}]` : `[LIVE_${isTP?'TP':'SL'}]`, 
            timestamp: new Date().toISOString(), pnl: pos.pnl
          });
          ghostState.activePositions.splice(i, 1);
        }
      }
    }
  } catch (e) { console.error(`[MONITOR_ERROR]`, e.message); }
  saveState();
}

async function loop() {
  lastHeartbeat = Date.now();
  if (!ghostState.isEngineActive) return;
  
  const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
  ghostState.scanIndex++;
  
  ghostState.currentStatus = `HUNTING_${symbol}_ENTRY`;

  try {
    const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=EUR&limit=48`);
    const candles = res.data?.Data?.Data;
    if (!candles || candles.length === 0) return;
    const price = candles[candles.length - 1].close;
    
    const analysis = await getAdvancedAnalysis(symbol, price, candles);
    
    if (analysis && analysis.side === 'BUY' && analysis.confidence >= ghostState.settings.confidenceThreshold) {
      if (!ghostState.activePositions.some(p => p.symbol === symbol)) {
        const tradePrice = analysis.entryPrice || price;
        const order = await placeRealOrder(symbol, 'BUY', ghostState.settings.defaultTradeSize, ghostState.isPaperMode);
        if (order.success) {
          const qty = ghostState.settings.defaultTradeSize / tradePrice;
          ghostState.activePositions.push({
            symbol, entryPrice: tradePrice, currentPrice: tradePrice, amount: ghostState.settings.defaultTradeSize,
            quantity: qty, tp: analysis.tp, sl: analysis.sl, confidence: analysis.confidence,
            pnl: 0, pnlPercent: 0, isPaper: ghostState.isPaperMode, timestamp: new Date().toISOString()
          });
          ghostState.executionLogs.unshift({
            id: crypto.randomUUID(), symbol, action: 'BUY', price: tradePrice, status: 'SUCCESS',
            details: ghostState.isPaperMode ? '[SIM]' : '[LIVE]', timestamp: new Date().toISOString()
          });
        }
      }
    }

    if (analysis) {
      ghostState.thoughts.unshift({ ...analysis, symbol, entryPrice: analysis.entryPrice || price, id: crypto.randomUUID(), timestamp: new Date().toISOString() });
      if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();
    }
  } catch (e) { 
    console.error(`[LOOP_ERROR]:`, e.message);
  }
  saveState();
}

async function syncLiquidity() {
  const realData = await fetchRealBalances();
  if (realData) {
    ghostState.liquidity = realData;
    ghostState.isPaperMode = false;
  } else {
    ghostState.isPaperMode = true;
    if (ghostState.liquidity.eur < 10) ghostState.liquidity.eur = 1000;
  }
  saveState();
}

function saveState() { 
  try { 
    ghostState.diag = isRateLimited ? "AI_WAIT" : "PREDATOR_X_ONLINE";
    fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); 
  } catch (e) {} 
}

syncLiquidity();
setInterval(monitorPositions, 2000);
setInterval(loop, 10000);
setInterval(syncLiquidity, 120000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});
app.post('/api/ghost/clear-history', (req, res) => {
  ghostState.executionLogs = [];
  ghostState.thoughts = [];
  if (req.body.clearPositions) ghostState.activePositions = [];
  saveState();
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🎯 PREDATOR X ULTRA: V27.0 ONLINE`));
