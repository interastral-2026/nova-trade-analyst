
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
const STATE_FILE = './ghost_state.json';

app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

// CONFIGURATION - Ensuring keys are trimmed
const CB_CONFIG = {
  apiKey: (process.env.CB_API_KEY || '').trim(),
  apiSecret: (process.env.CB_API_SECRET || '').trim(),
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
  if (!CB_CONFIG.apiKey || !CB_CONFIG.apiSecret) {
    console.log("[DIAGNOSTIC] Coinbase Keys Missing in Environment");
    return null;
  }
  
  const path = '/api/v3/brokerage/accounts';
  try {
    const response = await axios.get(`${CB_CONFIG.baseUrl}${path}`, {
      headers: getCoinbaseHeaders('GET', path),
      timeout: 10000
    });
    
    const accounts = response.data?.accounts || [];
    if (accounts.length === 0) console.log("[DIAGNOSTIC] No accounts returned from Coinbase");

    // جستجوی چند لایه برای پیدا کردن یورو
    let eurVal = 0;
    let usdcVal = 0;

    for (const acc of accounts) {
      const currency = acc.currency || acc.available_balance?.currency;
      const value = parseFloat(acc.available_balance?.value || 0);
      
      if (currency === 'EUR') eurVal += value;
      if (currency === 'USDC') usdcVal += value;
    }
    
    // اگر حسابی پیدا شد (حتی با موجودی 0) یعنی اتصال برقرار است
    const hasEurAccount = accounts.some(a => (a.currency === 'EUR' || a.available_balance?.currency === 'EUR'));
    
    if (hasEurAccount) {
      return { eur: eurVal, usdc: usdcVal, isLive: true };
    }
    return null;
  } catch (e) { 
    console.error("[CB_SYNC_CRITICAL]:", e.response?.data || e.message);
    return null; 
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
    currentStatus: "V16_INITIALIZING",
    scanIndex: 0,
    liquidity: { eur: 0, usdc: 0 },
    dailyStats: { trades: 0, profit: 0 },
    lastSync: null,
    diag: ""
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
    ghostState.liquidity.eur = realBals.eur;
    ghostState.liquidity.usdc = realBals.usdc;
    ghostState.isPaperMode = false;
    ghostState.lastSync = new Date().toISOString();
    ghostState.diag = "COINBASE_CONNECTED";
  } else {
    ghostState.diag = "USING_SIMULATED_DATA";
    if (ghostState.liquidity.eur === 0) ghostState.liquidity.eur = 12500.50; 
  }
  saveState();
}

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {}
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'FET', 'RENDER', 'NEAR'];

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!process.env.API_KEY) return { error: "AI_KEY_MISSING" };
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // ساده‌سازی دیتا برای جلوگیری از خطای Token Limit
  const compactData = candles.slice(-15).map(c => ({
    t: new Date(c.time * 1000).getHours(),
    c: c.close,
    v: Math.round(c.volumeto)
  }));

  const systemPrompt = `SYSTEM: PREDATOR_V16_ANALYSIS_CORE
  USER_REQUEST: Professional Signal for ${symbol} @ €${price}
  
  MANDATORY:
  1. Evaluate RSI and Trend Direction.
  2. ALWAYS return a JSON with side (BUY/SELL/NEUTRAL).
  3. If there is ANY bullish divergence, set side="BUY" and confidence > 75.
  4. Reasoning must be technical and brief.
  5. Provide TP and SL as numbers.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview', // استفاده از نسخه فلش برای سرعت بالاتر در اسکن‌های متوالی
      contents: [{ parts: [{ text: `DATA: ${JSON.stringify(compactData)}` }] }],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.5,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ['BUY', 'SELL', 'NEUTRAL'] },
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
    console.error(`[AI_ERROR_${symbol}]:`, e.message);
    return { error: "AI_TIMEOUT" }; 
  }
}

async function loop() {
  if (!ghostState.isEngineActive) return;

  try {
    const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    
    ghostState.currentStatus = `ANALYZING_${symbol}`;
    saveState();

    // دریافت دیتای قیمت از منبع جایگزین برای اطمینان از سرعت
    const candleRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=EUR&limit=24`, { timeout: 5000 });
    const candles = candleRes.data?.Data?.Data;
    
    if (!candles || candles.length === 0) return;

    const currentPrice = candles[candles.length - 1].close;
    const analysis = await getAdvancedAnalysis(symbol, currentPrice, candles);
    
    if (analysis && !analysis.error) {
      // ثبت در تاریخچه افکار (نمایش در تب اول)
      const thought = { 
        ...analysis, symbol, price: currentPrice, 
        timestamp: new Date().toISOString(), id: crypto.randomUUID() 
      };
      
      ghostState.thoughts.unshift(thought);
      if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();
      
      ghostState.lastScans.unshift({ ...thought });
      if (ghostState.lastScans.length > 50) ghostState.lastScans.pop();

      // منطق معامله خودکار
      if (ghostState.autoPilot && analysis.side === 'BUY' && analysis.confidence >= 75) {
        const hasPos = ghostState.activePositions.some(p => p.symbol === symbol);
        if (!hasPos) {
          const tradeSize = Math.max(50, ghostState.liquidity.eur * 0.15); // ۱۰٪ موجودی
          if (ghostState.liquidity.eur >= tradeSize) {
            // شبیه‌سازی یا معامله واقعی بر اساس وضعیت اتصال
            if (ghostState.isPaperMode) {
              ghostState.liquidity.eur -= tradeSize;
              ghostState.activePositions.push({
                symbol, entryPrice: currentPrice, amount: tradeSize,
                tp: analysis.tp, sl: analysis.sl, timestamp: new Date().toISOString()
              });
              ghostState.executionLogs.unshift({
                id: crypto.randomUUID(), symbol, action: 'BUY', amount: tradeSize, price: currentPrice,
                status: 'PAPER', timestamp: new Date().toISOString(), thought: analysis.reason
              });
              ghostState.dailyStats.trades++;
            } else {
              // معامله واقعی در کوین‌بیس
              const order = await placeRealOrder(symbol, 'BUY', tradeSize);
              if (order.success) {
                ghostState.activePositions.push({
                   symbol, entryPrice: currentPrice, amount: tradeSize,
                   tp: analysis.tp, sl: analysis.sl, timestamp: new Date().toISOString()
                });
                ghostState.executionLogs.unshift({
                  id: crypto.randomUUID(), symbol, action: 'BUY', amount: tradeSize, price: currentPrice,
                  status: 'LIVE', timestamp: new Date().toISOString(), thought: analysis.reason
                });
                ghostState.dailyStats.trades++;
              }
            }
          }
        }
      }
      ghostState.currentStatus = `READY_FOR_NEXT_SCAN`;
    }
    saveState();
  } catch (e) { 
    console.error("[MAIN_LOOP_CRASH]:", e.message);
  }
}

// اسکن هر ۱۰ ثانیه برای حداکثر سرعت در پیدا کردن سیگنال
setInterval(loop, 10000);
setInterval(syncLiquidity, 5000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n--- PREDATOR V16 ONLINE ---`);
  console.log(`PORT: ${PORT}`);
  console.log(`COINBASE API: ${CB_CONFIG.apiKey ? 'PRESENT' : 'MISSING'}`);
  console.log(`GEMINI API: ${process.env.API_KEY ? 'PRESENT' : 'MISSING'}`);
  console.log(`---------------------------\n`);
});
