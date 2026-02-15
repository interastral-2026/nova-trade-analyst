
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
const LIQUIDITY_ASSETS = ['EUR', 'USDC', 'EURC', 'USDT', 'USD'];

let ghostState = {
  isEngineActive: true,
  autoPilot: true,
  thoughts: [],
  managedAssets: {}, 
  executedOrders: [], 
  currentStatus: "PREDATOR_ACTIVE",
  scanIndex: 0,
  liquidity: { eur: 0, usdc: 0 }
};

// --- AUTHENTICATION ---
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
  if (!token) throw new Error("AUTH_TOKEN_GEN_FAILED");
  return await axios({
    method,
    url: `https://api.coinbase.com${path}`,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: body,
    timeout: 15000
  });
}

// --- PREDATOR AI SCANNER ---
async function runPredatorScan(symbol, price, history, mode) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `PREDATOR_SCAN: ${symbol} | PRICE: ${price} | MODE: ${mode}` }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ['BUY', 'SELL', 'HOLD', 'NEUTRAL'] },
            tp: { type: Type.NUMBER },
            sl: { type: Type.NUMBER },
            confidence: { type: Type.NUMBER },
            strategy: { type: Type.STRING },
            reason: { type: Type.STRING }
          },
          required: ['side', 'tp', 'sl', 'confidence', 'strategy', 'reason']
        },
        systemInstruction: "You are NOVA_PREDATOR. Spot Smart Money movements and avoid exchange traps. Set TP at 85% of target for safety. Set SL below liquidity zones. Output JSON only."
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (e) { return null; }
}

// --- ASSET PROCESSOR ---
async function syncAsset(curr, amount, isOwned) {
  if (!curr || LIQUIDITY_ASSETS.includes(curr)) return;
  const currencyKey = curr.toUpperCase().trim();

  try {
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${currencyKey}&tsyms=EUR`).catch(() => null);
    const currentPrice = pRes?.data?.EUR || 0;
    if (!currentPrice) return;

    let entryPrice = currentPrice;
    if (isOwned && amount > 0) {
      const fillsRes = await coinbaseCall('GET', `/api/v3/brokerage/orders/historical/fills?product_id=${currencyKey}-EUR&limit=1`).catch(() => null);
      const fills = fillsRes?.data?.fills || [];
      if (fills.length > 0) entryPrice = parseFloat(fills[0].price);
    }

    const analysis = await runPredatorScan(currencyKey, currentPrice, [], isOwned ? "PORTFOLIO_OPTIMIZE" : "HUNT_OPPORTUNITY");
    
    if (analysis) {
      ghostState.managedAssets[currencyKey] = {
        currency: currencyKey, amount, currentPrice, entryPrice, ...analysis, lastSync: new Date().toISOString()
      };
      if (analysis.confidence > 75 && analysis.side !== 'HOLD') {
        ghostState.thoughts.unshift({ ...analysis, symbol: currencyKey, timestamp: new Date().toISOString() });
        ghostState.thoughts = ghostState.thoughts.slice(0, 30);
      }
    }
  } catch (e) {}
}

async function masterLoop() {
  if (!ghostState.isEngineActive) return;
  try {
    const accRes = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    const accounts = accRes?.data?.accounts || [];

    let eTotal = 0, uTotal = 0;
    const cryptoItems = [];

    accounts.forEach(a => {
      const val = parseFloat(a.available_balance?.value || "0");
      const cur = a.currency;
      if (cur === 'EUR' || cur === 'EURC') eTotal += val;
      else if (cur === 'USDC' || cur === 'USDT' || cur === 'USD') uTotal += val;
      else if (val > 0.0001) cryptoItems.push({ cur, val });
    });

    ghostState.liquidity.eur = eTotal;
    ghostState.liquidity.usdc = uTotal;

    for (const item of cryptoItems) await syncAsset(item.cur, item.val, true);

    const target = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    await syncAsset(target, 0, false);
    
    ghostState.currentStatus = "PREDATOR_SCANNING_LIQUIDITY";
  } catch (e) {
    ghostState.currentStatus = "SYSTEM_RECONNECTING";
  }
}

setInterval(masterLoop, 20000);
app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.get('/api/balances', (req, res) => res.json([]));
app.post('/api/ghost/toggle', (req, res) => {
  const { engine, auto } = req.body;
  if (engine !== undefined) ghostState.isEngineActive = engine;
  if (auto !== undefined) ghostState.autoPilot = auto;
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`PREDATOR_ENGINE_ONLINE:${PORT}`));
