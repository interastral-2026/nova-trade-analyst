
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { GoogleGenAI, Type } from "@google/genai";
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env.local if it exists
try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
  dotenv.config(); // fallback to .env
} catch (e) {
  // dotenv not found, assuming environment variables are set externally (e.g., Railway)
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const STATE_FILE = './ghost_state.json';
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// --- ENVIRONMENT CONFIG ---
const API_KEY = process.env.API_KEY ? process.env.API_KEY.trim() : null;
const CB_API_KEY = process.env.CB_API_KEY ? process.env.CB_API_KEY.trim() : null;
const CB_API_SECRET = process.env.CB_API_SECRET ? process.env.CB_API_SECRET.replace(/\\n/g, '\n').trim() : null;

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'NEAR', 'FET'];

/**
 * GENERATE JWT FOR COINBASE CLOUD (V3 API)
 */
function generateCoinbaseJWT(request_method, request_path) {
  if (!CB_API_KEY || !CB_API_SECRET) return null;
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
  if (!token) return;

  try {
    const response = await axios.get('https://api.coinbase.com/api/v3/brokerage/accounts', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const accounts = response.data?.accounts || [];
    accounts.forEach(acc => {
      const currency = acc.currency;
      const amount = parseFloat(acc.available_balance?.value || 0);
      if (currency === 'EUR') ghostState.liquidity.eur = amount;
      if (currency === 'USDC' || currency === 'USD') ghostState.liquidity.usdc = amount;
    });
  } catch (e) {
    // Silent fail to keep app running if API is blocked/invalid
    console.warn("CB_SYNC_FAIL:", e.response?.data?.message || e.message);
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
      ? { market_market_ioc: { quote_size: Number(amount).toFixed(2).toString() } } // Buy with EUR (2 decimals)
      : { market_market_ioc: { base_size: Number(quantity).toFixed(6).toString() } }; // Sell crypto (6 decimals)

    const payload = {
      client_order_id: crypto.randomUUID(),
      product_id: `${symbol}-EUR`,
      side: side,
      order_configuration: orderConfig
    };

    const response = await axios.post('https://api.coinbase.com/api/v3/brokerage/orders', payload, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    console.log(`[REAL TRADE SUCCESS] ${side} ${symbol}`, response.data);
    return true;
  } catch (e) {
    console.error(`[REAL TRADE ERROR] (${side} ${symbol}):`, e.response?.data?.message || e.message);
    if (e.response?.data) console.error("Coinbase API Response:", JSON.stringify(e.response.data));
    return false;
  }
}

/**
 * AI CORE - SMC ANALYSIS (FIXED FOR "AI ANALYSIS ERROR")
 */
async function getAdvancedAnalysis(symbol, price, candles) {
  if (!API_KEY) return { side: "NEUTRAL", confidence: 0, analysis: "API_KEY_MISSING" };
  
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

    const result = JSON.parse(response.text.trim());
    return {
      side: result.side || "NEUTRAL",
      tp: Number(result.tp) || 0,
      sl: Number(result.sl) || 0,
      entryPrice: Number(result.entryPrice) || Number(price) || 0,
      confidence: Number(result.confidence) || 0,
      potentialRoi: Number(result.potentialRoi) || 0,
      analysis: result.analysis || "Observing structural gaps."
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
    isEngineActive: true, autoPilot: true, isPaperMode: false, // Set to false to enable real trading
    settings: { confidenceThreshold: 80, defaultTradeSize: 50.0 },
    thoughts: [], executionLogs: [], activePositions: [],
    liquidity: { eur: 0, usdc: 0 }, dailyStats: { trades: 0, profit: 0, dailyGoal: 50.0 },
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
ghostState.isPaperMode = false; // FORCE REAL TRADING ALWAYS
ghostState.settings.confidenceThreshold = 75; // Lowered to 75% so user can test real trades

async function loop() {
  if (!ghostState.isEngineActive) return;
  const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
  ghostState.scanIndex++;
  ghostState.currentStatus = `SNIPING_${symbol}`;
  
  try {
    // Fetch 30-minute candles for short-term analysis
    const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${symbol}&tsym=EUR&limit=30`);
    const candles = res.data?.Data?.Data || [];
    if (candles.length === 0) return;
    const price = candles[candles.length - 1].close;
    
    const analysis = await getAdvancedAnalysis(symbol, price, candles);
    
    if (analysis) {
      const signal = { ...analysis, symbol, id: crypto.randomUUID(), timestamp: new Date().toISOString() };
      
      // AUTO-EXECUTION (SMC PROTOCOL)
      if (signal.side === 'BUY' && signal.confidence >= ghostState.settings.confidenceThreshold && ghostState.autoPilot) {
        if (!ghostState.activePositions.some(p => p.symbol === symbol)) {
          
          // Use the available EUR balance or the default trade size, whichever is smaller
          const availableEur = ghostState.liquidity.eur;
          const tradeAmount = Math.min(ghostState.settings.defaultTradeSize, availableEur);
          
          if (tradeAmount >= 5) { // Minimum trade size for Coinbase is usually around 5 EUR
            const qty = tradeAmount / (price || 1);
            
            // Execute real trade
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
            } else {
              ghostState.executionLogs.unshift({ 
                id: crypto.randomUUID(), symbol, action: 'BUY', price: price || 0, 
                status: 'FAILED', details: `API_EXECUTION_FAILED`, timestamp: new Date().toISOString() 
              });
            }
          } else {
             ghostState.executionLogs.unshift({ 
                id: crypto.randomUUID(), symbol, action: 'BUY', price: price || 0, 
                status: 'FAILED', details: `INSUFFICIENT_EUR_BALANCE`, timestamp: new Date().toISOString() 
              });
          }
        }
      }
      ghostState.thoughts.unshift(signal);
      if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();
    }
  } catch (e) {}
  saveState();
}

async function monitor() {
  await syncCoinbaseBalance();
  if (ghostState.activePositions.length === 0) return;
  
  const symbols = ghostState.activePositions.map(p => p.symbol).join(',');
  try {
    const res = await axios.get(`https://min-api.cryptocompare.com/data/pricemulti?fsyms=${symbols}&tsyms=EUR`);
    const prices = res.data;
    for (let i = ghostState.activePositions.length - 1; i >= 0; i--) {
      const pos = ghostState.activePositions[i];
      const curPrice = prices[pos.symbol]?.EUR;
      if (!curPrice) continue;
      
      pos.currentPrice = curPrice;
      pos.pnlPercent = ((curPrice - pos.entryPrice) / (pos.entryPrice || 1)) * 100;
      pos.pnl = (curPrice - pos.entryPrice) * pos.quantity;
      
      if (curPrice >= pos.tp || curPrice <= pos.sl) {
        // Execute real sell trade
        const tradeSuccess = await executeTrade(pos.symbol, 'SELL', 0, pos.quantity);
        
        if (tradeSuccess) {
          ghostState.dailyStats.profit += pos.pnl;
          ghostState.executionLogs.unshift({ 
            id: crypto.randomUUID(), symbol: pos.symbol, action: 'SELL', 
            price: curPrice, pnl: pos.pnl, status: 'SUCCESS', timestamp: new Date().toISOString() 
          });
          ghostState.activePositions.splice(i, 1);
        } else {
          ghostState.executionLogs.unshift({ 
            id: crypto.randomUUID(), symbol: pos.symbol, action: 'SELL', 
            price: curPrice, pnl: pos.pnl, status: 'FAILED', details: 'API_EXECUTION_FAILED', timestamp: new Date().toISOString() 
          });
        }
      }
    }
  } catch (e) {}
  saveState();
}

function saveState() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {} }

setInterval(monitor, 5000);
setInterval(loop, 12000);

// Self-ping to keep the server alive on platforms like Railway/Heroku
setInterval(() => {
  axios.get(`http://localhost:${PORT}/api/ghost/state`).catch(() => {});
}, 5 * 60 * 1000); // Every 5 minutes

// Autonomous background logging
setInterval(() => {
  if (ghostState.isEngineActive) {
    console.log(`[AUTONOMOUS AI] 🤖 Running in background... Active Positions: ${ghostState.activePositions.length} | Daily Profit: €${ghostState.dailyStats.profit.toFixed(2)} / €${ghostState.dailyStats.dailyGoal}`);
  }
}, 60000); // Log every 1 minute

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  if (req.body.engine !== undefined) ghostState.isEngineActive = !!req.body.engine;
  if (req.body.auto !== undefined) ghostState.autoPilot = !!req.body.auto;
  saveState();
  res.json({ success: true });
});

// Serve static files in production
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n💎 NOVA PREDATOR V35 - QUANTUM SYNC`);
  console.log(`📡 COINBASE CLOUD ACCOUNT: ${CB_API_KEY ? CB_API_KEY.slice(0, 20) + '...' : 'NOT CONFIGURED'}`);
  console.log(`🔥 AUTO-SNIPER: ENABLED (SMC 80%+)\n`);
});
