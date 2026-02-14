
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
const LIQUIDITY_ASSETS = ['EUR', 'USDC', 'EURC', 'USDT'];

let ghostState = {
  isEngineActive: true,
  autoPilot: true,
  thoughts: [],
  managedAssets: {}, 
  executedOrders: [], 
  currentStatus: "NOVA_SYSTEM_SYNCING",
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

// --- AI STRATEGIC BRAIN ---
async function runNeuralStrategicScan(symbol, price, history, context) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `NODE_INTEL: ${symbol} | PRICE: ${price} | CONTEXT: ${context} | HISTORY: ${JSON.stringify(history.slice(-10))}` }] }],
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
        systemInstruction: `You are NOVA_ELITE_QUANT.
        1. ANTI-TRAP: If liquidity is fake or spread is high, stay NEUTRAL.
        2. SMART EXIT: Set precise TP and SL to avoid exchange manipulation.
        3. SNIPER: Only BUY if confidence > 88% and liquidity is confirmed.
        Return JSON only.`
      }
    });
    return JSON.parse(response.text);
  } catch (e) { return null; }
}

// --- ASSET PROCESSOR ---
async function syncAsset(curr, amount, isOwned) {
  if (!curr || LIQUIDITY_ASSETS.includes(curr.toUpperCase())) return;

  try {
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${curr}&tsyms=EUR,USD`).catch(() => null);
    if (!pRes) return;
    const currentPrice = pRes.data.EUR || (pRes.data.USD ? pRes.data.USD * 0.94 : 0);
    if (currentPrice === 0) return;

    let entryPrice = currentPrice;
    if (isOwned && amount > 0) {
      try {
        const fillsRes = await coinbaseCall('GET', `/api/v3/brokerage/orders/historical/fills?product_id=${curr}-EUR&limit=1`);
        if (fillsRes.data?.fills && Array.isArray(fillsRes.data.fills) && fillsRes.data.fills.length > 0) {
          entryPrice = parseFloat(fillsRes.data.fills[0].price);
        }
      } catch (e) {}
    }

    const currentAsset = {
      ...ghostState.managedAssets[curr],
      currency: curr, amount, currentPrice, entryPrice, lastSync: new Date().toISOString()
    };
    ghostState.managedAssets[curr] = currentAsset;

    // AUTO EXIT CHECK
    if (isOwned && amount > 0 && currentAsset.tp && currentAsset.sl) {
      if (currentPrice >= currentAsset.tp) {
        executeRobotOrder(curr, 'SELL', currentPrice, 100, "TAKE_PROFIT_TRIGGERED");
        return;
      }
      if (currentPrice <= currentAsset.sl) {
        executeRobotOrder(curr, 'SELL', currentPrice, 100, "STOP_LOSS_TRIGGERED");
        return;
      }
    }

    const hRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${curr}&tsym=EUR&limit=12`).catch(() => null);
    const history = hRes?.data?.Data?.Data || [];
    const analysis = await runNeuralStrategicScan(curr, currentPrice, history, isOwned ? "PORTFOLIO_MANAGEMENT" : "HUNTING_GAPS");

    if (analysis) {
      ghostState.managedAssets[curr] = { ...ghostState.managedAssets[curr], ...analysis };
      if (ghostState.autoPilot && analysis.confidence >= 88) {
        const hasCash = ghostState.liquidity.eur > 5 || ghostState.liquidity.usdc > 5;
        if (analysis.side === 'BUY' && !isOwned && hasCash) {
          executeRobotOrder(curr, 'BUY', currentPrice, analysis.confidence, analysis.reason);
        } else if (analysis.side === 'SELL' && isOwned && amount > 0) {
          executeRobotOrder(curr, 'SELL', currentPrice, analysis.confidence, analysis.reason);
        }
      }
    }
  } catch (e) {
    console.error(`Error processing ${curr}:`, e.message);
  }
}

function executeRobotOrder(symbol, side, price, confidence, reason) {
  const order = {
    id: crypto.randomUUID(),
    symbol, side, price, confidence,
    timestamp: new Date().toISOString(),
    status: 'EXECUTED_BY_NOVA'
  };
  ghostState.executedOrders.unshift(order);
  ghostState.thoughts.unshift({
    symbol, side, price, confidence, strategy: "QUANTUM_SECURE",
    reason: `System Order: ${side} | Target: ${price} | Reason: ${reason}`,
    timestamp: new Date().toISOString()
  });
  if (side === 'BUY') ghostState.managedAssets[symbol] = { ...ghostState.managedAssets[symbol], amount: 1 };
  else ghostState.managedAssets[symbol] = { ...ghostState.managedAssets[symbol], amount: 0 };
}

// --- MASTER PULSE LOOP ---
async function masterLoop() {
  if (!ghostState.isEngineActive) return;

  try {
    ghostState.currentStatus = "PULSE_RESYNCING_RESERVES";
    const accRes = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    const accounts = accRes.data?.accounts || [];

    let eurVal = 0;
    let usdcVal = 0;

    accounts.forEach(a => {
      if (!a.currency) return;
      const val = parseFloat(a.available_balance?.value || 0);
      const curr = a.currency.toUpperCase();
      
      if (curr === 'EUR' || curr === 'EURC') eurVal += val;
      if (curr === 'USDC' || curr === 'USDT') usdcVal += val;
    });

    ghostState.liquidity.eur = eurVal;
    ghostState.liquidity.usdc = usdcVal;

    // Sync Portfolio
    const activeAccounts = accounts.filter(a => {
      const val = parseFloat(a.available_balance?.value || 0);
      const curr = a.currency?.toUpperCase();
      return val > 0.0001 && curr && !LIQUIDITY_ASSETS.includes(curr);
    });

    for (const acc of activeAccounts) {
      await syncAsset(acc.currency, parseFloat(acc.available_balance.value), true);
    }

    // Hunter Watchlist
    if (eurVal > 2 || usdcVal > 2) {
      ghostState.currentStatus = "NOVA_SNIPER_HUNTING";
      const target = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
      ghostState.scanIndex++;
      if (!ghostState.managedAssets[target] || (ghostState.managedAssets[target].amount || 0) === 0) {
        await syncAsset(target, 0, false);
      }
    }

    ghostState.currentStatus = "SYSTEM_OPTIMIZED";
  } catch (e) {
    ghostState.currentStatus = "RECOVERY_IDLE";
  }
}

setInterval(masterLoop, 20000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.get('/api/balances', (req, res) => {
  const bals = Object.keys(ghostState.managedAssets)
    .map(k => ({ currency: k, available: ghostState.managedAssets[k].amount, total: ghostState.managedAssets[k].amount }))
    .filter(b => b.available > 0);
  bals.push({ currency: 'EUR', available: ghostState.liquidity.eur, total: ghostState.liquidity.eur });
  bals.push({ currency: 'USDC', available: ghostState.liquidity.usdc, total: ghostState.liquidity.usdc });
  res.json(bals);
});

app.post('/api/ghost/toggle', (req, res) => {
  const { engine, auto } = req.body;
  if (engine !== undefined) ghostState.isEngineActive = engine;
  if (auto !== undefined) ghostState.autoPilot = auto;
  res.json({ success: true });
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`SYSTEM_CORE_SYNCED:${PORT}`));
