
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
  const [activeTab, setActiveTab] = useState<'stream' | 'activity' | 'holdings'>('holdings');
  const terminalRef = useRef<HTMLDivElement>(null);

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
    } catch (e) {
      console.error("Terminal fetch failed");
    }
  };

  useEffect(() => {
    fetchState();
    const i = setInterval(fetchState, 2000);
    return () => clearInterval(i);
  }, []);

  const goalProgress = Math.max(0, Math.min(100, (stats.profit / stats.dailyGoal) * 100));

  return (
    <div className="flex flex-col space-y-6 h-full font-mono">
      {/* V27.0 Header */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="col-span-2 bg-[#0a0a0f] border border-indigo-500/20 rounded-3xl p-6 relative overflow-hidden shadow-[0_0_30px_rgba(79,70,229,0.05)]">
           <div className="flex justify-between items-end mb-3 relative z-10">
              <div>
                <p className="text-[8px] font-black text-indigo-400 uppercase tracking-[0.4em] mb-1">PROFIT_HARVEST_V27</p>
                <h3 className="text-2xl font-black text-white">€{stats.profit.toFixed(2)} <span className="text-slate-500 text-sm font-bold">/ €{stats.dailyGoal}</span></h3>
              </div>
              <div className="text-right">
                <span className={`text-[11px] font-black ${goalProgress >= 100 ? 'text-emerald-400 animate-pulse' : 'text-indigo-400'}`}>
                  {goalProgress.toFixed(1)}% TARGET
                </span>
              </div>
           </div>
           <div className="h-2 bg-white/5 rounded-full overflow-hidden relative z-10">
              <div 
                className={`h-full transition-all duration-1000 ${goalProgress >= 100 ? 'bg-emerald-500 shadow-[0_0_15px_#10b981]' : 'bg-gradient-to-r from-indigo-600 to-cyan-400'}`}
                style={{ width: `${goalProgress}%` }}
              ></div>
           </div>
        </div>
        
        <div className="bg-[#0a0a0f] border border-white/5 p-6 rounded-3xl flex flex-col justify-center">
           <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mb-1">UNITS_CAPITAL</p>
           <h2 className="text-xl font-black text-white">€{stats.eur.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h2>
        </div>

        <div className="bg-[#0a0a0f] border border-white/5 p-6 rounded-3xl flex flex-col justify-center relative overflow-hidden">
           <p className="text-[8px] font-black text-rose-500 uppercase tracking-widest mb-1">LINK_STATUS</p>
           <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
              <h2 className="text-[10px] font-black text-white truncate uppercase tracking-tighter">{liveActivity}</h2>
           </div>
           <p className="text-[7px] text-slate-500 mt-1 font-bold uppercase">{stats.diag}</p>
        </div>
      </div>

      <div className="flex-1 bg-[#010103] border border-white/10 rounded-[3rem] overflow-hidden flex flex-col shadow-2xl">
        <div className="px-10 py-6 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
           <div className="flex space-x-8">
              {[
                { id: 'holdings', label: 'Active Units', count: holdings.length },
                { id: 'stream', label: 'Neural Intelligence' },
                { id: 'activity', label: 'Execution Log' }
              ].map((tab) => (
                <button 
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)} 
                  className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all flex items-center space-x-3 ${activeTab === tab.id ? 'text-indigo-400 border-indigo-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}
                >
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className="bg-indigo-500 text-white text-[8px] px-2 py-0.5 rounded-full font-bold">{tab.count}</span>
                  )}
                </button>
              ))}
           </div>
        </div>

        <div ref={terminalRef} className="flex-1 overflow-y-auto p-10 custom-scrollbar">
           {activeTab === 'holdings' && (
             <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {holdings.length === 0 ? (
                   <div className="col-span-full h-80 flex flex-col items-center justify-center opacity-20 text-center">
                      <div className="w-20 h-20 border-4 border-indigo-500/30 rounded-full border-t-indigo-500 animate-spin mb-6"></div>
                      <p className="uppercase text-[12px] font-black tracking-[0.5em]">Scanning For High-Yield Entry...</p>
                   </div>
                ) : (
                  holdings.map((pos) => {
                    const isProfit = pos.pnlPercent >= 0;
                    const roi = pos.pnlPercent.toFixed(2);
                    const currentPrice = pos.currentPrice || pos.entryPrice;
                    const tpDist = Math.max(0, Math.min(100, ((currentPrice - pos.entryPrice) / (pos.tp - pos.entryPrice)) * 100));
                    
                    return (
                      <div key={pos.symbol} className={`group bg-gradient-to-br from-zinc-900/50 to-transparent border-2 p-8 rounded-[2.5rem] relative overflow-hidden transition-all hover:scale-[1.01] ${isProfit ? 'border-emerald-500/20 shadow-[0_0_40px_rgba(16,185,129,0.05)]' : 'border-rose-500/10'}`}>
                         <div className="flex justify-between items-start mb-8">
                            <div className="flex items-center space-x-4">
                               <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black ${isProfit ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                  {pos.symbol[0]}
                               </div>
                               <div>
                                  <h4 className="text-xl font-black text-white uppercase">{pos.symbol}</h4>
                                  <span className="text-[9px] font-black text-slate-500 uppercase">{pos.isPaper ? 'SIM' : 'LIVE'}</span>
                               </div>
                            </div>
                            <div className="text-right">
                               <h2 className={`text-3xl font-black tracking-tighter ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                                 {isProfit ? '+' : ''}{roi}%
                               </h2>
                               <p className={`text-[10px] font-bold ${isProfit ? 'text-emerald-500/60' : 'text-rose-500/60'}`}>€{pos.pnl.toFixed(2)}</p>
                            </div>
                         </div>

                         <div className="grid grid-cols-3 gap-6 p-6 bg-black/40 border border-white/5 rounded-3xl mb-8">
                            <div><span className="text-[8px] text-slate-600 block uppercase mb-1">Entry</span><span className="text-[12px] text-white font-black">€{pos.entryPrice.toLocaleString()}</span></div>
                            <div className="text-center"><span className="text-[8px] text-emerald-500 block uppercase mb-1">TP</span><span className="text-[12px] text-emerald-400 font-black">€{pos.tp.toLocaleString()}</span></div>
                            <div className="text-right"><span className="text-[8px] text-rose-500 block uppercase mb-1">SL</span><span className="text-[12px] text-rose-400 font-black">€{pos.sl.toLocaleString()}</span></div>
                         </div>
                      </div>
                    )
                  })
                )}
             </div>
           )}

           {activeTab === 'stream' && (
             <div className="space-y-6">
                {thoughtHistory.map((t, i) => (
                  <div key={t.id || i} className={`border-l-4 pl-8 py-6 bg-white/[0.01] border-white/5 transition-all hover:bg-white/[0.03] ${t.side === 'BUY' ? 'border-emerald-500 bg-emerald-500/[0.02]' : ''}`}>
                     <div className="flex items-center space-x-6 mb-4">
                        <span className="text-[10px] font-black text-slate-600">[{new Date(t.timestamp).toLocaleTimeString()}]</span>
                        <span className="text-lg font-black text-white uppercase">{t.symbol}</span>
                        <div className={`px-3 py-1 rounded-full text-[10px] font-black ${t.side === 'BUY' ? 'bg-emerald-500 text-black shadow-[0_0_10px_#10b981]' : 'bg-slate-800 text-slate-500'}`}>
                          {t.side} <span className="ml-2 font-bold">{t.confidence}% CONFIDENCE</span>
                        </div>
                     </div>
                     
                     <p className="text-[13px] text-slate-300 leading-relaxed font-medium mb-6 italic pr-10">"{t.analysis}"</p>

                     {(t.side === 'BUY' || t.side === 'SELL') && (
                       <div className="grid grid-cols-3 gap-4 max-w-lg p-4 bg-black/40 border border-white/5 rounded-2xl">
                          <div>
                             <span className="text-[8px] font-black text-slate-600 block uppercase mb-1">Entry Suggestion</span>
                             <span className="text-[11px] font-black text-white">€{(t.entryPrice || 0).toLocaleString()}</span>
                          </div>
                          <div className="text-center">
                             <span className="text-[8px] font-black text-emerald-500 block uppercase mb-1">Target TP</span>
                             <span className="text-[11px] font-black text-emerald-400">€{(t.tp || 0).toLocaleString()}</span>
                          </div>
                          <div className="text-right">
                             <span className="text-[8px] font-black text-rose-500 block uppercase mb-1">Stop Loss</span>
                             <span className="text-[11px] font-black text-rose-400">€{(t.sl || 0).toLocaleString()}</span>
                          </div>
                       </div>
                     )}
                  </div>
                ))}
             </div>
           )}

           {activeTab === 'activity' && (
             <div className="space-y-4">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between p-6 bg-white/[0.02] border border-white/5 rounded-3xl">
                     <div className="flex items-center space-x-6">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg ${log.action === 'BUY' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                           <i className={`fas ${log.action === 'BUY' ? 'fa-arrow-up' : 'fa-arrow-down'}`}></i>
                        </div>
                        <div>
                           <h5 className="text-[14px] font-black text-white uppercase">{log.symbol}</h5>
                           <p className="text-[10px] text-slate-600 font-bold tracking-tighter">{new Date(log.timestamp).toLocaleString()}</p>
                        </div>
                     </div>
                     <div className="text-right">
                        <div className="text-lg font-black text-white">€{log.price.toLocaleString()}</div>
                     </div>
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
