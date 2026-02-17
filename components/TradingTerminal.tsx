
import React, { useState, useEffect, useRef } from 'react';
import { ExecutionLog, ActivePosition, TradeSignal } from '../types';
import { getApiBase } from '../services/tradingService';

interface TradingTerminalProps {
  thoughtHistory: TradeSignal[];
  liveActivity: string;
}

const TradingTerminal: React.FC<TradingTerminalProps> = ({ 
  thoughtHistory,
  liveActivity
}) => {
  const [stats, setStats] = useState({ eur: 0, usdc: 0, trades: 0, profit: 0, isPaper: true, diag: '', dailyGoal: 50 });
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [holdings, setHoldings] = useState<ActivePosition[]>([]);
  const [activeTab, setActiveTab] = useState<'holdings' | 'stream' | 'activity'>('holdings');

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
        diag: data.diag || '',
        dailyGoal: data.dailyStats?.dailyGoal || 50
      });
      setLogs(data.executionLogs || []);
      setHoldings(data.activePositions || []);
    } catch (e) {}
  };

  useEffect(() => {
    fetchState();
    const i = setInterval(fetchState, 2000);
    return () => clearInterval(i);
  }, []);

  const goalProgress = Math.max(0, Math.min(100, (stats.profit / stats.dailyGoal) * 100));

  return (
    <div className="flex flex-col space-y-6 h-full font-mono">
      {/* V28.0 Dashboard Header */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="col-span-2 bg-[#0a0a12] border-2 border-indigo-500/20 rounded-[2.5rem] p-8 relative overflow-hidden">
           <div className="flex justify-between items-end mb-4 relative z-10">
              <div>
                <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.5em] mb-2">PROFIT_HARVEST_V28</p>
                <h3 className="text-3xl font-black text-white">€{stats.profit.toFixed(2)} <span className="text-slate-600 text-lg">/ €{stats.dailyGoal}</span></h3>
              </div>
              <div className="text-right">
                <span className={`text-[12px] font-black ${goalProgress >= 100 ? 'text-emerald-400' : 'text-indigo-500'}`}>
                  {goalProgress.toFixed(1)}% SUCCESS
                </span>
              </div>
           </div>
           <div className="h-3 bg-white/5 rounded-full overflow-hidden relative z-10 border border-white/5">
              <div 
                className={`h-full transition-all duration-1000 ${goalProgress >= 100 ? 'bg-emerald-500 shadow-[0_0_20px_#10b981]' : 'bg-gradient-to-r from-indigo-600 to-cyan-400'}`}
                style={{ width: `${goalProgress}%` }}
              ></div>
           </div>
        </div>
        
        <div className="bg-[#0a0a12] border border-white/5 p-8 rounded-[2.5rem] flex flex-col justify-center">
           <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-2">AVAILABLE_EQUITY</p>
           <h2 className="text-2xl font-black text-white">€{stats.eur.toLocaleString()}</h2>
        </div>

        <div className="bg-[#0a0a12] border border-white/5 p-8 rounded-[2.5rem] flex flex-col justify-center relative overflow-hidden">
           <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-2">NEURAL_LINK</p>
           <div className="flex items-center space-x-3">
              <span className="w-3 h-3 rounded-full bg-rose-500 animate-pulse"></span>
              <h2 className="text-[11px] font-black text-white uppercase truncate">{liveActivity}</h2>
           </div>
        </div>
      </div>

      <div className="flex-1 bg-[#010103] border border-white/10 rounded-[3.5rem] overflow-hidden flex flex-col shadow-2xl">
        <div className="px-12 py-8 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
           <div className="flex space-x-12">
              {[
                { id: 'holdings', label: 'Active Hunts', count: holdings.length },
                { id: 'stream', label: 'Intelligence Stream' },
                { id: 'activity', label: 'Execution Log' }
              ].map((tab) => (
                <button 
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)} 
                  className={`text-[12px] font-black uppercase tracking-widest pb-2 border-b-2 transition-all flex items-center space-x-3 ${activeTab === tab.id ? 'text-indigo-400 border-indigo-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}
                >
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className="bg-indigo-500 text-white text-[9px] px-2.5 py-0.5 rounded-full font-black animate-pulse">{tab.count}</span>
                  )}
                </button>
              ))}
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-12 custom-scrollbar">
           {activeTab === 'holdings' && (
             <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                {holdings.length === 0 ? (
                   <div className="col-span-full h-96 flex flex-col items-center justify-center opacity-20">
                      <div className="w-24 h-24 border-8 border-indigo-500/20 rounded-full border-t-indigo-500 animate-spin mb-8"></div>
                      <p className="uppercase text-[14px] font-black tracking-[0.8em]">Engaging Radar Targets...</p>
                   </div>
                ) : (
                  holdings.map((pos) => {
                    const isProfit = pos.pnlPercent >= 0;
                    return (
                      <div key={pos.symbol} className={`bg-zinc-900/40 border-2 p-10 rounded-[3rem] relative overflow-hidden transition-all hover:scale-[1.01] ${isProfit ? 'border-emerald-500/30' : 'border-rose-500/20'}`}>
                         <div className="flex justify-between items-start mb-10">
                            <div>
                               <h4 className="text-2xl font-black text-white mb-1 uppercase tracking-tighter">{pos.symbol}</h4>
                               <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Live Sniper Logic</span>
                            </div>
                            <div className="text-right">
                               <h2 className={`text-4xl font-black tracking-tighter ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                                 {isProfit ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
                               </h2>
                               <p className="text-[12px] font-black text-slate-500 mt-1">€{pos.pnl.toFixed(2)} ROI</p>
                            </div>
                         </div>

                         <div className="grid grid-cols-3 gap-8 p-8 bg-black/60 border border-white/5 rounded-[2rem] mb-10">
                            <div><span className="text-[9px] text-slate-600 block uppercase mb-1 font-black">Entry</span><span className="text-sm text-white font-black">€{pos.entryPrice.toLocaleString()}</span></div>
                            <div className="text-center"><span className="text-[9px] text-emerald-500 block uppercase mb-1 font-black">TP</span><span className="text-sm text-emerald-400 font-black">€{pos.tp.toLocaleString()}</span></div>
                            <div className="text-right"><span className="text-[9px] text-rose-500 block uppercase mb-1 font-black">SL</span><span className="text-sm text-rose-400 font-black">€{pos.sl.toLocaleString()}</span></div>
                         </div>

                         <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                            <div className={`h-full ${isProfit ? 'bg-emerald-500 shadow-[0_0_15px_#10b981]' : 'bg-rose-500'}`} style={{ width: '100%' }}></div>
                         </div>
                      </div>
                    )
                  })
                )}
             </div>
           )}

           {activeTab === 'stream' && (
             <div className="space-y-8 max-w-5xl mx-auto">
                {thoughtHistory.map((t, i) => (
                  <div key={t.id || i} className={`border-l-4 pl-10 py-8 bg-white/[0.01] border-white/10 rounded-r-3xl transition-all hover:bg-white/[0.03] ${t.side === 'BUY' ? 'border-emerald-500 bg-emerald-500/[0.02]' : ''}`}>
                     <div className="flex items-center space-x-8 mb-4">
                        <span className="text-[12px] font-black text-slate-600">[{new Date(t.timestamp).toLocaleTimeString()}]</span>
                        <span className="text-2xl font-black text-white uppercase">{t.symbol}</span>
                        <div className={`px-4 py-1 rounded-full text-[11px] font-black ${t.side === 'BUY' ? 'bg-emerald-500 text-black shadow-[0_0_15px_#10b981]' : 'bg-slate-800 text-slate-500'}`}>
                          {t.side} | {t.confidence}% CONFIDENCE
                        </div>
                     </div>
                     <p className="text-[15px] text-slate-400 leading-relaxed font-medium mb-8 italic pr-20">"{t.analysis}"</p>
                     
                     {t.side !== 'NEUTRAL' && (
                       <div className="grid grid-cols-3 gap-8 p-6 bg-black/40 border border-white/5 rounded-3xl">
                          <div><p className="text-[9px] font-black text-slate-600 uppercase mb-1">Target Entry</p><p className="text-[14px] font-black text-white">€{t.entryPrice?.toLocaleString()}</p></div>
                          <div className="text-center"><p className="text-[9px] font-black text-emerald-500 uppercase mb-1">Take Profit</p><p className="text-[14px] font-black text-emerald-400">€{t.tp?.toLocaleString()}</p></div>
                          <div className="text-right"><p className="text-[9px] font-black text-rose-500 uppercase mb-1">Stop Loss</p><p className="text-[14px] font-black text-rose-400">€{t.sl?.toLocaleString()}</p></div>
                       </div>
                     )}
                  </div>
                ))}
             </div>
           )}
        </div>
      </div>
    </div>
  );
};

export default TradingTerminal;
