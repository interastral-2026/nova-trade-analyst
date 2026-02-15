
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
const STATE_FILE = './ghost_state.json';

// پیکربندی کلیدهای کوین‌بیس (باید در محیط اجرا تعریف شده باشند)
const CB_CONFIG = {
  apiKey: process.env.CB_API_KEY || '',
  apiSecret: process.env.CB_API_SECRET || '',
  baseUrl: 'https://api.coinbase.com'
};

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(express.json());

// تابع تولید امضای امن برای کوین‌بیس (HMAC SHA256)
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

// استعلام موجودی واقعی از کوین‌بیس
async function fetchRealBalances() {
  if (!CB_CONFIG.apiKey) return null;
  const path = '/api/v3/brokerage/accounts';
  try {
    const response = await axios.get(`${CB_CONFIG.baseUrl}${path}`, {
      headers: getCoinbaseHeaders('GET', path)
    });
    const accounts = response.data.accounts || [];
    const eur = accounts.find(a => a.currency === 'EUR')?.available_balance.value || 0;
    const usdc = accounts.find(a => a.currency === 'USDC')?.available_balance.value || 0;
    return { eur: parseFloat(eur), usdc: parseFloat(usdc) };
  } catch (e) {
    console.error("CB_BALANCE_ERROR:", e.response?.data || e.message);
    return null;
  }
}

// اجرای سفارش واقعی در کوین‌بیس
async function placeRealOrder(symbol, side, amountEur) {
  if (!CB_CONFIG.apiKey) return { success: false, error: 'NO_API_KEYS' };
  
  const productId = `${symbol}-EUR`;
  const path = '/api/v3/brokerage/orders';
  const orderId = crypto.randomUUID();
  
  const body = JSON.stringify({
    client_order_id: orderId,
    product_id: productId,
    side: side === 'BUY' ? 'BUY' : 'SELL',
    order_configuration: {
      market_market_ioc: {
        quote_size: amountEur.toString() // مقدار بر اساس یورو
      }
    }
  });

  try {
    const response = await axios.post(`${CB_CONFIG.baseUrl}${path}`, body, {
      headers: getCoinbaseHeaders('POST', path, body)
    });
    return { success: true, data: response.data };
  } catch (e) {
    return { success: false, error: e.response?.data || e.message };
  }
}

function loadState() {
  const defaults = {
    isEngineActive: true,
    autoPilot: true,
    thoughts: [],
    executionLogs: [],
    activePositions: [], 
    currentStatus: "PREDATOR_CORE_ONLINE",
    scanIndex: 0,
    liquidity: { eur: 0, usdc: 0 }, // این مقادیر از کوین‌بیس آپدیت می‌شوند
    dailyStats: { trades: 0, profit: 0, fees: 0 }
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
  const realBals = await fetchRealBalances();
  if (realBals) {
    ghostState.liquidity = realBals;
    saveState();
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2));
  } catch (e) { console.error("FS_WRITE_ERROR:", e); }
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'LINK'];

async function getEntryAnalysis(symbol, price) {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `PREDATOR_ENTRY: ${symbol} @ €${price}. Confidence 0-100.` }] }],
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

async function loop() {
  if (!ghostState.isEngineActive) return;
  
  // آپدیت موجودی در هر سیکل
  await syncLiquidity();

  const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
  ghostState.scanIndex++;
  
  try {
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=EUR`);
    const priceEur = pRes.data.EUR;
    
    // ۱. مدیریت خروج (فعلا ساده‌سازی شده برای موجودی واقعی)
    const existingPosIndex = ghostState.activePositions.findIndex(p => p.symbol === symbol);
    if (existingPosIndex !== -1) {
      const pos = ghostState.activePositions[existingPosIndex];
      if (priceEur >= pos.tp || priceEur <= pos.sl) {
        ghostState.currentStatus = `REAL_EXIT_EXECUTING_${symbol}`;
        const order = await placeRealOrder(symbol, 'SELL', pos.amount);
        
        if (order.success) {
           ghostState.executionLogs.unshift({
             id: crypto.randomUUID(),
             symbol, action: 'SELL', amount: pos.amount, price: priceEur,
             status: 'LIVE_EXECUTED_CB', timestamp: new Date().toISOString(),
             thought: 'TARGET_HIT_REAL_ORDER_PLACED'
           });
           ghostState.activePositions.splice(existingPosIndex, 1);
        }
      }
    } else {
      // ۲. ورود به معامله
      ghostState.currentStatus = `SCANNING_${symbol}`;
      const analysis = await getEntryAnalysis(symbol, priceEur);
      
      if (analysis && analysis.confidence >= 70 && analysis.side === 'BUY') {
        ghostState.thoughts.unshift({ ...analysis, symbol, timestamp: new Date().toISOString(), price: priceEur });
        
        // ترید واقعی برای بالای ۷۵٪
        if (ghostState.autoPilot && analysis.confidence >= 75) {
          const tradeAmount = 100; // مبلغ تستی ۱۰۰ یورو
          if (ghostState.liquidity.eur >= tradeAmount) {
            ghostState.currentStatus = `REAL_BUY_EXECUTING_${symbol}`;
            const order = await placeRealOrder(symbol, 'BUY', tradeAmount);
            
            if (order.success) {
              ghostState.activePositions.push({
                symbol, entryPrice: priceEur, amount: tradeAmount,
                tp: analysis.tp, sl: analysis.sl, timestamp: new Date().toISOString()
              });
              ghostState.executionLogs.unshift({
                id: crypto.randomUUID(),
                symbol, action: 'BUY', amount: tradeAmount, price: priceEur,
                status: 'LIVE_EXECUTED_CB', timestamp: new Date().toISOString(),
                thought: `COINBASE_ORDER_SUCCESS: ${analysis.reason}`
              });
              ghostState.dailyStats.trades++;
            } else {
              console.error("CB_ORDER_FAILED:", order.error);
            }
          }
        }
      }
    }
    saveState();
  } catch (e) { console.error("LOOP_ERR:", e.message); }
}

// اجرای حلقه هر ۱۵ ثانیه
setInterval(loop, 15000);

app.get('/api/ghost/state', async (req, res) => {
  await syncLiquidity(); // اطمینان از نمایش موجودی زنده در UI
  res.json(ghostState);
});

app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`PREDATOR_CB_LIVE_ENGINE_ONLINE`));
