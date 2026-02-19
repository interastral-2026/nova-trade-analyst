
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { GoogleGenAI, Type } from "@google/genai";
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const STATE_FILE = './ghost_state.json';
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// --- ENVIRONMENT CONFIG ---
const API_KEY = process.env.API_KEY ? process.env.API_KEY.trim() : null;
// Use the exact keys provided by the user
const CB_API_KEY = "organizations/d90bac52-0e8a-4999-b156-7491091ffb5e/apiKeys/d2588804-6b9a-4c58-a81c-006d705648de";
const CB_API_SECRET = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIBBkeIqleUaSEr1vWhFuI2I62cECUzvi19U9cnU4RPKAoAoGCCqGSM49
AwEHoUQDQgAEDG28kGC8WnwJf5jLwpHhp0j7AOzCLaVLPjP+8N1kyXIHjo2Hojsn
rwu/5Us6D0T7yEfXtupYoXXhOJLWV+8dxg==
-----END EC PRIVATE KEY-----`;

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'NEAR', 'FET'];

/**
 * GENERATE JWT FOR COINBASE CLOUD (V3 API)
 */
function generateCoinbaseJWT() {
  if (!CB_API_KEY || !CB_API_SECRET) return null;
  try {
    const payload = {
      iss: "coinbase-cloud",
      nbf: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 120,
      sub: CB_API_KEY,
    };

    const header = {
      alg: "ES256",
      kid: CB_API_KEY,
      nonce: crypto.randomBytes(16).toString("hex"),
    };

    return jwt.sign(payload, CB_API_SECRET, { algorithm: 'ES256', header });
  } catch (e) {
    console.error("JWT Error:", e.message);
    return null;
  }
}

/**
 * SYNC REAL BALANCES FROM COINBASE
 */
async function syncCoinbaseBalance() {
  const token = generateCoinbaseJWT();
  if (!token) return;

  try {
    const response = await axios.get('https://api.coinbase.com/api/v3/brokerage/accounts', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const accounts = response.data?.accounts || [];
    accounts.forEach(acc => {
      const currency = acc.currency;
      const amount = parseFloat(acc.available_balance?.value || 0);
      if (currency === 'EUR') ghostState.liquidity.eur = amount;
      if (currency === 'USDC' || currency === 'USD') ghostState.liquidity.usdc = amount;
    });
  } catch (e) {
    // Silent fail to keep app running if API is blocked/invalid
    console.warn("CB_SYNC_FAIL:", e.response?.data?.message || e.message);
  }
}

/**
 * AI CORE - SMC ANALYSIS (FIXED FOR "AI ANALYSIS ERROR")
 */
async function getAdvancedAnalysis(symbol, price, candles) {
  if (!API_KEY) return { side: "NEUTRAL", confidence: 0, analysis: "API_KEY_MISSING" };
  
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const history = (candles || []).slice(-30).map(c => ({ h: c.high, l: c.low, c: c.close }));
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `SMC_ANALYSIS_SCAN: ${symbol} @ ${price} EUR. HISTORY_30H: ${JSON.stringify(history)}` }] }],
      config: {
        systemInstruction: `YOU ARE THE GHOST_SMC_BOT. 
Scan for Fair Value Gaps (FVG) and Market Structure Shifts (MSS). 
Confidence 0-100. PotentialRoi is a number representing percentage. 
ALWAYS RETURN VALID JSON.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ['BUY', 'SELL', 'NEUTRAL'] },
            tp: { type: Type.NUMBER },
            sl: { type: Type.NUMBER },
            entryPrice: { type: Type.NUMBER },
            confidence: { type: Type.NUMBER },
            potentialRoi: { type: Type.NUMBER },
            analysis: { type: Type.STRING }
          },
          required: ['side', 'tp', 'sl', 'entryPrice', 'confidence', 'potentialRoi', 'analysis']
        },
        temperature: 0.1
      }
    });

    const result = JSON.parse(response.text.trim());
    return {
      side: result.side || "NEUTRAL",
      tp: Number(result.tp) || 0,
      sl: Number(result.sl) || 0,
      entryPrice: Number(result.entryPrice) || Number(price) || 0,
      confidence: Number(result.confidence) || 0,
      potentialRoi: Number(result.potentialRoi) || 0,
      analysis: result.analysis || "Observing structural gaps."
    };
  } catch (e) { 
    console.error("Gemini Fail:", e.message);
    return { 
      side: "NEUTRAL", tp: 0, sl: 0, entryPrice: Number(price) || 0, 
      confidence: 0, potentialRoi: 0, analysis: "Neural Link Timeout" 
    };
  }
}

function loadState() {
  const defaults = {
    isEngineActive: true, autoPilot: true, isPaperMode: true,
    settings: { confidenceThreshold: 80, defaultTradeSize: 50.0 },
    thoughts: [], executionLogs: [], activePositions: [],
    liquidity: { eur: 0, usdc: 0 }, dailyStats: { trades: 0, profit: 0, dailyGoal: 50.0 },
    currentStatus: "INITIALIZING", scanIndex: 0
  };
  try { 
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return { ...defaults, ...saved };
    }
  } catch (e) {}
  return defaults;
}

let ghostState = loadState();

async function loop() {
  if (!ghostState.isEngineActive) return;
  const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
  ghostState.scanIndex++;
  ghostState.currentStatus = `SNIPING_${symbol}`;
  
  try {
    const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=EUR&limit=40`);
    const candles = res.data?.Data?.Data || [];
    if (candles.length === 0) return;
    const price = candles[candles.length - 1].close;
    
    const analysis = await getAdvancedAnalysis(symbol, price, candles);
    
    if (analysis) {
      const signal = { ...analysis, symbol, id: crypto.randomUUID(), timestamp: new Date().toISOString() };
      
      // AUTO-EXECUTION (SMC PROTOCOL)
      if (signal.side === 'BUY' && signal.confidence >= ghostState.settings.confidenceThreshold) {
        if (!ghostState.activePositions.some(p => p.symbol === symbol)) {
          const qty = ghostState.settings.defaultTradeSize / (price || 1);
          ghostState.activePositions.push({
            symbol, entryPrice: price || 0, currentPrice: price || 0, amount: ghostState.settings.defaultTradeSize,
            quantity: qty, tp: signal.tp, sl: signal.sl, confidence: signal.confidence, 
            potentialRoi: signal.potentialRoi,
            pnl: 0, pnlPercent: 0, isPaper: ghostState.isPaperMode, timestamp: new Date().toISOString()
          });
          ghostState.executionLogs.unshift({ 
            id: crypto.randomUUID(), symbol, action: 'BUY', price: price || 0, 
            status: 'SUCCESS', details: `AUTO_SMC_HIT_${signal.confidence}%`, timestamp: new Date().toISOString() 
          });
        }
      }
      ghostState.thoughts.unshift(signal);
      if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();
    }
  } catch (e) {}
  saveState();
}

async function monitor() {
  await syncCoinbaseBalance();
  if (ghostState.activePositions.length === 0) return;
  
  const symbols = ghostState.activePositions.map(p => p.symbol).join(',');
  try {
    const res = await axios.get(`https://min-api.cryptocompare.com/data/pricemulti?fsyms=${symbols}&tsyms=EUR`);
    const prices = res.data;
    for (let i = ghostState.activePositions.length - 1; i >= 0; i--) {
      const pos = ghostState.activePositions[i];
      const curPrice = prices[pos.symbol]?.EUR;
      if (!curPrice) continue;
      
      pos.currentPrice = curPrice;
      pos.pnlPercent = ((curPrice - pos.entryPrice) / (pos.entryPrice || 1)) * 100;
      pos.pnl = (curPrice - pos.entryPrice) * pos.quantity;
      
      if (curPrice >= pos.tp || curPrice <= pos.sl) {
        ghostState.dailyStats.profit += pos.pnl;
        ghostState.executionLogs.unshift({ 
          id: crypto.randomUUID(), symbol: pos.symbol, action: 'SELL', 
          price: curPrice, pnl: pos.pnl, status: 'SUCCESS', timestamp: new Date().toISOString() 
        });
        ghostState.activePositions.splice(i, 1);
      }
    }
  } catch (e) {}
  saveState();
}

function saveState() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {} }

setInterval(monitor, 5000);
setInterval(loop, 12000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = !!req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = !!req.body.auto;
  saveState();
  res.json({ success: true });
});

// Serve static files in production
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n💎 NOVA PREDATOR V35 - QUANTUM SYNC`);
  console.log(`📡 COINBASE CLOUD ACCOUNT: ${CB_API_KEY.slice(0, 20)}...`);
  console.log(`🔥 AUTO-SNIPER: ENABLED (SMC 80%+)\n`);
});
