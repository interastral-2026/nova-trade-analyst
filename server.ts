
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const envPaths = [
  path.join(process.cwd(), '.env.local'),
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '.env.local'),
  path.join(__dirname, '.env')
];

envPaths.forEach(envPath => {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log(`[ENV] Successfully loaded: ${envPath}`);
  }
});

const CB_API_KEY = (process.env.CB_API_KEY || "").trim();
const CB_API_SECRET = process.env.CB_API_SECRET 
  ? process.env.CB_API_SECRET.replace(/^"|"$/g, '').replace(/\\n/g, '\n').trim() 
  : "";

const WATCHLIST = ['SOL', 'AVAX', 'LINK', 'NEAR', 'MATIC', 'XRP', 'DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK', 'FLOKI', 'RNDR', 'INJ', 'FET', 'TIA'];
const STATE_FILE = './ghost_state.json';
const FEE_RATE = 0.008; // 0.8% round-trip fee (0.4% buy + 0.4% sell)
const MIN_HOLD_TIME_MS = 10 * 60 * 1000; // 10 minutes minimum hold time
const TRADE_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes cooldown between trades for same symbol

let availableEurPairs: string[] = [];
const lastTradeTime: Record<string, number> = {};
const pendingAnalysis: any[] = [];

// --- TRADING ENGINE LOGIC ---

let isScanning = false;
let isMonitoring = false;
let isAiMonitoring = false;

async function listAvailableProducts() {
  const token = generateCoinbaseJWT('GET', '/api/v3/brokerage/products');
  if (!token) return;
  try {
    const response = await axios.get('https://api.coinbase.com/api/v3/brokerage/products?product_type=SPOT', {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000
    });
    const products = response.data?.products || [];
    availableEurPairs = products
      .filter(p => p.quote_currency_id === 'EUR' && p.is_disabled === false)
      .map(p => p.product_id);
    console.log("--------------------------------------------------");
    console.log("✅ VALID EUR TRADING PAIRS FOR YOUR ACCOUNT:");
    console.log(availableEurPairs.join(', '));
    console.log("--------------------------------------------------");
  } catch (e: any) {
    console.warn("[PRODUCTS ERROR] Could not fetch valid pairs:", e.message);
  }
}

function generateCoinbaseJWT(request_method, request_path) {
  if (!CB_API_KEY || !CB_API_SECRET) return null;
  try {
    const request_host = 'api.coinbase.com';
    // Strip query parameters for the JWT uri claim as per Coinbase CDP best practices
    const pathWithoutQuery = request_path.split('?')[0];
    const uri = request_method + ' ' + request_host + pathWithoutQuery;
    
    const payload = {
      iss: "cdp",
      nbf: Math.floor(Date.now() / 1000) - 10, // 10 seconds in the past to avoid clock skew
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
  } catch (e: any) {
    console.error("JWT Error:", e.message);
    return null;
  }
}

async function syncCoinbaseBalance() {
  if (ghostState.isPaperMode) {
    if (ghostState.liquidity.eur < 10) ghostState.liquidity.eur = 1000; // Auto-refill paper money
    if (ghostState.liquidity.usdc < 10) ghostState.liquidity.usdc = 1000;
    return true;
  }

  const token = generateCoinbaseJWT('GET', '/api/v3/brokerage/accounts');
  if (!token) return false;
  try {
    // Increase limit to 250 to ensure we get all accounts
    const response = await axios.get('https://api.coinbase.com/api/v3/brokerage/accounts?limit=250', {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000
    });
    const accounts = response.data?.accounts || [];
    const newBalances = {}; 
    accounts.forEach((acc) => {
      const currency = acc.currency;
      const amount = parseFloat(acc.available_balance?.value || 0);
      if (currency === 'EUR') ghostState.liquidity.eur = amount;
      else if (currency === 'USDC' || currency === 'USD' || currency === 'EURC') ghostState.liquidity.usdc = amount;
      else if (amount > 0.00000001) newBalances[currency] = amount;
    });
    ghostState.actualBalances = newBalances;
    console.log(`[SYNC] Coinbase Balance Updated. EUR: ${ghostState.liquidity.eur}, Assets: ${Object.keys(newBalances).join(', ')}`);
    return true;
  } catch (e: any) {
    console.error("[SYNC ERROR] Failed to fetch Coinbase balances:", e.message);
    return false;
  }
}

async function executeTrade(symbol, side, amount, quantity) {
  if (ghostState.isPaperMode) {
    console.log(`[PAPER TRADE SUCCESS] ${side} ${symbol} (Amount: ${amount}, Qty: ${quantity})`);
    return { success: true };
  }

  const productId = symbol.includes('-') ? symbol : `${symbol}-EUR`;
  
  if (!ghostState.isPaperMode && availableEurPairs.length > 0 && !availableEurPairs.includes(productId)) {
    console.error(`[REAL TRADE ERROR] Invalid product ID: ${productId}`);
    return { success: false, reason: `INVALID_PRODUCT: ${productId}` };
  }
  
  if (!CB_API_KEY || !CB_API_SECRET) {
    console.error("[REAL TRADE ERROR] Missing Coinbase API credentials.");
    return { success: false, reason: "MISSING_API_KEYS" };
  }

  const token = generateCoinbaseJWT('POST', '/api/v3/brokerage/orders');
  if (!token) {
    console.error("[REAL TRADE ERROR] Failed to generate JWT.");
    return { success: false, reason: "JWT_GENERATION_FAILED" };
  }

  try {
    let finalQty = Number(quantity);
    
    // If real trading and selling, ensure we don't exceed actual balance to avoid INSUFFICIENT_FUND
    if (!ghostState.isPaperMode && side === 'SELL') {
      // Force sync balance before selling to get the exact available amount
      await syncCoinbaseBalance();
      const actual = ghostState.actualBalances[symbol] || 0;
      
      if (actual <= 0) {
        console.error(`[REAL TRADE REJECTED] No actual balance found for ${symbol} on Coinbase.`);
        return { success: false, reason: "NO_BALANCE_ON_EXCHANGE" };
      }
      
      if (finalQty > actual) {
        console.log(`[TRADE] Adjusting SELL quantity for ${symbol}: ${finalQty} -> ${actual} (Max Available)`);
        finalQty = actual;
      }
    }

    // Truncate instead of round to avoid INSUFFICIENT_FUND
    const quoteSizeStr = (Math.floor(Number(amount) * 100) / 100).toFixed(2);
    // Convert to string and truncate to 8 decimal places max without rounding up
    const baseSizeStr = finalQty.toString().match(/^-?\d+(?:\.\d{0,8})?/)[0];

    const orderConfig = side === 'BUY' 
      ? { market_market_ioc: { quote_size: quoteSizeStr } }
      : { market_market_ioc: { base_size: baseSizeStr } };
    
    const payload = {
      client_order_id: crypto.randomUUID(),
      product_id: productId,
      side: side,
      order_configuration: orderConfig
    };

    const response = await axios.post('https://api.coinbase.com/api/v3/brokerage/orders', payload, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 15000
    });

    // Check if order was actually created or rejected by Coinbase
    if (response.data?.success === false || response.data?.error_response) {
      const errorResponse = response.data?.error_response;
      const errorMsg = errorResponse?.message || errorResponse?.error || response.data?.failure_reason || "COINBASE_REJECTION";
      
      if (errorMsg === 'INSUFFICIENT_FUND' || (typeof errorMsg === 'string' && errorMsg.includes('INSUFFICIENT'))) {
        console.error("[REAL TRADE REJECTED] Insufficient funds on Coinbase.");
        return { success: false, reason: "INSUFFICIENT_FUNDS_ON_COINBASE" };
      }
      
      console.error("[REAL TRADE REJECTED]", response.data);
      return { success: false, reason: `CB_REJECT: ${errorMsg}` };
    }

    const orderId = response.data?.order_id || response.data?.success_response?.order_id;
    console.log(`[REAL TRADE SUCCESS] ${side} ${productId} | OrderID: ${orderId}`);
    return { success: true, orderId };
  } catch (e: any) {
    const errorData = e.response?.data;
    const errorMsg = errorData?.message || errorData?.error || e.message || "UNKNOWN_API_ERROR";
    
    console.error("[REAL TRADE API ERROR]", errorData || e.message);
    
    // Check for specific "insufficient funds" errors from Coinbase
    const lowerError = errorMsg.toLowerCase();
    if (lowerError.includes('insufficient') || lowerError.includes('balance') || lowerError.includes('funds')) {
      return { success: false, reason: "INSUFFICIENT_FUNDS_ON_COINBASE" };
    }

    if (lowerError.includes('401') || lowerError.includes('unauthorized')) {
      return { success: false, reason: "INVALID_API_KEYS" };
    }
    
    return { success: false, reason: `API_ERR: ${errorMsg}` };
  }
}

async function getLastFillPrice(symbol) {
  if (ghostState.isPaperMode) return null;
  const productId = `${symbol}-EUR`;
  const token = generateCoinbaseJWT('GET', `/api/v3/brokerage/orders/historical/fills?product_id=${productId}`);
  if (!token) return null;
  
  try {
    const response = await axios.get(`https://api.coinbase.com/api/v3/brokerage/orders/historical/fills?product_id=${productId}&limit=1`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000
    });
    
    const fills = response.data?.fills || [];
    if (fills.length > 0) {
      const lastFill = fills[0];
      if (lastFill.side === 'BUY') {
        return Number(lastFill.price);
      }
    }
    return null;
  } catch (e: any) {
    console.warn(`[LAST_FILL_ERROR] Could not fetch last fill for ${symbol}:`, e.message);
    return null;
  }
}

function loadState() {
  const defaults = {
    isEngineActive: true, autoPilot: true, isPaperMode: false,
    settings: { confidenceThreshold: 70, minRoi: 1.5, maxDailyDrawdown: -20.0 },
    thoughts: [], executionLogs: [], activePositions: [],
    liquidity: { eur: 0, usdc: 0 }, actualBalances: {}, 
    dailyStats: { trades: 0, profit: 0, dailyGoal: 50.0, lastResetDate: "" },
    totalProfit: 0,
    currentStatus: "INITIALIZING", scanIndex: 0
  };
  try { 
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return { 
        ...defaults, 
        ...parsed,
        settings: { ...defaults.settings, ...(parsed.settings || {}) }
      };
    }
  } catch {
    console.warn("[STATE] Failed to load state, using defaults.");
  }
  return defaults;
}

const ghostState = loadState();

// --- MIGRATION: CLEAN SYMBOLS (e.g., SOL-EUR -> SOL) ---
if (ghostState.activePositions && ghostState.activePositions.length > 0) {
  ghostState.activePositions = ghostState.activePositions.map(pos => {
    if (pos.symbol && pos.symbol.includes('-')) {
      const base = pos.symbol.split('-')[0];
      console.log(`[MIGRATION] Cleaning symbol: ${pos.symbol} -> ${base}`);
      return { ...pos, symbol: base };
    }
    return pos;
  });
}

async function monitorPositionsAI() {
  if (isAiMonitoring || !ghostState.isEngineActive || ghostState.activePositions.length === 0) return;
  isAiMonitoring = true;
  ghostState.currentStatus = "MONITORING_HUNTS";
  saveState();
  
  console.log(`[MONITOR] Queueing ${ghostState.activePositions.length} active positions for AI analysis...`);
  
  try {
    for (const pos of ghostState.activePositions) {
      try {
        const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${pos.symbol}&tsym=EUR&limit=100&aggregate=15`, { timeout: 8000 });
        const candles = res.data?.Data?.Data || [];
        if (candles.length === 0) continue;
        
        const price = candles[candles.length - 1].close;
        const roundTripFee = FEE_RATE;
        const breakEvenPrice = pos.entryPrice * (1 + roundTripFee);
        const currentProfitPercent = (price - breakEvenPrice) / (breakEvenPrice || 1);
        
        // Basic trailing stop logic (non-AI)
        if (currentProfitPercent > 0.03) {
          const newSl = breakEvenPrice * 1.02;
          if (pos.sl < newSl) pos.sl = newSl;
        } else if (currentProfitPercent > 0.02) {
          const newSl = breakEvenPrice * 1.01;
          if (pos.sl < newSl) pos.sl = newSl;
        }
        
        // Queue for AI analysis
        const existingIdx = pendingAnalysis.findIndex(p => p.symbol === pos.symbol && p.type === 'MONITOR');
        if (existingIdx === -1) {
          pendingAnalysis.push({
            id: crypto.randomUUID(),
            type: 'MONITOR',
            symbol: pos.symbol,
            price,
            candles,
            entryPrice: pos.entryPrice,
            timestamp: new Date().toISOString()
          });
        }
      } catch (e: any) {
        console.error(`[MONITOR] Error queueing ${pos.symbol}:`, e.message);
      }
    }
  } finally {
    isAiMonitoring = false;
  }
}

async function scanWatchlist() {
  if (isScanning || !ghostState.isEngineActive) return;
  isScanning = true;
  
  try {
    const rawWatchlist = availableEurPairs.length > 0 
      ? availableEurPairs.map(p => p.split('-')[0]) 
      : WATCHLIST;
    const currentWatchlist = [...new Set(rawWatchlist)];

    if (ghostState.activePositions.length >= 5) return;

    console.log(`[SCAN] Queueing market scan for AI analysis...`);
    
    // Scan up to 8 symbols per cycle
    const scanLimit = Math.min(8, currentWatchlist.length);
    for (let i = 0; i < scanLimit; i++) {
      const symbol = currentWatchlist[ghostState.scanIndex % currentWatchlist.length];
      ghostState.scanIndex++;
      
      if (ghostState.activePositions.some(p => p.symbol === symbol)) continue;
      if (Date.now() - (lastTradeTime[symbol] || 0) < TRADE_COOLDOWN_MS) continue;

      try {
        const res = await axios.get(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${symbol}&tsym=EUR&limit=100&aggregate=15`, { timeout: 8000 });
        const candles = res.data?.Data?.Data || [];
        if (candles.length === 0) continue;
        
        const price = candles[candles.length - 1].close;
        
        const existingIdx = pendingAnalysis.findIndex(p => p.symbol === symbol && p.type === 'SCAN');
        if (existingIdx === -1) {
          pendingAnalysis.push({
            id: crypto.randomUUID(),
            type: 'SCAN',
            symbol,
            price,
            candles,
            timestamp: new Date().toISOString()
          });
        }
      } catch {
        // Silent fail for scan
      }
    }
  } finally {
    isScanning = false;
  }
}

function addLog(action: string, symbol: string, details: string, status: 'SUCCESS' | 'FAILED' | 'INFO' = 'INFO', price: number = 0, pnl: number = 0, timestamp?: string) {
  ghostState.executionLogs.unshift({
    id: crypto.randomUUID(),
    symbol,
    action,
    price,
    pnl,
    status,
    details,
    timestamp: timestamp || new Date().toISOString()
  });
  if (ghostState.executionLogs.length > 100) ghostState.executionLogs.pop();
  saveState();
}

async function syncCoinbaseOrders() {
  if (ghostState.isPaperMode) return;
  
  const token = generateCoinbaseJWT('GET', '/api/v3/brokerage/orders/historical/batch');
  if (!token) return;

  try {
    const response = await axios.get('https://api.coinbase.com/api/v3/brokerage/orders/historical/batch?limit=50', {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000
    });
    
    const orders = response.data?.orders || [];
    let addedCount = 0;

    for (const order of orders) {
      if (order.status !== 'FILLED') continue;
      
      const orderId = order.order_id;
      const exists = ghostState.executionLogs.some(log => log.details && log.details.includes(orderId));
      
      if (!exists) {
        const symbol = order.product_id.split('-')[0];
        const action = order.side;
        const price = Number(order.avg_price) || Number(order.price) || 0;
        const timestamp = order.created_time || new Date().toISOString();
        
        addLog(action, symbol, `COINBASE_SYNC | ID: ${orderId}`, 'SUCCESS', price, 0, timestamp);
        addedCount++;
      }
    }

    if (addedCount > 0) {
      console.log(`[SYNC] Added ${addedCount} historical orders from Coinbase to logs.`);
      ghostState.executionLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      saveState();
    }
  } catch (e: any) {
    console.warn("[SYNC ERROR] Failed to sync historical orders:", e.message);
  }
}

async function monitor() {
  if (isMonitoring) return;
  isMonitoring = true;

  try {
    const today = new Date().toISOString().split('T')[0];
    if (ghostState.dailyStats.lastResetDate !== today) {
      ghostState.dailyStats.profit = 0; ghostState.dailyStats.trades = 0; ghostState.dailyStats.lastResetDate = today;
    }
    
    // KILL SWITCH: Daily Drawdown Limit
    const maxDrawdown = ghostState.settings.maxDailyDrawdown || -20.0;
    if (ghostState.dailyStats.profit <= maxDrawdown && ghostState.isEngineActive) {
      console.log(`[KILL SWITCH] Daily drawdown limit reached (${ghostState.dailyStats.profit.toFixed(2)} <= ${maxDrawdown}). Pausing engine.`);
      ghostState.isEngineActive = false;
      ghostState.currentStatus = "PAUSED_MAX_DRAWDOWN";
      saveState();
    }

    // Reconcile active positions with actual Coinbase balances (ONLY IN REAL MODE)
    if (!ghostState.isPaperMode) {
      for (let i = ghostState.activePositions.length - 1; i >= 0; i--) {
        const pos = ghostState.activePositions[i];
        const actualQty = ghostState.actualBalances[pos.symbol] || 0;
        
        // Add a 5-minute grace period for newly opened positions to avoid immediate reconciliation
        const tradeAgeMs = Date.now() - new Date(pos.timestamp).getTime();
        const isNewTrade = tradeAgeMs < (5 * 60 * 1000); 

        if (actualQty < (pos.quantity * 0.1) && !isNewTrade) {
          console.log(`[RECONCILE] Removing ${pos.symbol} - Position no longer exists on Coinbase.`);
          addLog('SELL', pos.symbol, `EXTERNAL_EXIT_DETECTED`, 'SUCCESS', pos.currentPrice, pos.pnl);
          ghostState.dailyStats.profit += pos.pnl; 
          ghostState.totalProfit += pos.pnl;
          ghostState.liquidity.eur += (pos.amount + pos.pnl);
          ghostState.activePositions.splice(i, 1);
        }
      }

      // ADOPT MISSING POSITIONS: If Coinbase has it but we don't track it, add it.
      for (const symbol of Object.keys(ghostState.actualBalances)) {
        if (!ghostState.activePositions.some(p => p.symbol === symbol)) {
          const qty = ghostState.actualBalances[symbol];
          const productId = `${symbol}-EUR`;
          
          // ONLY adopt if we can actually trade it against EUR
          const canTrade = availableEurPairs.length === 0 || availableEurPairs.includes(productId);
          
          if (qty > 0.00001 && canTrade) {
            console.log(`[RECONCILE] Adopting position: ${symbol} (${qty})`);
            const lastFillPrice = await getLastFillPrice(symbol);
            
            ghostState.activePositions.push({
              id: crypto.randomUUID(),
              symbol,
              entryPrice: lastFillPrice || 0, 
              currentPrice: 0,
              amount: (lastFillPrice || 0) * qty,
              quantity: qty,
              tp: 0,
              sl: 0,
              confidence: 100,
              potentialRoi: 0,
              pnl: 0,
              pnlPercent: 0,
              isPaper: false,
              timestamp: new Date().toISOString()
            });
            saveState();
          }
        }
      }
    }

    if (ghostState.activePositions.length === 0) return;
    const symbols = ghostState.activePositions.map((p) => p.symbol).join(',');
    try {
      const res = await axios.get(`https://min-api.cryptocompare.com/data/pricemulti?fsyms=${symbols}&tsyms=EUR`, { timeout: 8000 });
      const prices = res.data;
      for (let i = ghostState.activePositions.length - 1; i >= 0; i--) {
        const pos = ghostState.activePositions[i];
        const curPrice = prices[pos.symbol]?.EUR;
        if (!curPrice) continue;
        
        // If it's a newly adopted position, set initial prices and default targets
        if (pos.entryPrice === 0) {
          pos.entryPrice = curPrice;
          pos.amount = curPrice * pos.quantity;
          pos.tp = curPrice * 1.03; // Default 3% TP
          pos.sl = curPrice * 0.98; // Default 2% SL
        }

        pos.currentPrice = curPrice;
        const pnlPercent = ((curPrice - pos.entryPrice) / (pos.entryPrice || 1)) * 100;
        pos.pnlPercent = pnlPercent;
        
        // Calculate net PNL (subtracting round-trip fees)
        const grossPnl = (curPrice - pos.entryPrice) * pos.quantity;
        const feeAmount = pos.amount * FEE_RATE;
        pos.pnl = grossPnl - feeAmount;
        
        const breakEvenPrice = pos.entryPrice * (1 + FEE_RATE);
        const netPnlPercent = pnlPercent - (FEE_RATE * 100);

        // Dynamic Trailing Stop & Break Even
        if (netPnlPercent > 1.8 && pos.sl < breakEvenPrice) {
          pos.sl = breakEvenPrice * 1.005; // Lock in 0.5% pure profit as soon as we hit 1.8% net
        }

        if (netPnlPercent > 3.0) {
          const newSl = curPrice * 0.985; // 1.5% trailing stop once in 3.0% net profit
          if (newSl > pos.sl) {
            pos.sl = newSl;
          }
        }

        // TIME-BASED EXIT: If trade is open for > 6 hours and not in significant profit
        const tradeAgeMs = Date.now() - new Date(pos.timestamp).getTime();
        const tradeAgeHours = tradeAgeMs / (1000 * 60 * 60);
        const isStagnant = tradeAgeHours > 6 && netPnlPercent < 0.5 && curPrice > breakEvenPrice;

        // Trigger SELL if:
        // 1. Reached TP
        // 2. Reached SL (Hard stop loss)
        // 3. Trade is stagnant (time-based exit)
        
        const isGracePeriod = tradeAgeMs < (5 * 60 * 1000); // 5-minute grace period
        const isHardStop = curPrice <= (pos.entryPrice * 0.94); // 6% hard stop bypasses grace
        const isMinHoldTimeMet = tradeAgeMs > (60 * 1000); // 1-minute minimum hold time for ANY exit (except hard stop)
        
        let shouldSell = false;
        let sellReason = "";

        // Ensure TP/SL are initialized for adopted positions if they are still 0
        if (pos.tp === 0) pos.tp = pos.entryPrice * 1.05;
        if (pos.sl === 0) pos.sl = pos.entryPrice * 0.95;

        if (curPrice >= pos.tp) {
          if (isMinHoldTimeMet) {
            shouldSell = true;
            sellReason = "TAKE_PROFIT";
          }
        } else if (curPrice <= pos.sl) {
          if (isHardStop || (!isGracePeriod && isMinHoldTimeMet)) {
            shouldSell = true;
            sellReason = "STOP_LOSS";
          }
        } else if (isStagnant && isMinHoldTimeMet) {
          shouldSell = true;
          sellReason = "TIME_STAGNATION_EXIT";
        }

        if (shouldSell) {
          console.log(`[MONITOR] Triggering SELL for ${pos.symbol}. Reason: ${sellReason} | Price: ${curPrice} | SL: ${pos.sl} | TP: ${pos.tp} | Age: ${Math.round(tradeAgeMs/1000)}s`);
          
          const tradeResult = await executeTrade(pos.symbol, 'SELL', 0, pos.quantity);
          
          if (tradeResult.success) {
            ghostState.dailyStats.profit += pos.pnl;
            ghostState.totalProfit += pos.pnl;
            ghostState.liquidity.eur += (pos.amount + pos.pnl);
            lastTradeTime[pos.symbol] = Date.now();
            ghostState.executionLogs.unshift({ 
              id: crypto.randomUUID(), 
              symbol: pos.symbol, 
              action: 'SELL', 
              price: curPrice, 
              pnl: pos.pnl, 
              status: 'SUCCESS', 
              details: `EXIT_${sellReason}_PNL_${pos.pnl.toFixed(2)}`,
              timestamp: new Date().toISOString() 
            });
            if (ghostState.executionLogs.length > 50) ghostState.executionLogs.pop();
            ghostState.activePositions.splice(i, 1);
          } else if (tradeResult.reason && (tradeResult.reason.includes('INSUFFICIENT_FUND') || tradeResult.reason.includes('NO_BALANCE_ON_EXCHANGE'))) {
            console.log(`[MONITOR] Removing ${pos.symbol} due to missing balance on exchange.`);
            ghostState.activePositions.splice(i, 1);
          }
        }
      }
    } catch (e) {
      console.error("[MONITOR ERROR]", e);
    }
  } finally {
    isMonitoring = false;
    saveState();
  }
}

function saveState() { 
  try { 
    // Final deduplication before saving
    if (ghostState.thoughts) {
      const seen = new Set();
      ghostState.thoughts = ghostState.thoughts.filter(t => {
        if (!t.id) return true;
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
    }
    if (ghostState.executionLogs) {
      const seen = new Set();
      ghostState.executionLogs = ghostState.executionLogs.filter(l => {
        if (!l.id) return true;
        if (seen.has(l.id)) return false;
        seen.add(l.id);
        return true;
      });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(ghostState, null, 2)); 
  } catch (e) {
    console.error("[STATE SAVE ERROR]", e);
  } 
}

// --- SERVER SETUP ---

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json());

  // Request Logging
  app.use((req, _res, next) => {
    if (req.url.startsWith('/api')) {
      console.log(`[API_REQ] ${req.method} ${req.url}`);
    }
    next();
  });

  // API Routes (MOVED TO TOP)
  app.get('/api/ping', (req, res) => res.json({ status: 'pong', timestamp: new Date().toISOString() }));
  app.get('/api/ghost/state', (req, res) => res.json(ghostState));
  
  app.get('/api/ghost/pending-analysis', (req, res) => {
    if (pendingAnalysis.length === 0) return res.json(null);
    const request = pendingAnalysis.shift();
    res.json(request);
  });

  app.post('/api/ghost/submit-analysis', async (req, res) => {
    const { type, symbol, analysis } = req.body;
    if (!analysis || !symbol) return res.status(400).json({ error: 'Invalid analysis' });

    console.log(`[AI-SUBMIT] Received ${type} analysis for ${symbol}: ${analysis.side}`);

    if (type === 'MONITOR') {
      const pos = ghostState.activePositions.find(p => p.symbol === symbol);
      if (pos) {
        pos.lastAnalysis = analysis.analysis;
        pos.liquidityAnalysis = analysis.liquidityAnalysis || "تحلیل نقدینگی در دسترس نیست";
        pos.marketMonitoring = analysis.marketMonitoring || "نظارت بازار در دسترس نیست";
        pos.lastDecision = analysis.side;
        pos.lastConfidence = analysis.confidence;
        pos.lastChecked = new Date().toISOString();
        pos.estimatedTime = analysis.estimatedTime;

        // Update targets if AI suggests new ones
        const curPrice = pos.currentPrice || pos.entryPrice;
        const minAiSlBuffer = curPrice * 0.985;
        if (analysis.sl > 0 && analysis.sl < minAiSlBuffer && (pos.sl === 0 || (analysis.sl > pos.sl))) {
          pos.sl = analysis.sl;
        }
        if (analysis.tp > 0 && (pos.tp === 0 || analysis.tp > pos.tp)) {
          pos.tp = analysis.tp;
        }

        // Check for AI SELL signal
        if (analysis.side === 'SELL') {
          const tradeAgeMs = Date.now() - new Date(pos.timestamp).getTime();
          const isMinHoldTimeMet = tradeAgeMs > MIN_HOLD_TIME_MS;
          const breakEvenPrice = pos.entryPrice * (1 + FEE_RATE);
          const isProfitable = curPrice > (breakEvenPrice * (1 + 0.012));
          const isSignificantLoss = curPrice < (pos.entryPrice * 0.95);

          if ((isProfitable && isMinHoldTimeMet) || (analysis.confidence >= 98 && isSignificantLoss)) {
            const tradePnl = (curPrice - pos.entryPrice) * pos.quantity;
            const netPnl = tradePnl - (pos.amount * FEE_RATE);
            console.log(`[AI-MONITOR] AI SELL for ${symbol}. Net PNL: ${netPnl.toFixed(2)} EUR.`);
            
            const tradeResult = await executeTrade(symbol, 'SELL', 0, pos.quantity);
            if (tradeResult.success) {
              ghostState.dailyStats.profit += netPnl;
              ghostState.totalProfit += netPnl;
              ghostState.liquidity.eur += (pos.amount + netPnl);
              addLog('SELL', symbol, `AI_EXIT_CONF_${analysis.confidence}%`, 'SUCCESS', curPrice, netPnl);
              const idx = ghostState.activePositions.findIndex(p => p.symbol === symbol);
              if (idx !== -1) ghostState.activePositions.splice(idx, 1);
              lastTradeTime[symbol] = Date.now();
            }
          }
        }
      }
    } else if (type === 'SCAN') {
      // Process SCAN results
      ghostState.thoughts.unshift(analysis);
      if (ghostState.thoughts.length > 50) ghostState.thoughts.pop();

      const requiredConfidence = Math.max(85, ghostState.settings.confidenceThreshold || 85);
      if (analysis.side === 'BUY' && analysis.confidence >= requiredConfidence && ghostState.autoPilot) {
        const isProfitableEnough = analysis.potentialRoi >= ((FEE_RATE * 100) + 1.2);
        const totalEur = ghostState.liquidity.eur;
        const tradeAmount = Math.max(10, Math.min(totalEur, totalEur * 0.20));

        if (isProfitableEnough && totalEur >= (tradeAmount * 1.01) && tradeAmount >= 10 && ghostState.activePositions.length < 5) {
          const qty = tradeAmount / (analysis.entryPrice || 1);
          const tradeResult = await executeTrade(symbol, 'BUY', tradeAmount, qty);
          
          if (tradeResult.success) {
            analysis.decision = `EXECUTED: BUY_${symbol}_AT_${analysis.entryPrice}`;
            ghostState.activePositions.push({
              id: crypto.randomUUID(),
              symbol, entryPrice: analysis.entryPrice, currentPrice: analysis.entryPrice, amount: tradeAmount, quantity: qty,
              tp: analysis.tp, sl: analysis.sl, confidence: analysis.confidence, potentialRoi: analysis.potentialRoi,
              pnl: 0, pnlPercent: 0, isPaper: ghostState.isPaperMode, timestamp: new Date().toISOString(),
              estimatedTime: analysis.estimatedTime,
              lastAnalysis: analysis.analysis,
              liquidityAnalysis: analysis.liquidityAnalysis,
              marketMonitoring: analysis.marketMonitoring
            });
            ghostState.liquidity.eur -= tradeAmount;
            addLog('BUY', symbol, `AI_BUY_CONF_${analysis.confidence}%`, 'SUCCESS', analysis.entryPrice);
            ghostState.dailyStats.trades++;
          }
        }
      }
    }

    saveState();
    res.json({ success: true });
  });

  app.post('/api/ghost/toggle', (req, res) => {
    if (req.body.engine !== undefined) {
      ghostState.isEngineActive = !!req.body.engine;
      addLog('ENGINE', 'SYSTEM', ghostState.isEngineActive ? "ربات فعال شد." : "ربات متوقف شد.", 'INFO');
    }
    if (req.body.auto !== undefined) {
      ghostState.autoPilot = !!req.body.auto;
      addLog('AUTOPILOT', 'SYSTEM', ghostState.autoPilot ? "حالت خودکار فعال شد." : "حالت خودکار غیرفعال شد.", 'INFO');
    }
    if (req.body.paper !== undefined) {
      ghostState.isPaperMode = !!req.body.paper;
      addLog('PAPER_MODE', 'SYSTEM', ghostState.isPaperMode ? "حالت دمو فعال شد." : "حالت واقعی فعال شد.", 'INFO');
    }
    saveState();
    res.json({ success: true });
  });

  app.post('/api/ghost/settings', (req, res) => {
    if (req.body.settings) {
      ghostState.settings = { ...ghostState.settings, ...req.body.settings };
      saveState();
    }
    res.json({ success: true, settings: ghostState.settings });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: false,
        proxy: {} 
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api')) res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 UNIFIED SERVER RUNNING ON PORT ${PORT}`);
    
    // Start trading engine
    listAvailableProducts();
    syncCoinbaseBalance();
    syncCoinbaseOrders();
    monitor();
    monitorPositionsAI();
    scanWatchlist();
    
    setInterval(monitor, 8000);           // Hard TP/SL check (8s)
    setInterval(syncCoinbaseBalance, 60000); // Sync balances (60s)
    setInterval(syncCoinbaseOrders, 120000); // Sync orders (120s)
    setInterval(monitorPositionsAI, 90000); // AI Position Analysis (90s)
    setInterval(scanWatchlist, 120000);      // New Signal Scanning (120s)
    setInterval(listAvailableProducts, 600000); // Refresh products every 10m
  });
}

startServer();
