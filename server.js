
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
const STATE_FILE = './ghost_state.json';

// رفع کامل ارور CORS برای محیط Production و Local
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true
}));
app.use(express.json());

const CB_CONFIG = {
  apiKey: process.env.CB_API_KEY || '',
  apiSecret: process.env.CB_API_SECRET || '',
  baseUrl: 'https://api.coinbase.com'
};

function getCoinbaseHeaders(method, path, body = '') {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = timestamp + method.toUpperCase() + path + body;
  const signature = crypto.createHmac('sha256', CB_CONFIG.apiSecret).update(message).digest('hex');
  return {
    'CB-ACCESS-KEY': CB_CONFIG.apiKey,
    'CB-ACCESS-SIGN': signature,
    'CB-ACCESS-TIMESTAMP': timestamp,
    'Content-Type': 'application/json'
  };
}

async function fetchRealBalances() {
  if (!CB_CONFIG.apiKey || !CB_CONFIG.apiSecret) return null;
  const path = '/api/v3/brokerage/accounts';
  try {
    const response = await axios.get(`${CB_CONFIG.baseUrl}${path}`, {
      headers: getCoinbaseHeaders('GET', path)
    });
    const accounts = response.data.accounts || [];
    const eurAcc = accounts.find(a => a.currency === 'EUR');
    return { 
      eur: parseFloat(eurAcc?.available_balance?.value || 0),
      usdc: 0
    };
  } catch (e) { 
    console.error("Coinbase Sync Error:", e.message);
    return null; 
  }
}

async function placeRealOrder(symbol, side, amountEur) {
  if (!CB_CONFIG.apiKey || !CB_CONFIG.apiSecret) return { success: true, isPaper: true };
  
  const productId = `${symbol}-EUR`;
  const path = '/api/v3/brokerage/orders';
  const body = JSON.stringify({
    client_order_id: crypto.randomUUID(),
    product_id: productId,
    side: side === 'BUY' ? 'BUY' : 'SELL',
    order_configuration: { 
      market_market_ioc: { quote_size: amountEur.toFixed(2).toString() } 
    }
  });

  try {
    const response = await axios.post(`${CB_CONFIG.baseUrl}${path}`, body, {
      headers: getCoinbaseHeaders('POST', path, body)
    });
    return { success: true, data: response.data, isPaper: false };
  } catch (e) { 
    return { success: false, error: e.response?.data?.message || e.message }; 
  }
}

function loadState() {
  const defaults = {
    isEngineActive: true,
    autoPilot: true,
    isPaperMode: true,
    thoughts: [],
    executionLogs: [],
    activePositions: [], 
    lastScans: [],
    currentStatus: "HYPER_SCALPER_READY",
    scanIndex: 0,
    liquidity: { eur: 10000, usdc: 0 },
    dailyStats: { trades: 0, profit: 0, fees: 0 },
    cooldownUntil: 0
  };
  try {
    if (fs.existsSync(STATE_FILE)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
    }
  } catch (e) {}
  return defaults;
}

let ghostState = loadState();

// همگام‌سازی موجودی هر ۸ ثانیه
async function syncLiquidity() {
  try {
    const realBals = await fetchRealBalances();
    if (realBals) {
      ghostState.liquidity = realBals;
      ghostState.isPaperMode = false;
    }
  } catch (e) {}
  saveState();
}
setInterval(syncLiquidity, 8000);

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {}
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'LINK'];

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!process.env.API_KEY) return { error: "MISSING_AI_KEY" };
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const systemPrompt = `You are "SPECTRAL PREDATOR V11", a hyper-intelligent AI Scalper.
  MISSION: High-frequency profit extraction from volatility.
  
  STRATEGY:
  1. Identify "Bullish Order Blocks" for entry.
  2. Detect "Fair Value Gaps" (FVG) that the market must fill.
  3. Spot "Stop Hunts" (When price dips below support to trap retail, then rockets up).
  
  RULES:
  - Respond 'BUY' ONLY if you expect 3-7% profit in the next few candles.
  - Set a tight Stop-Loss to protect the EUR capital.
  - Set an aggressive Take-Profit at the next liquidity level.
  - If neutral, explain the trap you see (e.g. "Fakeout detected").`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `SCAN: ${symbol} | PRICE: €${price} | TREND: ${JSON.stringify(candles.slice(-20))}` }] }],
      config: {
        systemInstruction: systemPrompt,
        thinkingConfig: { thinkingBudget: 15000 },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ['BUY', 'NEUTRAL'] },
            tp: { type: Type.NUMBER },
            sl: { type: Type.NUMBER },
            confidence: { type: Type.NUMBER },
            reason: { type: Type.STRING },
            expectedROI: { type: Type.NUMBER }
          },
          required: ['side', 'tp', 'sl', 'confidence', 'reason', 'expectedROI']
        }
      }
    });
    
    let text = response.text.trim();
    if (text.startsWith('```')) text = text.replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch (e) { 
    if (e.message?.includes('429')) return { error: "RATE_LIMIT" };
    return { error: "AI_TIMEOUT" }; 
  }
}

async function loop() {
  if (!ghostState.isEngineActive) return;
  if (Date.now() < ghostState.cooldownUntil) return;

  try {
    const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    
    ghostState.currentStatus = `PREDATOR_V11_HUNTING: ${symbol}`;
    saveState();

    const candleRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=EUR&limit=30`);
    const candles = candleRes.data.Data.Data;
    const currentPrice = candles[candles.length - 1].close;

    // ۱. چک کردن پوزیشن‌های باز برای خروج (TP/SL)
    const posIndex = ghostState.activePositions.findIndex(p => p.symbol === symbol);
    if (posIndex !== -1) {
      const pos = ghostState.activePositions[posIndex];
      let exitReason = "";
      if (currentPrice >= pos.tp) exitReason = "TP_TARGET_SMASHED";
      else if (currentPrice <= pos.sl) exitReason = "STOP_LOSS_EXIT";

      if (exitReason) {
        const order = await placeRealOrder(symbol, 'SELL', pos.amount);
        if (order.success) {
          const profit = (currentPrice - pos.entryPrice) * (pos.amount / pos.entryPrice);
          if (ghostState.isPaperMode) ghostState.liquidity.eur += (pos.amount + profit);
          ghostState.dailyStats.profit += profit;
          ghostState.executionLogs.unshift({
            id: crypto.randomUUID(), symbol, action: 'SELL', amount: pos.amount, price: currentPrice,
            status: 'SUCCESS', timestamp: new Date().toISOString(), thought: `CASHED_OUT: ${exitReason} at €${currentPrice}`
          });
          ghostState.activePositions.splice(posIndex, 1);
        }
      }
    }

    // ۲. تحلیل برای ورود جدید
    const analysis = await getAdvancedAnalysis(symbol, currentPrice, candles);
    
    if (analysis && !analysis.error) {
      ghostState.thoughts.unshift({ ...analysis, symbol, timestamp: new Date().toISOString(), price: currentPrice, id: crypto.randomUUID() });
      if (ghostState.thoughts.length > 30) ghostState.thoughts.pop();

      if (ghostState.autoPilot && analysis.side === 'BUY' && analysis.confidence >= 75 && posIndex === -1) {
        const tradeSize = 30; // ورود با ۳۰ یورو
        if (ghostState.liquidity.eur >= tradeSize) {
          const order = await placeRealOrder(symbol, 'BUY', tradeSize);
          if (order.success) {
            if (ghostState.isPaperMode) ghostState.liquidity.eur -= tradeSize;
            ghostState.activePositions.push({
              symbol, entryPrice: currentPrice, amount: tradeSize,
              tp: analysis.tp, sl: analysis.sl, timestamp: new Date().toISOString()
            });
            ghostState.executionLogs.unshift({
              id: crypto.randomUUID(), symbol, action: 'BUY', amount: tradeSize, price: currentPrice,
              status: order.isPaper ? 'PAPER_FILLED' : 'LIVE_FILLED', 
              timestamp: new Date().toISOString(), thought: `PREDATOR_ENTRY: ${analysis.reason}`
            });
          }
        }
      }
      ghostState.currentStatus = `MONITORING_${symbol}`;
    } else if (analysis?.error === "RATE_LIMIT") {
      ghostState.cooldownUntil = Date.now() + 45000;
      ghostState.currentStatus = "AI_RATE_LIMIT_BACKOFF";
    }
    saveState();
  } catch (e) { 
    console.error("Loop error:", e.message);
  }
}

// اسکن هر ۳۵ ثانیه برای دقت بالا و پایداری
setInterval(loop, 35000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

// استفاده از پورت داینامیک برای Railway
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`PREDATOR_V11_STABLE_PORT_${PORT}`));
