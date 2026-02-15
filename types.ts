
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
  takeProfit: number;
  stopLoss: number;
  confidence: number;
  timeframe: string;
  analysis: string;
  thoughtProcess: string; 
  timestamp: string;
  netRoiExpected: string;
  estimatedFees: number;
  indicators: {
    rsi: number;
    macd: string;
    trend: string;
  };
}

export interface AccountBalance {
  currency: string;
  available: number;
  total: number;
  valueInEur?: number;
}

export interface ActivePosition {
  id: string;
  symbol: string;
  entryPrice: number;
  currentPrice: number;
  side: 'BUY' | 'SELL';
  size: number;
  pnl: number;
  pnlPercent: number;
  tp: number;
  sl: number;
  feesPaid: number;
  status: 'OPEN' | 'CLOSED';
}

export interface OpenOrder {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  amount: number;
  filled: number;
  status: string;
}

export interface ExecutionLog {
  id: string;
  symbol: string;
  action: string;
  amount: number;
  price: number;
  timestamp: string;
  status: 'SUCCESS' | 'FAILED' | 'AUTO_EXECUTED';
  fees?: number;
  netProfit?: number;
  thought?: string;
  details?: string;
}

export enum AnalysisStatus {
  IDLE = 'IDLE',
  SCANNING = 'SCANNING_LIQUIDITY',
  EXECUTING = 'EXECUTING_ORDER',
  ERROR = 'ERROR',
  ANALYZING = 'ANALYZING',
  FETCHING = 'FETCHING',
  COMPLETED = 'COMPLETED',
  RATE_LIMITED = 'RATE_LIMITED',
  OVERLOADED = 'OVERLOADED',
  KEY_REQUIRED = 'KEY_REQUIRED'
}
