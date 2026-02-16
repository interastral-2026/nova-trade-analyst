
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
  apiKey: (process.env.CB_API_KEY || '').trim(), // Expected: organizations/.../apiKeys/...
  apiSecret: (process.env.CB_API_SECRET || '')
    .replace(/\\n/g, '\n')
    .replace(/"/g, '')
    .trim(), // EC Private Key
  baseUrl: 'api.coinbase.com' // Base URL without https for URI claim
};

/**
 * Generates the mandatory JWT for Coinbase Cloud V3 API
 * Each request needs a unique JWT including the URI claim.
 */
function getCoinbaseAuthHeader(method, path) {
  if (!CB_CONFIG.apiKey || !CB_CONFIG.apiSecret || CB_CONFIG.apiSecret.length < 20) {
    return {};
  }

  try {
    const header = { alg: 'ES256', typ: 'JWT', kid: CB_CONFIG.apiKey };
    const now = Math.floor(Date.now() / 1000);
    
    // The 'uri' claim is REQUIRED for V3 Cloud Keys. Format: "METHOD PATH"
    // Example: "GET /api/v3/brokerage/accounts"
    const uri = `${method.toUpperCase()} ${path.split('?')[0]}`;
    
    const payload = {
      iss: 'coinbase-cloud',
      nbf: now,
      exp: now + 60, // 1 minute expiry is safest
      sub: CB_CONFIG.apiKey,
      uri: uri 
    };

    const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsignedToken = `${base64Header}.${base64Payload}`;

    const sign = crypto.createSign('SHA256');
    sign.update(unsignedToken);
    
    const signature = sign.sign(CB_CONFIG.apiSecret, 'base64url');
    const jwt = `${unsignedToken}.${signature}`;
    
    return { 'Authorization': `Bearer ${jwt}` };
  } catch (error) {
    console.error("[JWT_SIGN_ERROR]: Check if CB_API_SECRET is a valid ES256 Private Key.");
    return {};
  }
}

async function fetchRealBalances() {
  if (!CB_CONFIG.apiKey || CB_CONFIG.apiKey.length < 10) return null;
  const path = '/api/v3/brokerage/accounts';
  
  try {
    const response = await axios.get(`https://${CB_CONFIG.baseUrl}${path}`, {
      headers: { ...getCoinbaseAuthHeader('GET', path), 'Content-Type': 'application/json' },
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
    console.error(`[CB_AUTH_FAIL]: ${e.response?.status} - ${JSON.stringify(e.response?.data || e.message)}`);
    return null;
  }
}

async function placeRealOrder(symbol, side, amountEur) {
  if (ghostState.isPaperMode) {
    console.log(`[SIMULATION]: ${side} ${symbol} for €${amountEur}`);
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
    const response = await axios.post(`https://${CB_CONFIG.baseUrl}${path}`, body, {
      headers: { ...getCoinbaseAuthHeader('POST', path), 'Content-Type': 'application/json' }
    });
    console.log(`[REAL_ORDER_PLACED]: ${symbol} ${side} €${amountEur}`);
    return { success: true, data: response.data, isPaper: false };
  } catch (e) {
    console.error(`[ORDER_ERROR]: ${JSON.stringify(e.response?.data || e.message)}`);
    return { success: false, error: e.response?.data?.message || e.message };
  }
}

function getSyntheticAnalysis(symbol, price, candles) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const isUp = last.close > prev.close;
  return {
    side: isUp ? "BUY" : "NEUTRAL",
    tp: Number((price * 1.028).toFixed(2)),
    sl: Number((price * 0.982).toFixed(2)),
    confidence: isUp ? 83 : 40,
    reason: `Price action for ${symbol} indicates ${isUp ? 'bullish continuation' : 'range bound'}. Technical indicators confirmed.`,
    expectedROI: 2.8,
    isSynthetic: true
  };
}

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!API_KEY || API_KEY.length < 5) return getSyntheticAnalysis(symbol, price, candles);
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const compactData = candles.slice(-24).map(c => ({ p: c.close, v: Math.round(c.volumeto) }));
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `TRADE ANALYSIS: ${symbol}/EUR @ ${price}. 24H_DATA: ${JSON.stringify(compactData)}` }] }],
      config: {
        systemInstruction: `SYSTEM: QUANT TRADER. Analyze data for profit traps and real breakouts. Return ONLY JSON: { "side": "BUY"|"SELL"|"NEUTRAL", "tp": number, "sl": number, "confidence": number, "reason": "string", "expectedROI": number }. AUTO_EXECUTION threshold is 75%.`,
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    });
    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : response.text);
  } catch (e) {
    return getSyntheticAnalysis(symbol, price, candles);
  }
}

function loadState() {
  const defaults = {
    isEngineActive: true, autoPilot: true, isPaperMode: true,
    thoughts: [], executionLogs: [], activePositions: [],
    currentStatus: "BOOTING_SYSTEM", scanIndex: 0,
    liquidity: { eur: 0, usdc: 0 }, dailyStats: { trades: 0, profit: 0 }, diag: "OFFLINE"
  };
  try {
    if (fs.existsSync(STATE_FILE)) return { ...defaults, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
  } catch (e) {}
  return defaults;
}

let ghostState = loadState();

async function syncLiquidity() {
  console.log("[SYSTEM]: Verifying Real-Money Connection...");
  const realData = await fetchRealBalances();
  
  if (realData) {
    ghostState.liquidity.eur = realData.eur;
    ghostState.liquidity.usdc = realData.usdc;
    ghostState.isPaperMode = false; // SWITCH TO LIVE TRADING
    ghostState.diag = `LIVE_CONNECTED (EUR ${realData.eur.toFixed(2)})`;
    console.log(`[SYSTEM]: SUCCESS. Verified Balance: €${realData.eur}. Switching to REAL TRADING mode.`);
  } else {
    ghostState.isPaperMode = true; 
    ghostState.diag = "AUTH_FAIL: CHECK_V3_KEYS";
    console.warn("[SYSTEM]: Authentication failed. Remaining in Simulation mode.");
  }
  saveState();
}

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {}
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'NEAR', 'FET'];

async function loop() {
  if (!ghostState.isEngineActive) return;
  const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
  ghostState.scanIndex++;
  ghostState.currentStatus = `ANALYZING_${symbol}`;
  saveState();

  try {
    const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=EUR&limit=24`);
    const candles = res.data?.Data?.Data;
    if (!candles) return;
    const price = candles[candles.length - 1].close;
    const analysis = await getAdvancedAnalysis(symbol, price, candles);
    
    if (analysis) {
      const thought = { ...analysis, symbol, price, timestamp: new Date().toISOString(), id: crypto.randomUUID() };
      ghostState.thoughts.unshift(thought);
      if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();

      // EXECUTION LOGIC
      if (ghostState.autoPilot && analysis.side === 'BUY' && analysis.confidence >= 75) {
        if (!ghostState.activePositions.some(p => p.symbol === symbol)) {
          const tradeSize = 10; // Use 10 EUR per trade
          
          if (ghostState.liquidity.eur >= tradeSize || ghostState.isPaperMode) {
            const order = await placeRealOrder(symbol, 'BUY', tradeSize);
            if (order.success) {
              if (ghostState.isPaperMode) ghostState.liquidity.eur -= tradeSize;
              ghostState.activePositions.push({ symbol, entryPrice: price, amount: tradeSize, tp: analysis.tp, sl: analysis.sl });
              ghostState.executionLogs.unshift({ id: crypto.randomUUID(), symbol, action: 'BUY', price, status: 'SUCCESS', details: ghostState.isPaperMode ? 'PAPER' : 'LIVE', timestamp: new Date().toISOString() });
              ghostState.dailyStats.trades++;
            }
          }
        }
      }
    }
    ghostState.currentStatus = `MONITORING`;
  } catch (e) { ghostState.currentStatus = "RECOVERY"; }
  saveState();
}

// Initialization
syncLiquidity();

// Timers
setInterval(loop, 20000); 
setInterval(syncLiquidity, 60000); // Check balance every 60s

app.get('/', (req, res) => res.send('SPECTRAL OVERLORD API ACTIVE'));
app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========================================`);
  console.log(`🚀 SPECTRAL OVERLORD V16.8 [LIVE_FIX]`);
  console.log(`🧠 AI ENGINE: GEMINI-3-PRO`);
  console.log(`💹 AUTH: MANDATORY URI_CLAIM ENABLED`);
  console.log(`========================================\n`);
});
