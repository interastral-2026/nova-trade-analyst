
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
  const [stats, setStats] = useState({ eur: 0, usdc: 0, trades: 0, profit: 0, isPaper: true, lastSync: '', diag: '' });
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [holdings, setHoldings] = useState<any[]>([]);
  const [lastScans, setLastScans] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'stream' | 'activity' | 'holdings'>('stream');
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
          isPaper: data.isPaperMode,
          lastSync: data.lastSync || '',
          diag: data.diag || ''
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
        <div className={`p-5 rounded-[2rem] border transition-all relative overflow-hidden ${stats.isPaper ? 'bg-[#0a0a0c] border-white/5' : 'bg-[#050508] border-emerald-500/30 shadow-lg shadow-emerald-500/5'}`}>
           <div className="absolute top-2 right-4 flex items-center space-x-1">
             <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${stats.isPaper ? 'bg-amber-500' : 'bg-emerald-500'}`}></span> 
             <span className={`text-[7px] font-black uppercase ${stats.isPaper ? 'text-amber-500' : 'text-emerald-500'}`}>
               {stats.isPaper ? 'PAPER_MODE' : 'LIVE_SYNC'}
             </span>
           </div>
           <p className="text-[8px] font-black text-indigo-400 uppercase tracking-widest mb-1">EURO_BALANCE</p>
           <h2 className="text-2xl font-black text-white">€{stats.eur.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h2>
           <p className="text-[6px] text-slate-600 mt-1 uppercase">{stats.diag}</p>
        </div>
        
        <div className="bg-[#050508] border border-cyan-500/20 p-5 rounded-[2rem]">
           <p className="text-[8px] font-black text-cyan-400 uppercase tracking-widest mb-1">USDC_RESERVE</p>
           <h2 className="text-2xl font-black text-white">${stats.usdc.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h2>
        </div>
        
        <div className="bg-[#050508] border border-emerald-500/20 p-5 rounded-[2rem]">
           <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mb-1">TOTAL_OPS</p>
           <h2 className="text-2xl font-black text-white">{stats.trades}</h2>
        </div>
        
        <div className="bg-[#050508] border border-white/5 p-5 rounded-[2rem]">
           <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">ACTIVE_SCAN</p>
           <h2 className="text-[10px] font-black text-white truncate uppercase animate-pulse">{liveActivity || "SLEEPING"}</h2>
        </div>
      </div>

      {/* Main Console */}
      <div className="flex-1 bg-black border border-white/10 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl">
        <div className="px-8 py-5 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
           <div className="flex space-x-6">
              <button onClick={() => setActiveTab('stream')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'stream' ? 'text-indigo-400 border-indigo-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}>
                Neural Stream ({thoughtHistory.length})
              </button>
              <button onClick={() => setActiveTab('activity')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'activity' ? 'text-amber-400 border-amber-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}>
                Scan Log
              </button>
              <button onClick={() => setActiveTab('holdings')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'holdings' ? 'text-cyan-400 border-cyan-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}>
                Tactical Hunts ({holdings.length})
              </button>
           </div>
        </div>

        <div ref={terminalRef} className="flex-1 overflow-y-auto p-8 custom-scrollbar">
           {activeTab === 'stream' && (
             <div className="space-y-6">
                {thoughtHistory.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center opacity-30 text-center">
                    <i className="fas fa-satellite animate-spin text-3xl mb-4 text-indigo-500"></i>
                    <p className="text-[10px] font-black uppercase tracking-[0.4em]">Listening to Market Vibrations...</p>
                    <p className="text-[8px] mt-2 text-slate-600">If this persists, check Gemini API Key</p>
                  </div>
                ) : (
                  thoughtHistory.map((t, i) => (
                    <div key={t.id || i} className={`border-l-2 pl-6 py-4 transition-all relative group ${t.side === 'BUY' ? 'border-emerald-500 bg-emerald-500/[0.02]' : 'border-white/10 hover:border-white/30'}`}>
                       <div className="flex items-center space-x-4 mb-2">
                          <span className="text-[9px] font-black text-indigo-500/60">[{new Date(t.timestamp).toLocaleTimeString()}]</span>
                          <span className="text-sm font-black text-white uppercase tracking-tighter">{t.symbol}</span>
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded border ${t.side === 'BUY' ? 'border-emerald-500/40 text-emerald-400' : 'border-white/10 text-slate-600'}`}>
                            {t.side} @ {t.confidence}%
                          </span>
                       </div>
                       <p className="text-[11px] text-slate-400 leading-relaxed italic pr-12">"{t.reason}"</p>
                       <div className="mt-3 flex space-x-4 text-[9px] font-black">
                          <span className="text-emerald-500/80">TP: €{t.tp}</span>
                          <span className="text-rose-500/80">SL: €{t.sl}</span>
                       </div>
                    </div>
                  ))
                )}
             </div>
           )}

           {activeTab === 'holdings' && (
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {holdings.length === 0 ? (
                   <div className="col-span-2 h-48 flex flex-col items-center justify-center opacity-20 grayscale">
                      <p className="text-[10px] font-black uppercase tracking-widest">No Active Pursuits.</p>
                   </div>
                ) : (
                  holdings.map((pos) => (
                    <div key={pos.symbol} className="bg-white/[0.02] border border-emerald-500/20 p-6 rounded-[2rem] relative overflow-hidden">
                       <div className="flex justify-between items-center mb-6">
                          <h4 className="text-md font-black text-white">{pos.symbol}-EUR</h4>
                          <div className="flex items-center space-x-2">
                             <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
                             <span className="text-[8px] text-emerald-500 font-black">TRACKING</span>
                          </div>
                       </div>
                       <div className="grid grid-cols-2 gap-y-4 text-[10px]">
                          <div><span className="text-slate-600 uppercase block text-[7px] mb-1">Entry</span>€{pos.entryPrice}</div>
                          <div><span className="text-emerald-500/70 uppercase block text-[7px] mb-1">Target</span>€{pos.tp}</div>
                          <div><span className="text-indigo-400 uppercase block text-[7px] mb-1">Size</span>€{pos.amount}</div>
                          <div><span className="text-rose-500/70 uppercase block text-[7px] mb-1">Safety</span>€{pos.sl}</div>
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
