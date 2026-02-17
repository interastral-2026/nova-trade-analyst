
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
    .replace(/\\n/g, '\n') // Handle escaped newlines from .env
    .replace(/"/g, '')
    .replace(/'/g, '')
    .trim(),
  hostname: 'api.coinbase.com'
};

/**
 * GENERATES JWT COMPLIANT WITH COINBASE CDP V3
 * Uses ieee-p1363 encoding for ES256 (Strictly required for JWT)
 */
function getCoinbaseAuthHeader(method, path) {
  if (!CB_CONFIG.apiKey || !CB_CONFIG.apiSecret || CB_CONFIG.apiSecret.length < 30) {
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
    // Format: METHOD hostname/path
    const uriClaim = `${method.toUpperCase()} ${CB_CONFIG.hostname}${cleanPath}`;
    
    const payload = {
      iss: 'coinbase-cloud',
      nbf: now - 5,
      iat: now - 5,
      exp: now + 60,
      sub: CB_CONFIG.apiKey,
      uri: uriClaim
    };

    const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsignedToken = `${base64Header}.${base64Payload}`;

    // Ensure Private Key is standard PEM format
    let key = CB_CONFIG.apiSecret;
    if (!key.includes('-----BEGIN')) {
      const raw = key.replace(/\s/g, '');
      const lines = raw.match(/.{1,64}/g) || [];
      key = `-----BEGIN EC PRIVATE KEY-----\n${lines.join('\n')}\n-----END EC PRIVATE KEY-----`;
    }

    /**
     * CRITICAL FIX: Use ieee-p1363 encoding.
     * JWT ES256 expects the concatenation of R and S (64 bytes), NOT the DER format.
     */
    const signature = crypto.sign(
      'sha256',
      Buffer.from(unsignedToken),
      {
        key: key,
        dsaEncoding: 'ieee-p1363', 
      }
    ).toString('base64url');
    
    const jwt = `${unsignedToken}.${signature}`;
    return { 'Authorization': `Bearer ${jwt}` };
  } catch (error) {
    console.error("[JWT_SIGN_FAILURE]:", error.message);
    return {};
  }
}

async function fetchRealBalances() {
  if (!CB_CONFIG.apiKey.includes('organizations/')) return null;

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
    // Log the actual error for debugging
    console.error(`[CB_V3_AUTH_FAIL]: ${status} | Error: ${JSON.stringify(detail || e.message)}`);
    return null;
  }
}

async function placeRealOrder(symbol, side, amountEur) {
  if (ghostState.isPaperMode) return { success: true, isPaper: true };

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
    return { success: true, data: response.data, isPaper: false };
  } catch (e) {
    console.error(`[TRADE_EXEC_ERROR]: ${JSON.stringify(e.response?.data || e.message)}`);
    return { success: false, error: e.response?.data?.message || e.message };
  }
}

function getSyntheticAnalysis(symbol, price, candles) {
  const last = candles[candles.length - 1];
  const isUp = last.close > candles[candles.length - 2].close;
  return {
    side: isUp ? "BUY" : "NEUTRAL",
    tp: Number((price * 1.03).toFixed(2)),
    sl: Number((price * 0.98).toFixed(2)),
    confidence: isUp ? 80 : 30,
    reason: `Price movement for ${symbol} suggests ${isUp ? 'potential growth' : 'no clear trend'}.`,
    expectedROI: 3.0
  };
}

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!API_KEY) return getSyntheticAnalysis(symbol, price, candles);
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const compact = candles.slice(-20).map(c => ({ p: c.close, v: Math.round(c.volumeto) }));
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `ANALYZE_MARKET ${symbol}/EUR: ${JSON.stringify(compact)}` }] }],
      config: {
        systemInstruction: `SYSTEM: TRADING_BOT. Return JSON: { "side": "BUY"|"SELL"|"NEUTRAL", "tp": number, "sl": number, "confidence": number, "reason": "string", "expectedROI": number }. Confidence > 75 triggers BUY.`,
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
    liquidity: { eur: 0, usdc: 0 }, dailyStats: { trades: 0, profit: 0 }, diag: "SYSTEM_BOOT"
  };
  try {
    if (fs.existsSync(STATE_FILE)) return { ...defaults, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
  } catch (e) {}
  return defaults;
}

let ghostState = loadState();

async function syncLiquidity() {
  const realData = await fetchRealBalances();
  if (realData) {
    ghostState.liquidity.eur = realData.eur;
    ghostState.liquidity.usdc = realData.usdc;
    ghostState.isPaperMode = false; 
    ghostState.diag = `LIVE_SYNC_OK | EUR: ${realData.eur.toFixed(2)}`;
    console.log(`[SUCCESS]: AUTHENTICATED WITH COINBASE. EUR: ${realData.eur}`);
  } else {
    ghostState.isPaperMode = true; 
    ghostState.diag = "AUTH_FAIL | CHECK_KEYS";
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
  ghostState.currentStatus = `ANALYZING_${symbol}`;
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
          if (ghostState.isPaperMode || ghostState.liquidity.eur >= tradeSize) {
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
setInterval(loop, 30000); 
setInterval(syncLiquidity, 60000); 

app.get('/', (req, res) => res.send('NOVA_BRIDGE_V17.4_ACTIVE'));
app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========================================`);
  console.log(`🚀 NOVATRADE AI V17.4 (IEEE-P1363)`);
  console.log(`📡 BRIDGE_PORT: ${PORT}`);
  console.log(`========================================\n`);
});
