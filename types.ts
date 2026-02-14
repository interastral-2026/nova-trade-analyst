
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
  indicators: {
    rsi: number;
    macd: string;
    trend: string;
  };
  size?: number;
}

export interface OpenOrder {
  order_id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  status: string;
  created_at: string;
  type: 'LIMIT' | 'STOP_LIMIT' | 'MARKET';
  ai_plan?: string; 
}

export interface AssetInfo {
  id: string;
  name: string;
  price: string;
  change24h: number;
  volume: string;
  marketCap: string;
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
  side: 'LONG' | 'SHORT';
  size: number;
  status: 'OPEN' | 'CLOSED';
  pnl: number;
  pnlPercent: number;
  tp: number;
  sl: number;
  openTime: string;
  closeTime?: string;
  exitPrice?: number;
  orderSource: 'BOT' | 'MANUAL';
  strategyPlan?: string;
  analysisContext?: string;
}

export interface PerformanceStats {
  netProfit: number;
  grossLoss: number;
  winRate: number;
  totalTrades: number;
  history: {pnl: number, timestamp: string}[];
}

export interface ExecutionLog {
  id: string;
  symbol: string;
  action: string;
  amount: number;
  price: number;
  timestamp: string;
  status: 'SUCCESS' | 'FAILED' | 'CLOSED';
  pnl?: number;
  pnlPercent?: number;
  details?: string;
  thought?: string;
  tp?: number;
  sl?: number;
  exitPrice?: number;
}

export enum AnalysisStatus {
  IDLE = 'IDLE',
  FETCHING = 'FETCHING',
  ANALYZING = 'ANALYZING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  OVERLOADED = 'OVERLOADED',
  KEY_REQUIRED = 'KEY_REQUIRED'
}
