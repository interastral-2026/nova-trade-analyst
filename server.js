
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
const STATE_FILE = './ghost_state.json';

// رفع کامل مشکل CORS برای ارتباط با فرانت‌اند
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// --- سیستم پایداری داده‌ها (حتی با رفرش پاک نمی‌شوند) ---
function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error("Error saving state:", e);
  }
}

function loadInitialState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Error loading state:", e);
  }
  return {
    isEngineActive: true,
    autoPilot: true,
    thoughts: [],
    executionLogs: [],
    currentStatus: "PREDATOR_READY",
    scanIndex: 0,
    liquidity: { eur: 0, usdc: 0 },
    dailyStats: { trades: 0, profit: 0, fees: 0 }
  };
}

let ghostState = loadInitialState();

const API_KEY_NAME = "organizations/d90bac52-0e8a-4999-b156-7491091ffb5e/apiKeys/79d55457-7e62-45ad-8656-31e1d96e0571";
const PRIVATE_KEY = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIADE7F++QawcWU5iZfqmo8iupxBkqfJsFV0KsTaGpRpLoAoGCCqGSM49
AwEHoUQDQgAEhSKrrlzJxIh6hgr5fT0cZf3NO91/a6kRPkWRNG6kQlLW8FIzJ53Y
Dgbh5U2Zj3zlxHWivwVyZGMWMf8xEdxYXw==
-----END EC PRIVATE KEY-----`;

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'LINK', 'DOT', 'MATIC'];
const TAKER_FEE = 0.006; 

// --- AUTH & COMMUNICATION ---
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
  if (!token) return null;
  return await axios({
    method,
    url: `https://api.coinbase.com${path}`,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: body,
    timeout: 15000
  }).catch(() => null);
}

// --- AI BRAIN ---
async function runEliteScan(symbol, price) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `PREDATOR_SCAN: ${symbol} @ €${price}. Scan Liquidity Voids and SMART MONEY traps.` }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ['BUY', 'SELL', 'HOLD'] },
            tp: { type: Type.NUMBER },
            sl: { type: Type.NUMBER },
            confidence: { type: Type.NUMBER },
            reason: { type: Type.STRING },
            thoughtProcess: { type: Type.STRING }
          },
          required: ['side', 'tp', 'sl', 'confidence', 'reason', 'thoughtProcess']
        }
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (e) { return null; }
}

// --- MASTER SCAN LOOP ---
async function masterLoop() {
  if (!ghostState.isEngineActive) return;
  
  try {
    // 1. Sync Balances
    const accRes = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=50');
    if (accRes?.data?.accounts) {
      accRes.data.accounts.forEach(a => {
        const v = parseFloat(a.available_balance?.value || "0");
        if (a.currency === 'EUR') ghostState.liquidity.eur = v;
        if (a.currency === 'USDC') ghostState.liquidity.usdc = v;
      });
    }

    // 2. Scan Next Asset
    const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=EUR`);
    const price = pRes.data.EUR;

    ghostState.currentStatus = `SCANNING_${symbol}_LIQUIDITY`;

    const analysis = await runEliteScan(symbol, price);
    if (analysis && analysis.confidence >= 80) {
      const signal = { 
        ...analysis, 
        symbol, 
        timestamp: new Date().toISOString(), 
        price, 
        id: crypto.randomUUID() 
      };
      
      // اضافه کردن به افکار (Neural Thoughts)
      ghostState.thoughts.unshift(signal);
      if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();

      // ترید خودکار اگر اعتماد بالای ۸۵٪ باشد
      if (ghostState.autoPilot && analysis.confidence >= 85 && analysis.side === 'BUY' && ghostState.liquidity.eur > 50) {
        const amount = Math.min(ghostState.liquidity.eur * 0.25, 200);
        const tradeRes = await coinbaseCall('POST', '/api/v3/brokerage/orders', {
          client_order_id: crypto.randomUUID(),
          product_id: `${symbol}-EUR`,
          side: 'BUY',
          order_configuration: { market_market_ioc: { quote_size: amount.toString() } }
        });

        if (tradeRes?.data?.success) {
          const logEntry = {
            id: crypto.randomUUID(),
            symbol,
            action: 'BUY',
            amount,
            price,
            timestamp: new Date().toISOString(),
            status: 'AUTO_EXECUTED',
            fees: amount * TAKER_FEE,
            thought: analysis.reason
          };
          ghostState.executionLogs.unshift(logEntry);
          ghostState.dailyStats.trades++;
          ghostState.dailyStats.fees += (amount * TAKER_FEE);
        }
      }
    }
    
    saveState(ghostState);
  } catch (e) {
    console.error("Loop Error:", e.message);
  }
}

// اسکن هر ۲۰ ثانیه
setInterval(masterLoop, 20000);

// API Endpoints
app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  const { engine, auto } = req.body;
  if (engine !== undefined) ghostState.isEngineActive = engine;
  if (auto !== undefined) ghostState.autoPilot = auto;
  saveState(ghostState);
  res.json({ success: true });
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`[ELITE_BRIDGE] Operational on port ${PORT}`));
