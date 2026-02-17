
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
    : { market_market_ioc: { base_size: size.toString() } };

  try {
    const response = await axios.post(`https://${CB_CONFIG.hostname}${path}`, {
      client_order_id: crypto.randomUUID(), product_id: productId, side, order_configuration: orderConfig
    }, { headers: { ...getCoinbaseAuthHeader('POST', path), 'Content-Type': 'application/json' } });
    return { success: true, data: response.data, isPaper: false };
  } catch (e) {
    console.error(`[CB_ORDER_ERR]:`, e.response?.data || e.message);
    return { success: false, error: e.message };
  }
}

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const compact = candles.slice(-20).map(c => ({ p: c.close, v: Math.round(c.volumeto) }));
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `SCAN: ${symbol} @ ${price}. Analyze SMC structure.` }] }],
      config: {
        systemInstruction: `Return JSON: { "side": "BUY"|"SELL"|"NEUTRAL", "tp": number, "sl": number, "confidence": number, "reason": "string" }.`,
        responseMimeType: "application/json"
      }
    });
    return JSON.parse(response.text.trim());
  } catch (e) { return null; }
}

function loadState() {
  const defaults = {
    isEngineActive: true, autoPilot: true, isPaperMode: true,
    settings: { confidenceThreshold: 80, defaultTradeSize: 10.0 },
    thoughts: [], executionLogs: [], activePositions: [],
    liquidity: { eur: 0, usdc: 0 }, dailyStats: { trades: 0, profit: 0 },
    currentStatus: "IDLE", scanIndex: 0, diag: "BOOT"
  };
  try { if (fs.existsSync(STATE_FILE)) return { ...defaults, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch (e) {}
  return defaults;
}

let ghostState = loadState();

async function monitorPositions() {
  for (let i = ghostState.activePositions.length - 1; i >= 0; i--) {
    const pos = ghostState.activePositions[i];
    try {
      const res = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${pos.symbol}&tsyms=EUR`);
      const currentPrice = res.data.EUR;
      pos.currentPrice = currentPrice;
      pos.pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
      pos.pnl = (currentPrice - pos.entryPrice) * (pos.quantity || (pos.amount / pos.entryPrice));

      if (currentPrice >= pos.tp || currentPrice <= pos.sl) {
        const order = await placeRealOrder(pos.symbol, 'SELL', pos.isPaper ? pos.amount : pos.quantity, pos.isPaper);
        if (order.success) {
          ghostState.dailyStats.profit += pos.pnl;
          ghostState.executionLogs.unshift({
            id: crypto.randomUUID(), symbol: pos.symbol, action: 'SELL', price: currentPrice,
            status: 'SUCCESS', details: pos.isPaper ? '[SIM]' : '[LIVE]', timestamp: new Date().toISOString(), pnl: pos.pnl
          });
          ghostState.activePositions.splice(i, 1);
        }
      }
    } catch (e) {}
  }
  saveState();
}

async function loop() {
  if (!ghostState.isEngineActive) return;
  await monitorPositions();
  const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'NEAR', 'FET'];
  const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
  ghostState.scanIndex++;
  ghostState.currentStatus = `SCANNING_${symbol}`;

  try {
    const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=EUR&limit=24`);
    const candles = res.data?.Data?.Data;
    if (!candles) return;
    const price = candles[candles.length - 1].close;
    const analysis = await getAdvancedAnalysis(symbol, price, candles);
    
    if (analysis && analysis.side === 'BUY' && analysis.confidence >= (ghostState.settings?.confidenceThreshold || 80)) {
      if (!ghostState.activePositions.some(p => p.symbol === symbol)) {
        const order = await placeRealOrder(symbol, 'BUY', ghostState.settings.defaultTradeSize, ghostState.isPaperMode);
        if (order.success) {
          ghostState.activePositions.push({
            symbol, entryPrice: price, currentPrice: price, amount: ghostState.settings.defaultTradeSize,
            quantity: ghostState.settings.defaultTradeSize / price, tp: analysis.tp, sl: analysis.sl,
            pnl: 0, pnlPercent: 0, isPaper: ghostState.isPaperMode, timestamp: new Date().toISOString()
          });
          ghostState.executionLogs.unshift({
            id: crypto.randomUUID(), symbol, action: 'BUY', price, status: 'SUCCESS',
            details: ghostState.isPaperMode ? '[SIM]' : '[LIVE]', timestamp: new Date().toISOString()
          });
        }
      }
    }
    if (analysis) ghostState.thoughts.unshift({ ...analysis, symbol, timestamp: new Date().toISOString() });
    ghostState.currentStatus = `READY`;
  } catch (e) {}
  saveState();
}

async function syncLiquidity() {
  const realData = await fetchRealBalances();
  if (realData) {
    ghostState.liquidity = realData;
    ghostState.isPaperMode = false;
    ghostState.diag = `LIVE: EUR ${realData.eur.toFixed(2)}`;
  } else {
    ghostState.isPaperMode = true;
    ghostState.diag = "SIMULATION";
  }
  saveState();
}

function saveState() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {} }

syncLiquidity();
setInterval(loop, 25000);
setInterval(syncLiquidity, 60000);

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
  ghostState.dailyStats = { trades: 0, profit: 0 };
  if (req.body.clearPositions) ghostState.activePositions = [];
  saveState();
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 NOVA V17.8: READY ON ${PORT}`));
