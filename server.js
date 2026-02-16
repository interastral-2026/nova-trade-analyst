
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
const STATE_FILE = './ghost_state.json';

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'], credentials: true }));
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
  } catch (e) { return null; }
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
    currentStatus: "INITIALIZING_PREDATOR_X",
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

async function syncLiquidity() {
  const realBals = await fetchRealBalances();
  if (realBals) {
    ghostState.liquidity = realBals;
    ghostState.isPaperMode = false;
  } else {
    ghostState.isPaperMode = true;
  }
  saveState();
}
setInterval(syncLiquidity, 10000);

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {}
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'LINK'];

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!process.env.API_KEY) return { error: "MISSING_AI_KEY" };
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // منطق تهاجمی برای شکار سودهای بالا
  const systemPrompt = `You are "SPECTRAL PREDATOR X", an AI designed for High-Frequency Scalping and aggressive profit taking.
  GOAL: Identify short-term 2% to 10% profit opportunities.
  STRATEGY: 
  - Detect "Smart Money" accumulation zones.
  - Look for "Liquidity Grabs" (retail stop-losses being hit).
  - Identify Fair Value Gaps (FVG) for precise entries.
  DECISION RULES:
  - If you see a high-probability reversal with a 1:3 Risk/Reward, respond with 'BUY'.
  - Provide aggressive TP (Take Profit) and tight SL (Stop Loss).
  - Even if NEUTRAL, explain the market trap you are avoiding.
  - You MUST output JSON only.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `MARKET_SCAN: ${symbol}
      PRICE: €${price}
      CANDLES (1H): ${JSON.stringify(candles.slice(-25))}
      
      Find a high-profit opportunity or explain the current danger.` }] }],
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
    return { error: "ANALYSIS_FAILED" }; 
  }
}

async function loop() {
  if (!ghostState.isEngineActive) {
    ghostState.currentStatus = "ENGINE_OFFLINE";
    return;
  }
  
  if (Date.now() < ghostState.cooldownUntil) {
    ghostState.currentStatus = "AI_COOLING_DOWN";
    return;
  }

  try {
    const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    
    ghostState.currentStatus = `PREDATOR_HUNTING: ${symbol}`;
    saveState();

    const candleRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=EUR&limit=30`);
    const candles = candleRes.data.Data.Data;
    const currentPrice = candles[candles.length - 1].close;

    // ۱. مدیریت پوزیشن‌های باز
    const posIndex = ghostState.activePositions.findIndex(p => p.symbol === symbol);
    if (posIndex !== -1) {
      const pos = ghostState.activePositions[posIndex];
      let action = "";
      if (currentPrice >= pos.tp) action = "PROFIT_TARGET_HIT";
      else if (currentPrice <= pos.sl) action = "STOP_LOSS_HIT";

      if (action) {
        const order = await placeRealOrder(symbol, 'SELL', pos.amount);
        if (order.success) {
          const profit = (currentPrice - pos.entryPrice) * (pos.amount / pos.entryPrice);
          if (ghostState.isPaperMode) ghostState.liquidity.eur += (pos.amount + profit);
          ghostState.dailyStats.profit += profit;
          ghostState.executionLogs.unshift({
            id: crypto.randomUUID(), symbol, action: 'SELL', amount: pos.amount, price: currentPrice,
            status: 'SUCCESS', timestamp: new Date().toISOString(), thought: `Automatic Exit: ${action} at €${currentPrice}`
          });
          ghostState.activePositions.splice(posIndex, 1);
        }
      }
    }

    // ۲. تحلیل عمیق بازار (۴۰ ثانیه یک‌بار)
    const analysis = await getAdvancedAnalysis(symbol, currentPrice, candles);
    
    if (analysis && !analysis.error) {
      // ثبت اسکن در لیست
      ghostState.lastScans.unshift({ 
        id: crypto.randomUUID(), symbol, price: currentPrice, side: analysis.side, 
        confidence: analysis.confidence, reason: analysis.reason, timestamp: new Date().toISOString() 
      });

      // ثبت در فید افکار (حتی اگر NEUTRAL باشد برای زنده بودن سیستم)
      ghostState.thoughts.unshift({ ...analysis, symbol, timestamp: new Date().toISOString(), price: currentPrice, id: crypto.randomUUID() });
      if (ghostState.thoughts.length > 30) ghostState.thoughts.pop();

      // ۳. اجرای عملیات خرید تهاجمی (بالای ۷۵٪ اعتماد)
      if (ghostState.autoPilot && analysis.side === 'BUY' && analysis.confidence >= 75 && posIndex === -1) {
        const tradeSize = 25; // افزایش مبلغ خرید برای سوددهی ملموس‌تر
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
              timestamp: new Date().toISOString(), thought: `High-ROI Opportunity: ${analysis.reason}`
            });
            ghostState.dailyStats.trades++;
          }
        }
      }
      ghostState.currentStatus = `STABLE: ${symbol} SCANNED`;
    } else if (analysis?.error === "RATE_LIMIT") {
      ghostState.cooldownUntil = Date.now() + 60000;
      ghostState.currentStatus = "AI_RATE_LIMIT_WAITING";
    }
    saveState();
  } catch (e) { 
    ghostState.currentStatus = "DATA_SYNC_ERROR";
  }
}

// فاصله ۴۰ ثانیه‌ای برای تحلیل دقیق و جلوگیری از بلاک شدن
setInterval(loop, 40000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`PREDATOR_X_ENGINE_RUNNING`));
