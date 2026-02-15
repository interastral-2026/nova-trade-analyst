
import { TradeSignal, AccountBalance, ExecutionLog } from "../types.ts";

export const getApiBase = () => {
  return localStorage.getItem('NOVA_BRIDGE_URL') || "http://localhost:3001";
};

export const fetchAccountBalance = async (): Promise<AccountBalance[]> => {
  const base = getApiBase();
  try {
    const response = await fetch(`${base}/api/ghost/state`);
    if (!response.ok) return [];
    const data = await response.json();
    
    // تبدیل دیتای بک‌اند به فرمت مورد نظر فرانت
    return [
      { currency: 'EUR', available: data.liquidity?.eur || 0, total: data.liquidity?.eur || 0 },
      { currency: 'USDC', available: data.liquidity?.usdc || 0, total: data.liquidity?.usdc || 0 }
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
    
    const data = await response.json();
    return { 
      success: data.success, 
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
