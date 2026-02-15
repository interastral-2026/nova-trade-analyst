
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
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
  credentials: true
}));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

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
    const eur = accounts.find(a => a.currency === 'EUR')?.available_balance.value || 0;
    const usdc = accounts.find(a => a.currency === 'USDC')?.available_balance.value || 0;
    return { eur: parseFloat(eur), usdc: parseFloat(usdc) };
  } catch (e) { return null; }
}

async function placeRealOrder(symbol, side, amountEur) {
  if (!CB_CONFIG.apiKey || !CB_CONFIG.apiSecret) return { success: false, error: 'NO_CB_KEYS' };
  const productId = `${symbol}-EUR`;
  const path = '/api/v3/brokerage/orders';
  const body = JSON.stringify({
    client_order_id: crypto.randomUUID(),
    product_id: productId,
    side: side === 'BUY' ? 'BUY' : 'SELL',
    order_configuration: { market_market_ioc: { quote_size: amountEur.toString() } }
  });
  try {
    const response = await axios.post(`${CB_CONFIG.baseUrl}${path}`, body, {
      headers: getCoinbaseHeaders('POST', path, body)
    });
    return { success: true, data: response.data };
  } catch (e) { return { success: false, error: e.response?.data || e.message }; }
}

function loadState() {
  const defaults = {
    isEngineActive: true,
    autoPilot: true,
    thoughts: [],
    executionLogs: [],
    activePositions: [], 
    lastScans: [],
    currentStatus: "INITIALIZING",
    scanIndex: 0,
    liquidity: { eur: 0, usdc: 0 },
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
  if (!process.env.API_KEY) return null;
  // استفاده از مدل Flash برای سرعت بیشتر در تحلیل‌های مکرر
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `QUICK_SCAN: ${symbol} @ €${price}. 
      Check for: High-conviction SMART MONEY entry. 
      Return 'BUY' only if confidence > 70%. Otherwise return 'NEUTRAL'. 
      Provide a 1-sentence logic for your decision.` }] }],
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
  if (!process.env.API_KEY) {
    ghostState.currentStatus = "MISSING_API_KEY";
    return;
  }
  if (!ghostState.isEngineActive) {
    ghostState.currentStatus = "ENGINE_SUSPENDED";
    return;
  }
  
  try {
    const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    
    ghostState.currentStatus = `FETCHING_${symbol}_PRICE`;
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=EUR`);
    const priceEur = pRes.data.EUR;
    
    ghostState.currentStatus = `AI_PROMPTING_${symbol}`;
    const analysis = await getEntryAnalysis(symbol, priceEur);
    
    if (analysis) {
      const scanLog = {
        id: crypto.randomUUID(),
        symbol,
        price: priceEur,
        side: analysis.side,
        confidence: analysis.confidence,
        reason: analysis.reason,
        timestamp: new Date().toISOString()
      };
      
      ghostState.lastScans.unshift(scanLog);
      if (ghostState.lastScans.length > 20) ghostState.lastScans.pop();

      // کاهش فیلتر نمایش به 60٪ برای اینکه تحلیل‌های بیشتری در تب ROI-Feed ببینید
      if (analysis.confidence >= 60) {
        ghostState.thoughts.unshift({ ...analysis, symbol, timestamp: new Date().toISOString(), price: priceEur, id: crypto.randomUUID() });
        if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();

        // خرید واقعی همچنان فقط برای موارد بسیار قوی
        if (ghostState.autoPilot && analysis.confidence >= 75 && analysis.side === 'BUY') {
          ghostState.currentStatus = `EXECUTING_BUY_${symbol}`;
          const tradeAmount = 100;
          if (ghostState.liquidity.eur >= tradeAmount) {
            const order = await placeRealOrder(symbol, 'BUY', tradeAmount);
            if (order.success) {
              ghostState.activePositions.push({
                symbol, entryPrice: priceEur, amount: tradeAmount,
                tp: analysis.tp, sl: analysis.sl, timestamp: new Date().toISOString()
              });
              ghostState.executionLogs.unshift({
                id: crypto.randomUUID(), symbol, action: 'BUY', amount: tradeAmount, price: priceEur,
                status: 'SUCCESS', timestamp: new Date().toISOString(), thought: `AUTO_BUY: ${analysis.reason}`
              });
              ghostState.dailyStats.trades++;
            }
          }
        }
      }
    }
    ghostState.currentStatus = `IDLE_WAITING`;
    saveState();
  } catch (e) { 
    console.error("LOOP_ERROR:", e.message);
    ghostState.currentStatus = `ERROR: ${e.message.slice(0, 20)}`;
  }
}

// اجرای بلافاصله اولین اسکن
setTimeout(loop, 2000);
// چرخه اسکن هر ۱۲ ثانیه
setInterval(loop, 12000);

app.get('/api/ghost/state', (req, res) => {
  res.json(ghostState);
});

app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

// جلوگیری از کراش در صورت خطای غیرمنتظره
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT_EXCEPTION:', err);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`CORE_V6_UP_PORT_${PORT}`));
