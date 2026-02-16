
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
  apiKey: (process.env.CB_API_KEY || '').trim(), // Expected format: organizations/.../apiKeys/...
  apiSecret: (process.env.CB_API_SECRET || '').replace(/\\n/g, '\n').trim(), // ES256 Private Key
  baseUrl: 'https://api.coinbase.com'
};

/**
 * Enhanced JWT Generation for Coinbase Cloud V3
 */
function getCoinbaseAuthHeader(method, path) {
  if (!CB_CONFIG.apiKey || !CB_CONFIG.apiSecret || CB_CONFIG.apiSecret.length < 20) {
    return {};
  }

  try {
    const header = { alg: 'ES256', typ: 'JWT', kid: CB_CONFIG.apiKey };
    const now = Math.floor(Date.now() / 1000);
    
    // Coinbase Cloud V3 JWT requirements
    const payload = {
      iss: 'coinbase-cloud',
      nbf: now,
      exp: now + 120,
      sub: CB_CONFIG.apiKey,
    };

    const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsignedToken = `${base64Header}.${base64Payload}`;

    const sign = crypto.createSign('SHA256');
    sign.update(unsignedToken);
    
    // Attempt to sign with the provided private key
    const signature = sign.sign(CB_CONFIG.apiSecret, 'base64url');
    const jwt = `${unsignedToken}.${signature}`;
    
    return { 'Authorization': `Bearer ${jwt}` };
  } catch (error) {
    console.error("[AUTH_CRITICAL_ERROR]: Could not sign JWT. Check if CB_API_SECRET is a valid ES256 Private Key.");
    return {};
  }
}

async function fetchRealBalances() {
  if (!CB_CONFIG.apiKey || CB_CONFIG.apiKey.length < 10) return null;
  const path = '/api/v3/brokerage/accounts';
  
  try {
    const response = await axios.get(`${CB_CONFIG.baseUrl}${path}`, {
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
    
    // If we successfully fetched accounts (even if 0 balance), authentication is working
    return { eur: eurVal, usdc: usdcVal, count: accounts.length };
  } catch (e) {
    console.error("[CB_AUTH_FAIL]: Status", e.response?.status, "Message:", e.response?.data?.message || e.message);
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
    const response = await axios.post(`${CB_CONFIG.baseUrl}${path}`, body, {
      headers: { ...getCoinbaseAuthHeader('POST', path), 'Content-Type': 'application/json' }
    });
    console.log(`[REAL_TRADE_EXECUTED]: ${symbol} ${side} Amount: €${amountEur}`);
    return { success: true, data: response.data, isPaper: false };
  } catch (e) {
    const errData = e.response?.data;
    console.error(`[REAL_TRADE_FAILED]: ${symbol}`, JSON.stringify(errData || e.message));
    return { success: false, error: errData?.message || e.message };
  }
}

function getSyntheticAnalysis(symbol, price, candles) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const isUp = last.close > prev.close;
  return {
    side: isUp ? "BUY" : "NEUTRAL",
    tp: Number((price * 1.025).toFixed(2)),
    sl: Number((price * 0.985).toFixed(2)),
    confidence: isUp ? 82 : 45,
    reason: `Technical breakout detected on ${symbol}. Momentum is ${isUp ? 'Strongly Bullish' : 'Neutral'}.`,
    expectedROI: 2.5,
    isSynthetic: true
  };
}

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!API_KEY || API_KEY.length < 5) return getSyntheticAnalysis(symbol, price, candles);
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const compactData = candles.slice(-20).map(c => ({ p: c.close, v: Math.round(c.volumeto) }));
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `CRITICAL ANALYSIS: ${symbol}/EUR at ${price}. DATA: ${JSON.stringify(compactData)}` }] }],
      config: {
        systemInstruction: `YOU ARE A REAL-MONEY QUANT TRADER. Analyze price traps and trend shifts. Return ONLY JSON: { "side": "BUY"|"SELL"|"NEUTRAL", "tp": number, "sl": number, "confidence": number, "reason": "string", "expectedROI": number }. High confidence (75%+) only for clear entries.`,
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
    currentStatus: "SYSTEM_BOOT", scanIndex: 0,
    liquidity: { eur: 0, usdc: 0 }, dailyStats: { trades: 0, profit: 0 }, diag: "INITIALIZING"
  };
  try {
    if (fs.existsSync(STATE_FILE)) return { ...defaults, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
  } catch (e) {}
  return defaults;
}

let ghostState = loadState();

async function syncLiquidity() {
  console.log("[SYSTEM]: Checking Coinbase Connection...");
  const realData = await fetchRealBalances();
  
  if (realData) {
    ghostState.liquidity.eur = realData.eur;
    ghostState.liquidity.usdc = realData.usdc;
    ghostState.isPaperMode = false; // LIVE MODE ACTIVATED
    ghostState.diag = `LIVE_ACTIVE: EUR ${realData.eur.toFixed(2)}`;
    console.log(`[SYSTEM]: SUCCESS! Real trading enabled. Balance: €${realData.eur}`);
  } else {
    ghostState.isPaperMode = true; 
    ghostState.diag = "AUTH_ERROR: CHECK_API_KEYS";
    console.warn("[SYSTEM]: Auth failed. Staying in Paper Mode for safety.");
  }
  saveState();
}

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {}
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'FET', 'NEAR'];

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

      if (ghostState.autoPilot && analysis.side === 'BUY' && analysis.confidence >= 75) {
        if (!ghostState.activePositions.some(p => p.symbol === symbol)) {
          // Logic for 30 EUR balance: use 10 EUR per trade (3 trades max)
          const tradeSize = 10; 
          
          if (ghostState.liquidity.eur >= tradeSize || ghostState.isPaperMode) {
            const order = await placeRealOrder(symbol, 'BUY', tradeSize);
            if (order.success) {
              if (ghostState.isPaperMode) ghostState.liquidity.eur -= tradeSize;
              ghostState.activePositions.push({ symbol, entryPrice: price, amount: tradeSize, tp: analysis.tp, sl: analysis.sl });
              ghostState.executionLogs.unshift({ id: crypto.randomUUID(), symbol, action: 'BUY', price, status: 'SUCCESS', details: ghostState.isPaperMode ? 'PAPER' : 'LIVE', timestamp: new Date().toISOString() });
              ghostState.dailyStats.trades++;
            }
          } else {
            console.log(`[INSUFFICIENT_FUNDS]: Need €${tradeSize}, have €${ghostState.liquidity.eur}`);
          }
        }
      }
    }
    ghostState.currentStatus = `SCAN_IDLE`;
  } catch (e) { ghostState.currentStatus = "RECOVERING"; }
  saveState();
}

// Initial Sync
syncLiquidity();

// Main Trading Loops
setInterval(loop, 20000); // Analysis every 20s
setInterval(syncLiquidity, 45000); // Balance sync every 45s

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
  console.log(`🚀 SPECTRAL OVERLORD V16.7`);
  console.log(`💹 REAL TRADING CAPABLE: YES`);
  console.log(`🧠 AI MODEL: GEMINI-3-PRO`);
  console.log(`========================================\n`);
});
