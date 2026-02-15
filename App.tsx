
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
  const [liveActivity, setLiveActivity] = useState<string>("INITIALIZING...");
  const [status, setStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [bridgeUrl, setBridgeUrl] = useState<string>(getApiBase());

  const syncAll = useCallback(async () => {
    const base = getApiBase();
    try {
      const stateRes = await fetch(`${base}/api/ghost/state`).then(r => r.json());
      if (stateRes) {
        setThoughtHistory(stateRes.thoughts || []);
        setIsEngineActive(stateRes.isEngineActive);
        setAutoTradeEnabled(stateRes.autoPilot);
        setLiveActivity(stateRes.currentStatus || "SYSTEM_ACTIVE");
      }
      const bals = await fetchAccountBalance();
      if (bals) setBalances(bals);
    } catch (e) {
      setLiveActivity("BRIDGE_OFFLINE");
    }
  }, []);

  const handleUpdateBridge = (url: string) => {
    localStorage.setItem('NOVA_BRIDGE_URL', url);
    setBridgeUrl(url);
    syncAll();
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
      syncAll();
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
      syncAll();
    } catch (e) {}
  };

  useEffect(() => {
    syncAll();
    const interval = setInterval(syncAll, 4000); 
    const statsInterval = setInterval(() => {
      WATCHLIST.forEach(id => fetchProductStats(id).then(info => {
        setAssets(prev => {
          const filtered = prev.filter(a => a.id !== id);
          return [...filtered, info].sort((a,b) => a.id.localeCompare(b.id));
        });
      }));
    }, 12000);
    return () => { clearInterval(interval); clearInterval(statsInterval); };
  }, [syncAll]);

  return (
    <div className="flex flex-col h-screen bg-black text-slate-100 overflow-hidden font-mono">
      <Header status={status} onGenerate={syncAll} autoPilot={autoTradeEnabled} scanningSymbol={liveActivity} engineActive={isEngineActive} />
      <div className="flex-1 flex overflow-hidden relative">
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
        <main className="flex-1 flex bg-[#020408]">
          <div className="flex-1 p-8 overflow-y-auto">
              {/* Fix: Removed extra props (positions, logs, totalValue, performance, openOrders) that are not present in TradingTerminalProps to resolve TypeScript error */}
              <TradingTerminal 
                balances={balances} 
                autoTradeEnabled={autoTradeEnabled} 
                isEngineActive={isEngineActive} 
                onToggleEngine={toggleEngine} 
                onToggleAutoTrade={toggleAuto} 
                thoughtHistory={thoughtHistory} 
                liveActivity={liveActivity} 
                onForceScan={syncAll} 
              />
          </div>
          <div className="w-96 border-l border-white/5 p-6 overflow-y-auto custom-scrollbar bg-black/40">
              <div className="mb-6 flex justify-between items-center">
                 <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Tactical Signals</h3>
                 <span className="text-[8px] font-black text-slate-600">LIVE_FEED</span>
              </div>
              <SignalList signals={thoughtHistory} />
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
