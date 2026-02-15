
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
const STATE_FILE = './ghost_state.json';

// CORS configuration for local and remote access
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

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
    currentStatus: "PREDATOR_CORE_ONLINE",
    scanIndex: 0,
    liquidity: { eur: 2500.00, usdc: 1200.00 },
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
      contents: [{ parts: [{ text: `PREDATOR_TACTICAL_ANALYSIS: ${symbol} currently at €${price}. 
      Task: Detect Smart Money Reversals. 
      Threshold: Confidence > 70% required for signal.
      ROI Calculation: Must include estimated Net ROI after 0.6% fees.` }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ['BUY', 'SELL', 'NEUTRAL'] },
            tp: { type: Type.NUMBER },
            sl: { type: Type.NUMBER },
            confidence: { type: Type.NUMBER },
            expectedROI: { type: Type.NUMBER, description: "Percentage expected profit" },
            reason: { type: Type.STRING },
            thoughtProcess: { type: Type.STRING }
          },
          required: ['side', 'tp', 'sl', 'confidence', 'expectedROI', 'reason', 'thoughtProcess']
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
    ghostState.currentStatus = `HUNTING_${symbol}_VOLATILITY`;
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=EUR,USD`);
    const priceEur = pRes.data.EUR;
    const priceUsd = pRes.data.USD;

    const analysis = await getAnalysis(symbol, priceEur);
    
    if (analysis && analysis.confidence >= 70 && analysis.side !== 'NEUTRAL') {
      const signal = { 
        ...analysis, 
        symbol, 
        timestamp: new Date().toISOString(), 
        price: priceEur, 
        id: crypto.randomUUID() 
      };
      
      // Add and sort thoughts by ROI then Confidence
      ghostState.thoughts.unshift(signal);
      ghostState.thoughts.sort((a, b) => b.expectedROI - a.expectedROI || b.confidence - a.confidence);
      
      if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();
      
      // AUTO-TRADE EXECUTION (SIMULATED FOR TEST)
      if (ghostState.autoPilot && analysis.confidence >= 70) {
        const tradeAmount = 150; // €150 per trade for testing
        const fee = tradeAmount * 0.006;
        
        // Choose liquidity source
        let source = 'eur';
        if (ghostState.liquidity.eur < tradeAmount && ghostState.liquidity.usdc > tradeAmount) {
          source = 'usdc';
        }

        if (ghostState.liquidity[source] >= tradeAmount) {
          ghostState.liquidity[source] -= tradeAmount;
          
          const logEntry = {
             id: crypto.randomUUID(), 
             symbol, 
             action: analysis.side, 
             amount: tradeAmount, 
             price: source === 'eur' ? priceEur : priceUsd,
             currency: source.toUpperCase(),
             timestamp: new Date().toISOString(), 
             status: 'SUCCESS', 
             fees: fee, 
             thought: analysis.reason,
             roi: analysis.expectedROI
          };
          
          ghostState.executionLogs.unshift(logEntry);
          ghostState.dailyStats.trades++;
          ghostState.dailyStats.fees += fee;
          
          // Simple simulated profit realization (50% of signals "hit" instantly for visual feedback in test)
          if (Math.random() > 0.5) {
            const profit = tradeAmount * (analysis.expectedROI / 100);
            ghostState.liquidity[source] += (tradeAmount + profit - fee);
            ghostState.dailyStats.profit += (profit - fee);
            logEntry.status = 'COMPLETED_PROFIT';
            logEntry.netProfit = profit - fee;
          }
        }
      }
    }
    saveState();
  } catch (e) { console.error("LOOP_ERR:", e.message); }
}

// Faster loop for testing (every 15 seconds)
setInterval(loop, 15000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`BRIDGE_SERVER_RUNNING_ON_${PORT}`));
