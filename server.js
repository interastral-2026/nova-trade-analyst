
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

async function placeRealOrder(symbol, side, amountEur) {
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
    console.error("[ORDER_ERROR]:", e.response?.data || e.message);
    return { success: false, error: e.response?.data?.message || e.message }; 
  }
}

async function fetchRealBalances() {
  if (!CB_CONFIG.apiKey || !CB_CONFIG.apiSecret) {
    return null;
  }
  
  const path = '/api/v3/brokerage/accounts';
  try {
    const response = await axios.get(`${CB_CONFIG.baseUrl}${path}`, {
      headers: getCoinbaseHeaders('GET', path),
      timeout: 8000
    });
    
    const accounts = response.data?.accounts || [];
    let eurVal = 0;
    let usdcVal = 0;

    for (const acc of accounts) {
      const currency = acc.currency || acc.available_balance?.currency;
      const value = parseFloat(acc.available_balance?.value || 0);
      if (currency === 'EUR') eurVal += value;
      if (currency === 'USDC') usdcVal += value;
    }
    
    return { eur: eurVal, usdc: usdcVal, isLive: true };
  } catch (e) { 
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
    currentStatus: "SYSTEM_READY",
    scanIndex: 0,
    liquidity: { eur: 10000, usdc: 0 },
    dailyStats: { trades: 0, profit: 0 },
    lastSync: null,
    diag: "IDLE"
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
    ghostState.diag = "LIVE_CB_CONNECTED";
  } else {
    ghostState.diag = CB_CONFIG.apiKey ? "CB_SYNC_TIMEOUT" : "NO_KEYS_PAPER_MODE";
    ghostState.isPaperMode = true;
    if (ghostState.liquidity.eur === 0) ghostState.liquidity.eur = 5000;
  }
  saveState();
}

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {}
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'FET', 'RENDER', 'NEAR'];

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!process.env.API_KEY) {
    console.error("CRITICAL: Gemini API Key missing in process.env.API_KEY");
    return { error: "AI_KEY_MISSING" };
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const compactData = candles.slice(-12).map(c => ({
    time: new Date(c.time * 1000).getHours() + ":00",
    price: c.close,
    vol: Math.round(c.volumeto)
  }));

  const systemPrompt = `YOU ARE SPECTRAL_PREDATOR_V16.
  Market Analysis Task: ${symbol} @ EUR ${price}
  
  STRATEGY: 
  - Identify bullish/bearish divergence.
  - Check RSI support levels.
  - Confidence must be 50-95.
  - If Confidence > 75 and side is BUY, we trade.
  - Be very decisive.
  
  REQUIRED JSON FORMAT:
  {
    "side": "BUY" | "SELL" | "NEUTRAL",
    "tp": number,
    "sl": number,
    "confidence": number,
    "reason": "string (technical reason)",
    "expectedROI": number
  }`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `DATA: ${JSON.stringify(compactData)}` }] }],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.1,
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
    
    return JSON.parse(response.text.trim());
  } catch (e) { 
    console.error(`[AI_ERROR_${symbol}]:`, e.message);
    return { error: e.message }; 
  }
}

async function loop() {
  if (!ghostState.isEngineActive) {
    ghostState.currentStatus = "ENGINE_PAUSED";
    saveState();
    return;
  }

  const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
  ghostState.scanIndex++;
  ghostState.currentStatus = `SCANNING_${symbol}`;
  saveState();

  try {
    const candleRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=EUR&limit=24`, { timeout: 5000 });
    const candles = candleRes.data?.Data?.Data;
    
    if (!candles || candles.length === 0) {
      console.log(`[LOOP] No candles for ${symbol}`);
      return;
    }

    const currentPrice = candles[candles.length - 1].close;
    const analysis = await getAdvancedAnalysis(symbol, currentPrice, candles);
    
    if (analysis && !analysis.error) {
      const thought = { 
        ...analysis, symbol, price: currentPrice, 
        timestamp: new Date().toISOString(), id: crypto.randomUUID() 
      };
      
      ghostState.thoughts.unshift(thought);
      if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();
      
      ghostState.lastScans.unshift(thought);
      if (ghostState.lastScans.length > 50) ghostState.lastScans.pop();

      if (ghostState.autoPilot && analysis.side === 'BUY' && analysis.confidence >= 75) {
        const hasPos = ghostState.activePositions.some(p => p.symbol === symbol);
        if (!hasPos) {
          const tradeSize = Math.max(50, ghostState.liquidity.eur * 0.10);
          if (ghostState.liquidity.eur >= tradeSize) {
            const order = await placeRealOrder(symbol, 'BUY', tradeSize);
            if (order.success) {
              if (order.isPaper) ghostState.liquidity.eur -= tradeSize;
              ghostState.activePositions.push({
                symbol, entryPrice: currentPrice, amount: tradeSize,
                tp: analysis.tp, sl: analysis.sl, timestamp: new Date().toISOString()
              });
              ghostState.executionLogs.unshift({
                id: crypto.randomUUID(), symbol, action: 'BUY', amount: tradeSize, price: currentPrice,
                status: order.isPaper ? 'SUCCESS' : 'SUCCESS', 
                details: order.isPaper ? 'PAPER_EXECUTION' : 'LIVE_EXECUTION',
                timestamp: new Date().toISOString(), thought: analysis.reason
              });
              ghostState.dailyStats.trades++;
            }
          }
        }
      }
      ghostState.currentStatus = `FINISHED_${symbol}`;
    } else {
      ghostState.currentStatus = `AI_ERROR_${symbol}`;
    }
    saveState();
  } catch (e) { 
    console.error("[LOOP_ERROR]:", e.message);
  }
}

// اسکن هر 12 ثانیه برای جلوگیری از محدودیت نرخ API
setInterval(loop, 12000);
setInterval(syncLiquidity, 10000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n--- SPECTRAL OVERLORD ONLINE ---`);
  console.log(`PORT: ${PORT}`);
  console.log(`COINBASE KEYS: ${CB_CONFIG.apiKey ? 'DETECTED' : 'MISSING (USING PAPER)'}`);
  console.log(`GEMINI KEY: ${process.env.API_KEY ? 'DETECTED' : 'MISSING (CRITICAL)'}`);
  console.log(`--------------------------------\n`);
});
