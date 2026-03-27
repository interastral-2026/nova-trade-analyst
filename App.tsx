
import React, { useState, useEffect, useCallback } from 'react';
import { AssetInfo, TradeSignal, AnalysisStatus, AccountBalance } from './types.ts';
import { fetchProductStats } from './services/coinbaseService.ts';
import { getApiBase } from './services/tradingService.ts';
import Header from './components/Header.tsx';
import Sidebar from './components/Sidebar.tsx';
import SignalList from './components/SignalList.tsx';
import TradingTerminal from './components/TradingTerminal.tsx';

const WATCHLIST = ['XAU-EUR', 'WTI-EUR', 'GBP-EUR'];

const App: React.FC = () => {
  const [selectedAsset, setSelectedAsset] = useState<string>('XAU-EUR');
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [thoughtHistory, setThoughtHistory] = useState<TradeSignal[]>([]);
  const [_balances, setBalances] = useState<AccountBalance[]>([]);
  const [isEngineActive, setIsEngineActive] = useState<boolean>(true);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState<boolean>(true);
  const [isPaperMode, setIsPaperMode] = useState<boolean>(false);
  const [settings, setSettings] = useState<any>({});
  const [liveActivity, setLiveActivity] = useState<string>("INITIALIZING...");
  const [status, setStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [bridgeUrl, setBridgeUrl] = useState<string>(getApiBase());
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [showSignals, setShowSignals] = useState<boolean>(false);

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
    } catch {
      setLiveActivity("BRIDGE_OFFLINE");
      setStatus(AnalysisStatus.ERROR);
    }
  }, []);

  const handleUpdateBridge = (url: string) => {
    try {
      localStorage.setItem('NOVA_BRIDGE_URL', url.trim());
    } catch {
      console.error("Failed to save bridge URL");
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
    } catch {
      console.error("Failed to toggle engine");
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
    } catch {
      console.error("Failed to toggle auto trade");
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
    } catch {
      console.error("Failed to toggle paper mode");
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
    } catch {
      console.error("Failed to update settings");
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      syncWithServer();
    }, 0);
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
    return () => { 
      clearTimeout(timer);
      clearInterval(interval); 
      clearInterval(statsInterval); 
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
      
      {/* Mobile Navigation Bar */}
      <div className="lg:hidden flex border-b border-white/5 bg-[#05070a] px-4 py-2 justify-between items-center z-50">
        <button 
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 text-cyan-500 hover:text-cyan-400"
        >
          <i className={`fas ${mobileMenuOpen ? 'fa-times' : 'fa-bars'} text-xl`}></i>
        </button>
        <div className="flex space-x-4">
          <button 
            onClick={() => setShowSignals(!showSignals)}
            className={`p-2 ${showSignals ? 'text-indigo-400' : 'text-slate-500'}`}
          >
            <i className="fas fa-bolt text-xl"></i>
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar - Responsive */}
        <div className={`
          absolute lg:relative z-40 h-full transition-transform duration-300 transform
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          w-full sm:w-80 flex-shrink-0
        `}>
          <Sidebar 
            assets={assets} 
            selected={selectedAsset} 
            onSelect={(id) => { setSelectedAsset(id); setMobileMenuOpen(false); }} 
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

        {/* Backdrop for mobile sidebar */}
        {mobileMenuOpen && (
          <div 
            className="lg:hidden absolute inset-0 bg-black/60 backdrop-blur-sm z-30"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
        
        <main className="flex-1 flex bg-[#020204] relative">
          <div className="flex-1 p-4 lg:p-6 overflow-y-auto custom-scrollbar">
              <TradingTerminal 
                thoughtHistory={thoughtHistory} 
                liveActivity={liveActivity} 
              />
          </div>
          
          {/* Signal Feed - Responsive Overlay/Column */}
          <div className={`
            absolute lg:relative right-0 z-40 h-full transition-transform duration-300 transform
            ${showSignals ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
            w-full sm:w-80 border-l border-white/5 bg-black/95 lg:bg-black/40 flex flex-col
          `}>
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
               <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Signal Feed</span>
               <div className="flex items-center space-x-3">
                 <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse shadow-[0_0_8px_#6366f1]"></div>
                 <button className="lg:hidden text-slate-500" onClick={() => setShowSignals(false)}>
                   <i className="fas fa-times"></i>
                 </button>
               </div>
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
