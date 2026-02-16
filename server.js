
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
  if (!CB_CONFIG.apiKey || !CB_CONFIG.apiSecret) {
    console.log("[SYNC] API Keys missing, using simulated balance.");
    return null;
  }
  const path = '/api/v3/brokerage/accounts';
  try {
    const response = await axios.get(`${CB_CONFIG.baseUrl}${path}`, {
      headers: getCoinbaseHeaders('GET', path)
    });
    
    const accounts = response.data?.accounts || [];
    // جستجوی دقیق برای ارز یورو (EUR)
    const eurAcc = accounts.find(a => a.currency === 'EUR' || a.name === 'EUR Wallet' || a.available_balance?.currency === 'EUR');
    const usdcAcc = accounts.find(a => a.currency === 'USDC' || a.name === 'USDC Wallet');
    
    if (!eurAcc) {
      console.log("[SYNC] EUR Account not found in Coinbase response.");
      return null;
    }

    return { 
      eur: parseFloat(eurAcc.available_balance?.value || 0),
      usdc: parseFloat(usdcAcc?.available_balance?.value || 0)
    };
  } catch (e) { 
    console.error("[Coinbase API Error]:", e.response?.data || e.message);
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
    currentStatus: "PREDATOR_V14_ONLINE",
    scanIndex: 0,
    liquidity: { eur: 0, usdc: 0 },
    dailyStats: { trades: 0, profit: 0 },
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
    console.log(`[BALANCE_SYNC] EUR: ${realBals.eur} | LIVE`);
  } else {
    // اگر موجودی صفر است و دیتایی نیامد، در حالت Paper یک مبلغ فرضی بگذار تا ربات کار کند
    if (ghostState.liquidity.eur === 0 && ghostState.isPaperMode) {
      ghostState.liquidity.eur = 5000; 
    }
  }
  saveState();
}
setInterval(syncLiquidity, 8000);

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {}
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'LINK', 'DOT', 'NEAR'];

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!process.env.API_KEY) return { error: "MISSING_AI_KEY" };
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const systemPrompt = `You are "SPECTRAL PREDATOR V14". 
  MISSION: High-speed market analysis.
  
  RULES:
  1. ALWAYS provide a detailed technical reason for the asset's current state.
  2. If Confidence > 60%, the user MUST see your thought.
  3. If Confidence > 75% AND side is BUY, we execute.
  4. Detect support/resistance levels from the candle data.
  
  FORMAT: Return JSON. Be decisive. "NEUTRAL" is allowed but explain why.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `SCAN: ${symbol} | PRICE: €${price} | DATA: ${JSON.stringify(candles.slice(-15))}` }] }],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.4,
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
    return { error: "AI_ERROR" }; 
  }
}

async function loop() {
  if (!ghostState.isEngineActive) return;
  if (Date.now() < ghostState.cooldownUntil) return;

  try {
    const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    
    ghostState.currentStatus = `ANALYZING_${symbol}`;
    saveState();

    const candleRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=EUR&limit=24`);
    const candles = candleRes.data?.Data?.Data;
    
    if (!candles || candles.length === 0) {
       console.log(`[DATA] Empty candles for ${symbol}`);
       return;
    }

    const currentPrice = candles[candles.length - 1].close;
    const analysis = await getAdvancedAnalysis(symbol, currentPrice, candles);
    
    if (analysis && !analysis.error) {
      // قانون نمایش: نمایش در صورت اطمینان بالای ۶۰٪ (صرف نظر از BUY/SELL/NEUTRAL)
      if (analysis.confidence >= 60) {
        const thought = { 
          ...analysis, 
          symbol, 
          timestamp: new Date().toISOString(), 
          price: currentPrice, 
          id: crypto.randomUUID() 
        };
        ghostState.thoughts.unshift(thought);
        if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();

        ghostState.lastScans.unshift({ 
          id: crypto.randomUUID(), symbol, price: currentPrice, side: analysis.side, 
          confidence: analysis.confidence, reason: analysis.reason, timestamp: new Date().toISOString() 
        });
        if (ghostState.lastScans.length > 50) ghostState.lastScans.pop();
      }

      // قانون معامله: فقط خرید (BUY) با اطمینان بالای ۷۵٪
      if (ghostState.autoPilot && analysis.side === 'BUY' && analysis.confidence >= 75) {
        // چک کردن اینکه پوزیشن باز برای این ارز نداریم
        const hasPos = ghostState.activePositions.some(p => p.symbol === symbol);
        if (!hasPos) {
          const tradeSize = Math.max(35, ghostState.liquidity.eur * 0.25); // ۲۵٪ موجودی برای هر معامله
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
      ghostState.currentStatus = `MONITORING_${symbol}`;
    }
    saveState();
  } catch (e) { 
    console.error("[Loop Error]:", e.message);
  }
}

// اسکن سریع هر ۱۸ ثانیه برای پیدا کردن سیگنال‌های بیشتر
setInterval(loop, 18000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`PREDATOR_V14_READY_ON_${PORT}`));
