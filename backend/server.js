
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
  currentStatus: "CORE_ACTIVE",
  scanIndex: 0
};

const WATCHLIST = ['BTC-EUR', 'ETH-EUR', 'SOL-EUR', 'AVAX-EUR', 'ADA-EUR', 'LINK-EUR'];

// --- COINBASE AUTH ---
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
    return `${tokenData}.${crypto.sign("sha256", Buffer.from(tokenData), { key: PRIVATE_KEY, dsaEncoding: "ieee-p1363" }).toString('base64url')}`;
  } catch (e) { return null; }
}

async function coinbaseCall(method, path, body = null) {
  const token = generateToken(method, path);
  return await axios({
    method,
    url: `https://api.coinbase.com${path}`,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: body
  });
}

// --- AI CORE ---
async function runStrategicAnalysis(symbol, price, candles, context) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `TASK: STRATEGIC_POSITION_ANALYSIS | SYMBOL: ${symbol} | PRICE: ${price} | CONTEXT: ${context} | DATA: ${JSON.stringify(candles.slice(-10))}` }] }],
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
        systemInstruction: "You are the QUANT_STRATEGIST. Provide precise exit/hold strategies. For stablecoins, prioritize capital preservation. JSON ONLY."
      }
    });
    return JSON.parse(response.text);
  } catch (e) { return null; }
}

// --- MASTER LOOP (THE BRAIN) ---
async function masterLoop() {
  if (!ghostState.isEngineActive) return;

  try {
    // 1. Get ALL accounts from Coinbase
    const accountsRes = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    const allAccounts = accountsRes.data.accounts || [];
    const activeAccounts = allAccounts.filter(a => parseFloat(a.available_balance.value) > 0.000001 && a.currency !== 'EUR');

    ghostState.currentStatus = `ANALYZING_${activeAccounts.length}_ASSETS`;

    for (const acc of activeAccounts) {
      const currency = acc.currency;
      const symbol = `${currency}-EUR`;

      try {
        // Fetch Market Data (Fallback to EUR if possible, else USDT/USD)
        let priceRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${currency}&tsym=EUR&limit=24`).catch(() => null);
        
        // If EUR pair not found, try USD
        if (!priceRes || !priceRes.data?.Data?.Data) {
            priceRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${currency}&tsym=USD&limit=24`).catch(() => null);
        }

        const history = priceRes?.data?.Data?.Data || [];
        const currentPrice = history.length > 0 ? history[history.length - 1].close : 0;

        // Fetch Entry Price from Fills
        const fillsRes = await coinbaseCall('GET', `/api/v3/brokerage/orders/historical/fills?product_id=${symbol}&limit=5`).catch(() => ({ data: { fills: [] } }));
        const buyFills = fillsRes.data?.fills?.filter(f => f.side === 'BUY') || [];
        
        // Logical Entry Price: If we have fills, use last buy. If not, use current price as reference.
        const entryPrice = buyFills.length > 0 ? parseFloat(buyFills[0].price) : currentPrice;

        // Run AI Analysis only if we have a valid price
        if (currentPrice > 0) {
          const analysis = await runStrategicAnalysis(symbol, currentPrice, history, `WALLET_NODE_${currency}_ENTRY_${entryPrice}`);
          
          if (analysis) {
            ghostState.managedAssets[currency] = {
              currency,
              entryPrice,
              currentPrice,
              tp: analysis.tp,
              sl: analysis.sl,
              strategy: analysis.strategy,
              advice: analysis.side,
              reason: analysis.reason,
              amount: parseFloat(acc.available_balance.value),
              lastSync: new Date().toISOString()
            };
          }
        } else {
            // Handle cases like EURC where price is basically 1
            ghostState.managedAssets[currency] = {
                currency,
                entryPrice: entryPrice || 1.0,
                currentPrice: 1.0,
                strategy: "STABLE_PRESERVATION",
                advice: "HOLD",
                reason: "Stable asset detected. Maintaining liquidity.",
                amount: parseFloat(acc.available_balance.value),
                lastSync: new Date().toISOString()
            };
        }
      } catch (err) {
        console.error(`Failed to process ${currency}:`, err.message);
      }
    }

    // Secondary: Scan watchlist for new opportunities
    const scanTarget = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    const scanCandles = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${scanTarget.split('-')[0]}&tsym=EUR&limit=24`).catch(() => null);
    if (scanCandles?.data?.Data?.Data) {
      const hist = scanCandles.data.Data.Data;
      const price = hist[hist.length - 1].close;
      const decision = await runStrategicAnalysis(scanTarget, price, hist, "WATCHLIST_SCAN");
      if (decision && decision.side !== 'NEUTRAL') {
        ghostState.thoughts.unshift({ ...decision, symbol: scanTarget, timestamp: new Date().toISOString(), id: crypto.randomUUID() });
        if (ghostState.thoughts.length > 30) ghostState.thoughts.pop();
      }
    }

    ghostState.currentStatus = "PULSE_OPTIMIZED";
  } catch (e) {
    console.error("Master Loop Error:", e.message);
    ghostState.currentStatus = "CORE_SYNC_ERR";
  }
}

// Run every 40 seconds to stay within API limits but keep data fresh
setInterval(masterLoop, 40000);

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
    res.json(r.data.accounts.map(a => ({ 
      currency: a.currency, 
      total: parseFloat(a.available_balance.value || 0),
      available: parseFloat(a.available_balance.value || 0)
    })).filter(b => b.total > 0.0000001));
  } catch (e) { res.json([]); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`SYSTEM_RUNNING_ON_${PORT}`));
