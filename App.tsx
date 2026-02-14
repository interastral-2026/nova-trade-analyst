
import React, { useState, useEffect, useCallback } from 'react';
import { AssetInfo, TradeSignal, AnalysisStatus, AccountBalance, ActivePosition, ExecutionLog } from './types.ts';
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
  const [liveActivity, setLiveActivity] = useState<string>("SYNCING_NOVA_CORE...");
  const [status, setStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [bridgeUrl, setBridgeUrl] = useState<string>(getApiBase());
  const [bridgeOnline, setBridgeOnline] = useState<boolean>(false);

  const syncAll = useCallback(async () => {
    const base = getApiBase();
    try {
      const stateRes = await fetch(`${base}/api/ghost/state`).then(r => r.json());
      if (stateRes) {
        setThoughtHistory(stateRes.thoughts || []);
        setIsEngineActive(stateRes.isEngineActive);
        setAutoTradeEnabled(stateRes.autoPilot);
        setLiveActivity(stateRes.currentStatus || "SYSTEM_ACTIVE");
        setBridgeOnline(true);
      }

      const bals = await fetchAccountBalance();
      if (bals) setBalances(bals);

    } catch (e) {
      setBridgeOnline(false);
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
    try {
      await fetch(`${base}/api/ghost/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: !isEngineActive })
      });
      syncAll();
    } catch (e) {}
  };

  const toggleAuto = async () => {
    const base = getApiBase();
    try {
      await fetch(`${base}/api/ghost/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto: !autoTradeEnabled })
      });
      syncAll();
    } catch (e) {}
  };

  useEffect(() => {
    syncAll();
    const interval = setInterval(syncAll, 5000); 
    
    const statsInterval = setInterval(() => {
      WATCHLIST.forEach(id => fetchProductStats(id).then(info => {
        setAssets(prev => [...prev.filter(a => a.id !== id), info]);
      }).catch(() => {}));
    }, 15000);

    return () => {
      clearInterval(interval);
      clearInterval(statsInterval);
    };
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
        <main className="flex-1 p-4 lg:p-8 overflow-y-auto bg-[radial-gradient(ellipse_at_top,_#042f2e_0%,_#000_100%)]">
          
          <div className="max-w-[1800px] mx-auto mb-6 flex space-x-4">
             <div className="px-4 py-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-emerald-400 text-[9px] font-black uppercase tracking-widest flex items-center">
               <span className="w-1.5 h-1.5 rounded-full mr-2 bg-emerald-500 animate-pulse"></span>
               NETWORK_NODE: {bridgeOnline ? 'SYNC_STABLE' : 'LINK_LOST'}
             </div>
             <div className={`px-4 py-2 rounded-xl border ${bridgeOnline ? 'border-cyan-500/20 bg-cyan-500/5 text-cyan-400' : 'border-rose-500/20 bg-rose-500/5 text-rose-400'} text-[9px] font-black uppercase tracking-widest flex items-center`}>
               <span className={`w-1.5 h-1.5 rounded-full mr-2 ${bridgeOnline ? 'bg-cyan-500' : 'bg-rose-500'}`}></span>
               GATEWAY: {bridgeUrl ? bridgeUrl.replace('https://', '') : 'LOCAL_VITE_PROXY'}
             </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 max-w-[1800px] mx-auto">
            <div className="xl:col-span-8">
              <TradingTerminal 
                balances={balances} 
                positions={[]} 
                logs={[]} 
                autoTradeEnabled={autoTradeEnabled} 
                isEngineActive={isEngineActive} 
                onToggleEngine={toggleEngine} 
                onToggleAutoTrade={toggleAuto} 
                totalValue={0} 
                performance={{netProfit:0, grossLoss:0, winRate:0, totalTrades:0, history:[]}} 
                thoughtHistory={thoughtHistory} 
                liveActivity={liveActivity} 
                openOrders={[]} 
                onForceScan={syncAll} 
              />
            </div>
            <div className="xl:col-span-4">
              <SignalList signals={thoughtHistory} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
