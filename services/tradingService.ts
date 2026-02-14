
import { TradeSignal, AccountBalance, ExecutionLog, OpenOrder } from "../types.ts";

/**
 * NovaTrade Tactical Bridge Configuration
 * If localStorage has a custom bridge, use it. Otherwise, default to relative (Vite proxy).
 */
export const getApiBase = () => {
  return localStorage.getItem('NOVA_BRIDGE_URL') || "";
};

export const setApiBase = (url: string) => {
  localStorage.setItem('NOVA_BRIDGE_URL', url);
};

export const API_BASE = getApiBase();

export const fetchAccountBalance = async (): Promise<AccountBalance[]> => {
  const base = getApiBase();
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 8000);

    const url = `${base}/api/balances`;
    const response = await fetch(url, {
      signal: controller.signal
    });
    
    clearTimeout(id);
    
    if (!response.ok) return [];
    const data = await response.json();
    
    if (!Array.isArray(data)) return [];

    return data.map((acc: any) => ({
      currency: acc.currency || '?',
      available: parseFloat(acc.available || acc.total || 0),
      total: parseFloat(acc.total || 0)
    }));
  } catch (error: any) {
    return [];
  }
};

export const executeAutoTrade = async (
  signal: TradeSignal, 
  amountEur: number
): Promise<{ success: boolean; log: ExecutionLog; error?: string }> => {
  const base = getApiBase();
  const timestamp = new Date().toISOString();
  try {
    const response = await fetch(`${base}/api/trade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: signal.symbol,
        side: signal.side,
        amount_eur: amountEur,
        price: signal.entryPrice
      })
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
        details: data.success ? `EXECUTED_ON_NODE` : data.error
      }
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      log: { 
        id: crypto.randomUUID(), symbol: signal.symbol, action: signal.side, 
        amount: 0, price: 0, timestamp, status: 'FAILED'
      }
    };
  }
};
