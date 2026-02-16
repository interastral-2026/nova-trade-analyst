
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

// CONFIGURATION - Ensuring keys are trimmed and valid
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
  if (!CB_CONFIG.apiKey || !CB_CONFIG.apiSecret) return null;
  
  const path = '/api/v3/brokerage/accounts';
  try {
    const response = await axios.get(`${CB_CONFIG.baseUrl}${path}`, {
      headers: getCoinbaseHeaders('GET', path),
      timeout: 10000
    });
    
    const accounts = response.data?.accounts || [];
    let eurVal = 0;
    let usdcVal = 0;

    for (const acc of accounts) {
      // Coinbase V3 sometimes nests currency in available_balance
      const currency = acc.currency || (acc.available_balance ? acc.available_balance.currency : null);
      const value = parseFloat(acc.available_balance?.value || 0);
      
      if (currency === 'EUR') eurVal += value;
      if (currency === 'USDC') usdcVal += value;
    }
    
    // Check if we actually found any EUR/USDC accounts to confirm connection
    const hasAccounts = accounts.length > 0;
    return hasAccounts ? { eur: eurVal, usdc: usdcVal, isLive: true } : null;
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
    console.error("[ORDER_EXECUTION_FAILED]:", e.response?.data || e.message);
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
    currentStatus: "OVERLORD_V16_STANDBY",
    scanIndex: 0,
    liquidity: { eur: 0, usdc: 0 },
    dailyStats: { trades: 0, profit: 0 },
    lastSync: null,
    diag: "BOOTING"
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
    ghostState.diag = "CB_LIVE_CONNECTED";
  } else {
    ghostState.diag = CB_CONFIG.apiKey ? "CB_AUTH_PENDING" : "NO_KEYS_PAPER_ACTIVE";
    ghostState.isPaperMode = true;
    if (ghostState.liquidity.eur === 0) ghostState.liquidity.eur = 15000;
  }
  saveState();
}

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {}
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'FET', 'RENDER', 'NEAR'];

// Robust JSON extraction helper
function extractJSON(text) {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return JSON.parse(text);
  } catch (e) {
    throw new Error("Could not parse AI response as JSON");
  }
}

async function getAdvancedAnalysis(symbol, price, candles) {
  if (!process.env.API_KEY) {
    console.error("!!! GEMINI API KEY MISSING !!! Check your environment variables.");
    return { error: "AI_KEY_MISSING" };
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const compactData = candles.slice(-15).map(c => ({
    hour: new Date(c.time * 1000).getHours(),
    price: c.close,
    v: Math.round(c.volumeto)
  }));

  const systemPrompt = `SYSTEM: NOVA_PREDATOR_V16
  Role: Professional Scalper / Technical Analyst.
  Asset: ${symbol} @ EUR ${price}
  
  Instructions:
  - Analyze RSI, Volume, and Divergence.
  - Return side: BUY, SELL, or NEUTRAL.
  - Set confidence 50-95.
  - If Confidence > 75 and side is BUY, execute auto-trade.
  - Provide concise technical reasoning.
  
  MANDATORY JSON FORMAT:
  {
    "side": "BUY" | "SELL" | "NEUTRAL",
    "tp": number,
    "sl": number,
    "confidence": number,
    "reason": "string",
    "expectedROI": number
  }`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `MARKET_DATA: ${JSON.stringify(compactData)}` }] }],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    });
    
    const text = response.text;
    if (!text) throw new Error("AI returned empty response");
    
    return extractJSON(text);
  } catch (e) { 
    console.error(`[AI_FAILURE_${symbol}]:`, e.message);
    return { error: e.message }; 
  }
}

async function loop() {
  if (!ghostState.isEngineActive) {
    ghostState.currentStatus = "ENGINE_SUSPENDED";
    saveState();
    return;
  }

  const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
  ghostState.scanIndex++;
  
  ghostState.currentStatus = `PROBING_${symbol}`;
  saveState();

  try {
    const candleRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=EUR&limit=24`, { timeout: 8000 });
    const candles = candleRes.data?.Data?.Data;
    
    if (!candles || candles.length === 0) {
      console.warn(`[DATA_FAIL] No candles for ${symbol}`);
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

      // EXECUTION LOGIC
      if (ghostState.autoPilot && analysis.side === 'BUY' && analysis.confidence >= 75) {
        const hasPos = ghostState.activePositions.some(p => p.symbol === symbol);
        if (!hasPos) {
          const tradeSize = Math.max(50, ghostState.liquidity.eur * 0.12); // Use 12% of liquidity
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
                status: 'SUCCESS', details: order.isPaper ? 'SIMULATED' : 'LIVE_ORDER',
                timestamp: new Date().toISOString(), thought: analysis.reason
              });
              ghostState.dailyStats.trades++;
            }
          }
        }
      }
      ghostState.currentStatus = `WATCHING_MARKET`;
    } else {
      // Don't crash, just update status and move to next asset
      ghostState.currentStatus = `AI_TIMEOUT_${symbol}`;
      console.error(`[AI_BYPASS] Analysis failed for ${symbol}: ${analysis?.error || 'Unknown Error'}`);
    }
    saveState();
  } catch (e) { 
    console.error("[CRITICAL_LOOP_ERROR]:", e.message);
    ghostState.currentStatus = "SYSTEM_RECOVERY";
  }
}

// Optimized Intervals
setInterval(loop, 12000); // Scan every 12s
setInterval(syncLiquidity, 8000); // Sync wallet every 8s

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = req.body.auto;
  saveState();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========================================`);
  console.log(`🚀 SPECTRAL OVERLORD V16.2 ONLINE`);
  console.log(`📡 PORT: ${PORT}`);
  console.log(`💹 COINBASE: ${CB_CONFIG.apiKey ? 'DETECTED' : 'NOT SET (PAPER MODE)'}`);
  console.log(`🧠 GEMINI AI: ${process.env.API_KEY ? 'ACTIVE' : 'MISSING (CRITICAL)'}`);
  console.log(`========================================\n`);
});
