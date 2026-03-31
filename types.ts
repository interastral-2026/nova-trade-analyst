
export interface GhostState {
  isEngineActive: boolean;
  autoPilot: boolean;
  isPaperMode: boolean;
  settings: {
    confidenceThreshold: number;
    defaultTradeSize: number;
    minRoi?: number;
    maxDailyDrawdown?: number;
    dailyProfitTargetPercent?: number;
    riskPerTradePercent?: number;
    highPrecision?: boolean;
  };
  thoughts: TradeSignal[];
  executionLogs: ExecutionLog[];
  activePositions: ActivePosition[];
  liquidity: {
    eur: number;
    usdc: number;
  };
  actualBalances: Record<string, number>;
  dailyStats: {
    trades: number;
    profit: number;
    dailyGoal: number;
    lastResetDate: string;
  };
  totalProfit: number;
  currentStatus: string;
  scanIndex: number;
}

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
  potentialRoi: number;
  analysis: string;
  decision?: string;
  timestamp: string;
  estimatedTimeMinutes?: number;
  isPaper?: boolean;
}

export interface AccountBalance {
  currency: string;
  available: number;
  total: number;
}

export interface ActivePosition {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  currentPrice: number;
  peakPrice?: number;
  amount: number;
  quantity: number;
  tp: number;
  sl: number;
  confidence: number;
  potentialRoi: number;
  pnl: number;
  pnlPercent: number;
  isPaper: boolean;
  timestamp: string;
  estimatedTimeMinutes?: number;
  analysis?: string;
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
  FETCHING = 'FETCHING',
  COMPLETED = 'COMPLETED',
  RATE_LIMITED = 'RATE_LIMITED',
  OVERLOADED = 'OVERLOADED',
  KEY_REQUIRED = 'KEY_REQUIRED'
}
