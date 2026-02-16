
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
    
    // بهبود پارس کردن موجودی برای دقت ۱۰۰٪
    const accounts = response.data?.accounts || [];
    if (accounts.length === 0) return null;

    const eurAcc = accounts.find(a => a.currency === 'EUR' || a.name?.includes('EUR'));
    const usdcAcc = accounts.find(a => a.currency === 'USDC' || a.name?.includes('USDC'));
    
    return { 
      eur: parseFloat(eurAcc?.available_balance?.value || 0),
      usdc: parseFloat(usdcAcc?.available_balance?.value || 0)
    };
  } catch (e) { 
    console.error("[Coinbase Sync Error]:", e.message);
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
    currentStatus: "PREDATOR_V13_READY",
    scanIndex: 0,
    liquidity: { eur: 1000, usdc: 0 },
    dailyStats: { trades: 0, profit: 0, fees: 0 },
    cooldownUntil: 0
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
setInterval(syncLiquidity, 5000); // همگام‌سازی بسیار سریع هر ۵ ثانیه

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {}
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'LINK'];

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!process.env.API_KEY) return { error: "MISSING_AI_KEY" };
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const systemPrompt = `You are "SPECTRAL PREDATOR V13". 
  MISSION: Detect short-term scalp opportunities (1-4 hours).
  
  ANALYSIS RULES:
  - ALWAYS provide an analysis, even if the market is sideways.
  - Confidence > 60%: Signal will be SHOWN to user.
  - Confidence > 75%: Signal will be AUTO-TRADED.
  - Look for "Wick Rejections", "Volume Spikes", and "Trend Exhaustion".
  
  RESPONSE: JSON format ONLY. Be bold in your predictions but set safe SL.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `MARKET_SCAN: ${symbol} | PRICE: €${price} | RECENT_CANDLES: ${JSON.stringify(candles.slice(-12))}` }] }],
      config: {
        systemInstruction: systemPrompt,
        thinkingConfig: { thinkingBudget: 10000 },
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
    return { error: "AI_PROCESSING_ERROR" }; 
  }
}

async function loop() {
  if (!ghostState.isEngineActive) return;
  if (Date.now() < ghostState.cooldownUntil) return;

  try {
    const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    
    ghostState.currentStatus = `PREDATOR_SCANNING: ${symbol}`;
    saveState();

    const candleRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=EUR&limit=24`);
    const candles = candleRes.data?.Data?.Data;
    
    if (!candles || candles.length === 0) return;

    const currentPrice = candles[candles.length - 1].close;

    // ۱. چک کردن پوزیشن‌های باز
    const posIndex = ghostState.activePositions.findIndex(p => p.symbol === symbol);
    if (posIndex !== -1) {
      const pos = ghostState.activePositions[posIndex];
      let exitReason = "";
      if (currentPrice >= pos.tp) exitReason = "TP_SMASHED";
      else if (currentPrice <= pos.sl) exitReason = "SL_HIT";

      if (exitReason) {
        const order = await placeRealOrder(symbol, 'SELL', pos.amount);
        if (order.success) {
          const profit = (currentPrice - pos.entryPrice) * (pos.amount / pos.entryPrice);
          if (ghostState.isPaperMode) ghostState.liquidity.eur += (pos.amount + profit);
          ghostState.dailyStats.profit += profit;
          ghostState.executionLogs.unshift({
            id: crypto.randomUUID(), symbol, action: 'SELL', amount: pos.amount, price: currentPrice,
            status: 'SUCCESS', timestamp: new Date().toISOString(), thought: `POSITION_CLOSED: ${exitReason}`
          });
          ghostState.activePositions.splice(posIndex, 1);
        }
      }
    }

    // ۲. تحلیل جدید
    const analysis = await getAdvancedAnalysis(symbol, currentPrice, candles);
    
    if (analysis && !analysis.error) {
      // نمایش تحلیل در صورت اعتماد بالای ۶۰٪
      if (analysis.confidence >= 60) {
        ghostState.thoughts.unshift({ 
          ...analysis, 
          symbol, 
          timestamp: new Date().toISOString(), 
          price: currentPrice, 
          id: crypto.randomUUID() 
        });
        if (ghostState.thoughts.length > 40) ghostState.thoughts.pop();
        
        ghostState.lastScans.unshift({ 
          id: crypto.randomUUID(), symbol, price: currentPrice, side: analysis.side, 
          confidence: analysis.confidence, reason: analysis.reason, timestamp: new Date().toISOString() 
        });
        if (ghostState.lastScans.length > 50) ghostState.lastScans.pop();
      }

      // ۳. ورود خودکار با اعتماد بالای ۷۵٪
      if (ghostState.autoPilot && analysis.side === 'BUY' && analysis.confidence >= 75 && posIndex === -1) {
        // اختصاص ۲۰٪ از موجودی برای سوددهی سریع و ملموس
        const tradeSize = Math.max(30, ghostState.liquidity.eur * 0.20); 
        
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
            ghostState.dailyStats.trades++;
          }
        }
      }
      ghostState.currentStatus = `WATCHING_${symbol}`;
    } else if (analysis?.error === "RATE_LIMIT") {
      ghostState.cooldownUntil = Date.now() + 30000;
      ghostState.currentStatus = "AI_RATE_LIMIT_WAIT";
    }
    saveState();
  } catch (e) { 
    console.error("[Loop Error]:", e.message);
  }
}

// اسکن هر ۲۵ ثانیه برای سرعت عمل بالاتر
setInterval(loop, 25000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`PREDATOR_V13_STABLE_PORT_${PORT}`));
