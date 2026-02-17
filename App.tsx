
import React, { useState, useEffect, useCallback } from 'react';
import { AssetInfo, TradeSignal, AnalysisStatus, AccountBalance } from './types';
import { fetchProductStats } from './services/coinbaseService';
import { getApiBase } from './services/tradingService';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import SignalList from './components/SignalList';
import TradingTerminal from './components/TradingTerminal';

const WATCHLIST = ['BTC-EUR', 'ETH-EUR', 'SOL-EUR', 'AVAX-EUR', 'NEAR-EUR', 'FET-EUR'];

const App: React.FC = () => {
  const [selectedAsset, setSelectedAsset] = useState<string>('BTC-EUR');
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [thoughtHistory, setThoughtHistory] = useState<TradeSignal[]>([]);
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [isEngineActive, setIsEngineActive] = useState<boolean>(true);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState<boolean>(true);
  const [liveActivity, setLiveActivity] = useState<string>("INITIALIZING...");
  const [status, setStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [bridgeUrl, setBridgeUrl] = useState<string>(getApiBase());

  const syncWithServer = useCallback(async () => {
    try {
      const response = await fetch(`${getApiBase()}/api/ghost/state`);
      if (!response.ok) {
        setLiveActivity("SERVER_DISCONNECTED");
        setStatus(AnalysisStatus.ERROR);
        return;
      }
      
      const data = await response.json();
      setThoughtHistory(data.thoughts || []);
      setIsEngineActive(data.isEngineActive);
      setAutoTradeEnabled(data.autoPilot);
      setLiveActivity(data.currentStatus || "IDLE");
      
      setBalances([
        { currency: 'EUR', available: data.liquidity?.eur || 0, total: data.liquidity?.eur || 0 },
        { currency: 'USDC', available: data.liquidity?.usdc || 0, total: data.liquidity?.usdc || 0 }
      ]);
      setStatus(AnalysisStatus.IDLE);
    } catch (e) {
      setLiveActivity("BRIDGE_OFFLINE");
      setStatus(AnalysisStatus.ERROR);
    }
  }, []);

  const handleUpdateBridge = (url: string) => {
    localStorage.setItem('NOVA_BRIDGE_URL', url.trim());
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

  useEffect(() => {
    syncWithServer();
    const interval = setInterval(syncWithServer, 4000);
    const statsInterval = setInterval(() => {
      WATCHLIST.forEach(id => fetchProductStats(id).then(info => {
        setAssets(prev => {
          const filtered = prev.filter(a => a.id !== id);
          return [...filtered, info].sort((a,b) => a.id.localeCompare(b.id));
        });
      }));
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
      
      <div className="flex-1 flex overflow-hidden">
        <Sidebar 
          assets={assets} 
          selected={selectedAsset} 
          onSelect={setSelectedAsset} 
          autoPilot={autoTradeEnabled} 
          onToggleAuto={toggleAuto} 
          engineActive={isEngineActive} 
          onToggleEngine={toggleEngine} 
          viewMode={'terminal'} 
          onViewChange={() => {}} 
          bridgeUrl={bridgeUrl} 
          onUpdateBridge={handleUpdateBridge} 
        />
        
        <main className="flex-1 flex bg-[#020204]">
          <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
              <TradingTerminal 
                thoughtHistory={thoughtHistory} 
                liveActivity={liveActivity} 
              />
          </div>
          
          <div className="w-80 border-l border-white/5 bg-black/40 flex flex-col">
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
               <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Signal Feed</span>
               <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse shadow-[0_0_8px_#6366f1]"></div>
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
