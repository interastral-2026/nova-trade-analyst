
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
// Assets treated as cash fuel for the bot
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
        1. ANTI-TRAP: Identify artificial price movements. If volume is suspicious, stay NEUTRAL.
        2. SMART EXIT: Set precise TP and SL to protect user capital from exchange volatility.
        3. SNIPER: Only suggest BUY if confidence > 88% and user has cash.
        Return JSON only.`
      }
    });
    return JSON.parse(response.text);
  } catch (e) { return null; }
}

// --- ASSET PROCESSOR ---
async function syncAsset(curr, amount, isOwned) {
  // Defensive check: Skip if the asset is intended for liquidity, but we process it as a target
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
        // Robust check for fills data to prevent the .length error
        if (fillsRes.data && fillsRes.data.fills && Array.isArray(fillsRes.data.fills) && fillsRes.data.fills.length > 0) {
          entryPrice = parseFloat(fillsRes.data.fills[0].price);
        }
      } catch (e) {
        // Fallback to current price if order history fetch fails
      }
    }

    const currentAsset = {
      ...ghostState.managedAssets[curr],
      currency: curr, amount, currentPrice, entryPrice, lastSync: new Date().toISOString()
    };
    ghostState.managedAssets[curr] = currentAsset;

    // AUTO EXIT LOGIC
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

    // Neural Analysis Loop
    const hRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${curr}&tsym=EUR&limit=12`).catch(() => null);
    const history = hRes?.data?.Data?.Data || [];
    const analysis = await runNeuralStrategicScan(curr, currentPrice, history, isOwned ? "OPTIMIZING_POSITION" : "SCANNING_MARKET");

    if (analysis) {
      ghostState.managedAssets[curr] = { ...ghostState.managedAssets[curr], ...analysis };
      if (ghostState.autoPilot && analysis.confidence >= 88) {
        const totalCash = (ghostState.liquidity.eur || 0) + (ghostState.liquidity.usdc || 0);
        if (analysis.side === 'BUY' && !isOwned && totalCash > 2) {
          executeRobotOrder(curr, 'BUY', currentPrice, analysis.confidence, analysis.reason);
        } else if (analysis.side === 'SELL' && isOwned && amount > 0) {
          executeRobotOrder(curr, 'SELL', currentPrice, analysis.confidence, analysis.reason);
        }
      }
    }
  } catch (e) {
    console.error(`Fatal node error [${curr}]:`, e.message);
  }
}

function executeRobotOrder(symbol, side, price, confidence, reason) {
  const order = {
    id: crypto.randomUUID(),
    symbol, side, price, confidence,
    timestamp: new Date().toISOString(),
    status: 'NOVA_CORE_EXECUTED'
  };
  ghostState.executedOrders.unshift(order);
  ghostState.thoughts.unshift({
    symbol, side, price, confidence, strategy: "QUANT_DEFENSE",
    reason: `System Order Triggered: ${side} at €${price}. Logic: ${reason}`,
    timestamp: new Date().toISOString()
  });
  if (side === 'BUY') ghostState.managedAssets[symbol] = { ...ghostState.managedAssets[symbol], amount: 1 };
  else ghostState.managedAssets[symbol] = { ...ghostState.managedAssets[symbol], amount: 0 };
}

// --- MASTER PULSE LOOP ---
async function masterLoop() {
  if (!ghostState.isEngineActive) return;

  try {
    ghostState.currentStatus = "NOVA_SCANNING_VAULT";
    // Attempting to fetch accounts with a reliable limit
    const accRes = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    const accounts = accRes.data?.accounts || accRes.data || []; // Handle different API response structures

    let currentEur = 0;
    let currentUsdc = 0;

    // Improved parsing for Fiat/Stablecoin liquidity
    if (Array.isArray(accounts)) {
      accounts.forEach(a => {
        const currency = a.currency?.toUpperCase();
        const balance = parseFloat(a.available_balance?.value || a.balance?.value || 0);
        
        if (currency === 'EUR' || currency === 'EURC') currentEur += balance;
        if (currency === 'USDC' || currency === 'USDT') currentUsdc += balance;
      });
    }

    ghostState.liquidity.eur = currentEur;
    ghostState.liquidity.usdc = currentUsdc;

    // Process crypto portfolio
    if (Array.isArray(accounts)) {
      const cryptoHoldings = accounts.filter(a => {
        const balance = parseFloat(a.available_balance?.value || a.balance?.value || 0);
        const currency = a.currency?.toUpperCase();
        return balance > 0.0001 && currency && !LIQUIDITY_ASSETS.includes(currency);
      });

      for (const acc of cryptoHoldings) {
        await syncAsset(acc.currency, parseFloat(acc.available_balance?.value || acc.balance?.value || 0), true);
      }
    }

    // Market gap detection (Hunting Mode)
    if (currentEur > 1 || currentUsdc > 1) {
      ghostState.currentStatus = "NOVA_HUNTING_MARKET";
      const target = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
      ghostState.scanIndex++;
      if (!ghostState.managedAssets[target] || (ghostState.managedAssets[target].amount || 0) <= 0) {
        await syncAsset(target, 0, false);
      }
    }

    ghostState.currentStatus = "NOVA_SYSTEM_STABLE";
  } catch (e) {
    console.error("Master loop heartbeat failure:", e.message);
    ghostState.currentStatus = "RECOVERY_IDLE_MODE";
  }
}

// Set a tight loop for real-time responsiveness
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
  res.json({ success: true, activeState: ghostState });
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`[NOVA_CORE] Tactical Bridge operational on port ${PORT}`));
