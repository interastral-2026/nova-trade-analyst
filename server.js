
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());

const API_KEY_NAME = "organizations/d90bac52-0e8a-4999-b156-7491091ffb5e/apiKeys/79d55457-7e62-45ad-8656-31e1d96e0571";
const PRIVATE_KEY = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIADE7F++QawcWU5iZfqmo8iupxBkqfJsFV0KsTaGpRpLoAoGCCqGSM49
AwEHoUQDQgAEhSKrrlzJxIh6hgr5fT0cZf3NO91/a6kRPkWRNG6kQlLW8FIzJ53Y
Dgbh5U2Zj3zlxHWivwVyZGMWMf8xEdxYXw==
-----END EC PRIVATE KEY-----`;

let ghostState = {
  isEngineActive: true,
  autoPilot: true, 
  signals: [],
  thoughts: [],
  managedAssets: {}, 
  currentStatus: "NOVA_CORE_STABLE",
  scanIndex: 0,
  lastNeuralSync: null
};

const WATCHLIST = ['BTC-EUR', 'ETH-EUR', 'SOL-EUR', 'AVAX-EUR', 'ADA-EUR', 'LINK-EUR'];

// --- AUTHENTICATION ---
function generateToken(method, path) {
  const header = { alg: 'ES256', kid: API_KEY_NAME, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { 
    iss: 'coinbase-cloud', nbf: now, exp: now + 60, sub: API_KEY_NAME, 
    uri: `${method} api.coinbase.com${path.split('?')[0]}` 
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const tokenData = `${encodedHeader}.${encodedPayload}`;
  try {
    const signature = crypto.sign("sha256", Buffer.from(tokenData), { key: PRIVATE_KEY, dsaEncoding: "ieee-p1363" });
    return `${tokenData}.${signature.toString('base64url')}`;
  } catch (e) { return null; }
}

async function coinbaseCall(method, path, body = null) {
  const token = generateToken(method, path);
  if (!token) throw new Error("TOKEN_GENERATION_FAILED");
  return await axios({
    method,
    url: `https://api.coinbase.com${path}`,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: body
  });
}

// --- AI STRATEGIC BRAIN ---
async function runStrategicAnalysis(symbol, price, candles, context = "NEW_ENTRY") {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `TASK: STRATEGIC_POSITION_MANAGEMENT | CONTEXT: ${context} | SYMBOL: ${symbol} | PRICE: ${price} | OHLC_WINDOW: ${JSON.stringify(candles.slice(-15))}` }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ['BUY', 'SELL', 'HOLD', 'NEUTRAL'] },
            tp: { type: Type.NUMBER, description: "Logical Take Profit based on resistance/fib" },
            sl: { type: Type.NUMBER, description: "Stop Loss based on market structure" },
            confidence: { type: Type.NUMBER },
            strategy: { type: Type.STRING, description: "Name of strategy (e.g. Mean Reversion, Breakout)" },
            reason: { type: Type.STRING, description: "Technical justification" }
          },
          required: ['side', 'tp', 'sl', 'confidence', 'strategy', 'reason']
        },
        systemInstruction: "You are NOVA_QUANT_STRATEGIST. Provide high-accuracy TP/SL levels for crypto assets. Focus on capital preservation. Use SMC logic. Output JSON."
      }
    });
    return JSON.parse(response.text);
  } catch (e) { return null; }
}

// --- CORE MASTER LOOP ---
async function masterLoop() {
  if (!ghostState.isEngineActive) return;

  try {
    // 1. استخراج موجودی‌ها و یافتن قیمت ورود از تراکنش‌ها
    const accountsRes = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    const activeHoldings = accountsRes.data.accounts.filter(a => parseFloat(a.available_balance.value) > 0.000001 && a.currency !== 'EUR');

    for (const acc of activeHoldings) {
      const symbol = `${acc.currency}-EUR`;
      try {
        // دریافت آخرین تراکنش خرید برای پیدا کردن قیمت واقعی ورود
        const fillsRes = await coinbaseCall('GET', `/api/v3/brokerage/orders/historical/fills?product_id=${symbol}&limit=5`);
        const buyFills = fillsRes.data.fills?.filter(f => f.side === 'BUY') || [];
        const entryPrice = buyFills.length > 0 ? parseFloat(buyFills[0].price) : 0;
        
        // دریافت داده‌های چارت برای تحلیل TP/SL
        const candleRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${acc.currency}&tsym=EUR&limit=24`);
        const history = candleRes.data.Data.Data;
        const currentPrice = history[history.length - 1].close;
        
        const strategy = await runStrategicAnalysis(symbol, currentPrice, history, `MANAGE_EXISTING_POS_AT_${entryPrice}`);
        
        if (strategy) {
          ghostState.managedAssets[acc.currency] = {
            entryPrice,
            currentPrice,
            tp: strategy.tp,
            sl: strategy.sl,
            strategy: strategy.strategy,
            advice: strategy.side,
            reason: strategy.reason,
            lastUpdate: new Date().toISOString()
          };
        }
      } catch (err) { console.error(`Error processing ${acc.currency}:`, err.message); }
    }

    // 2. اسکن واچ‌لیست برای سیگنال‌های جدید
    const scanSym = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${scanSym.split('-')[0]}&tsym=EUR&limit=24`);
    const hist = res.data.Data.Data;
    const price = hist[hist.length - 1].close;
    const decision = await runStrategicAnalysis(scanSym, price, hist);
    
    if (decision) {
      const sig = { ...decision, symbol: scanSym, id: crypto.randomUUID(), timestamp: new Date().toISOString() };
      ghostState.thoughts.unshift(sig);
      if (ghostState.thoughts.length > 40) ghostState.thoughts.pop();
    }

    ghostState.currentStatus = "SYSTEM_OPTIMIZED";
  } catch (e) {
    ghostState.currentStatus = "SYNC_TIMEOUT";
  }
}

setInterval(masterLoop, 45000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.get('/api/balances', async (req, res) => {
  try {
    const r = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    const bals = r.data.accounts.map(a => ({ 
      currency: a.currency, 
      total: parseFloat(a.available_balance.value || 0),
      available: parseFloat(a.available_balance.value || 0)
    })).filter(b => b.total > 0.0000001);
    res.json(bals);
  } catch (e) { res.json([]); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`[NovaServer] Listening on ${PORT}`));
