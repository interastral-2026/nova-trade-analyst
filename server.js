
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
const STATE_FILE = './ghost_state.json';

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

// مکانیزم بارگذاری امن برای جلوگیری از خطای undefined در آرایه‌ها
function loadState() {
  const defaults = {
    isEngineActive: true,
    autoPilot: true,
    thoughts: [],
    executionLogs: [],
    activePositions: [], 
    currentStatus: "PREDATOR_CORE_ONLINE",
    scanIndex: 0,
    liquidity: { eur: 2500.00, usdc: 1200.00 },
    dailyStats: { trades: 0, profit: 0, fees: 0 }
  };

  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      // ترکیب مقادیر ذخیره شده با مقادیر پیش‌فرض برای اطمینان از وجود فیلدهای جدید (مثل activePositions)
      return { ...defaults, ...saved, 
        activePositions: saved.activePositions || [],
        executionLogs: saved.executionLogs || [],
        thoughts: saved.thoughts || [],
        liquidity: saved.liquidity || defaults.liquidity
      };
    }
  } catch (e) {
    console.error("LOAD_STATE_ERR:", e.message);
  }
  return defaults;
}

let ghostState = loadState();

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2));
  } catch (e) { console.error("FS_WRITE_ERROR:", e); }
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'LINK'];

async function getEntryAnalysis(symbol, price) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `PREDATOR_ENTRY: ${symbol} @ €${price}. Identify SMART MONEY Entry. Confidence > 70% required.` }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ['BUY', 'NEUTRAL'] },
            tp: { type: Type.NUMBER },
            sl: { type: Type.NUMBER },
            confidence: { type: Type.NUMBER },
            expectedROI: { type: Type.NUMBER },
            reason: { type: Type.STRING }
          },
          required: ['side', 'tp', 'sl', 'confidence', 'expectedROI', 'reason']
        }
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (e) { return null; }
}

async function getExitAnalysis(symbol, entryPrice, currentPrice, tp, sl) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const pnl = ((currentPrice - entryPrice) / entryPrice) * 100;
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `PREDATOR_EXIT_DECISION: ${symbol}. 
      Entry: €${entryPrice}, Current: €${currentPrice}, PnL: ${pnl.toFixed(2)}%. 
      Targets: TP €${tp}, SL €${sl}.
      Decision: SELL or HOLD?` }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            decision: { type: Type.STRING, enum: ['SELL', 'HOLD'] },
            reason: { type: Type.STRING },
            confidence: { type: Type.NUMBER }
          },
          required: ['decision', 'reason', 'confidence']
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
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=EUR,USD`);
    const priceEur = pRes.data.EUR;
    const priceUsd = pRes.data.USD;

    // اطمینان از اینکه activePositions یک آرایه است قبل از فراخوانی findIndex
    if (!Array.isArray(ghostState.activePositions)) {
      ghostState.activePositions = [];
    }

    const existingPosIndex = ghostState.activePositions.findIndex(p => p.symbol === symbol);
    
    if (existingPosIndex !== -1) {
      const pos = ghostState.activePositions[existingPosIndex];
      ghostState.currentStatus = `MANAGING_${symbol}_POSITION`;

      let shouldAutoSell = false;
      let sellReason = "";
      
      if (priceEur >= pos.tp) { shouldAutoSell = true; sellReason = "TAKE_PROFIT_HIT"; }
      else if (priceEur <= pos.sl) { shouldAutoSell = true; sellReason = "STOP_LOSS_HIT"; }

      if (!shouldAutoSell) {
        const exitAdvice = await getExitAnalysis(symbol, pos.entryPrice, priceEur, pos.tp, pos.sl);
        if (exitAdvice && exitAdvice.decision === 'SELL' && exitAdvice.confidence > 75) {
          shouldAutoSell = true;
          sellReason = `AI_DECISION: ${exitAdvice.reason}`;
        }
      }

      if (shouldAutoSell) {
        const pnlEur = (priceEur - pos.entryPrice) * (pos.amount / pos.entryPrice);
        const fee = pos.amount * 0.006;
        const netProfit = pnlEur - fee - (pos.feesPaid || 0);
        
        const currencyKey = (pos.currency || 'EUR').toLowerCase();
        ghostState.liquidity[currencyKey] += (pos.amount + pnlEur - fee);
        
        ghostState.executionLogs.unshift({
          id: crypto.randomUUID(),
          symbol,
          action: 'SELL',
          amount: pos.amount,
          price: priceEur,
          currency: pos.currency,
          timestamp: new Date().toISOString(),
          status: netProfit >= 0 ? 'SUCCESS_PROFIT' : 'CLOSED_LOSS',
          netProfit: netProfit,
          fees: fee,
          thought: sellReason
        });

        ghostState.dailyStats.profit += netProfit;
        ghostState.activePositions.splice(existingPosIndex, 1);
      }
    } else {
      ghostState.currentStatus = `SCANNING_${symbol}_ENTRY`;
      const analysis = await getEntryAnalysis(symbol, priceEur);
      
      if (analysis && analysis.side === 'BUY' && analysis.confidence >= 70) {
        // اطمینان از وجود آرایه thoughts
        if (!Array.isArray(ghostState.thoughts)) ghostState.thoughts = [];
        
        ghostState.thoughts.unshift({ ...analysis, symbol, timestamp: new Date().toISOString(), price: priceEur, id: crypto.randomUUID() });
        if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();

        if (ghostState.autoPilot) {
          const tradeAmount = 200; 
          const currencyKey = ghostState.liquidity.eur >= tradeAmount ? 'eur' : 'usdc';
          
          if (ghostState.liquidity[currencyKey] >= tradeAmount) {
            ghostState.liquidity[currencyKey] -= tradeAmount;
            const fee = tradeAmount * 0.006;
            
            const newPosition = {
              id: crypto.randomUUID(),
              symbol,
              entryPrice: priceEur,
              amount: tradeAmount,
              currency: currencyKey.toUpperCase(),
              tp: analysis.tp,
              sl: analysis.sl,
              timestamp: new Date().toISOString(),
              feesPaid: fee
            };

            ghostState.activePositions.push(newPosition);
            ghostState.executionLogs.unshift({
              id: crypto.randomUUID(),
              symbol,
              action: 'BUY',
              amount: tradeAmount,
              price: priceEur,
              currency: currencyKey.toUpperCase(),
              timestamp: new Date().toISOString(),
              status: 'SUCCESS',
              fees: fee,
              thought: analysis.reason
            });
            ghostState.dailyStats.trades++;
            ghostState.dailyStats.fees += fee;
          }
        }
      }
    }
    saveState();
  } catch (e) { 
    console.error("LOOP_ERR:", e.message); 
    // در صورت بروز خطا در منطق، وضعیت را بازنشانی نکنید، فقط لاگ کنید.
  }
}

setInterval(loop, 15000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`PREDATOR_ENGINE_v4_STABLE_ONLINE`));
