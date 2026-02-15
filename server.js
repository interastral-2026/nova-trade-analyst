
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
const STATE_FILE = './ghost_state.json';

// پیکربندی بسیار سخت‌گیرانه برای حل مشکل CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// هدرهای دستی برای اطمینان ۱۰۰٪ از عبور از فیلتر مرورگر
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {}
  return {
    isEngineActive: true,
    autoPilot: true,
    thoughts: [],
    executionLogs: [],
    currentStatus: "INITIALIZING_NEURAL_CORE",
    scanIndex: 0,
    liquidity: { eur: 1540.20, usdc: 450.00 },
    dailyStats: { trades: 0, profit: 0, fees: 0 }
  };
}

let ghostState = loadState();

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2));
  } catch (e) { console.error("FS_ERROR:", e); }
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'LINK'];

async function getAnalysis(symbol, price) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `PREDATOR_ANALYSIS: ${symbol} @ €${price}. Identify order blocks, RSI divergence, and liquidity gaps.` }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ['BUY', 'SELL', 'NEUTRAL'] },
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

async function loop() {
  if (!ghostState.isEngineActive) return;
  const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
  ghostState.scanIndex++;
  
  try {
    ghostState.currentStatus = `ANALYZING_${symbol}_STRUCTURE`;
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=EUR`);
    const price = pRes.data.EUR;

    const analysis = await getAnalysis(symbol, price);
    if (analysis) {
      const signal = { ...analysis, symbol, timestamp: new Date().toISOString(), price, id: crypto.randomUUID() };
      ghostState.thoughts.unshift(signal);
      if (ghostState.thoughts.length > 40) ghostState.thoughts.pop();
      
      // شبیه‌سازی ترید اگر اعتماد بالا باشد
      if (ghostState.autoPilot && analysis.confidence > 85 && analysis.side === 'BUY') {
        ghostState.executionLogs.unshift({
           id: crypto.randomUUID(), symbol, action: 'BUY', amount: 50, price, 
           timestamp: new Date().toISOString(), status: 'SUCCESS', fees: 0.3, thought: analysis.reason
        });
        ghostState.dailyStats.trades++;
        ghostState.dailyStats.fees += 0.3;
      }
    }
    saveState();
  } catch (e) { console.error("LOOP_ERR:", e.message); }
}

setInterval(loop, 25000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`BRIDGE_ONLINE_PORT_${PORT}`));
