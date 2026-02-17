
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
  // Key Name format: organizations/{org_id}/apiKeys/{key_id}
  apiKey: (process.env.CB_API_KEY || '').trim(), 
  // Private Key (PEM format)
  apiSecret: (process.env.CB_API_SECRET || '')
    .replace(/\\n/g, '\n')
    .replace(/"/g, '')
    .replace(/'/g, '')
    .trim(),
  hostname: 'api.coinbase.com'
};

/**
 * CDP V3 JWT GENERATION (Native Node Crypto Implementation)
 * This avoids common 'jsonwebtoken' library pitfalls with ES256 and Base64url encoding.
 */
function getCoinbaseAuthHeader(method, path) {
  if (!CB_CONFIG.apiKey || !CB_CONFIG.apiSecret || CB_CONFIG.apiSecret.length < 20) {
    return {};
  }

  try {
    const header = { 
      alg: 'ES256', 
      typ: 'JWT', 
      kid: CB_CONFIG.apiKey 
    };

    const now = Math.floor(Date.now() / 1000);
    const cleanPath = path.split('?')[0];
    const uriClaim = `${method.toUpperCase()} ${CB_CONFIG.hostname}${cleanPath}`;
    
    const payload = {
      iss: 'coinbase-cloud',
      nbf: now - 10, // Buffer for clock skew
      exp: now + 60,
      sub: CB_CONFIG.apiKey,
      uri: uriClaim
    };

    const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsignedToken = `${base64Header}.${base64Payload}`;

    // ENSURE PRIVATE KEY IS PEM FORMAT
    let key = CB_CONFIG.apiSecret;
    if (!key.includes('BEGIN')) {
      const base64Key = key.replace(/\s/g, '');
      const chunks = base64Key.match(/.{1,64}/g) || [];
      key = `-----BEGIN EC PRIVATE KEY-----\n${chunks.join('\n')}\n-----END EC PRIVATE KEY-----`;
    }

    const sign = crypto.createSign('SHA256');
    sign.update(unsignedToken);
    const signature = sign.sign(key, 'base64url');
    
    const jwt = `${unsignedToken}.${signature}`;
    return { 'Authorization': `Bearer ${jwt}` };
  } catch (error) {
    console.error("[JWT_SIGN_ERROR]:", error.message);
    return {};
  }
}

async function fetchRealBalances() {
  if (!CB_CONFIG.apiKey || CB_CONFIG.apiKey.length < 10) return null;
  const path = '/api/v3/brokerage/accounts';
  
  try {
    const authHeader = getCoinbaseAuthHeader('GET', path);
    if (!authHeader.Authorization) return null;

    const response = await axios.get(`https://${CB_CONFIG.hostname}${path}`, {
      headers: { 
        ...authHeader, 
        'Content-Type': 'application/json' 
      },
      timeout: 10000
    });
    
    const accounts = response.data?.accounts || [];
    let eurVal = 0;
    let usdcVal = 0;
    
    for (const acc of accounts) {
      const currency = acc.currency || acc.available_balance?.currency;
      const value = parseFloat(acc.available_balance?.value || 0);
      if (currency === 'EUR') eurVal += value;
      if (currency === 'USDC') usdcVal += value;
    }
    
    return { eur: eurVal, usdc: usdcVal, count: accounts.length };
  } catch (e) {
    const status = e.response?.status;
    const detail = e.response?.data;
    console.error(`[CB_AUTH_FAIL]: Status ${status} | Detail: ${JSON.stringify(detail || e.message)}`);
    return null;
  }
}

async function placeRealOrder(symbol, side, amountEur) {
  if (ghostState.isPaperMode) {
    console.log(`[SIMULATION]: ${side} ${symbol} €${amountEur}`);
    return { success: true, isPaper: true };
  }

  const productId = `${symbol}-EUR`;
  const path = '/api/v3/brokerage/orders';
  const body = {
    client_order_id: crypto.randomUUID(),
    product_id: productId,
    side: side === 'BUY' ? 'BUY' : 'SELL',
    order_configuration: {
      market_market_ioc: {
        quote_size: amountEur.toFixed(2).toString()
      }
    }
  };

  try {
    const response = await axios.post(`https://${CB_CONFIG.hostname}${path}`, body, {
      headers: { 
        ...getCoinbaseAuthHeader('POST', path), 
        'Content-Type': 'application/json' 
      }
    });
    console.log(`[REAL_TRADE]: ${symbol} ${side} Success`);
    return { success: true, data: response.data, isPaper: false };
  } catch (e) {
    console.error(`[TRADE_ERROR]: ${JSON.stringify(e.response?.data || e.message)}`);
    return { success: false, error: e.response?.data?.message || e.message };
  }
}

function getSyntheticAnalysis(symbol, price, candles) {
  const last = candles[candles.length - 1];
  const isUp = last.close > candles[candles.length - 2].close;
  return {
    side: isUp ? "BUY" : "NEUTRAL",
    tp: Number((price * 1.025).toFixed(2)),
    sl: Number((price * 0.985).toFixed(2)),
    confidence: isUp ? 82 : 35,
    reason: `System detection: ${symbol} is showing ${isUp ? 'bullish momentum' : 'no trend'}.`,
    expectedROI: 2.5
  };
}

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!API_KEY) return getSyntheticAnalysis(symbol, price, candles);
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const compact = candles.slice(-24).map(c => ({ p: c.close, v: Math.round(c.volumeto) }));
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `ANALYZE ${symbol}/EUR: ${JSON.stringify(compact)}` }] }],
      config: {
        systemInstruction: `YOU ARE A PROFESSIONAL ANALYST. Find profitable entries. Return ONLY JSON: { "side": "BUY"|"SELL"|"NEUTRAL", "tp": number, "sl": number, "confidence": number, "reason": "string", "expectedROI": number }.`,
        responseMimeType: "application/json"
      }
    });
    return JSON.parse(response.text.trim());
  } catch (e) { return getSyntheticAnalysis(symbol, price, candles); }
}

function loadState() {
  const defaults = {
    isEngineActive: true, autoPilot: true, isPaperMode: true,
    thoughts: [], executionLogs: [], activePositions: [],
    currentStatus: "INITIALIZING", scanIndex: 0,
    liquidity: { eur: 0, usdc: 0 }, dailyStats: { trades: 0, profit: 0 }, diag: "BOOTING"
  };
  try {
    if (fs.existsSync(STATE_FILE)) return { ...defaults, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
  } catch (e) {}
  return defaults;
}

let ghostState = loadState();

async function syncLiquidity() {
  console.log("[SYSTEM]: Checking Real-Money Connection...");
  const realData = await fetchRealBalances();
  
  if (realData) {
    ghostState.liquidity.eur = realData.eur;
    ghostState.liquidity.usdc = realData.usdc;
    ghostState.isPaperMode = false; 
    ghostState.diag = `LIVE: EUR ${realData.eur.toFixed(2)}`;
    console.log(`[SYSTEM]: AUTH SUCCESS. Connected to Live Account. EUR Balance: ${realData.eur}`);
  } else {
    ghostState.isPaperMode = true; 
    ghostState.diag = "AUTH_FAIL: 401";
    console.warn("[SYSTEM]: Authentication failed. Staying in Simulation mode.");
  }
  saveState();
}

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {}
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'NEAR', 'FET'];

async function loop() {
  if (!ghostState.isEngineActive) return;
  const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
  ghostState.scanIndex++;
  ghostState.currentStatus = `SCANNING_${symbol}`;
  saveState();

  try {
    const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=EUR&limit=24`);
    const candles = res.data?.Data?.Data;
    if (!candles || candles.length < 2) return;
    const price = candles[candles.length - 1].close;
    const analysis = await getAdvancedAnalysis(symbol, price, candles);
    
    if (analysis) {
      const thought = { ...analysis, symbol, price, timestamp: new Date().toISOString(), id: crypto.randomUUID() };
      ghostState.thoughts.unshift(thought);
      if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();

      if (ghostState.autoPilot && analysis.side === 'BUY' && analysis.confidence >= 75) {
        if (!ghostState.activePositions.some(p => p.symbol === symbol)) {
          const tradeSize = 10; 
          const hasFunds = ghostState.isPaperMode || ghostState.liquidity.eur >= tradeSize;
          
          if (hasFunds) {
            const order = await placeRealOrder(symbol, 'BUY', tradeSize);
            if (order.success) {
              if (ghostState.isPaperMode) ghostState.liquidity.eur -= tradeSize;
              ghostState.activePositions.push({ symbol, entryPrice: price, amount: tradeSize, tp: analysis.tp, sl: analysis.sl });
              ghostState.executionLogs.unshift({ 
                id: crypto.randomUUID(), symbol, action: 'BUY', price, status: 'SUCCESS', 
                details: ghostState.isPaperMode ? 'SIMULATION' : 'REAL_MARKET', 
                timestamp: new Date().toISOString() 
              });
              ghostState.dailyStats.trades++;
            }
          }
        }
      }
    }
    ghostState.currentStatus = `READY`;
  } catch (e) { ghostState.currentStatus = "COOLDOWN"; }
  saveState();
}

syncLiquidity();
setInterval(loop, 20000); 
setInterval(syncLiquidity, 60000); 

app.get('/', (req, res) => res.send('NOVA_TRADE_BRIDGE_ACTIVE'));
app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========================================`);
  console.log(`🚀 NOVA_TRADE AI OVERLORD ACTIVE`);
  console.log(`📡 BRIDGE: ${PORT} | AUTH: CDP_V3`);
  console.log(`========================================\n`);
});
