
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

// لیست ارزهایی که باید با دقت بالا مانیتور شوند
const PRIORITY_NODES = ['BTC', 'ETH', 'USDC', 'SOL', 'ADA', 'LINK', 'EURC'];

let ghostState = {
  isEngineActive: true,
  autoPilot: true, 
  signals: [],
  thoughts: [],
  managedAssets: {}, 
  executedOrders: [], // ذخیره تاریخچه سفارشات ربات برای ماندگاری در طول اجرای سرور
  currentStatus: "NOVA_CORE_ONLINE",
  scanIndex: 0
};

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

// --- AI BRAIN (Gemini 3 Pro) ---
async function runNeuralAnalysis(symbol, price, history, context) {
  if (!process.env.API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `ANALYZE_ASSET: ${symbol} | PRICE: ${price} | RECENT_DATA: ${JSON.stringify(history.slice(-10))} | CONTEXT: ${context}` }] }],
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
        systemInstruction: "You are the QUANTUM_OVERLORD. If confidence > 88%, issue a clear BUY or SELL signal. Calculate TP/SL precisely."
      }
    });
    return JSON.parse(response.text);
  } catch (e) { return null; }
}

// --- ASSET PROCESSOR ---
async function processAssetNode(acc) {
  const curr = acc.currency;
  const amount = parseFloat(acc.available_balance.value);
  if (amount < 0.00000001 && !PRIORITY_NODES.includes(curr)) return;

  try {
    // 1. دریافت قیمت لحظه‌ای با چند لایه پشتیبان (فیکس برای ETH و USDC)
    let currentPrice = 0;
    try {
      const pRes = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${curr}&tsyms=EUR,USD`);
      currentPrice = pRes.data.EUR || (pRes.data.USD ? pRes.data.USD * 0.94 : (curr === 'USDC' ? 0.94 : 0));
    } catch (e) {
      if (curr === 'USDC') currentPrice = 0.94; // تخمین پایه برای USDC
    }

    if (currentPrice === 0) return;

    // 2. همگام‌سازی قیمت خرید (Entry)
    let entryPrice = 0;
    try {
      const fills = await coinbaseCall('GET', `/api/v3/brokerage/orders/historical/fills?product_id=${curr}-EUR&limit=1`);
      if (fills.data?.fills?.length > 0) {
        entryPrice = parseFloat(fills.data.fills[0].price);
      }
    } catch (e) {}
    
    // اگر قیمت خرید پیدا نشد، قیمت فعلی را مرجع قرار بده
    if (entryPrice <= 0) entryPrice = currentPrice;

    // 3. آپدیت وضعیت در managedAssets (نمایش آنی در فرانت‌-اند)
    ghostState.managedAssets[curr] = {
      ...ghostState.managedAssets[curr],
      currency: curr,
      amount,
      currentPrice,
      entryPrice,
      lastSync: new Date().toISOString()
    };

    // 4. تحلیل هوشمند (AI)
    const hRes = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${curr}&tsym=EUR&limit=12`).catch(() => null);
    const history = hRes?.data?.Data?.Data || [];
    
    const analysis = await runNeuralAnalysis(curr, currentPrice, history, `HOLDING_NODE_${curr}`);
    
    if (analysis) {
      ghostState.managedAssets[curr] = {
        ...ghostState.managedAssets[curr],
        ...analysis
      };

      // 5. اجرای خودکار (قانون ۸۸٪)
      if (ghostState.autoPilot && analysis.confidence >= 88 && (analysis.side === 'BUY' || analysis.side === 'SELL')) {
        const orderId = crypto.randomUUID();
        const orderLog = {
          id: orderId,
          symbol: curr,
          side: analysis.side,
          price: currentPrice,
          amount: analysis.side === 'SELL' ? amount : (10 / currentPrice), // تست با مقدار کوچک ۱۰ یورو برای خرید
          confidence: analysis.confidence,
          timestamp: new Date().toISOString(),
          status: 'EXECUTED_BY_AI'
        };
        
        // در محیط پروداکشن اینجا دستور واقعی صادر می‌شود
        // await coinbaseCall('POST', '/api/v3/brokerage/orders', { ... });
        
        ghostState.executedOrders.unshift(orderLog);
        console.log(`[!] AI_AUTO_TRADE: ${curr} ${analysis.side} at ${analysis.confidence}% confidence.`);
      }
    }
  } catch (err) {
    console.error(`Node Processor Error [${curr}]:`, err.message);
  }
}

// --- MASTER LOOP ---
async function masterLoop() {
  if (!ghostState.isEngineActive) return;

  try {
    ghostState.currentStatus = "SYNCING_COINBASE_PORTFOLIO";
    const accountsRes = await coinbaseCall('GET', '/api/v3/brokerage/accounts?limit=250');
    const allAccounts = accountsRes.data.accounts || [];

    // همگام‌سازی دارایی‌ها به صورت موازی
    await Promise.allSettled(allAccounts.map(acc => processAssetNode(acc)));

    ghostState.currentStatus = "NEURAL_MONITORING_ACTIVE";
  } catch (e) {
    ghostState.currentStatus = "CORE_BRIDGE_TIMEOUT";
  }
}

setInterval(masterLoop, 30000);

app.get('/api/ghost/state', (req, res) => res.json(ghostState));
app.post('/api/ghost/toggle', (req, res) => {
  const { engine, auto } = req.body;
  if (engine !== undefined) ghostState.isEngineActive = engine;
  if (auto !== undefined) ghostState.autoPilot = auto;
  res.json({ success: true });
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`SYSTEM_UP_AND_SYNCED:${PORT}`));
