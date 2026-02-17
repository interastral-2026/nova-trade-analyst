
export interface AssetInfo {
  id: string;
  name: string;
  price: string;
  change24h: number;
  volume: string;
  marketCap: string;
}

export interface MarketData {
  time: number;
  low: number;
  high: number;
  open: number;
  close: number;
  volume: number;
}

export interface TradeSignal {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL' | 'NEUTRAL';
  entryPrice: number;
  tp: number;
  sl: number;
  confidence: number;
  analysis: string;
  timestamp: string;
  isPaper?: boolean;
}

export interface AccountBalance {
  currency: string;
  available: number;
  total: number;
}

export interface ActivePosition {
  symbol: string;
  entryPrice: number;
  currentPrice: number;
  amount: number;
  quantity: number;
  tp: number;
  sl: number;
  pnl: number;
  pnlPercent: number;
  isPaper: boolean;
  timestamp: string;
}

export interface ExecutionLog {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'NEUTRAL';
  price: number;
  status: 'SUCCESS' | 'FAILED';
  details?: string;
  timestamp: string;
  pnl?: number;
  amount?: number;
  thought?: string;
}

export enum AnalysisStatus {
  IDLE = 'IDLE',
  SCANNING = 'SCANNING',
  ERROR = 'ERROR',
  ANALYZING = 'ANALYZING',
  // Added missing members used in components/Header.tsx
  FETCHING = 'FETCHING',
  COMPLETED = 'COMPLETED',
  RATE_LIMITED = 'RATE_LIMITED',
  OVERLOADED = 'OVERLOADED',
  KEY_REQUIRED = 'KEY_REQUIRED'
}
