
import { TradeSignal, AccountBalance, ExecutionLog } from "../types";

export const getApiBase = () => {
  if (typeof window === 'undefined') return "";
  
  const { hostname, port, protocol } = window.location;

  // 1. Localhost fallback: If on port 5173 (Vite), point to 3000 (Express)
  if ((hostname === 'localhost' || hostname === '127.0.0.1') && port === '5173') {
    return "http://127.0.0.1:3000";
  }

  // 2. AI Studio / Cloud Run Environment: 
  // If the hostname contains "-5173", it's likely a Vite-specific URL.
  // We should try to hit the -3000 URL which is the unified server.
  if (hostname.includes('-5173') && hostname.endsWith('.run.app')) {
    const targetHostname = hostname.replace('-5173', '-3000');
    return `${protocol}//${targetHostname}`;
  }

  // 3. General .run.app check: If on the correct port already, use relative path
  if (hostname.endsWith('.run.app')) {
    return "";
  }

  // 4. Check localStorage (User override) - ONLY if it looks like a valid URL
  const savedUrl = localStorage.getItem('NOVA_BRIDGE_URL');
  if (savedUrl && (savedUrl.startsWith('http://') || savedUrl.startsWith('https://'))) {
    return savedUrl.endsWith('/') ? savedUrl.slice(0, -1) : savedUrl;
  }

  // 5. Default to relative path
  return "";
};

export const fetchAccountBalance = async (): Promise<AccountBalance[]> => {
  const base = getApiBase();
  try {
    const response = await fetch(`${base}/api/ghost/state`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) return [];
    
    // Validate JSON response
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      console.error("Expected JSON response but got:", contentType);
      return [];
    }
    
    const data = await response.json();
    return [
      { currency: 'EUR', available: Number(data.liquidity?.eur) || 0, total: Number(data.liquidity?.eur) || 0 },
      { currency: 'USDC', available: Number(data.liquidity?.usdc) || 0, total: Number(data.liquidity?.usdc) || 0 }
    ];
  } catch {
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
