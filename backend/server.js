
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { GoogleGenAI, Type } from "@google/genai";
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to load from multiple locations to be safe
const envPaths = [
  path.join(process.cwd(), '.env.local'),
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '.env.local'),
  path.join(__dirname, '.env'),
  path.join(__dirname, '../.env.local'),
  path.join(__dirname, '../.env')
];

envPaths.forEach(envPath => {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log(`[ENV] Successfully loaded: ${envPath}`);
  }
});

if (!process.env.CB_API_KEY) {
  console.warn("⚠️  WARNING: CB_API_KEY not found in process.env after searching all .env files.");
}
if (!process.env.CB_API_SECRET) {
  console.warn("⚠️  WARNING: CB_API_SECRET not found in process.env after searching all .env files.");
}

const app = express();
const STATE_FILE = './ghost_state.json';
// Force backend to 3001 to avoid conflict with frontend on 3000
const PORT = 3001; 

app.use(cors());
app.use(express.json());

// --- ENVIRONMENT CONFIG ---
const API_KEY = process.env.API_KEY ? process.env.API_KEY.trim() : null;
const CB_API_KEY = process.env.CB_API_KEY ? process.env.CB_API_KEY.trim() : null;
const CB_API_SECRET = process.env.CB_API_SECRET 
  ? process.env.CB_API_SECRET.replace(/^"|"$/g, '').replace(/\\n/g, '\n').trim() 
  : null;

const WATCHLIST = ['BTC-EUR', 'ETH-EUR', 'SOL-EUR', 'AVAX-EUR', 'NEAR-EUR', 'FET-EUR'];

/**
 * GENERATE JWT FOR COINBASE CLOUD (V3 API)
 */
function generateCoinbaseJWT(request_method, request_path) {
  if (!CB_API_KEY) {
    console.error("[JWT ERROR] CB_API_KEY is missing.");
    return null;
  }
  if (!CB_API_SECRET) {
    console.error("[JWT ERROR] CB_API_SECRET is missing.");
    return null;
  }
  try {
    const request_host = 'api.coinbase.com';
    const uri = request_method + ' ' + request_host + request_path;
    
    const payload = {
      iss: "cdp",
      nbf: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 120,
      sub: CB_API_KEY,
      uri: uri,
    };

    const header = {
      alg: "ES256",
      kid: CB_API_KEY,
      nonce: crypto.randomBytes(16).toString("hex"),
    };

    return jwt.sign(payload, CB_API_SECRET, { algorithm: 'ES256', header });
  } catch (e) {
    console.error("JWT Error:", e.message);
    return null;
  }
}

/**
 * SYNC REAL BALANCES FROM COINBASE
 */
async function syncCoinbaseBalance() {
  const token = generateCoinbaseJWT('GET', '/api/v3/brokerage/accounts');
  if (!token) return false;

  try {
    const response = await axios.get('https://api.coinbase.com/api/v3/brokerage/accounts', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const accounts = response.data?.accounts || [];
    const newBalances = {}; 

    accounts.forEach((acc) => {
      const currency = acc.currency;
      const amount = parseFloat(acc.available_balance?.value || 0);
      if (currency === 'EUR') ghostState.liquidity.eur = amount;
      else if (currency === 'USDC' || currency === 'USD') ghostState.liquidity.usdc = amount;
      else if (amount > 0.00000001) {
        newBalances[currency] = amount;
      }
    });
    
    ghostState.actualBalances = newBalances;
    return true;
  } catch (e) {
    console.warn("CB_SYNC_FAIL:", e.response?.data?.message || e.message);
    return false;
  }
}

/**
 * EXECUTE REAL TRADE ON COINBASE
 */
async function executeTrade(symbol, side, amount, quantity) {
  console.log(`[REAL TRADE INITIATED] Attempting to ${side} ${symbol} | Amount: €${amount} | Qty: ${quantity}`);
  
  const token = generateCoinbaseJWT('POST', '/api/v3/brokerage/orders');
  if (!token) {
    console.error("[REAL TRADE FAILED] Missing or invalid Coinbase API credentials.");
    return false;
  }

  try {
    const orderConfig = side === 'BUY' 
      ? { market_market_ioc: { quote_size: Number(amount).toFixed(2).toString() } }
      : { market_market_ioc: { base_size: Number(quantity).toFixed(6).toString() } };

    const payload = {
      client_order_id: crypto.randomUUID(),
      product_id: symbol,
      side: side,
      order_configuration: orderConfig
    };

    const response = await axios.post('https://api.coinbase.com/api/v3/brokerage/orders', payload, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    console.log(`[REAL TRADE SUCCESS] ${side} ${symbol}`, response.data);
    return true;
  } catch (e) {
    console.error("[REAL TRADE ERROR] (", side, symbol, "):", e.response?.data?.message || e.message);
    return false;
  }
}

/**
 * AI CORE - SMC ANALYSIS
 */
async function getAdvancedAnalysis(symbol, price, candles) {
  if (!API_KEY) return { side: "NEUTRAL", confidence: 0, analysis: "API_KEY_MISSING", id: crypto.randomUUID(), symbol: symbol, entryPrice: price, tp: 0, sl: 0, potentialRoi: 0, timestamp: new Date().toISOString() };
  
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const history = (candles || []).slice(-30).map(c => ({ h: c.high, l: c.low, c: c.close }));
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `SMC_ANALYSIS_SCAN: ${symbol} @ ${price} EUR. HISTORY_30M: ${JSON.stringify(history)}. CURRENT_DAILY_PROFIT: ${ghostState.dailyStats.profit} EUR. DAILY_GOAL: ${ghostState.dailyStats.dailyGoal} EUR.` }] }],
      config: {
        systemInstruction: `YOU ARE THE GHOST_SMC_BOT, AN AGGRESSIVE YET CALCULATED AI TRADER.
Your goal is to reach a daily profit of 50 EUR. You must be aggressive in finding opportunities but strict with risk management.
Scan for Fair Value Gaps (FVG) and Market Structure Shifts (MSS) for short-term trades (e.g., 30 minutes).
CRITICAL: You MUST factor in exchange fees (approx 0.6% total for round trip) when calculating your Take Profit (tp) and Stop Loss (sl). Your tp MUST cover fees and still yield a profit.
If you find a high-probability setup, set a tight SL and a realistic TP.
Confidence 0-100 (Assign 75-85 for good setups, 90+ for perfect ones). PotentialRoi is a number representing percentage.
ALWAYS RETURN VALID JSON.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ['BUY', 'SELL', 'NEUTRAL'] },
            tp: { type: Type.NUMBER },
            sl: { type: Type.NUMBER },
            entryPrice: { type: Type.NUMBER },
            confidence: { type: Type.NUMBER },
            potentialRoi: { type: Type.NUMBER },
            analysis: { type: Type.STRING }
          },
          required: ['side', 'tp', 'sl', 'entryPrice', 'confidence', 'potentialRoi', 'analysis']
        },
        temperature: 0.1
      }
    });

    const result = JSON.parse(response.text?.trim() || '{}');
    return {
      side: result.side || "NEUTRAL",
      tp: Number(result.tp) || 0,
      sl: Number(result.sl) || 0,
      entryPrice: Number(result.entryPrice) || Number(price) || 0,
      confidence: Number(result.confidence) || 0,
      potentialRoi: Number(result.potentialRoi) || 0,
      analysis: result.analysis || "Observing structural gaps.",
      id: crypto.randomUUID(),
      symbol: symbol,
      timestamp: new Date().toISOString()
    };
  } catch (e) { 
    console.error("Gemini Fail:", e.message);
    return { 
      side: "NEUTRAL", tp: 0, sl: 0, entryPrice: Number(price) || 0, 
      confidence: 0, potentialRoi: 0, analysis: "Neural Link Timeout" 
    };
  }
}

function loadState() {
  const defaults = {
    isEngineActive: true, autoPilot: true, isPaperMode: false,
    settings: { confidenceThreshold: 75, defaultTradeSize: 50.0 },
    thoughts: [], executionLogs: [], activePositions: [],
    liquidity: { eur: 0, usdc: 0 }, actualBalances: {}, dailyStats: { trades: 0, profit: 0, dailyGoal: 50.0, lastResetDate: "" },
    currentStatus: "INITIALIZING", scanIndex: 0
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

// --- MIGRATION: FIX OLD SYMBOLS (e.g., SOL -> SOL-EUR) ---
if (ghostState.activePositions && ghostState.activePositions.length > 0) {
  ghostState.activePositions = ghostState.activePositions.map(pos => {
    if (pos.symbol && !pos.symbol.includes('-')) {
      console.log(`[MIGRATION] Fixing symbol: ${pos.symbol} -> ${pos.symbol}-EUR`);
      return { ...pos, symbol: `${pos.symbol}-EUR` };
    }
    return pos;
  });
}

async function loop() {
  if (!ghostState.isEngineActive) return;
  const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
  ghostState.scanIndex++;
  ghostState.currentStatus = `SNIPING_${symbol}`;
  
  try {
    const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${symbol}&tsym=EUR&limit=30`);
    const candles = res.data?.Data?.Data || [];
    if (candles.length === 0) return;
    const price = candles[candles.length - 1].close;
    
    const analysis = await getAdvancedAnalysis(symbol, price, candles);
    
    if (analysis) {
      const signal = { ...analysis, symbol, id: crypto.randomUUID(), timestamp: new Date().toISOString() };
      
      if (signal.side === 'BUY' && signal.confidence >= ghostState.settings.confidenceThreshold && ghostState.autoPilot) {
        if (!ghostState.activePositions.some((p) => p.symbol === symbol)) {
          const availableEur = ghostState.liquidity.eur;
          const tradeAmount = Math.min(ghostState.settings.defaultTradeSize, availableEur);
          
          if (tradeAmount >= 5) { 
            const qty = tradeAmount / (price || 1);
            const tradeSuccess = await executeTrade(symbol, 'BUY', tradeAmount, qty);
            
            if (tradeSuccess) {
              ghostState.activePositions.push({
                symbol, entryPrice: price || 0, currentPrice: price || 0, amount: tradeAmount,
                quantity: qty, tp: signal.tp, sl: signal.sl, confidence: signal.confidence, 
                potentialRoi: signal.potentialRoi,
                pnl: 0, pnlPercent: 0, isPaper: ghostState.isPaperMode, timestamp: new Date().toISOString()
              });
              ghostState.executionLogs.unshift({ 
                id: crypto.randomUUID(), symbol, action: 'BUY', price: price || 0, 
                status: 'SUCCESS', details: `AUTO_SMC_HIT_${signal.confidence}%`, timestamp: new Date().toISOString() 
              });
              ghostState.dailyStats.trades++;
            }
          }
        }
      }
      ghostState.thoughts.unshift(signal);
      if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();
    }
  } catch (e) {
    console.error(`[LOOP ERROR]`, e.message);
  }
  saveState();
}

async function monitor() {
  const syncSuccess = await syncCoinbaseBalance();
  
  if (syncSuccess && ghostState.actualBalances) {
    ghostState.activePositions = ghostState.activePositions.filter((p) => {
      const actualAmount = ghostState.actualBalances[p.symbol] || 0;
      return actualAmount > 0.00000001;
    });

    for (const [symbol, amount_val] of Object.entries(ghostState.actualBalances)) {
      const productId = symbol === 'EUR' || symbol === 'USDC' ? null : `${symbol}-EUR`;
      
      if (productId && WATCHLIST.includes(productId) && amount_val > 0.00000001) {
        let pos = ghostState.activePositions.find((p) => p.symbol === productId);
        if (!pos) {
          ghostState.activePositions.push({
            symbol: productId, entryPrice: 0, currentPrice: 0, amount: 0, quantity: amount_val,
            tp: 0, sl: 0, confidence: 99, potentialRoi: 0, pnl: 0, pnlPercent: 0,
            isPaper: false, timestamp: new Date().toISOString()
          });
        } else {
          pos.quantity = amount_val;
        }
      }
    }
  }

  const today = new Date().toISOString().split('T')[0];
  if (ghostState.dailyStats.lastResetDate !== today) {
    ghostState.dailyStats.profit = 0;
    ghostState.dailyStats.trades = 0;
    ghostState.dailyStats.lastResetDate = today;
  }

  if (ghostState.activePositions.length === 0) return;
  
  const symbols = ghostState.activePositions.map((p) => p.symbol).join(',');
  try {
    const res = await axios.get(`https://min-api.cryptocompare.com/data/pricemulti?fsyms=${symbols}&tsyms=EUR`);
    const prices = res.data;
    for (let i = ghostState.activePositions.length - 1; i >= 0; i--) {
      const pos = ghostState.activePositions[i];
      const curPrice = prices[pos.symbol]?.EUR;
      if (!curPrice) continue;
      
      if (pos.entryPrice === 0) {
        pos.entryPrice = curPrice;
        pos.amount = pos.quantity * curPrice;
        pos.tp = curPrice * 1.015; // Aggressive 1.5% TP for external assets
        pos.sl = curPrice * 0.96;  // 4% SL
      }

      pos.currentPrice = curPrice;
      pos.pnlPercent = ((curPrice - pos.entryPrice) / (pos.entryPrice || 1)) * 100;
      pos.pnl = (curPrice - pos.entryPrice) * pos.quantity;
      
      const isTakeProfitHit = curPrice >= pos.tp;
      const isStopLossHit = curPrice <= pos.sl;

      if (isTakeProfitHit || isStopLossHit) {
        const reason = isTakeProfitHit ? "TAKE_PROFIT" : "STOP_LOSS";
        console.log(`[TARGET HIT] ${pos.symbol} hit ${reason} at ${curPrice}. Executing liquidation...`);
        
        const tradeSuccess = await executeTrade(pos.symbol, 'SELL', 0, pos.quantity);
        
        if (tradeSuccess) {
          ghostState.dailyStats.profit += pos.pnl;
          console.log(`[PROFIT SECURED] +€${pos.pnl.toFixed(2)} from ${pos.symbol}`);
          ghostState.executionLogs.unshift({ 
            id: crypto.randomUUID(), symbol: pos.symbol, action: 'SELL', 
            price: curPrice, pnl: pos.pnl, status: 'SUCCESS', 
            details: `TARGET_${reason}_REACHED`, timestamp: new Date().toISOString() 
          });
          ghostState.activePositions.splice(i, 1);
        } else {
          console.error(`[LIQUIDATION FAILED] Could not close ${pos.symbol}. Will retry in 10s.`);
        }
      }
    }
  } catch (e) {
    console.error(`[MONITOR ERROR]`, e.message);
  }
  saveState();
}

function saveState() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {} }

monitor();
loop();
setInterval(monitor, 10000);
setInterval(loop, 30000);

app.get('/', (req, res) => res.send('🚀 NovaTrade AI Backend is Running. Use /api/ghost/state for data.'));
app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = !!req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = !!req.body.auto;
  saveState();
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 STANDALONE BACKEND RUNNING ON PORT ${PORT}`);
  console.log(`🔑 GEMINI_API: ${API_KEY ? '✅ LOADED' : '❌ MISSING'}`);
  console.log(`📡 COINBASE_KEY: ${CB_API_KEY ? '✅ LOADED' : '❌ MISSING'}`);
  console.log(`🔐 COINBASE_SECRET: ${CB_API_SECRET ? '✅ LOADED' : '❌ MISSING'}`);
});
