
import React, { useState, useEffect, useCallback } from 'react';
import { AssetInfo, TradeSignal, AnalysisStatus, AccountBalance } from './types.ts';
import { fetchProductStats } from './services/coinbaseService.ts';
import { getApiBase } from './services/tradingService.ts';
import Header from './components/Header.tsx';
import Sidebar from './components/Sidebar.tsx';
import SignalList from './components/SignalList.tsx';
import TradingTerminal from './components/TradingTerminal.tsx';

const WATCHLIST = ['BTC-EUR', 'ETH-EUR', 'SOL-EUR', 'AVAX-EUR', 'XRP-EUR', 'DOGE-EUR', 'LINK-EUR', 'ADA-EUR'];

const App: React.FC = () => {
  const [selectedAsset, setSelectedAsset] = useState<string>('BTC-EUR');
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [thoughtHistory, setThoughtHistory] = useState<TradeSignal[]>([]);
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [isEngineActive, setIsEngineActive] = useState<boolean>(true);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState<boolean>(true);
  const [isPaperMode, setIsPaperMode] = useState<boolean>(false);
  const [settings, setSettings] = useState<any>({});
  const [liveActivity, setLiveActivity] = useState<string>("INITIALIZING...");
  const [status, setStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [bridgeUrl, setBridgeUrl] = useState<string>(getApiBase());

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
      setThoughtHistory(data.thoughts || []);
      setIsEngineActive(!!data.isEngineActive);
      setAutoTradeEnabled(!!data.autoPilot);
      setIsPaperMode(!!data.isPaperMode);
      setSettings(data.settings || {});
      setLiveActivity(data.currentStatus || "IDLE");
      
      setBalances([
        { currency: 'EUR', available: Number(data.liquidity?.eur) || 0, total: Number(data.liquidity?.eur) || 0 },
        { currency: 'USDC', available: Number(data.liquidity?.usdc) || 0, total: Number(data.liquidity?.usdc) || 0 }
      ]);
      setStatus(AnalysisStatus.IDLE);
    } catch (e) {
      setLiveActivity("BRIDGE_OFFLINE");
      setStatus(AnalysisStatus.ERROR);
    }
  }, []);

  const handleUpdateBridge = (url: string) => {
    try {
      localStorage.setItem('NOVA_BRIDGE_URL', url.trim());
    } catch (e) {}
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
    } catch (e) {}
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
    } catch (e) {}
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
    } catch (e) {}
  };

  const updateSettings = async (newSettings: any) => {
    setSettings({ ...settings, ...newSettings });
    try {
      await fetch(`${getApiBase()}/api/ghost/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: newSettings })
      });
    } catch (e) {}
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
        }).catch(() => {});
      });
    }, 8000);
    return () => { clearInterval(interval); clearInterval(statsInterval); };
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
