
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

const STABLECOINS = ['USDC', 'EURC', 'USDT', 'DAI', 'PYUSD', 'USDS'];

let ghostState = {
  isEngineActive: true,
  autoPilot: true, 
  signals: [],
  thoughts: [],
  managedAssets: {}, 
  currentStatus: "SYSTEM_ONLINE",
  scanIndex: 0
};

const WATCHLIST = ['BTC-EUR', 'ETH-EUR', 'SOL-EUR', 'AVAX-EUR', 'ADA-EUR', 'LINK-EUR'];

// --- COINBASE AUTH ---
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

// --- AI ANALYZER ---
async function runStrategicAnalysis(symbol, price, history, context) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `CORE_ANALYSIS_TASK: ${symbol} @ ${price} | HISTORY: ${JSON.stringify(history.slice(-8))} | CONTEXT: ${context}` }] }],
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
        systemInstruction: "You are NOVA_CORE_ANALYST. Output strict JSON only. Be accurate with TP/SL targets based on price action."
      }
    });
    return JSON.parse(response.text);
  } catch (e) { return null; }
}

// --- ROBUST ASSET PROCESSOR ---
async function processAsset(acc) {
  const curr = acc.currency;
  const amount = parseFloat(acc.available_balance.value);
  if (amount < 0.00000001) return;

  try {
    // 1. Unified Price Fetching (EUR with USD Fallback)
    let currentPrice = 0;
    try {
      const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${curr}&tsyms=EUR,USD`);
      currentPrice = pRes.data.EUR || (pRes.data.USD ? pRes.data.USD * 0.93 : 0);
    } catch (e) {
      console.error(`Price fetch failed for ${curr}`);
    }

    if (currentPrice === 0) return;

    // 2. Entry Price Detection (with immediate fallback)
    let entryPrice = 0;
    try {
      const symbol = `${curr}-EUR`;
      const fills = await coinbaseCall('GET', `/api/v3/brokerage/orders/historical/fills?product_id=${symbol}&limit=1`);
      if (fills.data?.fills?.length > 0) {
        entryPrice = parseFloat(fills.data.fills[0].price);
      }
    } catch (e) {}
    
    // If no fill found, or it's a stablecoin, use market price as ref
    if (entryPrice <= 0) entryPrice = currentPrice;

    // 3. Update State IMMEDIATELY to avoid "Detecting"
    ghostState.managedAssets[curr] = {
      ...ghostState.managedAssets[curr],
      currency: curr,
      amount: amount,
      currentPrice: currentPrice,
      entryPrice: entryPrice,
      lastSync: new Date().toISOString()
    };

    // 4. Analysis Logic
    if (STABLECOINS.includes(curr)) {
      // Automatic targets for stablecoins to avoid "Calculating"
      ghostState.managedAssets[curr] = {
        ...ghostState.managedAssets[curr],
        tp: currentPrice * 1.002,
        sl: currentPrice * 0.998,
        strategy: "STABLE_PEG_MONITOR",
        advice: "HOLD",
        reason: "Stablecoin node. Maintaining liquidity and capital safety."
      };
    } else {
      // Async AI Analysis for Volatile Assets
      const histRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${curr}&tsym=EUR&limit=12`).catch(() => null);
      const history = histRes?.data?.Data?.Data || [];
      
      const analysis = await runStrategicAnalysis(curr, currentPrice, history, "PORTFOLIO_HUNT");
      if (analysis) {
        ghostState.managedAssets[curr] = {
          ...ghostState.managedAssets[curr],
          tp: analysis.tp,
          sl: analysis.sl,
          strategy: analysis.strategy,
          advice: analysis.side,
          reason: analysis.reason
        };
      }
    }
  } catch (err) {
    console.error(`Error processing ${curr}:`, err.message);
  }
}

// --- MAIN CONTROL LOOP ---
async function masterLoop() {
  if (!ghostState.isEngineActive) return;

  try {
    const accs = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    const active = accs.data.accounts.filter(a => parseFloat(a.available_balance.value) > 0 && a.currency !== 'EUR');

    ghostState.currentStatus = `ANALYZING_${active.length}_NODES`;

    // Process each asset
    for (const acc of active) {
      await processAsset(acc);
    }

    // Occasional watchlist scanning for insights
    const target = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${target.split('-')[0]}&tsyms=EUR`).catch(() => null);
    if (pRes?.data?.EUR) {
      const insight = await runStrategicAnalysis(target, pRes.data.EUR, [], "MARKET_WATCH");
      if (insight && insight.side !== 'NEUTRAL') {
        ghostState.thoughts.unshift({ ...insight, symbol: target, timestamp: new Date().toISOString(), id: crypto.randomUUID() });
        if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();
      }
    }

    ghostState.currentStatus = "PULSE_STABLE";
  } catch (e) {
    console.error("Master Loop Failed:", e.message);
    ghostState.currentStatus = "SYNC_ERR_RETRYING";
  }
}

// Faster refresh rate for responsive UI
setInterval(masterLoop, 20000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.get('/api/balances', async (req, res) => {
  try {
    const r = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    res.json(r.data.accounts.map(a => ({ 
      currency: a.currency, 
      total: parseFloat(a.available_balance.value || 0)
    })).filter(b => b.total > 0.00000001));
  } catch (e) { res.json([]); }
});

app.post('/api/ghost/toggle', (req, res) => {
  const { engine, auto } = req.body;
  if (engine !== undefined) ghostState.isEngineActive = engine;
  if (auto !== undefined) ghostState.autoPilot = auto;
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`SYSTEM_READY_ON_${PORT}`));
