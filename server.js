
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

// --- PERSISTENCE LAYER ---
function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); } catch (e) {}
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {}
  return null;
}

const API_KEY_NAME = "organizations/d90bac52-0e8a-4999-b156-7491091ffb5e/apiKeys/79d55457-7e62-45ad-8656-31e1d96e0571";
const PRIVATE_KEY = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIADE7F++QawcWU5iZfqmo8iupxBkqfJsFV0KsTaGpRpLoAoGCCqGSM49
AwEHoUQDQgAEhSKrrlzJxIh6hgr5fT0cZf3NO91/a6kRPkWRNG6kQlLW8FIzJ53Y
Dgbh5U2Zj3zlxHWivwVyZGMWMf8xEdxYXw==
-----END EC PRIVATE KEY-----`;

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'LINK', 'DOT', 'MATIC'];
const TAKER_FEE = 0.006; 

let ghostState = loadState() || {
  isEngineActive: true,
  autoPilot: true,
  thoughts: [],
  managedAssets: {}, 
  executionLogs: [], 
  currentStatus: "PREDATOR_READY",
  scanIndex: 0,
  liquidity: { eur: 0, usdc: 0 },
  dailyStats: { trades: 0, profit: 0, fees: 0 }
};

// --- AUTH ---
function generateToken(method, path) {
  try {
    const header = { alg: 'ES256', kid: API_KEY_NAME, typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: 'coinbase-cloud', nbf: now, exp: now + 60, sub: API_KEY_NAME, uri: `${method} api.coinbase.com${path.split('?')[0]}` };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const tokenData = `${encodedHeader}.${encodedPayload}`;
    return `${tokenData}.${crypto.sign("sha256", Buffer.from(tokenData), { key: PRIVATE_KEY, dsaEncoding: "ieee-p1363" }).toString('base64url')}`;
  } catch (e) { return null; }
}

async function coinbaseCall(method, path, body = null) {
  const token = generateToken(method, path);
  if (!token) return null;
  return await axios({ method, url: `https://api.coinbase.com${path}`, headers: { 'Authorization': `Bearer ${token}` }, data: body, timeout: 15000 }).catch(() => null);
}

// --- AI BRAIN ---
async function runEliteScan(symbol, price) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `PREDATOR_ANALYSIS: ${symbol} @ ${price}. Current Liquidity: ${ghostState.liquidity.eur} EUR.` }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ['BUY', 'SELL', 'HOLD'] },
            tp: { type: Type.NUMBER },
            sl: { type: Type.NUMBER },
            confidence: { type: Type.NUMBER },
            reason: { type: Type.STRING },
            thoughtProcess: { type: Type.STRING }
          },
          required: ['side', 'tp', 'sl', 'confidence', 'reason', 'thoughtProcess']
        },
        systemInstruction: "You are NOVA_ELITE_PREDATOR. Spot Smart Money moves and avoid exchange traps. Set TP at 85% of target. Account for 0.6% fees. Only >80% signals. Return JSON only."
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (e) { return null; }
}

async function masterLoop() {
  if (!ghostState.isEngineActive) return;
  try {
    const accRes = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=50');
    if (accRes?.data?.accounts) {
      accRes.data.accounts.forEach(a => {
        const v = parseFloat(a.available_balance?.value || "0");
        if (a.currency === 'EUR') ghostState.liquidity.eur = v;
        if (a.currency === 'USDC') ghostState.liquidity.usdc = v;
      });
    }

    const symbol = WATCHLIST[ghostState.scanIndex % WATCHLIST.length];
    ghostState.scanIndex++;
    
    const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=EUR`);
    const price = pRes.data.EUR;

    const analysis = await runEliteScan(symbol, price);
    if (analysis && analysis.confidence >= 80) {
      const signal = { ...analysis, symbol, timestamp: new Date().toISOString(), price, id: crypto.randomUUID() };
      ghostState.thoughts.unshift(signal);
      ghostState.thoughts = ghostState.thoughts.slice(0, 50);

      if (ghostState.autoPilot && analysis.confidence >= 85 && analysis.side === 'BUY' && ghostState.liquidity.eur > 50) {
        const amount = Math.min(ghostState.liquidity.eur * 0.3, 300);
        const res = await coinbaseCall('POST', '/api/v3/brokerage/orders', {
          client_order_id: crypto.randomUUID(),
          product_id: `${symbol}-EUR`,
          side: 'BUY',
          order_configuration: { market_market_ioc: { quote_size: amount.toString() } }
        });
        if (res?.data?.success) {
          ghostState.executionLogs.unshift({ id: crypto.randomUUID(), symbol, action: 'BUY', amount, price, timestamp: new Date().toISOString(), status: 'AUTO_EXECUTED', fees: amount * TAKER_FEE, thought: analysis.reason });
          ghostState.dailyStats.trades++;
          ghostState.dailyStats.fees += amount * TAKER_FEE;
        }
      }
    }
    ghostState.currentStatus = `HUNTING_${symbol}_LIQUIDITY`;
    saveState();
  } catch (e) { ghostState.currentStatus = "ENGINE_RETRYING"; }
}

setInterval(masterLoop, 20000);
app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  const { engine, auto } = req.body;
  if (engine !== undefined) ghostState.isEngineActive = engine;
  if (auto !== undefined) ghostState.autoPilot = auto;
  saveState();
  res.json({ success: true });
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`PREDATOR_CORE_V3_ONLINE:${PORT}`));
