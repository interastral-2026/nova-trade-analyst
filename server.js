
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import { GoogleGenAI } from "@google/genai";

const app = express();
const STATE_FILE = './ghost_state.json';
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const API_KEY = process.env.API_KEY ? process.env.API_KEY.trim() : null;

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'NEAR', 'FET'];

// --- AI CORE ANALYZER (SMC STRATEGY) ---
async function getAdvancedAnalysis(symbol, price, candles) {
  if (!API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const history = candles.slice(-40).map(c => ({ h: c.high, l: c.low, c: c.close }));
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `SMC_SNIPER_V33: ${symbol} @ ${price} EUR. DATA: ${JSON.stringify(history)}` }] }],
      config: {
        systemInstruction: `ROLE: ELITE_TRADER_V33. STRATEGY: SMC (Smart Money Concepts).
CRITICAL: Identify Liquidity Sweeps, Market Structure Shifts (MSS), and Fair Value Gaps (FVG).
ALWAYS return valid JSON with these numeric fields: side, tp, sl, entryPrice, confidence, potentialRoi, analysis.
Confidence must be 0-100. potentialRoi is percentage.`,
        responseMimeType: "application/json",
        temperature: 0.1
      }
    });

    const result = JSON.parse(response.text.trim());
    return {
      side: result.side || "NEUTRAL",
      tp: Number(result.tp) || 0,
      sl: Number(result.sl) || 0,
      entryPrice: Number(result.entryPrice) || price || 0,
      confidence: Number(result.confidence) || 0,
      potentialRoi: Number(result.potentialRoi) || 0,
      analysis: result.analysis || "Observing price action..."
    };
  } catch (e) { 
    return { side: "NEUTRAL", tp: 0, sl: 0, entryPrice: price || 0, confidence: 0, potentialRoi: 0, analysis: "AI Analysis Error" };
  }
}

function loadState() {
  const defaults = {
    isEngineActive: true, autoPilot: true, isPaperMode: true,
    settings: { confidenceThreshold: 80, defaultTradeSize: 60.0 },
    thoughts: [], executionLogs: [], activePositions: [],
    liquidity: { eur: 1000, usdc: 500 }, dailyStats: { trades: 0, profit: 0, dailyGoal: 50.0 },
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
    const candles = res.data?.Data?.Data;
    if (!candles || candles.length === 0) return;
    const price = candles[candles.length - 1].close;
    
    const analysis = await getAdvancedAnalysis(symbol, price, candles);
    
    if (analysis) {
      const signal = { ...analysis, symbol, id: crypto.randomUUID(), timestamp: new Date().toISOString() };
      
      // AUTO-EXECUTION (STRICT 80%+)
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
            status: 'SUCCESS', details: `SMC_SIGNAL_${signal.confidence}%`, timestamp: new Date().toISOString() 
          });
        }
      }
      ghostState.thoughts.unshift(signal);
      if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();
    }
  } catch (e) { console.error("Loop failed", e.message); }
  saveState();
}

async function monitor() {
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
      
      const hitTP = curPrice >= pos.tp && pos.tp > 0;
      const hitSL = curPrice <= pos.sl && pos.sl > 0;

      if (hitTP || hitSL) {
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

setInterval(monitor, 3000);
setInterval(loop, 10000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🎯 PREDATOR GHOST V33 ONLINE`));
