
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

// --- AI ANALYST ---
async function runStrategicAnalysis(symbol, price, candles, context = "NEW_ENTRY") {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `TASK: STRATEGIC_ANALYSIS | SYMBOL: ${symbol} | PRICE: ${price} | CONTEXT: ${context} | DATA: ${JSON.stringify(candles.slice(-15))}` }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ['BUY', 'SELL', 'HOLD', 'NEUTRAL'] },
            tp: { type: Type.NUMBER },
            sl: { type: Type.NUMBER },
            confidence: { type: Type.NUMBER },
            strategy: { type: Type.STRING },
            reason: { type: Type.STRING }
          },
          required: ['side', 'tp', 'sl', 'confidence', 'strategy', 'reason']
        },
        systemInstruction: "You are the QUANT_STRATEGIST. Provide precise TP/SL for assets. For stablecoins or pegged assets, be conservative. JSON ONLY."
      }
    });
    return JSON.parse(response.text);
  } catch (e) { return null; }
}

// --- MASTER LOOP ---
async function masterLoop() {
  if (!ghostState.isEngineActive) return;

  try {
    const accountsRes = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    const activeAccounts = accountsRes.data.accounts.filter(a => parseFloat(a.available_balance.value) > 0.000001 && a.currency !== 'EUR');

    for (const acc of activeAccounts) {
      const symbol = `${acc.currency}-EUR`;
      try {
        // Fetch Current Market Price first
        const candleRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${acc.currency}&tsym=EUR&limit=24`).catch(() => ({ data: {} }));
        
        // Fix: Robust check for nested data
        const history = candleRes.data?.Data?.Data || [];
        const currentPrice = history.length > 0 ? history[history.length - 1].close : 0;

        // Fetch Entry Price
        const fillsRes = await coinbaseCall('GET', `/api/v3/brokerage/orders/historical/fills?product_id=${symbol}&limit=5`).catch(() => ({ data: { fills: [] } }));
        const buyFills = fillsRes.data?.fills?.filter(f => f.side === 'BUY') || [];
        // If no fill found, use current price as fallback entry price to enable analysis
        const entryPrice = buyFills.length > 0 ? parseFloat(buyFills[0].price) : currentPrice;

        if (currentPrice > 0) {
          const strategy = await runStrategicAnalysis(symbol, currentPrice, history, `WALLET_POS_ENTRY_${entryPrice}`);
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
        } else {
          // If no market price (like EURC on some pairs), set a basic entry from fill if possible
          ghostState.managedAssets[acc.currency] = {
            entryPrice: entryPrice || 1.00,
            currentPrice: 1.00,
            status: "PRICE_SOURCE_WAITING"
          };
        }
      } catch (err) {
        console.error(`[Process Error] ${acc.currency}:`, err.message);
      }
    }

    // Watchlist Scanning
    const scanSym = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    const scanRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${scanSym.split('-')[0]}&tsym=EUR&limit=24`).catch(() => ({ data: {} }));
    const scanHist = scanRes.data?.Data?.Data || [];
    if (scanHist.length > 0) {
      const price = scanHist[scanHist.length - 1].close;
      const decision = await runStrategicAnalysis(scanSym, price, scanHist);
      if (decision) {
        ghostState.thoughts.unshift({ ...decision, symbol: scanSym, id: crypto.randomUUID(), timestamp: new Date().toISOString() });
        if (ghostState.thoughts.length > 40) ghostState.thoughts.pop();
      }
    }

    ghostState.currentStatus = "PULSE_OPTIMIZED";
  } catch (e) {
    ghostState.currentStatus = "SYNC_ERROR";
  }
}

setInterval(masterLoop, 45000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  const { engine, auto } = req.body;
  if (engine !== undefined) ghostState.isEngineActive = engine;
  if (auto !== undefined) ghostState.autoPilot = auto;
  res.json({ success: true });
});

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
app.listen(PORT, '0.0.0.0', () => console.log(`STRATEGIC_CORE_ACTIVE_ON_${PORT}`));
