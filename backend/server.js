
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
  currentStatus: "CORE_READY",
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

// --- AI CORE ---
async function runStrategicAnalysis(symbol, price, candles, context) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `STRATEGY_REQUEST: ${symbol} | PRICE: ${price} | DATA_SLICE: ${JSON.stringify(candles.slice(-10))} | CONTEXT: ${context}` }] }],
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
        systemInstruction: "You are NOVA_STRATEGIST. Return precise JSON exit/hold analysis. Be bold but data-driven."
      }
    });
    return JSON.parse(response.text);
  } catch (e) { return null; }
}

// --- ASSET PROCESSOR ---
async function processAsset(acc) {
  const curr = acc.currency;
  const symbol = `${curr}-EUR`;
  
  try {
    // 1. Get Market Price (With better failover)
    let priceData = await axios.get(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${curr}&tsyms=EUR`).catch(() => null);
    let currentPrice = priceData?.data?.RAW?.[curr]?.['EUR']?.PRICE || 0;

    // Fallback to USD if EUR pair fails
    if (currentPrice === 0) {
        let usdPriceData = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${curr}&tsyms=USD,EUR`).catch(() => null);
        currentPrice = usdPriceData?.data?.EUR || usdPriceData?.data?.USD || 0;
    }

    // 2. Fetch Entry Reference (Fills)
    const fillsRes = await coinbaseCall('GET', `/api/v3/brokerage/orders/historical/fills?product_id=${symbol}&limit=3`).catch(() => null);
    const buyFills = fillsRes?.data?.fills?.filter(f => f.side === 'BUY') || [];
    const entryPrice = buyFills.length > 0 ? parseFloat(buyFills[0].price) : currentPrice;

    // 3. Populate basic info IMMEDIATELY
    ghostState.managedAssets[curr] = {
        ...ghostState.managedAssets[curr],
        currency: curr,
        entryPrice: entryPrice || 1, // Avoid 0
        currentPrice: currentPrice || 1,
        amount: parseFloat(acc.available_balance.value),
        lastSync: new Date().toISOString()
    };

    // 4. Analysis Logic
    if (STABLECOINS.includes(curr)) {
        ghostState.managedAssets[curr] = {
            ...ghostState.managedAssets[curr],
            tp: currentPrice * 1.002,
            sl: currentPrice * 0.998,
            strategy: "LIQUID_SHIELD",
            advice: "HOLD",
            reason: "Stable asset node. Maintaining peg and liquidity."
        };
    } else if (currentPrice > 0) {
        // AI analysis in background for volatile assets
        const historyRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${curr}&tsym=EUR&limit=10`).catch(() => null);
        const history = historyRes?.data?.Data?.Data || [];
        
        const strategy = await runStrategicAnalysis(symbol, currentPrice, history, `WALLET_ANALYSIS_${curr}`);
        if (strategy) {
            ghostState.managedAssets[curr] = {
                ...ghostState.managedAssets[curr],
                tp: strategy.tp,
                sl: strategy.sl,
                strategy: strategy.strategy,
                advice: strategy.side,
                reason: strategy.reason
            };
        }
    }
  } catch (e) {
    console.error(`Asset Processor Error [${curr}]:`, e.message);
  }
}

// --- MASTER LOOP (PARALLEL) ---
async function masterLoop() {
  if (!ghostState.isEngineActive) return;

  try {
    const accountsRes = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    const allAccounts = accountsRes.data.accounts || [];
    const activeAccounts = allAccounts.filter(a => parseFloat(a.available_balance.value) > 0.00000001 && a.currency !== 'EUR');

    ghostState.currentStatus = `UPDATING_${activeAccounts.length}_NODES`;

    // Process all assets in parallel to avoid one asset blocking others
    await Promise.allSettled(activeAccounts.map(acc => processAsset(acc)));

    // Watchlist scanning for ideas
    const scanTarget = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    const scanPrice = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${scanTarget.split('-')[0]}&tsyms=EUR`).catch(() => null);
    if (scanPrice?.data?.EUR) {
        const decision = await runStrategicAnalysis(scanTarget, scanPrice.data.EUR, [], "WATCHLIST_OPPORTUNITY");
        if (decision && decision.side !== 'NEUTRAL') {
            ghostState.thoughts.unshift({ ...decision, symbol: scanTarget, timestamp: new Date().toISOString(), id: crypto.randomUUID() });
            if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();
        }
    }

    ghostState.currentStatus = "PULSE_SYNC_STABLE";
  } catch (e) {
    console.error("Master Loop Master Error:", e.message);
    ghostState.currentStatus = "BRIDGE_ERROR";
  }
}

// Faster interval for core price updates, AI analysis happens within
setInterval(masterLoop, 25000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.get('/api/balances', async (req, res) => {
  try {
    const r = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    res.json(r.data.accounts.map(a => ({ 
      currency: a.currency, 
      total: parseFloat(a.available_balance.value || 0),
      available: parseFloat(a.available_balance.value || 0)
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
app.listen(PORT, '0.0.0.0', () => console.log(`SYSTEM_CORE_UP_${PORT}`));
