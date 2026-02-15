
import React, { useState, useEffect, useCallback } from 'react';
import { AssetInfo, TradeSignal, AnalysisStatus, AccountBalance } from './types.ts';
import { fetchProductStats } from './services/coinbaseService.ts';
import { getApiBase, fetchAccountBalance } from './services/tradingService.ts';
import Header from './components/Header.tsx';
import Sidebar from './components/Sidebar.tsx';
import SignalList from './components/SignalList.tsx';
import TradingTerminal from './components/TradingTerminal.tsx';

const WATCHLIST = ['BTC-EUR', 'ETH-EUR', 'SOL-EUR', 'AVAX-EUR', 'ADA-EUR', 'LINK-EUR'];

const App: React.FC = () => {
  const [selectedAsset, setSelectedAsset] = useState<string>('BTC-EUR');
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [thoughtHistory, setThoughtHistory] = useState<TradeSignal[]>([]);
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [isEngineActive, setIsEngineActive] = useState<boolean>(true);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState<boolean>(true);
  const [liveActivity, setLiveActivity] = useState<string>("SYSTEM_CONNECTING...");
  const [status, setStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [bridgeUrl, setBridgeUrl] = useState<string>(getApiBase());

  const syncWithServer = useCallback(async () => {
    const base = getApiBase();
    try {
      const response = await fetch(`${base}/api/ghost/state`, {
        headers: { 'Accept': 'application/json' }
      });
      
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      
      const data = await response.json();
      setThoughtHistory(data.thoughts || []);
      setIsEngineActive(data.isEngineActive);
      setAutoTradeEnabled(data.autoPilot);
      setLiveActivity(data.currentStatus || "SYSTEM_SCANNING");
      
      const bals = await fetchAccountBalance();
      if (bals) setBalances(bals);
      setStatus(AnalysisStatus.IDLE);
    } catch (e) {
      setLiveActivity("BRIDGE_OFFLINE (CHECK_SERVER)");
      setStatus(AnalysisStatus.ERROR);
    }
  }, []);

  const handleUpdateBridge = (url: string) => {
    let cleanUrl = url.trim();
    if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);
    localStorage.setItem('NOVA_BRIDGE_URL', cleanUrl);
    setBridgeUrl(cleanUrl);
    syncWithServer();
  };

  const toggleEngine = async () => {
    const base = getApiBase();
    const newState = !isEngineActive;
    setIsEngineActive(newState);
    try {
      await fetch(`${base}/api/ghost/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: newState })
      });
    } catch (e) {}
  };

  const toggleAuto = async () => {
    const base = getApiBase();
    const newState = !autoTradeEnabled;
    setAutoTradeEnabled(newState);
    try {
      await fetch(`${base}/api/ghost/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto: newState })
      });
    } catch (e) {}
  };

  useEffect(() => {
    syncWithServer();
    const interval = setInterval(syncWithServer, 5000); 
    const statsInterval = setInterval(() => {
      WATCHLIST.forEach(id => fetchProductStats(id).then(info => {
        setAssets(prev => {
          const filtered = prev.filter(a => a.id !== id);
          return [...filtered, info].sort((a,b) => a.id.localeCompare(b.id));
        });
      }));
    }, 15000);
    return () => { clearInterval(interval); clearInterval(statsInterval); };
  }, [syncWithServer]);

  return (
    <div className="flex flex-col h-screen bg-black text-slate-100 overflow-hidden font-mono">
      <Header status={status} onGenerate={syncWithServer} autoPilot={autoTradeEnabled} scanningSymbol={liveActivity} engineActive={isEngineActive} />
      <div className="flex-1 flex overflow-hidden relative">
        <Sidebar 
          assets={assets} selected={selectedAsset} onSelect={setSelectedAsset} 
          autoPilot={autoTradeEnabled} onToggleAuto={toggleAuto} 
          engineActive={isEngineActive} onToggleEngine={toggleEngine} 
          viewMode={'terminal'} onViewChange={() => {}} 
          bridgeUrl={bridgeUrl} onUpdateBridge={handleUpdateBridge} 
        />
        <main className="flex-1 flex bg-[#020205]">
          <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
              <TradingTerminal 
                balances={balances} autoTradeEnabled={autoTradeEnabled} 
                isEngineActive={isEngineActive} onToggleEngine={toggleEngine} 
                onToggleAutoTrade={toggleAuto} thoughtHistory={thoughtHistory} 
                liveActivity={liveActivity} onForceScan={syncWithServer} 
              />
          </div>
          <div className="w-80 border-l border-white/5 bg-black/40 flex flex-col">
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
               <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Target Signals</span>
               <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></div>
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
