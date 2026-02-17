
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

// CONFIGURATION
const API_KEY = process.env.API_KEY ? process.env.API_KEY.trim() : null;
const CB_CONFIG = {
  apiKey: (process.env.CB_API_KEY || '').trim(), 
  apiSecret: (process.env.CB_API_SECRET || '')
    .replace(/\\n/g, '\n')
    .replace(/"/g, '')
    .replace(/'/g, '')
    .trim(),
  hostname: 'api.coinbase.com'
};

/**
 * GENERATES JWT COMPLIANT WITH COINBASE CDP V3
 */
function getCoinbaseAuthHeader(method, path) {
  if (!CB_CONFIG.apiKey || !CB_CONFIG.apiSecret || CB_CONFIG.apiSecret.length < 30) return {};
  try {
    const header = { alg: 'ES256', typ: 'JWT', kid: CB_CONFIG.apiKey };
    const now = Math.floor(Date.now() / 1000);
    const cleanPath = path.split('?')[0];
    const uriClaim = `${method.toUpperCase()} ${CB_CONFIG.hostname}${cleanPath}`;
    const payload = {
      iss: 'coinbase-cloud', nbf: now - 5, iat: now - 5, exp: now + 60,
      sub: CB_CONFIG.apiKey, uri: uriClaim
    };
    const unsignedToken = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
    let key = CB_CONFIG.apiSecret;
    if (!key.includes('-----BEGIN')) {
      const raw = key.replace(/\s/g, '');
      const lines = raw.match(/.{1,64}/g) || [];
      key = `-----BEGIN EC PRIVATE KEY-----\n${lines.join('\n')}\n-----END EC PRIVATE KEY-----`;
    }
    const signature = crypto.sign('sha256', Buffer.from(unsignedToken), { key: key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return { 'Authorization': `Bearer ${unsignedToken}.${signature}` };
  } catch (error) {
    console.error("[JWT_ERROR]:", error.message);
    return {};
  }
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

/**
 * PLACE REAL MARKET ORDER
 * BUY: uses quote_size (EUR)
 * SELL: uses base_size (Crypto Quantity)
 */
async function placeRealOrder(symbol, side, size) {
  if (ghostState.isPaperMode) return { success: true, isPaper: true, order_id: 'SIM_' + Date.now() };

  const productId = `${symbol}-EUR`;
  const path = '/api/v3/brokerage/orders';
  
  const orderConfig = side === 'BUY' 
    ? { market_market_ioc: { quote_size: size.toFixed(2).toString() } }
    : { market_market_ioc: { base_size: size.toString() } };

  const body = {
    client_order_id: crypto.randomUUID(),
    product_id: productId,
    side: side,
    order_configuration: orderConfig
  };

  try {
    const response = await axios.post(`https://${CB_CONFIG.hostname}${path}`, body, {
      headers: { ...getCoinbaseAuthHeader('POST', path), 'Content-Type': 'application/json' }
    });
    console.log(`[ORDER_SENT]: ${side} ${symbol} | Response:`, response.data.order_id);
    return { success: true, data: response.data, isPaper: false };
  } catch (e) {
    console.error(`[ORDER_FAIL]: ${JSON.stringify(e.response?.data || e.message)}`);
    return { success: false, error: e.response?.data?.message || e.message };
  }
}

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!API_KEY) return { side: "NEUTRAL", confidence: 0 };
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const compact = candles.slice(-20).map(c => ({ p: c.close, v: Math.round(c.volumeto) }));
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `ANALYZE ${symbol}/EUR: ${JSON.stringify(compact)}` }] }],
      config: {
        systemInstruction: `Return JSON: { "side": "BUY"|"SELL"|"NEUTRAL", "tp": number, "sl": number, "confidence": number, "reason": "string" }. Confidence > 75 for BUY.`,
        responseMimeType: "application/json"
      }
    });
    return JSON.parse(response.text.trim());
  } catch (e) { return null; }
}

function loadState() {
  const defaults = {
    isEngineActive: true, autoPilot: true, isPaperMode: true,
    thoughts: [], executionLogs: [], activePositions: [],
    liquidity: { eur: 0, usdc: 0 }, dailyStats: { trades: 0, profit: 0 },
    currentStatus: "IDLE", scanIndex: 0, diag: "BOOT"
  };
  try { if (fs.existsSync(STATE_FILE)) return { ...defaults, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch (e) {}
  return defaults;
}

let ghostState = loadState();

/**
 * POSITION MONITOR: Checks TP/SL every cycle
 */
async function monitorPositions() {
  for (let i = ghostState.activePositions.length - 1; i >= 0; i--) {
    const pos = ghostState.activePositions[i];
    try {
      const res = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${pos.symbol}&tsyms=EUR`);
      const currentPrice = res.data.EUR;
      
      const hitTP = currentPrice >= pos.tp;
      const hitSL = currentPrice <= pos.sl;

      if (hitTP || hitSL) {
        const reason = hitTP ? "TAKE_PROFIT" : "STOP_LOSS";
        console.log(`[EXIT_TRIGGER]: ${pos.symbol} at ${currentPrice} (${reason})`);
        
        // Use quantity (amount_crypto) for real sell, or amount (eur) for paper
        const sellSize = ghostState.isPaperMode ? pos.amount : (pos.quantity || pos.amount / pos.entryPrice);
        const order = await placeRealOrder(pos.symbol, 'SELL', sellSize);
        
        if (order.success) {
          const pnl = (currentPrice - pos.entryPrice) * (pos.quantity || pos.amount / pos.entryPrice);
          ghostState.dailyStats.profit += pnl;
          ghostState.executionLogs.unshift({
            id: crypto.randomUUID(), symbol: pos.symbol, action: 'SELL', price: currentPrice,
            status: 'SUCCESS', details: reason, timestamp: new Date().toISOString(), pnl
          });
          ghostState.activePositions.splice(i, 1);
        }
      }
    } catch (e) { console.error(`[MONITOR_ERR] ${pos.symbol}:`, e.message); }
  }
  saveState();
}

async function loop() {
  if (!ghostState.isEngineActive) return;
  
  // 1. MONITOR EXISTING TRADES
  await monitorPositions();

  // 2. SCAN FOR NEW OPPORTUNITIES
  const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'NEAR', 'FET'];
  const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
  ghostState.scanIndex++;
  ghostState.currentStatus = `SCANNING_${symbol}`;

  try {
    const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=EUR&limit=24`);
    const candles = res.data?.Data?.Data;
    if (!candles || candles.length < 2) return;
    const price = candles[candles.length - 1].close;
    
    const analysis = await getAdvancedAnalysis(symbol, price, candles);
    if (analysis && analysis.side === 'BUY' && analysis.confidence >= 75) {
      if (!ghostState.activePositions.some(p => p.symbol === symbol)) {
        const tradeSizeEur = 10.0;
        if (ghostState.isPaperMode || ghostState.liquidity.eur >= tradeSizeEur) {
          const order = await placeRealOrder(symbol, 'BUY', tradeSizeEur);
          if (order.success) {
            const qty = tradeSizeEur / price; // Simplified, in real market use fill data if available
            ghostState.activePositions.push({
              symbol, entryPrice: price, amount: tradeSizeEur, 
              quantity: qty, tp: analysis.tp, sl: analysis.sl, 
              timestamp: new Date().toISOString()
            });
            if (ghostState.isPaperMode) ghostState.liquidity.eur -= tradeSizeEur;
            ghostState.executionLogs.unshift({
              id: crypto.randomUUID(), symbol, action: 'BUY', price, 
              status: 'SUCCESS', timestamp: new Date().toISOString()
            });
            ghostState.dailyStats.trades++;
          }
        }
      }
    }
    ghostState.thoughts.unshift({ ...analysis, symbol, price, timestamp: new Date().toISOString() });
    if (ghostState.thoughts.length > 30) ghostState.thoughts.pop();
    ghostState.currentStatus = `READY`;
  } catch (e) { ghostState.currentStatus = "COOLDOWN"; }
  saveState();
}

async function syncLiquidity() {
  const realData = await fetchRealBalances();
  if (realData) {
    ghostState.liquidity.eur = realData.eur;
    ghostState.liquidity.usdc = realData.usdc;
    ghostState.isPaperMode = false;
    ghostState.diag = `LIVE: EUR ${realData.eur.toFixed(2)}`;
  } else {
    ghostState.isPaperMode = true;
    ghostState.diag = "AUTH_FAIL | SIM_ONLY";
  }
  saveState();
}

function saveState() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {} }

syncLiquidity();
setInterval(loop, 20000); 
setInterval(syncLiquidity, 60000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 NOVA V17.5: TRADE ENGINE ACTIVE ON ${PORT}`));
