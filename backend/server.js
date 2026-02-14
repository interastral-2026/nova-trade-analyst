
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
  logs: [],
  thoughts: [],
  managedPositions: [], 
  lastScan: null,
  currentStatus: "CORE_V2.1_READY",
  scanIndex: 0
};

const WATCHLIST = ['BTC-EUR', 'ETH-EUR', 'SOL-EUR', 'AVAX-EUR', 'ADA-EUR', 'LINK-EUR'];

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
    method, url: `https://api.coinbase.com${path}`,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: body
  });
}

async function performScan(symbol) {
  if (!ghostState.isEngineActive) return;
  ghostState.currentStatus = `PROBING_${symbol}`;

  try {
    const [candleRes, balRes, tickRes] = await Promise.all([
      coinbaseCall('GET', `/api/v3/brokerage/products/${symbol}/candles?granularity=ONE_HOUR&limit=30`),
      coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250'),
      coinbaseCall('GET', `/api/v3/brokerage/products/${symbol}`)
    ]);

    const candles = candleRes.data.candles || [];
    const currentPrice = parseFloat(tickRes.data.price);
    const existing = ghostState.managedPositions.find(p => p.symbol === symbol);

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const callAI = async (retries = 3, delay = 2000) => {
      try {
        return await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: [{ parts: [{ text: `NODE_INTEL: ${JSON.stringify({ symbol, currentPrice, candles: candles.slice(0, 15), managed: existing })}` }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                side: { type: Type.STRING, enum: ['BUY', 'SELL', 'NEUTRAL'] },
                tp: { type: Type.NUMBER },
                sl: { type: Type.NUMBER },
                confidence: { type: Type.NUMBER },
                analysis: { type: Type.STRING }
              },
              required: ['side', 'confidence', 'analysis', 'tp', 'sl']
            },
            systemInstruction: `YOU ARE GHOST_CORE. Output strict JSON.`
          }
        });
      } catch (e) {
        if (retries > 0 && (e.message.includes("503") || e.message.toLowerCase().includes("overloaded"))) {
          await new Promise(r => setTimeout(r, delay));
          return callAI(retries - 1, delay * 2);
        }
        throw e;
      }
    };

    const response = await callAI();
    const result = JSON.parse(response.text);
    const signal = { ...result, symbol, timestamp: new Date().toISOString(), id: crypto.randomUUID() };
    ghostState.thoughts.unshift(signal);
    if (result.side !== 'NEUTRAL') ghostState.signals.unshift(signal);
    ghostState.lastScan = new Date().toISOString();
  } catch (e) {
    console.error("Heartbeat Error:", e.message);
  } finally {
    ghostState.currentStatus = "SCANNING_PULSE_IDLE";
  }
}

setInterval(() => {
  const sym = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
  performScan(sym);
  ghostState.scanIndex++;
}, 45000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.get('/api/balances', async (req, res) => {
  try {
    const r = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    res.json(r.data.accounts.map(a => ({ 
      currency: a.currency, 
      total: parseFloat(a.available_balance.value || 0) 
    })).filter(b => b.total > 0));
  } catch (e) { res.json([]); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`SERVER_ON_${PORT}`));
