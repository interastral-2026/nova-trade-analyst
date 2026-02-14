
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
const LIQUIDITY_ASSETS = ['EUR', 'USDC', 'EURC', 'USDT', 'USD'];

let ghostState = {
  isEngineActive: true,
  autoPilot: true,
  thoughts: [],
  managedAssets: {}, 
  executedOrders: [], 
  currentStatus: "NOVA_INITIALIZING",
  scanIndex: 0,
  liquidity: { eur: 0, usdc: 0 }
};

// --- AUTHENTICATION ---
function generateToken(method, path) {
  const header = { alg: 'ES256', kid: API_KEY_NAME, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { 
    iss: 'coinbase-cloud', nbf: now, exp: now + 60, sub: API_KEY_NAME, 
    uri: `${method} api.coinbase.com${path.split('?')[0]}` 
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const tokenData = `${encodedHeader}.${encodedPayload}`;
  try {
    return `${tokenData}.${crypto.sign("sha256", Buffer.from(tokenData), { key: PRIVATE_KEY, dsaEncoding: "ieee-p1363" }).toString('base64url')}`;
  } catch (e) { return null; }
}

async function coinbaseCall(method, path, body = null) {
  const token = generateToken(method, path);
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
      contents: [{ parts: [{ text: `NODE_INTEL: ${symbol} | PRICE: ${price} | CONTEXT: ${context}` }] }],
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
        systemInstruction: "You are NOVA_ELITE_QUANT. Provide precise market analysis with TP/SL. Return JSON only."
      }
    });
    return JSON.parse(response.text);
  } catch (e) { return null; }
}

// --- DEFENSIVE ASSET PROCESSOR ---
async function syncAsset(curr, amount, isOwned) {
  // جلوگیری از پردازش ارزهای نقد به عنوان دارایی معاملاتی
  if (!curr) return;
  const currencyKey = curr.toUpperCase().trim();
  if (LIQUIDITY_ASSETS.includes(currencyKey)) return;

  try {
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${currencyKey}&tsyms=EUR,USD`).catch(() => null);
    const currentPrice = pRes?.data?.EUR || (pRes?.data?.USD ? pRes.data.USD * 0.94 : 0);
    if (!currentPrice || currentPrice === 0) return;

    let entryPrice = currentPrice;
    if (isOwned && amount > 0) {
      try {
        const fillsRes = await coinbaseCall('GET', `/api/v3/brokerage/orders/historical/fills?product_id=${currencyKey}-EUR&limit=1`);
        // ایمن‌سازی کامل در برابر خطای Length
        const fills = fillsRes?.data?.fills;
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

    const hRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${currencyKey}&tsym=EUR&limit=12`).catch(() => null);
    const history = hRes?.data?.Data?.Data || [];
    const analysis = await runNeuralStrategicScan(currencyKey, currentPrice, history, isOwned ? "HODL_MODE" : "HUNT_MODE");
    
    if (analysis) {
      ghostState.managedAssets[currencyKey] = { ...ghostState.managedAssets[currencyKey], ...analysis };
    }
  } catch (e) {
    // خطاهای احتمالی در کنسول ثبت می‌شوند اما باعث توقف برنامه نمی‌شوند
    console.warn(`[SKIP] Node ${currencyKey} error: ${e.message}`);
  }
}

// --- MASTER LOOP: FIXED BALANCE & ERROR HANDLING ---
async function masterLoop() {
  if (!ghostState.isEngineActive) return;

  try {
    ghostState.currentStatus = "NOVA_VAULT_SYNCING";
    const accRes = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    
    const accounts = accRes.data?.accounts || (Array.isArray(accRes.data) ? accRes.data : []);

    let eurTotal = 0;
    let usdcTotal = 0;
    const cryptoHoldings = [];

    if (Array.isArray(accounts)) {
      accounts.forEach(a => {
        const rawVal = a.available_balance?.value || a.balance?.value || "0";
        const val = parseFloat(rawVal) || 0;
        const cur = String(a.currency || "").trim().toUpperCase();

        if (!cur || val < 0) return;

        // دسته‌بندی دقیق نقدینگی برای نمایش در ویجت بالا
        if (cur === 'EUR' || cur === 'EURC') {
          eurTotal += val;
        } else if (cur === 'USDC' || cur === 'USDT' || cur === 'USD') {
          usdcTotal += val;
        } else if (val > 0.0001) {
          cryptoHoldings.push({ cur, val });
        }
      });
    }

    // به‌روزرسانی نقدینگی در حالت سراسری (این مقادیر در داشبورد شما نمایش داده می‌شوند)
    ghostState.liquidity.eur = eurTotal;
    ghostState.liquidity.usdc = usdcTotal;

    // پردازش دارایی‌های کریپتو موجود
    for (const item of cryptoHoldings) {
      await syncAsset(item.cur, item.val, true);
    }

    // اسکن دوره‌ای Watchlist
    if (eurTotal > 1 || usdcTotal > 1) {
      ghostState.currentStatus = "NOVA_SNIPER_IDLE";
      const target = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
      ghostState.scanIndex++;
      if (!ghostState.managedAssets[target] || (ghostState.managedAssets[target].amount || 0) <= 0) {
        await syncAsset(target, 0, false);
      }
    }

    ghostState.currentStatus = "NOVA_SYSTEM_STABLE";
  } catch (e) {
    console.error("[CRITICAL] Master Sync Pulse Failure:", e.message);
    ghostState.currentStatus = "BRIDGE_RECOVERY";
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
app.listen(PORT, '0.0.0.0', () => console.log(`CORE_TACTICAL_BRIDGE_ONLINE:${PORT}`));
