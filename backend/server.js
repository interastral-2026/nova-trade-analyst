
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
const STABLECOINS = ['USDC', 'EURC', 'USDT', 'EUR'];

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

// --- AI BRAIN WITH TRAP DETECTION ---
async function runNeuralStrategicScan(symbol, price, history, context) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `ANALYSIS_NODE: ${symbol} | PRICE: ${price} | CONTEXT: ${context} | DATA: ${JSON.stringify(history.slice(-12))}` }] }],
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
        systemInstruction: `You are the NOVA_ELITE_QUANT. 
        1. ANTI-TRAP: If liquidity is low or price action looks like a pump-and-dump, remain NEUTRAL.
        2. SMART_ENTRY: Set TP/SL based on clear support/resistance.
        3. LIQUIDITY_FOCUS: Deployment of EUR/USDC is the priority for high-confidence (88%+) BUY signals.
        Output valid JSON only.`
      }
    });
    return JSON.parse(response.text);
  } catch (e) { return null; }
}

// --- SYNC & EXECUTION ENGINE ---
async function syncAsset(curr, amount, isOwned) {
  try {
    // 1. Precise Pricing (Base: EUR)
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${curr}&tsyms=EUR,USD`).catch(() => null);
    if (!pRes) return;
    const currentPrice = pRes.data.EUR || (pRes.data.USD ? pRes.data.USD * 0.94 : (curr === 'USDC' ? 0.94 : 0));

    // 2. Entry Reference (Fixing the .length error)
    let entryPrice = currentPrice;
    if (isOwned) {
      try {
        const fillsRes = await coinbaseCall('GET', `/api/v3/brokerage/orders/historical/fills?product_id=${curr}-EUR&limit=1`);
        const fills = fillsRes.data?.fills;
        if (Array.isArray(fills) && fills.length > 0) {
          entryPrice = parseFloat(fills[0].price);
        }
      } catch (e) { /* Fallback to current price if API fails */ }
    }

    // 3. Current State Object
    const currentAsset = {
      ...ghostState.managedAssets[curr],
      currency: curr, amount, currentPrice, entryPrice, lastSync: new Date().toISOString()
    };
    ghostState.managedAssets[curr] = currentAsset;

    // 4. AUTOMATIC EXIT STRATEGY (Check TP/SL)
    if (isOwned && currentAsset.tp && currentAsset.sl) {
      if (currentPrice >= currentAsset.tp) {
        console.log(`[EXIT] TP HIT for ${curr} at ${currentPrice}`);
        executeRobotOrder(curr, 'SELL', currentPrice, 100, "TARGET_PROFIT_HIT");
        return;
      }
      if (currentPrice <= currentAsset.sl) {
        console.log(`[EXIT] SL HIT for ${curr} at ${currentPrice}`);
        executeRobotOrder(curr, 'SELL', currentPrice, 100, "STOP_LOSS_HIT");
        return;
      }
    }

    // 5. Neural Analysis for New Signals or Managed Positions
    const hRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${curr}&tsym=EUR&limit=12`).catch(() => null);
    const history = hRes?.data?.Data?.Data || [];
    const analysis = await runNeuralStrategicScan(curr, currentPrice, history, isOwned ? "PORTFOLIO_OPTIMIZATION" : "MARKET_HUNT");

    if (analysis) {
      ghostState.managedAssets[curr] = { ...ghostState.managedAssets[curr], ...analysis };

      // 6. ROBOT DEPLOYMENT (88% RULE)
      if (ghostState.autoPilot && analysis.confidence >= 88) {
        const hasLiquidity = ghostState.liquidity.eur > 10 || ghostState.liquidity.usdc > 10;
        if (analysis.side === 'BUY' && !isOwned && hasLiquidity) {
          executeRobotOrder(curr, 'BUY', currentPrice, analysis.confidence, analysis.reason);
        } else if (analysis.side === 'SELL' && isOwned) {
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
    symbol, side, price, confidence, strategy: "QUANTUM_HUNTER",
    reason: `Decision: ${side} | Reason: ${reason} | Conf: ${confidence}%`,
    timestamp: new Date().toISOString()
  });
  
  // Update local amount to prevent double trading before next sync
  if (side === 'BUY') {
    ghostState.managedAssets[symbol] = { ...ghostState.managedAssets[symbol], amount: 1 }; 
  } else {
    ghostState.managedAssets[symbol] = { ...ghostState.managedAssets[symbol], amount: 0 };
  }
}

// --- MASTER PULSE ---
async function masterLoop() {
  if (!ghostState.isEngineActive) return;

  try {
    ghostState.currentStatus = "PULSE_CHECK_LIQUIDITY";
    const accRes = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    const accounts = accRes.data.accounts || [];

    // Sync Liquidity Nodes (EUR & USDC)
    const eurAcc = accounts.find(a => a.currency === 'EUR');
    const usdcAcc = accounts.find(a => a.currency === 'USDC');
    ghostState.liquidity.eur = parseFloat(eurAcc?.available_balance?.value || 0);
    ghostState.liquidity.usdc = parseFloat(usdcAcc?.available_balance?.value || 0);

    // Sync Active Portfolio
    const active = accounts.filter(a => parseFloat(a.available_balance.value) > 0.0001 && !STABLECOINS.includes(a.currency));
    for (const acc of active) {
      await syncAsset(acc.currency, parseFloat(acc.available_balance.value), true);
    }

    // Sync Hunter Watchlist (Only if we have cash)
    if (ghostState.liquidity.eur > 5 || ghostState.liquidity.usdc > 5) {
      ghostState.currentStatus = "HUNTING_HIGH_CONFIDENCE";
      const target = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
      ghostState.scanIndex++;
      if (!ghostState.managedAssets[target] || ghostState.managedAssets[target].amount === 0) {
        await syncAsset(target, 0, false);
      }
    }

    ghostState.currentStatus = "MONITORING_NEURAL_NODES";
  } catch (e) {
    ghostState.currentStatus = "BRIDGE_ERROR_AUTO_RETRY";
  }
}

setInterval(masterLoop, 20000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  const { engine, auto } = req.body;
  if (engine !== undefined) ghostState.isEngineActive = engine;
  if (auto !== undefined) ghostState.autoPilot = auto;
  res.json({ success: true, state: ghostState });
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`SYSTEM_CORE_SYNCED:${PORT}`));
