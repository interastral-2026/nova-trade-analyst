
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

const STABLECOINS = ['USDC', 'EURC', 'USDT', 'DAI', 'PYUSD'];

let ghostState = {
  isEngineActive: true,
  autoPilot: true, 
  signals: [],
  thoughts: [],
  managedAssets: {}, 
  currentStatus: "NOVA_CORE_STABLE",
  scanIndex: 0
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

// --- AI ENGINE ---
async function runStrategicAnalysis(symbol, price, candles, context) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `TASK: POSITION_STRATEGY | SYMBOL: ${symbol} | PRICE: ${price} | CONTEXT: ${context} | DATA: ${JSON.stringify(candles.slice(-10))}` }] }],
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
        systemInstruction: "You are the QUANT_STRATEGIST. Provide precise exit/hold strategies. JSON ONLY."
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
      const curr = acc.currency;
      const symbol = `${curr}-EUR`;

      // 1. Instant Data Refresh (Avoid "Detecting")
      try {
        let marketData = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${curr}&tsym=EUR&limit=24`).catch(() => null);
        if (!marketData || !marketData.data?.Data?.Data) {
            marketData = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${curr}&tsym=USD&limit=24`).catch(() => null);
        }

        const history = marketData?.data?.Data?.Data || [];
        const currentPrice = history.length > 0 ? history[history.length - 1].close : 0;

        // Fetch Entry
        const fillsRes = await coinbaseCall('GET', `/api/v3/brokerage/orders/historical/fills?product_id=${symbol}&limit=5`).catch(() => null);
        const buyFills = fillsRes?.data?.fills?.filter(f => f.side === 'BUY') || [];
        const entryPrice = buyFills.length > 0 ? parseFloat(buyFills[0].price) : currentPrice;

        // Populate basic info immediately if not already present
        if (!ghostState.managedAssets[curr]) {
            ghostState.managedAssets[curr] = {
                currency: curr,
                entryPrice: entryPrice || 0,
                currentPrice: currentPrice || 0,
                amount: parseFloat(acc.available_balance.value)
            };
        } else {
            ghostState.managedAssets[curr].currentPrice = currentPrice;
            ghostState.managedAssets[curr].amount = parseFloat(acc.available_balance.value);
        }

        // 2. Special Logic for Stablecoins (No AI needed)
        if (STABLECOINS.includes(curr)) {
            ghostState.managedAssets[curr] = {
                ...ghostState.managedAssets[curr],
                tp: currentPrice * 1.001,
                sl: currentPrice * 0.995,
                strategy: "STABLE_LIQUIDITY",
                advice: "HOLD",
                reason: "Stable asset detected. Capital preservation mode active.",
                lastSync: new Date().toISOString()
            };
            continue;
        }

        // 3. AI Analysis for Volatile Assets
        if (currentPrice > 0) {
            const strategy = await runStrategicAnalysis(symbol, currentPrice, history, `WALLET_NODE_${curr}`);
            if (strategy) {
                ghostState.managedAssets[curr] = {
                    ...ghostState.managedAssets[curr],
                    tp: strategy.tp,
                    sl: strategy.sl,
                    strategy: strategy.strategy,
                    advice: strategy.side,
                    reason: strategy.reason,
                    lastSync: new Date().toISOString()
                };
            }
        }
      } catch (e) {
        console.error(`Error processing ${curr}:`, e.message);
      }
    }

    ghostState.currentStatus = "PULSE_OPTIMIZED";
  } catch (e) {
    ghostState.currentStatus = "CORE_SYNC_ERR";
  }
}

setInterval(masterLoop, 35000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.get('/api/balances', async (req, res) => {
  try {
    const r = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    res.json(r.data.accounts.map(a => ({ 
      currency: a.currency, 
      total: parseFloat(a.available_balance.value || 0)
    })).filter(b => b.total > 0.0000001));
  } catch (e) { res.json([]); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`STRATEGIC_BRIDGE_UP_${PORT}`));
