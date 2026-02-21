
import { TradeSignal, AccountBalance, ExecutionLog } from "../types.ts";

export const getApiBase = () => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const url = localStorage.getItem('NOVA_BRIDGE_URL');
      if (url) return url.endsWith('/') ? url.slice(0, -1) : url;
    }
  } catch (e) {
    console.warn("Storage access restricted:", e);
  }
  return typeof window !== 'undefined' && window.location.hostname === 'localhost' ? "http://localhost:3000" : "";
};

export const fetchAccountBalance = async (): Promise<AccountBalance[]> => {
  const base = getApiBase();
  try {
    const response = await fetch(`${base}/api/ghost/state`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return [
      { currency: 'EUR', available: Number(data.liquidity?.eur) || 0, total: Number(data.liquidity?.eur) || 0 },
      { currency: 'USDC', available: Number(data.liquidity?.usdc) || 0, total: Number(data.liquidity?.usdc) || 0 }
    ];
  } catch (error) {
    return [];
  }
};

export const executeAutoTrade = async (
  signal: TradeSignal, 
  amountEur: number
): Promise<{ success: boolean; log: ExecutionLog; error?: string }> => {
  const base = getApiBase();
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
    
    if (!response.ok) throw new Error("TRADE_FAILED");
    const data = await response.json();
    
    return { 
      success: !!data.success, 
      log: {
        id: crypto.randomUUID(),
        symbol: signal.symbol,
        action: signal.side,
        amount: amountEur,
        price: signal.entryPrice,
        timestamp: new Date().toISOString(),
        status: data.success ? 'SUCCESS' : 'FAILED',
        thought: signal.analysis
      }
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      log: { 
        id: crypto.randomUUID(), symbol: signal.symbol, action: signal.side, 
        amount: 0, price: 0, timestamp: new Date().toISOString(), status: 'FAILED'
      }
    };
  }
};
