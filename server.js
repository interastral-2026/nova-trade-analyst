
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());

// CONFIGURATION
const API_KEY_NAME = "organizations/d90bac52-0e8a-4999-b156-7491091ffb5e/apiKeys/79d55457-7e62-45ad-8656-31e1d96e0571";
const PRIVATE_KEY = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIADE7F++QawcWU5iZfqmo8iupxBkqfJsFV0KsTaGpRpLoAoGCCqGSM49
AwEHoUQDQgAEhSKrrlzJxIh6hgr5fT0cZf3NO91/a6kRPkWRNG6kQlLW8FIzJ53Y
Dgbh5U2Zj3zlxHWivwVyZGMWMf8xEdxYXw==
-----END EC PRIVATE KEY-----`;

let ghostState = {
  isEngineActive: true,
  autoPilot: true, 
  signals: [],
  thoughts: [],
  managedPositions: [], 
  tradeHistory: [], 
  currentStatus: "OMEGA_V25_READY",
  scanIndex: 0,
  lastNeuralSync: null
};

const WATCHLIST = ['BTC-EUR', 'ETH-EUR', 'SOL-EUR', 'AVAX-EUR', 'ADA-EUR', 'LINK-EUR'];

// --- COINBASE AUTH UTILS ---
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
    const signature = crypto.sign("sha256", Buffer.from(tokenData), { key: PRIVATE_KEY, dsaEncoding: "ieee-p1363" });
    return `${tokenData}.${signature.toString('base64url')}`;
  } catch (e) { return null; }
}

async function coinbaseCall(method, path, body = null) {
  const token = generateToken(method, path);
  return await axios({
    method,
    url: `https://api.coinbase.com${path}`,
    headers: { 'Authorization': `Bearer ${token}` },
    data: body
  });
}

// --- NEURAL ANALYSIS ENGINE (24/7) ---
async function runNeuralInference(symbol, price, candles) {
  if (!process.env.API_KEY) return null;
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{ parts: [{ text: `ANALYZE_MARKET: ${JSON.stringify({ symbol, price, candles: candles.slice(-20) })}` }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          side: { type: Type.STRING, enum: ['BUY', 'SELL', 'NEUTRAL'] },
          tp: { type: Type.NUMBER },
          sl: { type: Type.NUMBER },
          confidence: { type: Type.NUMBER },
          reason: { type: Type.STRING }
        },
        required: ['side', 'tp', 'sl', 'confidence', 'reason']
      },
      systemInstruction: "You are GHOST_QUANT_AI. High-frequency scalping mode. Output strict JSON."
    }
  });

  try {
    const res = await model;
    return JSON.parse(res.text);
  } catch (e) {
    console.error("AI_INFERENCE_FAIL:", e.message);
    return null;
  }
}

async function performAutonomousScan() {
  if (!ghostState.isEngineActive) return;

  const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
  ghostState.scanIndex++;
  ghostState.currentStatus = `ANALYZING_${symbol}`;

  try {
    // 1. Get Data
    const candleRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol.split('-')[0]}&tsym=EUR&limit=30`);
    const currentPrice = candleRes.data.Data.Data[candleRes.data.Data.Data.length - 1].close;

    // 2. AI Analysis
    const decision = await runNeuralInference(symbol, currentPrice, candleRes.data.Data.Data);
    
    if (decision) {
      const signal = {
        ...decision,
        symbol,
        entryPrice: currentPrice,
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString()
      };

      ghostState.thoughts.unshift(signal);
      if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();

      // 3. Auto-Trade Logic
      if (ghostState.autoPilot && decision.side !== 'NEUTRAL' && decision.confidence > 75) {
        console.log(`AUTO_TRADE_TRIGGERED: ${symbol} ${decision.side}`);
        // اینجا کد ارسال سفارش به کوین‌بیس می‌تواند قرار بگیرد
      }
    }
    ghostState.lastNeuralSync = new Date().toISOString();
  } catch (e) {
    console.error("SCAN_ERROR:", e.message);
  }
}

// --- API ROUTES ---
app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  const { engine, auto } = req.body;
  if (engine !== undefined) ghostState.isEngineActive = engine;
  if (auto !== undefined) ghostState.autoPilot = auto;
  res.json({ success: true });
});

// --- CORE LOOPS ---
setInterval(performAutonomousScan, 45000); // اسکن هر ۴۵ ثانیه حتی بدون حضور کاربر

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`GHOST_CORE_ACTIVE_ON_PORT_${PORT}`);
});
