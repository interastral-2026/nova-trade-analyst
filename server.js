
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
  apiKey: (process.env.CB_API_KEY || '').trim(), // Format: organizations/.../apiKeys/...
  apiSecret: (process.env.CB_API_SECRET || '').replace(/\\n/g, '\n').trim(), // EC Private Key
  baseUrl: 'https://api.coinbase.com'
};

/**
 * Generates a JWT for Coinbase Cloud V3 API Authentication
 * Required for the newer Cloud API Keys (ES256)
 */
function getCoinbaseAuthHeader() {
  if (!CB_CONFIG.apiKey || !CB_CONFIG.apiSecret) return {};

  try {
    const algorithm = 'ES256';
    const header = {
      alg: algorithm,
      typ: 'JWT',
      kid: CB_CONFIG.apiKey
    };

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: 'coinbase-cloud',
      nbf: now,
      exp: now + 60,
      sub: CB_CONFIG.apiKey,
    };

    const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsignedToken = `${base64Header}.${base64Payload}`;

    // Sign the token using the EC Private Key
    const sign = crypto.createSign('SHA256');
    sign.update(unsignedToken);
    const signature = sign.sign(CB_CONFIG.apiSecret, 'base64url');

    const jwt = `${unsignedToken}.${signature}`;
    return { 'Authorization': `Bearer ${jwt}` };
  } catch (error) {
    console.error("[AUTH_GEN_ERROR]:", error.message);
    return {};
  }
}

async function fetchRealBalances() {
  if (!CB_CONFIG.apiKey || CB_CONFIG.apiKey.length < 10) return null;
  const path = '/api/v3/brokerage/accounts';
  try {
    const response = await axios.get(`${CB_CONFIG.baseUrl}${path}`, {
      headers: { ...getCoinbaseAuthHeader(), 'Content-Type': 'application/json' },
      timeout: 10000
    });
    
    const accounts = response.data?.accounts || [];
    let eurVal = 0;
    let usdcVal = 0;
    
    for (const acc of accounts) {
      const currency = acc.currency;
      const value = parseFloat(acc.available_balance?.value || 0);
      if (currency === 'EUR') eurVal += value;
      if (currency === 'USDC') usdcVal += value;
    }
    
    return accounts.length > 0 ? { eur: eurVal, usdc: usdcVal } : null;
  } catch (e) {
    // If we get a 401 or similar, auth failed
    console.error("[CB_SYNC_ERROR]: Authentication failed or API unreachable.");
    return null;
  }
}

async function placeRealOrder(symbol, side, amountEur) {
  // If we are in paper mode, just simulate
  if (ghostState.isPaperMode) {
    console.log(`[PAPER_TRADE]: ${side} ${symbol} for €${amountEur}`);
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
    const response = await axios.post(`${CB_CONFIG.baseUrl}${path}`, body, {
      headers: { ...getCoinbaseAuthHeader(), 'Content-Type': 'application/json' }
    });
    console.log(`[LIVE_TRADE_SUCCESS]: ${symbol} ${side}`);
    return { success: true, data: response.data, isPaper: false };
  } catch (e) {
    console.error(`[LIVE_TRADE_FAIL_${symbol}]:`, e.response?.data || e.message);
    return { success: false, error: e.message };
  }
}

function getSyntheticAnalysis(symbol, price, candles) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const isUp = last.close > prev.close;
  return {
    side: isUp ? "BUY" : "NEUTRAL",
    tp: Number((price * 1.035).toFixed(2)),
    sl: Number((price * 0.982).toFixed(2)),
    confidence: isUp ? 81 : 40,
    reason: `[MARKET_SCAN] Technical indicators for ${symbol} show ${isUp ? 'upward momentum' : 'consolidation'}. AI analysis recommended.`,
    expectedROI: 3.5,
    isSynthetic: true
  };
}

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!API_KEY || API_KEY.length < 5) return getSyntheticAnalysis(symbol, price, candles);
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const compactData = candles.slice(-15).map(c => ({ p: c.close, v: Math.round(c.volumeto) }));
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `ANALYZE ${symbol}/EUR at ${price}. DATA: ${JSON.stringify(compactData)}` }] }],
      config: {
        systemInstruction: `YOU ARE A QUANT TRADER. Return ONLY JSON: { "side": "BUY"|"SELL"|"NEUTRAL", "tp": number, "sl": number, "confidence": number, "reason": "string", "expectedROI": number }.`,
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
    currentStatus: "INITIALIZING", scanIndex: 0,
    liquidity: { eur: 0, usdc: 0 }, dailyStats: { trades: 0, profit: 0 }, diag: "CONNECTING"
  };
  try {
    if (fs.existsSync(STATE_FILE)) return { ...defaults, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
  } catch (e) {}
  return defaults;
}

let ghostState = loadState();

async function syncLiquidity() {
  const realBals = await fetchRealBalances();
  if (realBals) {
    ghostState.liquidity = realBals;
    ghostState.isPaperMode = false; // SUCCESS: Switch to Real Trading
    ghostState.diag = "LIVE_CB_V3_CONNECTED";
    console.log(`[SYSTEM]: Connected to Coinbase. Real Balances: EUR ${realBals.eur}`);
  } else {
    ghostState.isPaperMode = true; // FAIL: Fallback to Paper
    ghostState.diag = "AUTH_FAILED_PAPER_MODE";
  }
  saveState();
}

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {}
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'FET', 'RENDER', 'NEAR'];

async function loop() {
  if (!ghostState.isEngineActive) return;
  const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
  ghostState.scanIndex++;
  ghostState.currentStatus = `SCANNING_${symbol}`;
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

      if (ghostState.autoPilot && analysis.side === 'BUY' && analysis.confidence >= 75) {
        if (!ghostState.activePositions.some(p => p.symbol === symbol)) {
          // Minimum trade 10 EUR or 10% of balance
          const tradeSize = Math.max(10, Math.min(100, ghostState.liquidity.eur * 0.1));
          
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
    ghostState.currentStatus = `WATCHING_MARKET`;
  } catch (e) { ghostState.currentStatus = "SYSTEM_RECOVERY"; }
  saveState();
}

// Initial sync
syncLiquidity();

// Intervals
setInterval(loop, 15000);
setInterval(syncLiquidity, 30000); // Sync balance every 30s

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
  console.log(`🚀 SPECTRAL OVERLORD V16.6`);
  console.log(`🧠 AI: ${API_KEY ? 'GEMINI_PRO' : 'OFFLINE'}`);
  console.log(`💹 MODE: JWT_V3_AUTH_ENABLED`);
  console.log(`========================================\n`);
});
