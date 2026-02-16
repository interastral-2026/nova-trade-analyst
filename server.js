
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

// CONFIGURATION
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
    
    const accounts = response.data?.accounts || [];
    // جستجوی بسیار دقیق بر اساس کد ارز EUR بدون توجه به نام حساب
    const eurAcc = accounts.find(a => 
      a.currency === 'EUR' || 
      a.available_balance?.currency === 'EUR' || 
      (a.name && a.name.toUpperCase().includes('EUR'))
    );
    const usdcAcc = accounts.find(a => 
      a.currency === 'USDC' || 
      a.available_balance?.currency === 'USDC'
    );
    
    if (eurAcc) {
      return { 
        eur: parseFloat(eurAcc.available_balance?.value || 0),
        usdc: parseFloat(usdcAcc?.available_balance?.value || 0),
        isLive: true
      };
    }
    return null;
  } catch (e) { 
    console.error("[CB_SYNC_ERROR]:", e.message);
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
    currentStatus: "PREDATOR_V15_IDLE",
    scanIndex: 0,
    liquidity: { eur: 0, usdc: 0 },
    dailyStats: { trades: 0, profit: 0 },
    lastSync: null
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
    ghostState.liquidity.eur = realBals.eur;
    ghostState.liquidity.usdc = realBals.usdc;
    ghostState.isPaperMode = false;
    ghostState.lastSync = new Date().toISOString();
  } else if (ghostState.liquidity.eur === 0) {
    // Fallback if no keys or no data
    ghostState.liquidity.eur = 2500; 
    ghostState.isPaperMode = true;
  }
  saveState();
}
setInterval(syncLiquidity, 7000);

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {}
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'LINK', 'DOT', 'NEAR', 'FET', 'RENDER'];

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!process.env.API_KEY) return { error: "AI_KEY_MISSING" };
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const systemPrompt = `You are "SPECTRAL PREDATOR V15".
  TASK: High-frequency technical analysis of ${symbol}.
  
  CRITICAL INSTRUCTION:
  - ALWAYS find a reason to be either BULLISH, BEARISH or NEUTRAL.
  - Confidence MUST range from 50 to 95.
  - If Confidence > 60: The signal will be BROADCAST to the terminal.
  - If Confidence > 75 AND Side is BUY: AUTO-TRADE will trigger.
  - Analyze RSI, Volume spikes, and support levels from provided candle data.
  
  FORMAT: JSON ONLY. Be sharp and professional.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `MARKET_DATA: ${symbol} | PRICE: €${price} | RECENT_HOURS: ${JSON.stringify(candles.slice(-12))}` }] }],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.2, // Lower temp for more consistent technical analysis
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
    return { error: "AI_TIMEOUT" }; 
  }
}

async function loop() {
  if (!ghostState.isEngineActive) return;

  try {
    const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    
    ghostState.currentStatus = `SCANNING_${symbol}`;
    saveState();

    const candleRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=EUR&limit=24`);
    const candles = candleRes.data?.Data?.Data;
    
    if (!candles || candles.length === 0) return;

    const currentPrice = candles[candles.length - 1].close;
    const analysis = await getAdvancedAnalysis(symbol, currentPrice, candles);
    
    if (analysis && !analysis.error) {
      // قانون نمایش: نمایش هر چیزی بالای ۶۰٪
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

      // قانون معامله: خرید بالای ۷۵٪
      if (ghostState.autoPilot && analysis.side === 'BUY' && analysis.confidence >= 75) {
        const hasPos = ghostState.activePositions.some(p => p.symbol === symbol);
        if (!hasPos) {
          const tradeSize = Math.max(30, ghostState.liquidity.eur * 0.20); // اختصاص ۲۰٪ موجودی
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
                status: order.isPaper ? 'PAPER' : 'LIVE', timestamp: new Date().toISOString(), thought: analysis.reason
              });
              ghostState.dailyStats.trades++;
            }
          }
        }
      }
      ghostState.currentStatus = `WATCHING_${symbol}`;
    }
    saveState();
  } catch (e) { 
    console.error("[SCAN_LOOP_ERROR]:", e.message);
  }
}

// اسکن سریع‌تر هر ۱۵ ثانیه برای اطمینان از پیدا شدن سیگنال
setInterval(loop, 15000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`PREDATOR_V15_STABLE_RUNNING_ON_${PORT}`));
