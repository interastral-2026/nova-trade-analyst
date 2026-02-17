
import React, { useState, useEffect } from 'react';
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
  const [stats, setStats] = useState({ eur: 0, usdc: 0, trades: 0, profit: 0, isPaper: true, dailyGoal: 50 });
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
        dailyGoal: data.dailyStats?.dailyGoal || 50
      });
      setLogs(data.executionLogs || []);
      setHoldings(data.activePositions || []);
    } catch (e) {}
  };

  useEffect(() => {
    fetchState();
    const i = setInterval(fetchState, 3000);
    return () => clearInterval(i);
  }, []);

  const goalProgress = Math.max(0, Math.min(100, (stats.profit / stats.dailyGoal) * 100));

  return (
    <div className="flex flex-col space-y-6 h-full font-mono bg-black/50">
      {/* V32 Status Banner */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="col-span-1 md:col-span-2 bg-[#080812] border-2 border-indigo-500/20 rounded-[2.2rem] p-7 shadow-2xl relative overflow-hidden group">
           <div className="flex justify-between items-end mb-4 relative z-10">
              <div>
                <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.5em] mb-1">PROFIT_HARVEST_V32</p>
                <h3 className="text-3xl font-black text-white">€{stats.profit.toFixed(2)} <span className="text-slate-600 text-lg">/ €{stats.dailyGoal}</span></h3>
              </div>
              <div className="text-right">
                <span className={`text-[12px] font-black ${goalProgress >= 100 ? 'text-emerald-400' : 'text-indigo-500'}`}>
                  {goalProgress.toFixed(1)}% GOAL
                </span>
              </div>
           </div>
           <div className="h-3 bg-white/5 rounded-full overflow-hidden border border-white/5 relative z-10">
              <div 
                className={`h-full transition-all duration-1000 ${goalProgress >= 100 ? 'bg-emerald-500 shadow-[0_0_20px_#10b981]' : 'bg-gradient-to-r from-indigo-600 to-cyan-400'}`}
                style={{ width: `${goalProgress}%` }}
              ></div>
           </div>
        </div>
        
        <div className="bg-[#080812] border border-white/10 p-7 rounded-[2.2rem] flex flex-col justify-center shadow-lg">
           <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-1">LIQUIDITY_EUR</p>
           <h2 className="text-2xl font-black text-white tracking-tighter">€{stats.eur.toLocaleString()}</h2>
        </div>

        <div className="bg-[#080812] border border-white/10 p-7 rounded-[2.2rem] flex flex-col justify-center relative overflow-hidden shadow-lg">
           <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-1">RADAR_ACTIVITY</p>
           <div className="flex items-center space-x-3">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse shadow-[0_0_10px_#e11d48]"></span>
              <h2 className="text-[11px] font-black text-white uppercase truncate tracking-tight">{liveActivity}</h2>
           </div>
        </div>
      </div>

      <div className="flex-1 bg-[#010103] border border-white/10 rounded-[3rem] overflow-hidden flex flex-col shadow-2xl relative">
        <div className="px-10 py-6 border-b border-white/5 flex justify-between items-center bg-white/[0.01] backdrop-blur-md">
           <div className="flex space-x-12">
              {[
                { id: 'holdings', label: 'Active Hunts', count: holdings.length },
                { id: 'stream', label: 'Intelligence Stream' },
                { id: 'activity', label: 'Activity Logs' }
              ].map((tab) => (
                <button 
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)} 
                  className={`text-[12px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all flex items-center space-x-3 ${activeTab === tab.id ? 'text-indigo-400 border-indigo-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}
                >
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className="bg-indigo-500 text-white text-[9px] px-2 py-0.5 rounded-full font-black animate-pulse">{tab.count}</span>
                  )}
                </button>
              ))}
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
           {activeTab === 'holdings' && (
             <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                {holdings.length === 0 ? (
                   <div className="col-span-full h-80 flex flex-col items-center justify-center opacity-20 text-center grayscale border border-dashed border-white/5 rounded-[3rem]">
                      <div className="w-20 h-20 border-8 border-indigo-500/10 border-t-indigo-500 rounded-full animate-spin mb-8"></div>
                      <p className="uppercase text-[14px] font-black tracking-[0.5em]">Establishing Target Nodes...</p>
                   </div>
                ) : (
                  holdings.map((pos) => {
                    const isProfit = pos.pnlPercent >= 0;
                    return (
                      <div key={pos.symbol} className={`group bg-[#0a0a14] border-2 p-10 rounded-[3rem] relative overflow-hidden transition-all hover:scale-[1.01] ${isProfit ? 'border-emerald-500/30 shadow-[0_0_50px_rgba(16,185,129,0.05)]' : 'border-rose-500/20 shadow-[0_0_50px_rgba(244,63,94,0.05)]'}`}>
                         <div className="flex justify-between items-start mb-10">
                            <div>
                               <h4 className="text-2xl font-black text-white tracking-tighter uppercase mb-1">{pos.symbol}</h4>
                               <span className="text-[11px] font-black text-slate-600 uppercase tracking-widest">{pos.confidence || 0}% Conf. | {pos.potentialRoi || 0}% ROI</span>
                            </div>
                            <div className="text-right">
                               <h2 className={`text-4xl font-black tracking-tighter ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                                 {isProfit ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
                               </h2>
                               <p className="text-[12px] font-black text-slate-500 mt-1 uppercase">€{pos.pnl.toFixed(2)} ROI</p>
                            </div>
                         </div>

                         <div className="grid grid-cols-3 gap-6 p-8 bg-black/60 border border-white/5 rounded-3xl mb-10 shadow-inner">
                            <div className="text-center">
                              <span className="text-[9px] text-slate-600 block uppercase mb-1 font-black">Entry</span>
                              <span className="text-[14px] text-white font-black tracking-tighter">€{pos.entryPrice.toLocaleString()}</span>
                            </div>
                            <div className="text-center border-x border-white/5">
                              <span className="text-[9px] text-emerald-500 block uppercase mb-1 font-black">Target</span>
                              <span className="text-[14px] text-emerald-400 font-black tracking-tighter">€{pos.tp.toLocaleString()}</span>
                            </div>
                            <div className="text-center">
                              <span className="text-[9px] text-rose-500 block uppercase mb-1 font-black">Stop</span>
                              <span className="text-[14px] text-rose-400 font-black tracking-tighter">€{pos.sl.toLocaleString()}</span>
                            </div>
                         </div>

                         <div className="h-2 bg-white/5 rounded-full overflow-hidden shadow-inner">
                            <div className={`h-full ${isProfit ? 'bg-emerald-500 shadow-[0_0_15px_#10b981]' : 'bg-rose-500 shadow-[0_0_15px_#f43f5e]'}`} style={{ width: '100%' }}></div>
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
                  <div key={t.id || i} className={`border-l-4 pl-10 py-8 bg-white/[0.01] border-white/5 rounded-r-[2.5rem] transition-all hover:bg-white/[0.03] ${t.side === 'BUY' ? 'border-emerald-500 bg-emerald-500/[0.02]' : 'border-slate-800'}`}>
                     <div className="flex items-center space-x-8 mb-4">
                        <span className="text-[12px] font-black text-slate-600">[{new Date(t.timestamp).toLocaleTimeString()}]</span>
                        <span className="text-2xl font-black text-white uppercase tracking-tighter">{t.symbol}</span>
                        <div className={`px-4 py-1.5 rounded-full text-[10px] font-black ${t.side === 'BUY' ? 'bg-emerald-500 text-black shadow-[0_0_20px_#10b981]' : 'bg-slate-800 text-slate-500'}`}>
                          {t.side} | {(t.confidence || 0)}% CONFIDENCE
                        </div>
                     </div>
                     <p className="text-[16px] text-slate-400 leading-relaxed font-medium mb-8 italic pr-20 opacity-90">"{t.analysis}"</p>
                     
                     {t.side !== 'NEUTRAL' && (
                       <div className="grid grid-cols-3 gap-8 max-w-2xl p-6 bg-black/40 border border-white/5 rounded-[2rem] shadow-xl">
                          <div>
                             <p className="text-[9px] font-black text-slate-600 uppercase mb-1">Target TP</p>
                             <p className="text-[15px] font-black text-emerald-400">€{(t.tp || 0).toLocaleString()}</p>
                          </div>
                          <div className="text-center border-x border-white/5">
                             <p className="text-[9px] font-black text-slate-600 uppercase mb-1">Risk SL</p>
                             <p className="text-[15px] font-black text-rose-400">€{(t.sl || 0).toLocaleString()}</p>
                          </div>
                          <div className="text-right">
                             <p className="text-[9px] font-black text-slate-600 uppercase mb-1">Est. ROI</p>
                             <p className="text-[15px] font-black text-indigo-400">+{(t.potentialRoi || 0)}%</p>
                          </div>
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
