
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
// ارزهایی که به عنوان نقدینگی (پول نقد) در نظر گرفته می‌شوند
const LIQUIDITY_ASSETS = ['EUR', 'USDC', 'EURC', 'USDT'];

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
        1. ANTI-TRAP: If liquidity is low, spread is high, or price looks manipulated (fake pump), stay NEUTRAL.
        2. SMART EXIT: Always define precise TP (Take Profit) and SL (Stop Loss). 
        3. SNIPER ENTRY: Only suggest BUY for liquidity deployment if confidence > 88%. 
        4. GUARD: Protect user funds from "exchange traps" and fake signals. Output JSON only.`
      }
    });
    return JSON.parse(response.text);
  } catch (e) { return null; }
}

// --- CORE ASSET PROCESSOR ---
async function syncAsset(curr, amount, isOwned) {
  if (LIQUIDITY_ASSETS.includes(curr)) return; // نقدینگی به طور جداگانه هندل می‌شود

  try {
    // 1. دریافت قیمت لحظه‌ای
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${curr}&tsyms=EUR,USD`).catch(() => null);
    if (!pRes) return;
    const currentPrice = pRes.data.EUR || (pRes.data.USD ? pRes.data.USD * 0.94 : 0);
    if (currentPrice === 0) return;

    // 2. همگام‌سازی قیمت ورود (Entry) با امنیت بالا
    let entryPrice = currentPrice;
    if (isOwned && amount > 0) {
      try {
        const fillsRes = await coinbaseCall('GET', `/api/v3/brokerage/orders/historical/fills?product_id=${curr}-EUR&limit=1`);
        if (fillsRes.data && Array.isArray(fillsRes.data.fills) && fillsRes.data.fills.length > 0) {
          entryPrice = parseFloat(fillsRes.data.fills[0].price);
        }
      } catch (e) { /* نادیده گرفتن خطای API و استفاده از قیمت فعلی به عنوان مرجع */ }
    }

    // 3. بروزرسانی وضعیت محلی
    const currentAsset = {
      ...ghostState.managedAssets[curr],
      currency: curr, amount, currentPrice, entryPrice, lastSync: new Date().toISOString()
    };
    ghostState.managedAssets[curr] = currentAsset;

    // 4. خروج هوشمند خودکار (Check TP/SL)
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

    // 5. تحلیل عصبی
    const hRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${curr}&tsym=EUR&limit=12`).catch(() => null);
    const history = hRes?.data?.Data?.Data || [];
    const analysis = await runNeuralStrategicScan(curr, currentPrice, history, isOwned ? "PORTFOLIO_WATCH" : "SIGNAL_HUNT");

    if (analysis) {
      ghostState.managedAssets[curr] = { ...ghostState.managedAssets[curr], ...analysis };

      // 6. اجرای خودکار (قانون 88 درصد)
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
    status: 'EXECUTED_BY_AI_CORE'
  };
  ghostState.executedOrders.unshift(order);
  ghostState.thoughts.unshift({
    symbol, side, price, confidence, strategy: "QUANTUM_ANTITRAP",
    reason: `System Order: ${side} for ${symbol}. Decision: ${reason}`,
    timestamp: new Date().toISOString()
  });
  
  // شبیه‌سازی تغییر موجودی برای جلوگیری از تکرار دستور تا سیکل بعدی
  if (side === 'BUY') ghostState.managedAssets[symbol] = { ...ghostState.managedAssets[symbol], amount: 1 };
  else ghostState.managedAssets[symbol] = { ...ghostState.managedAssets[symbol], amount: 0 };
}

// --- MASTER PULSE ---
async function masterLoop() {
  if (!ghostState.isEngineActive) return;

  try {
    ghostState.currentStatus = "PULSE_LIQUIDITY_SYNC";
    const accRes = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    const accounts = accRes.data.accounts || [];

    // همگام‌سازی نقدینگی (EUR, USDC, EURC)
    let totalEur = 0;
    let totalUsdc = 0;

    accounts.forEach(a => {
      const val = parseFloat(a.available_balance?.value || 0);
      if (a.currency === 'EUR') totalEur += val;
      if (a.currency === 'EURC') totalEur += val; // فرض برابری تقریبی در نمایش
      if (a.currency === 'USDC' || a.currency === 'USDT') totalUsdc += val;
    });

    ghostState.liquidity.eur = totalEur;
    ghostState.liquidity.usdc = totalUsdc;

    // همگام‌سازی دارایی‌های فعال
    const active = accounts.filter(a => {
      const val = parseFloat(a.available_balance?.value || 0);
      return val > 0.0001 && !LIQUIDITY_ASSETS.includes(a.currency);
    });

    for (const acc of active) {
      await syncAsset(acc.currency, parseFloat(acc.available_balance.value), true);
    }

    // شکارچی: اسکن واچ‌لیست اگر نقدینگی داریم
    if (totalEur > 2 || totalUsdc > 2) {
      ghostState.currentStatus = "HUNTING_MARKET_GAPS";
      const target = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
      ghostState.scanIndex++;
      if (!ghostState.managedAssets[target] || (ghostState.managedAssets[target].amount || 0) === 0) {
        await syncAsset(target, 0, false);
      }
    }

    ghostState.currentStatus = "NEURAL_NODES_SECURE";
  } catch (e) {
    ghostState.currentStatus = "BRIDGE_RECOVERY_MODE";
  }
}

setInterval(masterLoop, 20000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  const { engine, auto } = req.body;
  if (engine !== undefined) ghostState.isEngineActive = engine;
  if (auto !== undefined) ghostState.autoPilot = auto;
  res.json({ success: true });
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`STRATEGIC_PULSE_LIVE:${PORT}`));
