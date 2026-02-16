
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
    currentStatus: "SYSTEM_IDLE",
    scanIndex: 0,
    liquidity: { eur: 10000, usdc: 0 },
    dailyStats: { trades: 0, profit: 0, fees: 0 }
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
}

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {}
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'LINK'];

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!process.env.API_KEY) return { error: "MISSING_AI_KEY" };
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const systemPrompt = `You are "SPECTRAL OVERLORD V3", a world-class institutional trader.
  STRATEGY: Smart Money Concepts (SMC), Liquidity Traps, and Fair Value Gaps.
  TASK: Analyze ${symbol} data. 
  1. Identify Liquidity Grabs (wicks that trapped retail traders).
  2. Decide: BUY or NEUTRAL.
  3. You MUST provide a response even if market is boring.
  4. Confidence 75%+ triggers an automated trade. Be extremely precise.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `DATASET for ${symbol}:
      Current: €${price}
      History (30h): ${JSON.stringify(candles.slice(-30))}
      Decision?` }] }],
      config: {
        systemInstruction: systemPrompt,
        thinkingConfig: { thinkingBudget: 20000 },
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
    
    let text = response.text.trim();
    if (text.startsWith('```')) text = text.replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch (e) { 
    console.error("AI_PRO_ERROR:", e.message);
    return { error: e.message }; 
  }
}

async function loop() {
  if (!ghostState.isEngineActive) {
    ghostState.currentStatus = "ENGINE_OFF";
    return;
  }
  
  if (!process.env.API_KEY) {
    ghostState.currentStatus = "AI_KEY_MISSING";
    return;
  }

  try {
    await syncLiquidity();
    const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    
    ghostState.currentStatus = `DEEP_ANALYSIS: ${symbol}...`;
    saveState();

    const candleRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=EUR&limit=30`);
    const candles = candleRes.data.Data.Data;
    const currentPrice = candles[candles.length - 1].close;

    // 1. Manage Positions
    const posIndex = ghostState.activePositions.findIndex(p => p.symbol === symbol);
    if (posIndex !== -1) {
      const pos = ghostState.activePositions[posIndex];
      let triggered = "";
      if (currentPrice >= pos.tp) triggered = "TP";
      else if (currentPrice <= pos.sl) triggered = "SL";

      if (triggered) {
        const order = await placeRealOrder(symbol, 'SELL', pos.amount);
        if (order.success) {
          const profit = (currentPrice - pos.entryPrice) * (pos.amount / pos.entryPrice);
          if (ghostState.isPaperMode) ghostState.liquidity.eur += (pos.amount + profit);
          ghostState.dailyStats.profit += profit;
          ghostState.executionLogs.unshift({
            id: crypto.randomUUID(), symbol, action: 'SELL', amount: pos.amount, price: currentPrice,
            status: 'SUCCESS', timestamp: new Date().toISOString(), thought: `EXIT_TRIGGERED: ${triggered} hit at €${currentPrice}`
          });
          ghostState.activePositions.splice(posIndex, 1);
        }
      }
    }

    // 2. Deep AI Call
    const analysis = await getAdvancedAnalysis(symbol, currentPrice, candles);
    
    if (analysis && !analysis.error) {
      ghostState.currentStatus = `SCAN_DONE: ${symbol} (${analysis.confidence}%)`;
      
      // Update UI Logs
      ghostState.lastScans.unshift({ 
        id: crypto.randomUUID(), symbol, price: currentPrice, side: analysis.side, 
        confidence: analysis.confidence, reason: analysis.reason, timestamp: new Date().toISOString() 
      });
      if (ghostState.lastScans.length > 20) ghostState.lastScans.pop();

      // Store Thoughts
      ghostState.thoughts.unshift({ ...analysis, symbol, timestamp: new Date().toISOString(), price: currentPrice, id: crypto.randomUUID() });
      if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();

      // 3. Execution
      if (ghostState.autoPilot && analysis.confidence >= 75 && analysis.side === 'BUY' && posIndex === -1) {
        const tradeAmount = 10; 
        if (ghostState.liquidity.eur >= tradeAmount) {
          const order = await placeRealOrder(symbol, 'BUY', tradeAmount);
          if (order.success) {
            if (ghostState.isPaperMode) ghostState.liquidity.eur -= tradeAmount;
            ghostState.activePositions.push({
              symbol, entryPrice: currentPrice, amount: tradeAmount,
              tp: analysis.tp, sl: analysis.sl, timestamp: new Date().toISOString()
            });
            ghostState.executionLogs.unshift({
              id: crypto.randomUUID(), symbol, action: 'BUY', amount: tradeAmount, price: currentPrice,
              status: order.isPaper ? 'PAPER_FILLED' : 'LIVE_FILLED', 
              timestamp: new Date().toISOString(), thought: `AI Confirm ${analysis.confidence}%: ${analysis.reason}`
            });
            ghostState.dailyStats.trades++;
          }
        }
      }
    } else if (analysis?.error) {
      ghostState.currentStatus = `AI_ERROR: ${analysis.error.substring(0, 20)}...`;
    }
    saveState();
  } catch (e) { 
    console.error("LOOP_ERR:", e.message);
    ghostState.currentStatus = "NETWORK_ERROR";
  }
}

// اسکن هر ۱۲ ثانیه برای زنده نگه داشتن سیستم
setInterval(loop, 12000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`STABLE_PREDATOR_V9`));
