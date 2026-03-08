
import { TradeSignal, AccountBalance, ExecutionLog } from "../types";

export const getApiBase = () => {
  if (typeof window === 'undefined') return "";
  
  // 1. Check localStorage (User override)
  const savedUrl = localStorage.getItem('NOVA_BRIDGE_URL');
  if (savedUrl) return savedUrl.endsWith('/') ? savedUrl.slice(0, -1) : savedUrl;

  // 2. Localhost fallback: If on port 5173 (Vite), point to 3000 (Express)
  if ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port === '5173') {
    return "http://127.0.0.1:3000";
  }

  // 3. Default to relative path (works for unified server)
  return "";
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
  } catch (_error) {
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
