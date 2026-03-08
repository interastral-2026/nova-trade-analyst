
export interface GhostState {
  isEngineActive: boolean;
  autoPilot: boolean;
  isPaperMode: boolean;
  settings: {
    confidenceThreshold: number;
    maxDailyDrawdown?: number;
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
  tradePercentage?: number;
  analysis: string;
  liquidityAnalysis?: string;
  marketMonitoring?: string;
  decision?: string;
  estimatedTime?: string;
  timestamp: string;
  isPaper?: boolean;
}

export interface AccountBalance {
  currency: string;
  available: number;
  total: number;
}

export interface ActivePosition {
  id: string;
  symbol: string;
  entryPrice: number;
  currentPrice: number;
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
  lastAnalysis?: string;
  lastDecision?: string;
  lastConfidence?: number;
  lastChecked?: string;
  liquidityAnalysis?: string;
  marketMonitoring?: string;
  estimatedTime?: string;
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
