
import { TradeSignal, AccountBalance, ExecutionLog, OpenOrder } from "../types.ts";

export const API_BASE = 'https://robot-production-9206.up.railway.app'; 

export const fetchAccountBalance = async (): Promise<AccountBalance[]> => {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(`${API_BASE}/api/balances`, {
      mode: 'cors',
      signal: controller.signal
    });
    
    clearTimeout(id);
    
    if (!response.ok) return [];
    const data = await response.json();
    
    return Array.isArray(data) ? data.map((acc: any) => ({
      currency: acc.currency,
      available: parseFloat(acc.total || 0),
      total: parseFloat(acc.total || 0)
    })) : [];
  } catch (error: any) {
    console.warn("BRIDGE_CONNECTION_TIMEOUT");
    return [];
  }
};

export const fetchOpenOrders = async (): Promise<OpenOrder[]> => {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(`${API_BASE}/api/ghost/state`, {
      mode: 'cors',
      signal: controller.signal
    });
    
    clearTimeout(id);
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
        details: data.success ? `EXECUTED_AT_BRIDGE` : data.error
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
        details: `BRIDGE_ERROR: ${error.message}`
      }
    };
  }
};
