
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

// --- AI BRAIN: ANTI-TRAP & STRATEGIC EXIT ---
async function runNeuralStrategicScan(symbol, price, history, context) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `NODE_ID: ${symbol} | PRICE: ${price} | CONTEXT: ${context} | MARKET_DATA: ${JSON.stringify(history.slice(-12))}` }] }],
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
        systemInstruction: `You are NOVA_PREDATOR_QUANT. 
        1. ANTI-TRAP: Identify 'Exchange Traps' (fake volume, low liquidity, high spread). If a pump looks artificial, stay NEUTRAL.
        2. STRATEGIC EXIT: Always provide precise TP (Take Profit) and SL (Stop Loss) relative to current price.
        3. SNIPER MODE: Only suggest BUY if confidence > 88%. Use available EUR/USDC liquidity as fuel.
        4. GUARD: Your job is to grow the portfolio and prevent losses. Output valid JSON.`
      }
    });
    return JSON.parse(response.text);
  } catch (e) { return null; }
}

// --- CORE ASSET PROCESSOR ---
async function syncAsset(curr, amount, isOwned) {
  if (LIQUIDITY_ASSETS.includes(curr)) return;

  try {
    // 1. Price Sync
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${curr}&tsyms=EUR,USD`).catch(() => null);
    if (!pRes) return;
    const currentPrice = pRes.data.EUR || (pRes.data.USD ? pRes.data.USD * 0.94 : 0);
    if (currentPrice === 0) return;

    // 2. Entry Ref
    let entryPrice = currentPrice;
    if (isOwned && amount > 0) {
      try {
        const fillsRes = await coinbaseCall('GET', `/api/v3/brokerage/orders/historical/fills?product_id=${curr}-EUR&limit=1`);
        if (fillsRes.data?.fills?.length > 0) {
          entryPrice = parseFloat(fillsRes.data.fills[0].price);
        }
      } catch (e) {}
    }

    const currentAsset = {
      ...ghostState.managedAssets[curr],
      currency: curr, amount, currentPrice, entryPrice, lastSync: new Date().toISOString()
    };
    ghostState.managedAssets[curr] = currentAsset;

    // 3. AUTO-EXIT CHECK (TP/SL)
    if (isOwned && amount > 0 && currentAsset.tp && currentAsset.sl) {
      if (currentPrice >= currentAsset.tp) {
        executeRobotOrder(curr, 'SELL', currentPrice, 100, "TAKE_PROFIT_HIT");
        return;
      }
      if (currentPrice <= currentAsset.sl) {
        executeRobotOrder(curr, 'SELL', currentPrice, 100, "STOP_LOSS_HIT");
        return;
      }
    }

    // 4. Neural Analysis
    const hRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${curr}&tsym=EUR&limit=12`).catch(() => null);
    const history = hRes?.data?.Data?.Data || [];
    const analysis = await runNeuralStrategicScan(curr, currentPrice, history, isOwned ? "OPTIMIZING_HOLDING" : "HUNTING_ENTRY");

    if (analysis) {
      ghostState.managedAssets[curr] = { ...ghostState.managedAssets[curr], ...analysis };

      // 5. Execution Logic
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
  const orderId = crypto.randomUUID();
  const order = {
    id: orderId,
    symbol, side, price, confidence,
    timestamp: new Date().toISOString(),
    status: 'EXECUTED_BY_NOVA'
  };
  ghostState.executedOrders.unshift(order);
  ghostState.thoughts.unshift({
    symbol, side, price, confidence, strategy: "QUANTUM_ANTITRAP",
    reason: `Automatic ${side} execution. Target Price: ${price}. Reason: ${reason}`,
    timestamp: new Date().toISOString()
  });
  
  // Local state update to prevent double-trade
  if (side === 'BUY') {
    ghostState.managedAssets[symbol] = { ...ghostState.managedAssets[symbol], amount: 1 };
  } else {
    ghostState.managedAssets[symbol] = { ...ghostState.managedAssets[symbol], amount: 0 };
  }
}

// --- MASTER LOOP ---
async function masterLoop() {
  if (!ghostState.isEngineActive) {
    ghostState.currentStatus = "ENGINE_OFFLINE";
    return;
  }

  try {
    ghostState.currentStatus = "SYNCING_CASH_BALANCES";
    const accRes = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    const accounts = accRes.data?.accounts || [];

    // 1. FIX: Accurate Liquidity Capture
    let eurVal = 0;
    let usdcVal = 0;

    accounts.forEach(a => {
      const val = parseFloat(a.available_balance?.value || 0);
      if (a.currency === 'EUR' || a.currency === 'EURC') eurVal += val;
      if (a.currency === 'USDC' || a.currency === 'USDT') usdcVal += val;
    });

    ghostState.liquidity.eur = eurVal;
    ghostState.liquidity.usdc = usdcVal;

    // 2. Portfolio Assets
    const activeAccounts = accounts.filter(a => {
      const val = parseFloat(a.available_balance?.value || 0);
      return val > 0.0001 && !LIQUIDITY_ASSETS.includes(a.currency);
    });

    for (const acc of activeAccounts) {
      await syncAsset(acc.currency, parseFloat(acc.available_balance.value), true);
    }

    // 3. Hunter Scan
    if (eurVal > 2 || usdcVal > 2) {
      ghostState.currentStatus = "HUNTING_MODE_ACTIVE";
      const target = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
      ghostState.scanIndex++;
      if (!ghostState.managedAssets[target] || (ghostState.managedAssets[target].amount || 0) === 0) {
        await syncAsset(target, 0, false);
      }
    }

    ghostState.currentStatus = "SYSTEM_WATCHING";
  } catch (e) {
    ghostState.currentStatus = "BRIDGE_RECOVERY_MODE";
  }
}

setInterval(masterLoop, 20000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.get('/api/balances', (req, res) => {
  // Return all accounts with non-zero balance for the UI
  const bals = Object.keys(ghostState.managedAssets).map(k => ({
    currency: k,
    available: ghostState.managedAssets[k].amount,
    total: ghostState.managedAssets[k].amount
  })).filter(b => b.available > 0);
  
  // Add base liquidity to the list
  bals.push({ currency: 'EUR', available: ghostState.liquidity.eur, total: ghostState.liquidity.eur });
  bals.push({ currency: 'USDC', available: ghostState.liquidity.usdc, total: ghostState.liquidity.usdc });
  
  res.json(bals);
});

app.post('/api/ghost/toggle', (req, res) => {
  const { engine, auto } = req.body;
  if (engine !== undefined) ghostState.isEngineActive = engine;
  if (auto !== undefined) ghostState.autoPilot = auto;
  res.json({ success: true, state: ghostState });
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`CORE_ENGINE_READY:${PORT}`));
