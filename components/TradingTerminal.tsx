
import React, { useState, useEffect, useRef } from 'react';
import { ExecutionLog } from '../types';
import { getApiBase } from '../services/tradingService';

interface TradingTerminalProps {
  balances: any[];
  autoTradeEnabled: boolean;
  isEngineActive: boolean;
  onToggleEngine: () => void;
  onToggleAutoTrade: () => void;
  thoughtHistory: any[];
  liveActivity?: string;
  onForceScan?: () => void;
}

const TradingTerminal: React.FC<TradingTerminalProps> = ({ 
  autoTradeEnabled,
  thoughtHistory,
  liveActivity
}) => {
  const [stats, setStats] = useState({ eur: 0, usdc: 0, trades: 0, profit: 0, isPaper: true });
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [holdings, setHoldings] = useState<any[]>([]);
  const [lastScans, setLastScans] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'stream' | 'activity' | 'holdings' | 'orders'>('stream');
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchState = async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/ghost/state`);
        const data = await res.json();
        setStats({ 
          eur: data.liquidity?.eur || 0, 
          usdc: data.liquidity?.usdc || 0,
          trades: data.dailyStats?.trades || 0, 
          profit: data.dailyStats?.profit || 0,
          isPaper: data.isPaperMode || false
        });
        setLogs(data.executionLogs || []);
        setHoldings(data.activePositions || []);
        setLastScans(data.lastScans || []);
      } catch (e) {}
    };
    fetchState();
    const i = setInterval(fetchState, 3000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="flex flex-col space-y-6 h-full font-mono">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className={`border p-5 rounded-[2rem] shadow-xl relative overflow-hidden transition-all ${stats.isPaper ? 'bg-[#0a0a0c] border-white/5' : 'bg-[#050508] border-emerald-500/30 shadow-emerald-500/5'}`}>
           {!stats.isPaper && <div className="absolute top-2 right-4 flex items-center space-x-1"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span> <span className="text-[7px] text-emerald-500 font-black uppercase">Live Coinbase Sync</span></div>}
           <p className="text-[8px] font-black text-indigo-400 uppercase tracking-widest mb-1">EUR_LIQUIDITY</p>
           <h2 className="text-2xl font-black text-white">€{stats.eur.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h2>
        </div>
        <div className="bg-[#050508] border border-cyan-500/20 p-5 rounded-[2rem]">
           <p className="text-[8px] font-black text-cyan-400 uppercase tracking-widest mb-1">USDC_VAULT</p>
           <h2 className="text-2xl font-black text-white">${stats.usdc.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h2>
        </div>
        <div className="bg-[#050508] border border-emerald-500/20 p-5 rounded-[2rem]">
           <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mb-1">TOTAL_TRADES</p>
           <h2 className="text-2xl font-black text-white">{stats.trades}</h2>
        </div>
        <div className="bg-[#050508] border border-white/5 p-5 rounded-[2rem]">
           <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">ENGINE_STATUS</p>
           <h2 className="text-[10px] font-black text-white truncate uppercase animate-pulse">{liveActivity || "READY"}</h2>
        </div>
      </div>

      {/* Main Console */}
      <div className="flex-1 bg-black border border-white/10 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl">
        <div className="px-8 py-5 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
           <div className="flex space-x-6">
              <button onClick={() => setActiveTab('stream')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'stream' ? 'text-indigo-400 border-indigo-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}>
                Neural Feed ({thoughtHistory.length})
              </button>
              <button onClick={() => setActiveTab('activity')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'activity' ? 'text-amber-400 border-amber-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}>
                Analysis History
              </button>
              <button onClick={() => setActiveTab('holdings')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'holdings' ? 'text-cyan-400 border-cyan-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}>
                Active Hunts ({holdings.length})
              </button>
           </div>
        </div>

        <div ref={terminalRef} className="flex-1 overflow-y-auto p-8 custom-scrollbar">
           {activeTab === 'stream' && (
             <div className="space-y-6">
                {thoughtHistory.length === 0 ? (
                  <div className="h-48 flex flex-col items-center justify-center opacity-20 italic text-xs uppercase tracking-[0.5em]">
                    <i className="fas fa-satellite-dish animate-spin mb-4 text-2xl"></i>
                    Neural Core Probing Assets...
                  </div>
                ) : (
                  thoughtHistory.map((t, i) => (
                    <div key={t.id || i} className={`border-l-2 pl-6 py-2 transition-all relative ${t.confidence >= 75 && t.side === 'BUY' ? 'border-emerald-500 bg-emerald-500/5' : 'border-white/10'}`}>
                       <div className="flex items-center space-x-4 mb-1">
                          <span className="text-[9px] font-black text-indigo-500">[{new Date(t.timestamp).toLocaleTimeString()}]</span>
                          <span className="text-sm font-black text-white uppercase">{t.symbol}</span>
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded border ${t.side === 'BUY' ? 'border-emerald-500 text-emerald-400' : 'border-white/20 text-slate-500'}`}>
                            {t.side}
                          </span>
                          <span className="text-[9px] font-black text-slate-500">CONFIDENCE: {t.confidence}%</span>
                       </div>
                       <p className="text-[11px] text-slate-400 leading-relaxed italic pr-10">"{t.reason}"</p>
                    </div>
                  ))
                )}
             </div>
           )}

           {activeTab === 'holdings' && (
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {holdings.length === 0 ? (
                   <div className="col-span-2 h-48 flex flex-col items-center justify-center opacity-20 grayscale">
                      <p className="text-[10px] font-black uppercase tracking-widest">No Active Positions...</p>
                   </div>
                ) : (
                  holdings.map((pos) => (
                    <div key={pos.symbol} className="bg-white/[0.02] border border-emerald-500/20 p-5 rounded-2xl">
                       <div className="flex justify-between items-center mb-4">
                          <h4 className="text-sm font-black text-white">{pos.symbol}-EUR</h4>
                          <span className="text-[8px] bg-emerald-500 text-black font-black px-2 py-1 rounded">HUNTING</span>
                       </div>
                       <div className="grid grid-cols-2 gap-4 text-[10px]">
                          <div><span className="text-slate-500 uppercase block text-[7px]">Entry</span>€{pos.entryPrice}</div>
                          <div><span className="text-emerald-500 uppercase block text-[7px]">Target</span>€{pos.tp}</div>
                       </div>
                    </div>
                  ))
                )}
             </div>
           )}
        </div>
      </div>
    </div>
  );
};

export default TradingTerminal;
