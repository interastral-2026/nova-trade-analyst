
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
  if (!CB_CONFIG.apiKey || !CB_CONFIG.apiSecret) {
    console.warn("CB_KEYS_MISSING: Real balances not available.");
    return null;
  }
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
  if (!CB_CONFIG.apiKey || !CB_CONFIG.apiSecret) return { success: false, error: 'NO_API_KEYS' };
  
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
    liquidity: { eur: 0, usdc: 0 },
    dailyStats: { trades: 0, profit: 0, fees: 0 }
  };

  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return { 
        ...defaults, 
        ...saved,
        activePositions: Array.isArray(saved.activePositions) ? saved.activePositions : [],
        thoughts: Array.isArray(saved.thoughts) ? saved.thoughts : [],
        executionLogs: Array.isArray(saved.executionLogs) ? saved.executionLogs : []
      };
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

// تحلیل ورود هوشمند
async function getEntryAnalysis(symbol, price) {
  if (!process.env.API_KEY) {
    console.error("CRITICAL: API_KEY is missing in process.env. Please check your .env file or VS Code environment.");
    return null;
  }
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `PREDATOR_ENTRY_SCAN: ${symbol} @ €${price}. Identify SMART MONEY Entry opportunities. Provide confidence (0-100), TP, SL, and rationale.` }] }],
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
  } catch (e) { 
    console.error(`AI_ANALYSIS_ERR [${symbol}]:`, e.message);
    return null; 
  }
}

// تحلیل خروج هوشمند
async function getExitAnalysis(symbol, entryPrice, currentPrice, tp, sl) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const pnl = ((currentPrice - entryPrice) / entryPrice) * 100;
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `PREDATOR_EXIT_ANALYSIS: ${symbol}. Entry: €${entryPrice}, Current: €${currentPrice}, PnL: ${pnl.toFixed(2)}%. Targets: TP €${tp}, SL €${sl}. Decision: SELL or HOLD?` }] }],
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
  
  await syncLiquidity();

  const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
  ghostState.scanIndex++;
  
  try {
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=EUR`);
    const priceEur = pRes.data.EUR;
    
    // ۱. مدیریت خروج هوشمند و دارایی‌ها
    const existingPosIndex = ghostState.activePositions.findIndex(p => p.symbol === symbol);
    if (existingPosIndex !== -1) {
      const pos = ghostState.activePositions[existingPosIndex];
      ghostState.currentStatus = `MANAGING_${symbol}_POSITION`;

      let shouldSell = false;
      let sellReason = "";

      // بررسی اهداف قیمتی
      if (priceEur >= pos.tp) { shouldSell = true; sellReason = "TARGET_PROFIT_REACHED"; }
      else if (priceEur <= pos.sl) { shouldSell = true; sellReason = "STOP_LOSS_REACHED"; }

      // مشورت با هوش مصنوعی برای خروج بهینه
      if (!shouldSell) {
        const exitAdvice = await getExitAnalysis(symbol, pos.entryPrice, priceEur, pos.tp, pos.sl);
        if (exitAdvice && exitAdvice.decision === 'SELL' && exitAdvice.confidence > 75) {
          shouldSell = true;
          sellReason = `AI_STRATEGIC_EXIT: ${exitAdvice.reason}`;
        }
      }

      if (shouldSell) {
        const order = await placeRealOrder(symbol, 'SELL', pos.amount);
        if (order.success) {
           ghostState.executionLogs.unshift({
             id: crypto.randomUUID(),
             symbol, action: 'SELL', amount: pos.amount, price: priceEur,
             status: 'SUCCESS', timestamp: new Date().toISOString(),
             thought: sellReason
           });
           ghostState.activePositions.splice(existingPosIndex, 1);
        }
      }
    } else {
      // ۲. پویش برای ورود جدید
      ghostState.currentStatus = `SCANNING_${symbol}`;
      const analysis = await getEntryAnalysis(symbol, priceEur);
      
      // نمایش سیگنال برای بالای ۷۰٪
      if (analysis && analysis.confidence >= 70 && analysis.side === 'BUY') {
        ghostState.thoughts.unshift({ ...analysis, symbol, timestamp: new Date().toISOString(), price: priceEur, id: crypto.randomUUID() });
        if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();

        // اجرای خودکار برای بالای ۷۵٪
        if (ghostState.autoPilot && analysis.confidence >= 75) {
          const tradeAmount = 100; // مبلغ تستی (می‌تواند بر اساس مدیریت ریسک داینامیک شود)
          if (ghostState.liquidity.eur >= tradeAmount) {
            ghostState.currentStatus = `EXECUTING_BUY_${symbol}`;
            const order = await placeRealOrder(symbol, 'BUY', tradeAmount);
            
            if (order.success) {
              ghostState.activePositions.push({
                symbol, entryPrice: priceEur, amount: tradeAmount,
                tp: analysis.tp, sl: analysis.sl, timestamp: new Date().toISOString()
              });
              ghostState.executionLogs.unshift({
                id: crypto.randomUUID(),
                symbol, action: 'BUY', amount: tradeAmount, price: priceEur,
                status: 'SUCCESS', timestamp: new Date().toISOString(),
                thought: `AI_ORDER_EXECUTED_CB: ${analysis.reason}`
              });
              ghostState.dailyStats.trades++;
            }
          }
        }
      }
    }
    saveState();
  } catch (e) { 
    console.error("LOOP_ERR:", e.message); 
  }
}

// اجرای حلقه هر ۱۲ ثانیه برای واکنش سریع‌تر
setInterval(loop, 12000);

app.get('/api/ghost/state', async (req, res) => {
  await syncLiquidity();
  res.json(ghostState);
});

app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`PREDATOR_CORE_V4_READY_ON_PORT_${PORT}`));
