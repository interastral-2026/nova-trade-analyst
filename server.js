
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
    const usdcAcc = accounts.find(a => a.currency === 'USDC');
    return { 
      eur: parseFloat(eurAcc?.available_balance?.value || 0), 
      usdc: parseFloat(usdcAcc?.available_balance?.value || 0) 
    };
  } catch (e) { 
    console.error("CB_BALANCE_ERROR:", e.response?.data || e.message);
    return null; 
  }
}

async function placeRealOrder(symbol, side, amountEur) {
  // اگر کلیدها نباشند، سیستم به حالت مجازی برمی‌گردد
  if (!CB_CONFIG.apiKey || !CB_CONFIG.apiSecret) {
    return { success: true, isPaper: true };
  }
  
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
    return { success: false, error: e.response?.data?.message || e.response?.data || e.message }; 
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
    currentStatus: "IDLE",
    scanIndex: 0,
    liquidity: { eur: 0, usdc: 0 },
    dailyStats: { trades: 0, profit: 0, fees: 0 }
  };
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
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
    // اگر کلیدی نباشد و موجودی صفر باشد، پول مجازی برای نمایش فعال می‌شود
    if (ghostState.liquidity.eur === 0) ghostState.liquidity.eur = 10000;
    ghostState.isPaperMode = true;
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2));
  } catch (e) {}
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'LINK'];

async function getEntryAnalysis(symbol, price) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `SCAN: ${symbol} @ €${price}. High-conviction entry? Return BUY only if confidence >= 75%.` }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ['BUY', 'NEUTRAL'] },
            tp: { type: Type.NUMBER },
            sl: { type: Type.NUMBER },
            confidence: { type: Type.NUMBER },
            reason: { type: Type.STRING }
          },
          required: ['side', 'tp', 'sl', 'confidence', 'reason']
        }
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (e) { return null; }
}

async function loop() {
  if (!process.env.API_KEY || !ghostState.isEngineActive) return;
  
  try {
    await syncLiquidity();
    const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=EUR`);
    const priceEur = pRes.data.EUR;
    
    // ۱. مدیریت پوزیشن‌های باز
    const posIndex = ghostState.activePositions.findIndex(p => p.symbol === symbol);
    if (posIndex !== -1) {
      const pos = ghostState.activePositions[posIndex];
      let shouldClose = false;
      let closeReason = "";

      if (priceEur >= pos.tp) { shouldClose = true; closeReason = "TP_HIT"; }
      else if (priceEur <= pos.sl) { shouldClose = true; closeReason = "SL_HIT"; }

      if (shouldClose) {
        const order = await placeRealOrder(symbol, 'SELL', pos.amount);
        if (order.success) {
          const profit = (priceEur - pos.entryPrice) * (pos.amount / pos.entryPrice);
          if (ghostState.isPaperMode) ghostState.liquidity.eur += (pos.amount + profit);
          ghostState.dailyStats.profit += profit;
          ghostState.executionLogs.unshift({
            id: crypto.randomUUID(), symbol, action: 'SELL', amount: pos.amount, price: priceEur,
            status: 'SUCCESS', timestamp: new Date().toISOString(), thought: `Closed @ ${closeReason}`
          });
          ghostState.activePositions.splice(posIndex, 1);
        }
      }
    }

    // ۲. تحلیل و خرید
    const analysis = await getEntryAnalysis(symbol, priceEur);
    if (analysis) {
      ghostState.currentStatus = `ANALYZED_${symbol}_${analysis.confidence}%`;
      
      // لاگ کردن اسکن در سیستم
      ghostState.lastScans.unshift({ 
        id: crypto.randomUUID(), symbol, price: priceEur, side: analysis.side, 
        confidence: analysis.confidence, reason: analysis.reason, timestamp: new Date().toISOString() 
      });
      if (ghostState.lastScans.length > 10) ghostState.lastScans.pop();

      // اگر اطمینان بالای ۶۰٪ بود در فید نمایش بده
      if (analysis.confidence >= 60) {
        ghostState.thoughts.unshift({ ...analysis, symbol, timestamp: new Date().toISOString(), price: priceEur, id: crypto.randomUUID() });
        if (ghostState.thoughts.length > 30) ghostState.thoughts.pop();
      }

      // اجرای خرید واقعی در صورتی که اطمینان >= 75٪ باشد
      if (ghostState.autoPilot && analysis.confidence >= 75 && analysis.side === 'BUY' && posIndex === -1) {
        const tradeAmount = 10; // خرید ۱۰ یورویی برای تست
        
        if (ghostState.liquidity.eur >= tradeAmount) {
          const order = await placeRealOrder(symbol, 'BUY', tradeAmount);
          
          if (order.success) {
            // کسر موجودی فقط برای حالت مجازی (در حالت واقعی صرافی خودش کسر می‌کند)
            if (ghostState.isPaperMode) ghostState.liquidity.eur -= tradeAmount;
            
            ghostState.activePositions.push({
              symbol, entryPrice: priceEur, amount: tradeAmount,
              tp: analysis.tp, sl: analysis.sl, timestamp: new Date().toISOString()
            });
            
            ghostState.executionLogs.unshift({
              id: crypto.randomUUID(), symbol, action: 'BUY', amount: tradeAmount, price: priceEur,
              status: order.isPaper ? 'PAPER_SUCCESS' : 'LIVE_SUCCESS', 
              timestamp: new Date().toISOString(), thought: analysis.reason
            });
            ghostState.dailyStats.trades++;
          } else {
            // لاگ کردن خطا در صورت شکست در خرید واقعی
            ghostState.executionLogs.unshift({
              id: crypto.randomUUID(), symbol, action: 'BUY_FAILED', amount: tradeAmount, price: priceEur,
              status: 'ERROR', timestamp: new Date().toISOString(), thought: `API_REJECTED: ${order.error}`
            });
          }
        } else {
          ghostState.executionLogs.unshift({
            id: crypto.randomUUID(), symbol, action: 'INSUFFICIENT_FUNDS', amount: tradeAmount, price: priceEur,
            status: 'SKIPPED', timestamp: new Date().toISOString(), thought: `Need €${tradeAmount}, Have €${ghostState.liquidity.eur.toFixed(2)}`
          });
        }
      }
    }
    saveState();
  } catch (e) { 
    console.error("LOOP_ERROR:", e.message);
    ghostState.currentStatus = "SCAN_ERROR";
  }
}

setInterval(loop, 12000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`REAL_TRADING_V8_ACTIVE_ON_${PORT}`));
