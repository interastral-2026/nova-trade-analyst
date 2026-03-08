
import React, { useState } from 'react';
import { ExecutionLog, ActivePosition, TradeSignal } from '../types.ts';

interface TradingTerminalProps {
  thoughtHistory: TradeSignal[];
  liveActivity: string;
  activePositions: ActivePosition[];
  executionLogs: ExecutionLog[];
  stats: {
    eur: number;
    usdc: number;
    trades: number;
    profit: number;
    totalProfit: number;
    isPaper: boolean;
    dailyGoal: number;
  };
}

const TradingTerminal: React.FC<TradingTerminalProps> = ({ 
  thoughtHistory = [],
  liveActivity = "IDLE",
  activePositions = [],
  executionLogs = [],
  stats
}) => {
  const [activeTab, setActiveTab] = useState<'holdings' | 'stream' | 'activity'>('holdings');

  const goalProgress = stats.dailyGoal > 0 ? Math.max(0, Math.min(100, (stats.profit / stats.dailyGoal) * 100)) : 0;

  const formatPrice = (val: any) => {
    const num = Number(val);
    if (isNaN(num)) return "0.00";
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const getSafeNum = (val: any) => {
    const n = Number(val);
    return isNaN(n) ? 0 : n;
  };

  return (
    <div className="flex flex-col space-y-6 h-full font-mono bg-black/50">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="col-span-2 bg-[#080812] border border-indigo-500/20 rounded-3xl p-5 shadow-2xl relative overflow-hidden group">
           <div className="flex justify-between items-end mb-3 relative z-10">
              <div>
                <p className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.3em] mb-1">DAILY_PROFIT</p>
                <h3 className="text-2xl font-black text-white">€{getSafeNum(stats.profit).toFixed(2)} <span className="text-slate-600 text-sm">/ €{stats.dailyGoal}</span></h3>
              </div>
              <div className="text-right">
                <span className={`text-[10px] font-black ${goalProgress >= 100 ? 'text-emerald-400' : 'text-indigo-500'}`}>
                   {goalProgress.toFixed(0)}%
                </span>
              </div>
           </div>
           <div className="h-2 bg-white/5 rounded-full overflow-hidden border border-white/5 relative z-10">
              <div 
                className={`h-full transition-all duration-1000 ${goalProgress >= 100 ? 'bg-emerald-500 shadow-[0_0_15px_#10b981]' : 'bg-gradient-to-r from-indigo-600 to-cyan-400'}`}
                style={{ width: `${goalProgress}%` }}
              ></div>
           </div>
        </div>
        
        <div className="bg-[#080812] border border-white/10 p-5 rounded-3xl flex flex-col justify-center shadow-lg">
           <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1">TOTAL</p>
           <h2 className="text-xl font-black text-white tracking-tighter">€{formatPrice(stats.totalProfit)}</h2>
        </div>

        <div className="bg-[#080812] border border-white/10 p-5 rounded-3xl flex flex-col justify-center shadow-lg">
           <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest mb-1">CASH</p>
           <h2 className="text-xl font-black text-white tracking-tighter">€{formatPrice(stats.eur)}</h2>
        </div>

        <div className="bg-[#080812] border border-white/10 p-5 rounded-3xl flex flex-col justify-center relative overflow-hidden shadow-lg col-span-2 lg:col-span-1">
           <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest mb-1">RADAR</p>
           <div className="flex items-center space-x-2">
              <span className={`w-2 h-2 rounded-full ${liveActivity.includes('ANALYZING') ? 'bg-cyan-500 animate-ping' : 'bg-rose-600 animate-pulse'} shadow-[0_0_8px_#e11d48]`}></span>
              <h2 className={`text-[10px] font-black uppercase truncate tracking-tight ${liveActivity.includes('ANALYZING') ? 'text-cyan-400' : 'text-white'}`}>
                {liveActivity || "READY"}
              </h2>
           </div>
        </div>
      </div>

      <div className="flex-1 bg-[#010103] border border-white/10 rounded-[3rem] overflow-hidden flex flex-col shadow-2xl relative">
        <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-white/[0.01] backdrop-blur-md">
           <div className="flex space-x-8">
              {[
                { id: 'holdings', label: 'Hunts', count: activePositions.length },
                { id: 'stream', label: 'Intelligence' },
                { id: 'activity', label: 'Logs' }
              ].map((tab) => (
                <button 
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)} 
                  className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all flex items-center space-x-2 ${activeTab === tab.id ? 'text-indigo-400 border-indigo-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}
                >
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className="bg-indigo-500 text-white text-[8px] px-1.5 py-0.5 rounded-full font-black animate-pulse">{tab.count}</span>
                  )}
                </button>
              ))}
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
           {activeTab === 'holdings' && (
             <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 lg:gap-6">
                {activePositions.length === 0 ? (
                   <div className="col-span-full h-64 flex flex-col items-center justify-center opacity-20 text-center grayscale border border-dashed border-white/10 rounded-[2rem] bg-white/[0.01]">
                      <div className="w-12 h-12 border-4 border-indigo-500/10 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
                      <p className="uppercase text-[10px] font-black tracking-[0.3em] text-indigo-400">Establishing Target Nodes...</p>
                   </div>
                ) : (
                   activePositions.map((pos) => {
                    const isProfit = getSafeNum(pos.pnlPercent) >= 0;
                    const roi = getSafeNum(pos.pnlPercent);
                    const pnl = getSafeNum(pos.pnl);
                    
                    return (
                      <div key={pos.id || pos.symbol} className={`group bg-[#080812] border p-5 lg:p-6 rounded-[2rem] relative overflow-hidden transition-all hover:border-indigo-500/40 ${isProfit ? 'border-emerald-500/20 shadow-[0_0_40px_rgba(16,185,129,0.03)]' : 'border-rose-500/20 shadow-[0_0_40px_rgba(244,63,94,0.03)]'}`}>
                         {/* Header Section */}
                         <div className="flex justify-between items-start mb-5">
                            <div className="flex items-center space-x-3">
                               <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-lg ${isProfit ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                 {pos.symbol[0]}
                               </div>
                               <div>
                                  <h4 className="text-xl font-black text-white tracking-tighter uppercase leading-none">{pos.symbol}</h4>
                                  <div className="flex items-center space-x-2 mt-1">
                                     <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">{getSafeNum(pos.confidence)}% CONF</span>
                                     <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
                                     <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest">SMC_HUNT</span>
                                  </div>
                               </div>
                            </div>
                            <div className="text-right">
                               <div className={`text-2xl font-black tracking-tighter leading-none ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                                 {isProfit ? '+' : ''}{roi.toFixed(2)}%
                               </div>
                               <p className="text-[10px] font-black text-slate-500 mt-1 uppercase">€{pnl.toFixed(2)} ROI</p>
                            </div>
                         </div>

                         {/* Price Grid */}
                         <div className="grid grid-cols-3 gap-2 mb-5">
                            <div className="bg-black/40 border border-white/5 p-3 rounded-2xl text-center">
                              <span className="text-[7px] text-slate-600 block uppercase mb-1 font-black tracking-widest">Entry</span>
                              <span className="text-[10px] text-white font-black tracking-tighter">€{formatPrice(pos.entryPrice)}</span>
                            </div>
                            <div className="bg-emerald-500/[0.02] border border-emerald-500/10 p-3 rounded-2xl text-center">
                              <span className="text-[7px] text-emerald-500 block uppercase mb-1 font-black tracking-widest">Target</span>
                              <span className="text-[10px] text-emerald-400 font-black tracking-tighter">€{formatPrice(pos.tp)}</span>
                            </div>
                            <div className="bg-rose-500/[0.02] border border-rose-500/10 p-3 rounded-2xl text-center">
                              <span className="text-[7px] text-rose-500 block uppercase mb-1 font-black tracking-widest">Stop</span>
                              <span className="text-[10px] text-rose-400 font-black tracking-tighter">€{formatPrice(pos.sl)}</span>
                            </div>
                         </div>

                         {/* AI Analysis Section - Stable Layout */}
                         <div className="mb-5 p-4 bg-indigo-900/10 border border-indigo-500/20 rounded-2xl relative min-h-[160px] flex flex-col">
                           <div className="absolute -top-2.5 left-4 bg-[#080812] px-2 py-0.5 border border-indigo-500/20 rounded-full flex items-center space-x-1.5">
                             <div className="w-1 h-1 rounded-full bg-indigo-500 animate-pulse"></div>
                             <span className="text-[7px] font-black text-indigo-400 uppercase tracking-widest">Neural Analysis</span>
                           </div>
                           
                           <div className="flex justify-between items-center mb-3 mt-1">
                             <div className="flex items-center space-x-2">
                               <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest ${
                                 pos.lastDecision === 'BUY' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                                 pos.lastDecision === 'SELL' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                                 'bg-slate-800 text-slate-400 border border-slate-700'
                               }`}>
                                 {pos.lastDecision === 'NEUTRAL' ? 'HOLDING' : (pos.lastDecision || 'SCANNING')}
                               </span>
                               <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                                 ETA: {pos.estimatedTime || "--"}
                               </span>
                               {pos.lastChecked && (
                                 <span className="text-[7px] font-black text-slate-500 uppercase tracking-widest">
                                   CHECKED: {new Date(pos.lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                 </span>
                               )}
                             </div>
                           </div>
                           
                           <div className="flex-1 overflow-y-auto custom-scrollbar max-h-32">
                             <p className="text-[10px] text-indigo-100/80 leading-relaxed font-medium italic mb-4" dir="auto">
                                {pos.lastAnalysis ? `"${pos.lastAnalysis}"` : "در حال دریافت تحلیل اولیه هوش مصنوعی..."}
                             </p>

                             <div className="space-y-3 pt-3 border-t border-white/5">
                               <div className="flex items-start space-x-2">
                                 <div className="w-4 flex justify-center mt-0.5">
                                   <i className="fas fa-droplet text-cyan-500 text-[8px]"></i>
                                 </div>
                                 <div className="flex-1">
                                   <span className="text-[7px] text-slate-500 uppercase font-black block mb-0.5">نقدینگی (Liquidity)</span>
                                   <p className="text-[9px] text-slate-300 leading-tight font-medium" dir="auto">
                                     {pos.liquidityAnalysis || "در حال بررسی سطوح نقدینگی..."}
                                   </p>
                                 </div>
                               </div>
                               <div className="flex items-start space-x-2">
                                 <div className="w-4 flex justify-center mt-0.5">
                                   <i className="fas fa-eye text-amber-500 text-[8px]"></i>
                                 </div>
                                 <div className="flex-1">
                                   <span className="text-[7px] text-slate-500 uppercase font-black block mb-0.5">نظارت بازار (Monitoring)</span>
                                   <p className="text-[9px] text-slate-300 leading-tight font-medium" dir="auto">
                                     {pos.marketMonitoring || "در حال پایش نوسانات بازار..."}
                                   </p>
                                 </div>
                               </div>
                             </div>
                           </div>
                         </div>

                         {/* Progress Bar */}
                         <div className="relative h-1.5 bg-white/5 rounded-full overflow-hidden shadow-inner">
                            <div 
                              className={`absolute top-0 left-0 h-full transition-all duration-1000 ${isProfit ? 'bg-emerald-500 shadow-[0_0_15px_#10b981]' : 'bg-rose-500 shadow-[0_0_15px_#f43f5e]'}`} 
                              style={{ width: `${Math.max(5, Math.min(100, (roi + 5) * 10))}%` }}
                            ></div>
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
                  <div key={t.id || i} className={`border-l-4 pl-10 py-8 bg-white/[0.01] border-white/5 rounded-r-[2.5rem] transition-all hover:bg-white/[0.03] ${
                    t.side === 'BUY' ? 'border-emerald-500 bg-emerald-500/[0.02]' : 
                    t.side === 'SELL' ? 'border-rose-500 bg-rose-500/[0.02]' : 
                    'border-slate-800 bg-slate-800/[0.01]'
                  }`}>
                     <div className="flex items-center space-x-8 mb-4">
                        <span className="text-[12px] font-black text-slate-600">[{t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : "00:00"}]</span>
                        <span className="text-2xl font-black text-white uppercase tracking-tighter">{t.symbol}</span>
                        <div className={`px-4 py-1.5 rounded-full text-[10px] font-black ${
                          t.side === 'BUY' ? 'bg-emerald-500 text-black shadow-[0_0_20px_#10b981]' : 
                          t.side === 'SELL' ? 'bg-rose-500 text-white shadow-[0_0_20px_#f43f5e]' : 
                          'bg-slate-800 text-slate-500'
                        }`}>
                          {t.side === 'NEUTRAL' ? 'WAIT' : t.side} | {getSafeNum(t.confidence)}% CONFIDENCE
                        </div>
                        {t.decision && (
                          <div className={`px-4 py-1.5 rounded-full text-[9px] font-black border uppercase tracking-widest ${
                            t.decision.includes('EXECUTED') ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/5' : 
                            t.decision.includes('FAILED') ? 'border-rose-500/50 text-rose-400 bg-rose-500/5' : 
                            'border-white/10 text-slate-500 bg-white/5'
                          }`}>
                            {t.decision}
                          </div>
                        )}
                     </div>
                     <p className="text-[16px] text-slate-400 leading-relaxed font-medium mb-8 italic pr-20 opacity-90 whitespace-pre-wrap" dir="auto">"{t.analysis || "No analysis data."}"</p>
                     
                     {t.side !== 'NEUTRAL' && (
                       <div className="grid grid-cols-3 gap-8 max-w-2xl p-6 bg-black/40 border border-white/5 rounded-[2rem] shadow-xl">
                          <div>
                             <p className="text-[9px] font-black text-slate-600 uppercase mb-1">Target TP</p>
                             <p className="text-[15px] font-black text-emerald-400">€{formatPrice(t.tp)}</p>
                          </div>
                          <div className="text-center border-x border-white/5">
                             <p className="text-[9px] font-black text-slate-600 uppercase mb-1">Risk SL</p>
                             <p className="text-[15px] font-black text-rose-400">€{formatPrice(t.sl)}</p>
                          </div>
                          <div className="text-right">
                             <p className="text-[9px] font-black text-slate-600 uppercase mb-1">Est. ROI</p>
                             <p className="text-[15px] font-black text-indigo-400">+{getSafeNum(t.potentialRoi).toFixed(1)}%</p>
                          </div>
                       </div>
                     )}
                  </div>
                ))}
             </div>
           )}

           {activeTab === 'activity' && (
              <div className="space-y-4 max-w-5xl mx-auto">
                 {executionLogs.length === 0 ? (
                   <p className="text-slate-600 text-[10px] uppercase font-black text-center py-20">No execution logs found.</p>
                 ) : (
                   executionLogs.map(log => (
                     <div key={log.id} className="bg-[#0a0a14] border border-white/5 p-6 rounded-2xl flex justify-between items-center group hover:border-indigo-500/30 transition-all">
                        <div className="flex items-center space-x-6">
                           <div className={`w-10 h-10 rounded-full flex items-center justify-center ${log.action === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : log.action === 'SELL' ? 'bg-rose-500/10 text-rose-400' : 'bg-indigo-500/10 text-indigo-400'}`}>
                              <i className={`fas ${log.action === 'BUY' ? 'fa-shopping-cart' : log.action === 'SELL' ? 'fa-hand-holding-usd' : 'fa-sync-alt'}`}></i>
                           </div>
                           <div>
                              <p className="text-[10px] text-slate-500 mb-1">{new Date(log.timestamp).toLocaleString()}</p>
                              <h5 className="text-sm font-black text-white uppercase tracking-tight">
                                {log.symbol} / {log.action} @ €{formatPrice(log.price)}
                              </h5>
                              {log.details && (
                                <p className="text-[10px] text-indigo-400/70 mt-1 font-black uppercase tracking-widest">{log.details}</p>
                              )}
                           </div>
                        </div>
                        <div className="text-right">
                           {log.pnl !== undefined && log.pnl !== 0 && (
                             <p className={`text-sm font-black mb-1 ${log.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                               {log.pnl >= 0 ? '+' : ''}€{log.pnl.toFixed(2)}
                             </p>
                           )}
                           <span className={`text-[9px] font-black px-2 py-1 rounded uppercase tracking-widest ${log.status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                             {log.status}
                           </span>
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
