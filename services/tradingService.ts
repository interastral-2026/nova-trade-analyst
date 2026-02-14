
import { TradeSignal, AccountBalance, ExecutionLog, OpenOrder } from "../types.ts";

// تشخیص خودکار آدرس سرور: اگر روی سیستم خودتان هستید به 3001 وصل می‌شود
export const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3001'
  : 'https://nova-trade-analyst-production.up.railway.app'; 

export const fetchAccountBalance = async (): Promise<AccountBalance[]> => {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(`${API_BASE}/api/balances`, {
      mode: 'cors',
      signal: controller.signal
    });
    
    clearTimeout(id);
    
    if (!response.ok) {
        console.error(`API_ERROR: ${response.status}`);
        return [];
    }
    
    const data = await response.json();
    
    // اطمینان از اینکه داده‌ها با فرمت صحیح (AccountBalance) برمی‌گردند
    return Array.isArray(data) ? data.map((acc: any) => ({
      currency: acc.currency,
      available: parseFloat(acc.total || acc.available || 0),
      total: parseFloat(acc.total || 0)
    })) : [];
  } catch (error: any) {
    console.warn("BRIDGE_CONNECTION_FAILED: ", error.message);
    return [];
  }
};

export const fetchOpenOrders = async (): Promise<OpenOrder[]> => {
  try {
    const response = await fetch(`${API_BASE}/api/ghost/state`);
    if (!response.ok) return [];
    const state = await response.json();
    return state.openOrders || [];
  } catch (error: any) {
    return [];
  }
};

export const executeAutoTrade = async (
  signal: TradeSignal, 
  amountEur: number
): Promise<{ success: boolean; log: ExecutionLog; error?: string }> => {
  const timestamp = new Date().toISOString();
  try {
    const response = await fetch(`${API_BASE}/api/trade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: signal.symbol,
        side: signal.side,
        amount_eur: amountEur,
        price: signal.entryPrice
      }),
      mode: 'cors'
    });
    
    const data = await response.json();
    return { 
      success: data.success, 
      log: {
        id: data.order?.order_id || crypto.randomUUID(),
        symbol: signal.symbol,
        action: signal.side,
        amount: amountEur,
        price: signal.entryPrice,
        timestamp,
        status: data.success ? 'SUCCESS' : 'FAILED',
        details: data.success ? `EXECUTED_ON_NOVA_RAILWAY` : data.error
      }
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      log: { 
        id: crypto.randomUUID(), 
        symbol: signal.symbol, 
        action: signal.side, 
        amount: 0, 
        price: 0, 
        timestamp, 
        status: 'FAILED',
        details: `NOVA_BRIDGE_ERR: ${error.message}`
      }
    };
  }
};
