
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
const STATE_FILE = './ghost_state.json';

// پیکربندی فوق‌العاده باز برای حل مشکل CORS در محیط‌های مختلف
app.use(cors());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// --- سیستم پایداری داده‌ها ---
function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error("Critical Error: Could not write to filesystem", e);
  }
}

function loadInitialState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {}
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

// --- CONFIG ---
const API_KEY_NAME = "organizations/d90bac52-0e8a-4999-b156-7491091ffb5e/apiKeys/79d55457-7e62-45ad-8656-31e1d96e0571";
const PRIVATE_KEY = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIADE7F++QawcWU5iZfqmo8iupxBkqfJsFV0KsTaGpRpLoAoGCCqGSM49
AwEHoUQDQgAEhSKrrlzJxIh6hgr5fT0cZf3NO91/a6kRPkWRNG6kQlLW8FIzJ53Y
Dgbh5U2Zj3zlxHWivwVyZGMWMf8xEdxYXw==
-----END EC PRIVATE KEY-----`;

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'LINK', 'DOT', 'MATIC'];
const TAKER_FEE = 0.006; 

// --- CORE UTILS ---
async function coinbaseCall(method, path, body = null) {
  // این بخش نیاز به توکن JWT دارد که در محیط واقعی از کلید خصوصی ساخته می‌شود
  // فعلاً برای شبیه‌سازی و تست ساختار باقی می‌ماند
  return null; 
}

async function runEliteScan(symbol, price) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `ANALYZE: ${symbol} @ €${price}. Identify SMART MONEY traps and liquidity zones.` }] }],
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
        },
        systemInstruction: "You are NOVA_PREDATOR. Execute high-probability trades only."
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (e) { return null; }
}

async function masterLoop() {
  if (!ghostState.isEngineActive) return;
  
  try {
    const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    
    // دریافت قیمت زنده
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=EUR`);
    const price = pRes.data.EUR;

    ghostState.currentStatus = `HUNTING_${symbol}_LIQUIDITY`;

    const analysis = await runEliteScan(symbol, price);
    if (analysis && analysis.confidence >= 80) {
      const signal = { ...analysis, symbol, timestamp: new Date().toISOString(), price, id: crypto.randomUUID() };
      ghostState.thoughts.unshift(signal);
      if (ghostState.thoughts.length > 100) ghostState.thoughts.pop();

      // ترید خودکار
      if (ghostState.autoPilot && analysis.confidence >= 88 && analysis.side === 'BUY') {
        const logEntry = {
          id: crypto.randomUUID(),
          symbol,
          action: 'BUY',
          amount: 100,
          price,
          timestamp: new Date().toISOString(),
          status: 'AUTO_EXECUTED',
          fees: 0.6,
          thought: analysis.reason
        };
        ghostState.executionLogs.unshift(logEntry);
        ghostState.dailyStats.trades++;
        ghostState.dailyStats.fees += 0.6;
      }
    }
    saveState(ghostState);
  } catch (e) {
    console.error("Master Loop Error:", e.message);
  }
}

// اسکن هر ۳۰ ثانیه برای جلوگیری از محدودیت API
setInterval(masterLoop, 30000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));

app.post('/api/ghost/toggle', (req, res) => {
  const { engine, auto } = req.body;
  if (engine !== undefined) ghostState.isEngineActive = engine;
  if (auto !== undefined) ghostState.autoPilot = auto;
  saveState(ghostState);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`BRIDGE_SERVER_ONLINE: ${PORT}`));
