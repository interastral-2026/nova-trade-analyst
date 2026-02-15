
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import { GoogleGenAI, Type } from "@google/genai";

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

const API_KEY_NAME = "organizations/d90bac52-0e8a-4999-b156-7491091ffb5e/apiKeys/79d55457-7e62-45ad-8656-31e1d96e0571";
const PRIVATE_KEY = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIADE7F++QawcWU5iZfqmo8iupxBkqfJsFV0KsTaGpRpLoAoGCCqGSM49
AwEHoUQDQgAEhSKrrlzJxIh6hgr5fT0cZf3NO91/a6kRPkWRNG6kQlLW8FIzJ53Y
Dgbh5U2Zj3zlxHWivwVyZGMWMf8xEdxYXw==
-----END EC PRIVATE KEY-----`;

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'LINK', 'DOT', 'MATIC'];
const TAKER_FEE = 0.006; // 0.6% standard fee

let ghostState = {
  isEngineActive: true,
  autoPilot: true,
  thoughts: [],
  managedAssets: {}, 
  executionLogs: [], 
  currentStatus: "PREDATOR_STANDBY",
  scanIndex: 0,
  liquidity: { eur: 0, usdc: 0 },
  dailyStats: { trades: 0, profit: 0, fees: 0 }
};

// --- AUTH & COMMUNICATION ---
function generateToken(method, path) {
  try {
    const header = { alg: 'ES256', kid: API_KEY_NAME, typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = { 
      iss: 'coinbase-cloud', nbf: now, exp: now + 60, sub: API_KEY_NAME, 
      uri: `${method} api.coinbase.com${path.split('?')[0]}` 
    };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const tokenData = `${encodedHeader}.${encodedPayload}`;
    return `${tokenData}.${crypto.sign("sha256", Buffer.from(tokenData), { key: PRIVATE_KEY, dsaEncoding: "ieee-p1363" }).toString('base64url')}`;
  } catch (e) { return null; }
}

async function coinbaseCall(method, path, body = null) {
  const token = generateToken(method, path);
  if (!token) return null;
  return await axios({
    method,
    url: `https://api.coinbase.com${path}`,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: body,
    timeout: 15000
  });
}

// --- PREDATOR QUANT BRAIN ---
async function runEliteScan(symbol, price, context) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `ELITE_SCAN: ${symbol} | PRICE: ${price} | BAL: ${JSON.stringify(ghostState.liquidity)}` }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ['BUY', 'SELL', 'HOLD'] },
            tp: { type: Type.NUMBER },
            sl: { type: Type.NUMBER },
            confidence: { type: Type.NUMBER },
            reason: { type: Type.STRING },
            netRoi: { type: Type.NUMBER }
          },
          required: ['side', 'tp', 'sl', 'confidence', 'reason', 'netRoi']
        },
        systemInstruction: `YOU ARE NOVA_ELITE_QUANT. 
        - DO NOT FEAR THE MARKET, HUNT IT.
        - IGNORE TRAPS: Wait for Liquidity Sweeps.
        - STRICT FEES: Account for 0.6% entry and 0.6% exit fees.
        - CONFIDENCE: Only return >80% for signals. Return side="HOLD" if unsure.
        - STRATEGY: TP at 85% of target for guaranteed capture. SL in Deep Liquidity Zones.`
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (e) { return null; }
}

// --- ORDER EXECUTION ---
async function executeOrder(symbol, side, amount, price) {
  console.log(`[EXECUTING] ${side} ${symbol} @ ${price}`);
  try {
    const res = await coinbaseCall('POST', '/api/v3/brokerage/orders', {
      client_order_id: crypto.randomUUID(),
      product_id: `${symbol}-EUR`,
      side: side,
      order_configuration: { market_market_ioc: { quote_size: amount.toString() } }
    });
    
    if (res?.data?.success) {
      const fee = amount * TAKER_FEE;
      ghostState.dailyStats.fees += fee;
      ghostState.executionLogs.unshift({
        id: crypto.randomUUID(),
        symbol,
        action: side,
        amount,
        price,
        timestamp: new Date().toISOString(),
        status: 'AUTO_EXECUTED',
        fees: fee
      });
      return true;
    }
  } catch (e) { console.error("Trade Error", e.message); }
  return false;
}

// --- MASTER LOOP ---
async function masterLoop() {
  if (!ghostState.isEngineActive) return;
  
  try {
    // 1. Sync Balances
    const accRes = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=100');
    if (accRes?.data?.accounts) {
      let e = 0, u = 0;
      accRes.data.accounts.forEach(a => {
        const v = parseFloat(a.available_balance?.value || "0");
        if (a.currency === 'EUR') e = v;
        if (a.currency === 'USDC' || a.currency === 'USDT') u = v;
      });
      ghostState.liquidity = { eur: e, usdc: u };
    }

    // 2. Scan Next Asset
    const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=EUR`);
    const price = pRes.data.EUR;

    const analysis = await runEliteScan(symbol, price, "LIVE_MARKET");
    
    if (analysis && analysis.confidence >= 80) {
      const signal = { ...analysis, symbol, timestamp: new Date().toISOString(), price };
      ghostState.thoughts.unshift(signal);
      ghostState.thoughts = ghostState.thoughts.slice(0, 30);

      // AUTO EXECUTE if > 85% and funds available
      if (ghostState.autoPilot && analysis.confidence >= 85 && analysis.side === 'BUY' && ghostState.liquidity.eur > 50) {
        ghostState.currentStatus = "EXECUTING_PREDATOR_STRIKE";
        const tradeAmount = Math.min(ghostState.liquidity.eur * 0.25, 200); // Risk 25% or max 200 EUR
        await executeOrder(symbol, 'BUY', tradeAmount, price);
      }
    }
    
    ghostState.currentStatus = `SCANNING_${symbol}_LIQUIDITY`;
  } catch (e) {
    ghostState.currentStatus = "RECONNECTING_TO_VAULT";
  }
}

setInterval(masterLoop, 15000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.get('/api/balances', (req, res) => {
  res.json([
    { currency: 'EUR', available: ghostState.liquidity.eur, total: ghostState.liquidity.eur },
    { currency: 'USDC', available: ghostState.liquidity.usdc, total: ghostState.liquidity.usdc }
  ]);
});
app.post('/api/ghost/toggle', (req, res) => {
  const { engine, auto } = req.body;
  if (engine !== undefined) ghostState.isEngineActive = engine;
  if (auto !== undefined) ghostState.autoPilot = auto;
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`ELITE_PREDATOR_ACTIVE:${PORT}`));
