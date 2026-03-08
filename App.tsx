
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AssetInfo, TradeSignal, AnalysisStatus, ActivePosition, ExecutionLog } from './types.ts';
import { fetchProductStats } from './services/coinbaseService.ts';
import { getApiBase } from './services/tradingService.ts';
import Header from './components/Header.tsx';
import Sidebar from './components/Sidebar.tsx';
import SignalList from './components/SignalList.tsx';
import TradingTerminal from './components/TradingTerminal.tsx';
import { GoogleGenAI, Type } from "@google/genai";

const WATCHLIST = ['BTC-EUR', 'ETH-EUR', 'SOL-EUR', 'AVAX-EUR', 'XRP-EUR', 'DOGE-EUR', 'LINK-EUR', 'ADA-EUR'];

const App: React.FC = () => {
  const [selectedAsset, setSelectedAsset] = useState<string>('BTC-EUR');
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [thoughtHistory, setThoughtHistory] = useState<TradeSignal[]>([]);
  const [activePositions, setActivePositions] = useState<ActivePosition[]>([]);
  const [executionLogs, setExecutionLogs] = useState<ExecutionLog[]>([]);
  const [stats, setStats] = useState({ eur: 0, usdc: 0, trades: 0, profit: 0, totalProfit: 0, isPaper: true, dailyGoal: 50 });
  const [isEngineActive, setIsEngineActive] = useState<boolean>(true);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState<boolean>(true);
  const [isPaperMode, setIsPaperMode] = useState<boolean>(false);
  const [settings, setSettings] = useState<any>({});
  const [liveActivity, setLiveActivity] = useState<string>("INITIALIZING...");
  const [status, setStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [bridgeUrl, setBridgeUrl] = useState<string>(getApiBase());
  
  const aiProcessingRef = useRef(false);

  const syncWithServer = useCallback(async () => {
    const base = getApiBase();
    try {
      const response = await fetch(`${base}/api/ghost/state`);
      if (!response.ok) {
        setLiveActivity("SERVER_DISCONNECTED");
        setStatus(AnalysisStatus.ERROR);
        return;
      }
      
      const data = await response.json();
      
      // Deduplicate by ID to prevent React key warnings
      const deduplicate = (arr: any[]) => {
        if (!Array.isArray(arr)) return [];
        const seen = new Set();
        return arr.filter(item => {
          if (!item.id) return true;
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
      };

      setThoughtHistory(deduplicate(data.thoughts));
      setActivePositions(data.activePositions || []);
      setExecutionLogs(deduplicate(data.executionLogs));
      setStats({
        eur: Number(data.liquidity?.eur) || 0,
        usdc: Number(data.liquidity?.usdc) || 0,
        trades: Number(data.dailyStats?.trades) || 0,
        profit: Number(data.dailyStats?.profit) || 0,
        totalProfit: Number(data.totalProfit) || 0,
        isPaper: data.isPaperMode !== false,
        dailyGoal: Number(data.dailyStats?.dailyGoal) || 50
      });
      
      setIsEngineActive(!!data.isEngineActive);
      setAutoTradeEnabled(!!data.autoPilot);
      setIsPaperMode(!!data.isPaperMode);
      setSettings(data.settings || {});
      setLiveActivity(data.currentStatus || "IDLE");
      
      // Detect AI Key Error in thoughts
      const hasKeyError = (data.thoughts || []).some((t: any) => t.analysis && (t.analysis.includes('کلید') || t.analysis.includes('API key')));
      if (hasKeyError) {
        setStatus(AnalysisStatus.KEY_REQUIRED);
      } else {
        setStatus(AnalysisStatus.IDLE);
      }
    } catch {
      setLiveActivity("BRIDGE_OFFLINE");
      setStatus(AnalysisStatus.ERROR);
    }
  }, []);

  const handleUpdateBridge = (url: string) => {
    try {
      localStorage.setItem('NOVA_BRIDGE_URL', url.trim());
    } catch (e) {
      console.warn("Failed to save bridge URL", e);
    }
    setBridgeUrl(url.trim());
    syncWithServer();
  };

  const toggleEngine = async () => {
    const newState = !isEngineActive;
    setIsEngineActive(newState);
    try {
      await fetch(`${getApiBase()}/api/ghost/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: newState })
      });
    } catch (e) {
      console.error("Failed to toggle engine", e);
    }
  };

  const toggleAuto = async () => {
    const newState = !autoTradeEnabled;
    setAutoTradeEnabled(newState);
    try {
      await fetch(`${getApiBase()}/api/ghost/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto: newState })
      });
    } catch (e) {
      console.error("Failed to toggle auto trade", e);
    }
  };

  const togglePaper = async () => {
    const newState = !isPaperMode;
    setIsPaperMode(newState);
    try {
      await fetch(`${getApiBase()}/api/ghost/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper: newState })
      });
    } catch (e) {
      console.error("Failed to toggle paper mode", e);
    }
  };

  const updateSettings = async (newSettings: any) => {
    setSettings({ ...settings, ...newSettings });
    try {
      await fetch(`${getApiBase()}/api/ghost/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: newSettings })
      });
    } catch (e) {
      console.error("Failed to update settings", e);
    }
  };

  useEffect(() => {
    syncWithServer();
    const interval = setInterval(syncWithServer, 4000);
    const statsInterval = setInterval(() => {
      WATCHLIST.forEach(id => {
        fetchProductStats(id).then(info => {
          setAssets(prev => {
            const filtered = prev.filter(a => a.id !== id);
            return [...filtered, info].sort((a,b) => a.id.localeCompare(b.id));
          });
        }).catch((err) => {
          console.error(`Failed to fetch stats for ${id}`, err);
        });
      });
    }, 8000);

    // AI Analysis Loop (Frontend-side to use platform key)
    const aiInterval = setInterval(async () => {
      if (aiProcessingRef.current) return;
      aiProcessingRef.current = true;

      try {
        const base = getApiBase();
        const reqRes = await fetch(`${base}/api/ghost/pending-analysis`);
        if (!reqRes.ok) {
          throw new Error(`HTTP error! status: ${reqRes.status}`);
        }
        const req = await reqRes.json();

        if (req) {
          console.log(`[FRONTEND-AI] Processing ${req.type} for ${req.symbol}...`);
          setLiveActivity(`ANALYZING_${req.symbol}`);
          
          try {
            const apiKey = (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) || "";
            const ai = new GoogleGenAI({ apiKey });
            const history = (req.candles || []).slice(-40).map((c: any) => ({ h: c.high, l: c.low, c: c.close }));
                     const response = await ai.models.generateContent({
              model: 'gemini-3-flash-preview',
              contents: [{ parts: [{ text: `SMC_ANALYSIS_REQUEST: ${req.symbol}
CURRENT_PRICE: ${req.price} EUR
TYPE: ${req.type}
${req.entryPrice ? `EXISTING_ENTRY: ${req.entryPrice} EUR` : ''}

MARKET_DATA_15M_CANDLES:
${JSON.stringify(history)}

TASK:
Perform a professional Smart Money Concepts (SMC) analysis.
1. Identify Market Structure (BOS/CHoCH), Order Blocks (OB), and Fair Value Gaps (FVG).
2. Calculate:
   - entryPrice: The optimal entry point (usually near an OB or FVG). If req.type is SCAN, this should be close to CURRENT_PRICE if the setup is immediate.
   - tp: Take Profit target based on the next liquidity zone or supply/demand area.
   - sl: Stop Loss placed below/above the structural invalidation point.
3. ACCOUNT FOR FEES: 0.8% round-trip. Break-even = entryPrice * 1.008.
4. Only suggest BUY if: ((tp - entryPrice) / entryPrice) - 0.008 > 0.012 (1.2% net profit) AND confidence > 85%.
5. potentialRoi must be the NET profit percentage after subtracting the 0.8% fee.
6. If the setup is not high-probability, return side: "NEUTRAL".

OUTPUT_REQUIREMENTS:
- "analysis", "liquidityAnalysis", and "marketMonitoring" MUST be in PERSIAN (Farsi).
- All prices (tp, sl, entryPrice) must be numbers.
- Return valid JSON only.` }] }],
              config: {
                systemInstruction: `YOU ARE GHOST_SMC_PRO, THE WORLD'S MOST ACCURATE CRYPTO TRADING AI.
You use Smart Money Concepts and Liquidity analysis to find high-probability scalps.
You are conservative and only trade when the risk/reward ratio is excellent.
Always calculate Entry, TP, and SL relative to the current market price provided.

JSON_SCHEMA:
{
  "side": "BUY" | "SELL" | "NEUTRAL",
  "tp": number,
  "sl": number,
  "entryPrice": number,
  "confidence": number (0-100),
  "potentialRoi": number (NET % profit after 0.8% fees),
  "estimatedTime": string,
  "liquidityAnalysis": string (Persian),
  "marketMonitoring": string (Persian),
  "analysis": string (Persian)
}`,
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    side: { type: Type.STRING, enum: ['BUY', 'SELL', 'NEUTRAL'] },
                    tp: { type: Type.NUMBER },
                    sl: { type: Type.NUMBER },
                    entryPrice: { type: Type.NUMBER },
                    confidence: { type: Type.NUMBER },
                    potentialRoi: { type: Type.NUMBER },
                    estimatedTime: { type: Type.STRING },
                    liquidityAnalysis: { type: Type.STRING },
                    marketMonitoring: { type: Type.STRING },
                    analysis: { type: Type.STRING }
                  },
                  required: ['side', 'tp', 'sl', 'entryPrice', 'confidence', 'potentialRoi', 'analysis', 'estimatedTime', 'liquidityAnalysis', 'marketMonitoring']
                },
                temperature: 0.2
              }
            });

            const rawText = response.text?.trim() || '{}';
            console.log(`[FRONTEND-AI] AI Raw Response for ${req.symbol}:`, rawText);
            const result = JSON.parse(rawText);
            
            // Normalize confidence
            if (result.confidence !== undefined && result.confidence > 0 && result.confidence <= 1) {
              result.confidence = Math.round(result.confidence * 100);
            }

            const analysisResult = {
              ...result,
              id: crypto.randomUUID ? crypto.randomUUID() : `ghost-${Date.now()}-${Math.random().toString(36).substring(7)}`,
              symbol: req.symbol,
              timestamp: new Date().toISOString()
            };

            console.log(`[FRONTEND-AI] Parsed Analysis for ${req.symbol}:`, analysisResult);

            await fetch(`${base}/api/ghost/submit-analysis`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: req.type,
                symbol: req.symbol,
                analysis: analysisResult
              })
            });
            
            console.log(`[FRONTEND-AI] Submitted ${req.type} for ${req.symbol}`);
          } catch (aiError: any) {
            console.error("[FRONTEND-AI] AI Error:", aiError);
            // Submit failure result to backend so it doesn't wait forever
            await fetch(`${base}/api/ghost/submit-analysis`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: req.type,
                symbol: req.symbol,
                analysis: {
                  side: "NEUTRAL",
                  analysis: `خطای هوش مصنوعی: ${aiError.message || "Unknown error"}`,
                  symbol: req.symbol,
                  timestamp: new Date().toISOString(),
                  confidence: 0,
                  potentialRoi: 0,
                  estimatedTime: "--",
                  liquidityAnalysis: "خطا در تحلیل",
                  marketMonitoring: "خطا در نظارت",
                  id: Math.random().toString(36).substring(7)
                }
              })
            });
          }
        }
      } catch (e) {
        console.error("[FRONTEND-AI] Loop Error:", e);
      } finally {
        aiProcessingRef.current = false;
      }
    }, 5000);

    return () => { 
      clearInterval(interval); 
      clearInterval(statsInterval); 
      clearInterval(aiInterval);
    };
  }, [syncWithServer]);

  return (
    <div className="flex flex-col h-screen bg-black text-slate-100 overflow-hidden font-mono">
      <Header 
        status={status} 
        onGenerate={syncWithServer} 
        autoPilot={autoTradeEnabled} 
        scanningSymbol={liveActivity} 
        engineActive={isEngineActive} 
      />
      
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <div className="hidden lg:block">
          <Sidebar 
            assets={assets} 
            selected={selectedAsset} 
            onSelect={setSelectedAsset} 
            autoPilot={autoTradeEnabled} 
            onToggleAuto={toggleAuto} 
            engineActive={isEngineActive} 
            onToggleEngine={toggleEngine} 
            isPaperMode={isPaperMode}
            onTogglePaper={togglePaper}
            viewMode={'terminal'} 
            onViewChange={() => {}} 
            bridgeUrl={bridgeUrl} 
            onUpdateBridge={handleUpdateBridge}
            settings={settings}
            onUpdateSettings={updateSettings}
          />
        </div>
        
        <main className="flex-1 flex flex-col md:flex-row bg-[#020204] overflow-hidden">
          <div className="flex-1 p-3 md:p-6 overflow-y-auto custom-scrollbar">
              <TradingTerminal 
                thoughtHistory={thoughtHistory} 
                liveActivity={liveActivity} 
                activePositions={activePositions}
                executionLogs={executionLogs}
                stats={stats}
              />
          </div>
          
          <div className="w-full md:w-64 lg:w-80 border-t md:border-t-0 md:border-l border-white/5 bg-black/40 flex flex-col h-64 md:h-auto">
            <div className="p-3 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
               <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Signal Feed</span>
               <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse shadow-[0_0_8px_#6366f1]"></div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <SignalList signals={thoughtHistory} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
