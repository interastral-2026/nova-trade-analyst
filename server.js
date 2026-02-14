
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());

const API_KEY_NAME = "organizations/d90bac52-0e8a-4999-b156-7491091ffb5e/apiKeys/79d55457-7e62-45ad-8656-31e1d96e0571";
const PRIVATE_KEY = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIADE7F++QawcWU5iZfqmo8iupxBkqfJsFV0KsTaGpRpLoAoGCCqGSM49
AwEHoUQDQgAEhSKrrlzJxIh6hgr5fT0cZf3NO91/a6kRPkWRNG6kQlLW8FIzJ53Y
Dgbh5U2Zj3zlxHWivwVyZGMWMf8xEdxYXw==
-----END EC PRIVATE KEY-----`;

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'LINK', 'DOT', 'MATIC'];
const LIQUIDITY_ASSETS = ['EUR', 'USDC', 'EURC', 'USDT', 'USD', 'EURC-EUR', 'USDC-EUR'];

let ghostState = {
  isEngineActive: true,
  autoPilot: true,
  thoughts: [],
  managedAssets: {}, 
  executedOrders: [], 
  currentStatus: "NOVA_READY",
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
    data: body
  });
}

// --- AI BRAIN ---
async function runNeuralStrategicScan(symbol, price, history, context) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `SCAN_REQ: ${symbol} | PRICE: ${price} | MODE: ${context}` }] }],
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
        systemInstruction: "You are NOVA_ELITE_QUANT. Provide precise market analysis. Output JSON only."
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (e) { return null; }
}

// --- SECURE ASSET PROCESSOR ---
async function syncAsset(curr, amount, isOwned) {
  if (!curr) return;
  const currencyKey = curr.toUpperCase().trim();
  
  // بلاک کردن قطعی ارزهای نقد از چرخه پردازش تکنیکال برای جلوگیری از خطای Length
  if (LIQUIDITY_ASSETS.includes(currencyKey)) return;

  try {
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${currencyKey}&tsyms=EUR,USD`).catch(() => null);
    const currentPrice = pRes?.data?.EUR || (pRes?.data?.USD ? pRes.data.USD * 0.94 : 0);
    if (!currentPrice || currentPrice === 0) return;

    let entryPrice = currentPrice;
    if (isOwned && amount > 0) {
      try {
        const fillsRes = await coinbaseCall('GET', `/api/v3/brokerage/orders/historical/fills?product_id=${currencyKey}-EUR&limit=1`);
        const fills = fillsRes?.data?.fills;
        // بررسی ایمن وجود آرایه قبل از دسترسی به ایندکس و طول
        if (Array.isArray(fills) && fills.length > 0) {
          entryPrice = parseFloat(fills[0].price) || currentPrice;
        }
      } catch (e) {}
    }

    const currentAsset = {
      ...ghostState.managedAssets[currencyKey],
      currency: currencyKey, amount, currentPrice, entryPrice, lastSync: new Date().toISOString()
    };
    ghostState.managedAssets[currencyKey] = currentAsset;

    // فقط تحلیل اگر واقعاً لازم باشد
    const analysis = await runNeuralStrategicScan(currencyKey, currentPrice, [], isOwned ? "PORTFOLIO" : "WATCHLIST");
    if (analysis) {
      ghostState.managedAssets[currencyKey] = { ...ghostState.managedAssets[currencyKey], ...analysis };
      if (analysis.reason) {
         ghostState.thoughts.unshift({ ...analysis, symbol: currencyKey, timestamp: new Date().toISOString() });
         ghostState.thoughts = ghostState.thoughts.slice(0, 20);
      }
    }
  } catch (e) {
    // خطاها فقط در کنسول لاگ می‌شوند و باعث توقف نمی‌شوند
    console.log(`[LOG] Asset ${currencyKey} skipped or limited data.`);
  }
}

// --- MASTER LOOP ---
async function masterLoop() {
  if (!ghostState.isEngineActive) return;

  try {
    const accRes = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    const accounts = accRes?.data?.accounts || (Array.isArray(accRes?.data) ? accRes.data : []);

    let eTotal = 0;
    let uTotal = 0;
    const cryptoItems = [];

    if (Array.isArray(accounts)) {
      accounts.forEach(a => {
        const raw = a.available_balance?.value || a.balance?.value || "0";
        const val = parseFloat(raw) || 0;
        const cur = (a.currency || "").toUpperCase().trim();

        if (!cur) return;

        if (cur === 'EUR' || cur === 'EURC') {
          eTotal += val;
        } else if (cur === 'USDC' || cur === 'USDT' || cur === 'USD') {
          uTotal += val;
        } else if (val > 0.0001) {
          cryptoItems.push({ cur, val });
        }
      });
    }

    ghostState.liquidity.eur = eTotal;
    ghostState.liquidity.usdc = uTotal;

    for (const item of cryptoItems) {
      await syncAsset(item.cur, item.val, true);
    }

    if (eTotal > 1 || uTotal > 1) {
      const target = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
      ghostState.scanIndex++;
      if (!ghostState.managedAssets[target] || (ghostState.managedAssets[target].amount || 0) <= 0) {
        await syncAsset(target, 0, false);
      }
    }
    ghostState.currentStatus = "NOVA_ACTIVE_STABLE";
  } catch (e) {
    ghostState.currentStatus = "RECONNECTING_VAULT";
  }
}

setInterval(masterLoop, 15000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.get('/api/balances', (req, res) => {
  const holdings = Object.keys(ghostState.managedAssets)
    .map(k => ({ currency: k, available: ghostState.managedAssets[k].amount, total: ghostState.managedAssets[k].amount }))
    .filter(b => b.available > 0);
  
  holdings.push({ currency: 'EUR', available: ghostState.liquidity.eur, total: ghostState.liquidity.eur });
  holdings.push({ currency: 'USDC', available: ghostState.liquidity.usdc, total: ghostState.liquidity.usdc });
  res.json(holdings);
});

app.post('/api/ghost/toggle', (req, res) => {
  const { engine, auto } = req.body;
  if (engine !== undefined) ghostState.isEngineActive = engine;
  if (auto !== undefined) ghostState.autoPilot = auto;
  res.json({ success: true });
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`SYSTEM_BRIDGE_READY:${PORT}`));
