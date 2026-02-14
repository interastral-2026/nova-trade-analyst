
import React, { useState } from 'react';
import { AccountBalance, ActivePosition, TradeSignal, OpenOrder, ExecutionLog, PerformanceStats } from '../types';

interface TradingTerminalProps {
  balances: AccountBalance[];
  positions: ActivePosition[];
  logs: ExecutionLog[];
  autoTradeEnabled: boolean;
  isEngineActive: boolean;
  onToggleEngine: () => void;
  onToggleAutoTrade: () => void;
  totalValue: number;
  performance: PerformanceStats;
  thoughtHistory: TradeSignal[];
  liveActivity?: string;
  openOrders: OpenOrder[];
  diagnostics?: string[];
  onForceScan?: () => void;
}

// @google/genai rule: Ensure components use most recent context if needed, 
// but here we are primarily fixing TypeScript interface mismatch.
const TradingTerminal: React.FC<TradingTerminalProps> = ({ 
  balances, 
  positions, 
  logs,
  autoTradeEnabled,
  isEngineActive,
  onToggleEngine,
  onToggleAutoTrade,
  totalValue,
  performance,
  thoughtHistory,
  liveActivity,
  openOrders,
  diagnostics = [],
  onForceScan
}) => {
  const [tab, setTab] = useState<'exposure' | 'orders' | 'logic'>('orders');
  
  const cashBalance = balances.find(b => b.currency === 'EUR');
  const eurValue = cashBalance?.total || 0;
  // فیلتر کردن ارزهایی که موجودی معنادار دارند
  const cryptoAssets = balances.filter(b => b.currency !== 'EUR' && b.total > 0.0000001);

  return (
    <div className="flex flex-col space-y-6 font-mono">
      {/* Portfolio Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 bg-gradient-to-br from-[#020617] to-black border border-cyan-500/20 p-6 rounded-3xl relative overflow-hidden shadow-2xl">
           <div className="flex justify-between items-start">
              <div>
                 <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em] mb-2">Network Liquidity (EUR)</p>
                 <h2 className="text-4xl font-black text-white tracking-tighter">
                    €{eurValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                 </h2>
                 <p className="text-[10px] text-emerald-400 font-bold mt-2 uppercase tracking-widest flex items-center">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full mr-2 animate-pulse"></span>
                    {liveActivity || "READY_FOR_COMMAND"}
                 </p>
              </div>
              <button 
                onClick={onForceScan}
                className="w-12 h-12 bg-cyan-500/10 rounded-2xl flex items-center justify-center border border-cyan-500/20 hover:bg-cyan-500/20 transition-all text-cyan-400 shadow-lg shadow-cyan-500/5 group"
                title="Trigger Instant Neural Probe"
              >
                 <i className="fas fa-bolt group-hover:scale-125 transition-transform"></i>
              </button>
           </div>
        </div>
        {[
          { label: 'Wallet Matrix', val: cryptoAssets.length, sub: 'Active Assets', color: 'text-cyan-400' },
          { label: 'Strategic Ops', val: positions.length, sub: 'Managed Positions', color: 'text-emerald-400' }
        ].map((stat, i) => (
          <div key={i} className="bg-[#020617] border border-white/5 p-6 rounded-3xl flex flex-col justify-center">
             <p className="text-[8px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1">{stat.label}</p>
             <p className={`text-2xl font-black ${stat.color}`}>{stat.val}</p>
             <p className="text-[7px] text-slate-600 font-bold uppercase mt-1">{stat.sub}</p>
          </div>
        ))}
      </div>

      <div className="bg-[#020617]/90 backdrop-blur-2xl border border-white/5 rounded-3xl overflow-hidden shadow-2xl min-h-[600px] flex flex-col">
         <div className="px-8 pt-6 pb-4 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-cyan-950/20 to-transparent">
            <div className="flex space-x-12">
               {[
                 { id: 'orders', label: 'Tactical Console', icon: 'fa-crosshairs' },
                 { id: 'exposure', label: 'Asset Matrix', icon: 'fa-cube' },
                 { id: 'logic', label: 'Neural Insights', icon: 'fa-brain' }
               ].map(t => (
                 <button 
                   key={t.id} 
                   onClick={() => setTab(t.id as any)} 
                   className={`flex items-center space-x-3 pb-4 text-[10px] font-black uppercase tracking-[0.2em] transition-all relative ${tab === t.id ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300'}`}
                 >
                   <i className={`fas ${t.icon} text-[12px]`}></i>
                   <span>{t.label}</span>
                   {tab === t.id && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-cyan-500 shadow-[0_0_15px_#22d3ee]"></div>}
                 </button>
               ))}
            </div>
         </div>

         <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
            {tab === 'exposure' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 {cryptoAssets.length === 0 ? (
                   <div className="col-span-2 py-32 text-center opacity-20 flex flex-col items-center">
                     <i className="fas fa-box-open text-5xl mb-4"></i>
                     <p className="text-xs font-black uppercase tracking-[0.3em]">No Assets Detected in Wallet</p>
                   </div>
                 ) : cryptoAssets.map(b => {
                   const pos = positions.find(p => p.symbol.startsWith(b.currency));
                   return (
                     <div key={b.currency} className="bg-white/[0.03] border border-white/10 p-6 rounded-2xl hover:border-cyan-500/30 transition-all group">
                        <div className="flex justify-between items-center mb-6">
                           <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-400 font-black text-xs">
                                 {b.currency}
                              </div>
                              <span className="text-sm font-black text-white">{b.currency} Asset</span>
                           </div>
                           <div className="text-right">
                              <p className="text-[8px] text-slate-500 font-black uppercase mb-1">Total Held</p>
                              <span className="text-xs font-black text-slate-200">{b.total.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                           </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 pt-6 border-t border-white/5">
                           <div>
                              <p className="text-[8px] text-cyan-500 font-black uppercase mb-1">Entry Price Node</p>
                              <p className="text-[13px] font-black text-white">
                                {pos?.entryPrice ? `€${pos.entryPrice.toLocaleString()}` : 'CALCULATING...'}
                              </p>
                           </div>
                           <div className="text-right">
                              <p className="text-[8px] text-emerald-500 font-black uppercase mb-1">Current Yield</p>
                              <p className={`text-[13px] font-black ${pos && pos.pnlPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {pos ? `${pos.pnlPercent.toFixed(2)}%` : 'FETCHING...'}
                              </p>
                           </div>
                        </div>
                     </div>
                   );
                 })}
              </div>
            )}

            {tab === 'orders' && (
              <div className="space-y-4">
                 {positions.length === 0 ? (
                    <div className="py-32 text-center opacity-20 flex flex-col items-center">
                       <i className="fas fa-radar text-6xl mb-6 animate-pulse"></i>
                       <p className="text-[10px] font-black uppercase tracking-[0.4em]">Listening for Tactical Market Entries...</p>
                    </div>
                 ) : (
                    positions.map(p => (
                      <div key={p.id} className="bg-gradient-to-r from-cyan-950/20 to-black/40 border border-cyan-500/20 p-8 rounded-3xl relative overflow-hidden group">
                         <div className="absolute top-0 right-0 p-4">
                            <span className="text-[8px] font-black bg-cyan-500 text-black px-3 py-1 rounded uppercase tracking-widest">Live Execution</span>
                         </div>
                         <div className="flex justify-between items-center mb-8">
                            <div>
                               <h3 className="text-2xl font-black text-white tracking-tighter mb-1">{p.symbol}</h3>
                               <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.2em]">{p.strategyPlan || 'PRO_QUANT_LOGIC'}</p>
                            </div>
                            <div className="text-right">
                               <p className={`text-3xl font-black ${p.pnlPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                 {p.pnlPercent >= 0 ? '+' : ''}{p.pnlPercent.toFixed(2)}%
                               </p>
                               <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest">Real-time Floating PnL</p>
                            </div>
                         </div>
                         <div className="grid grid-cols-3 gap-4">
                            {[
                              { label: 'Entry Node', val: `€${p.entryPrice.toLocaleString()}`, color: 'text-slate-300' },
                              { label: 'Profit Target', val: `€${p.tp.toLocaleString()}`, color: 'text-emerald-400' },
                              { label: 'Protection Stop', val: `€${p.sl.toLocaleString()}`, color: 'text-rose-400' }
                            ].map((m, i) => (
                              <div key={i} className="bg-black/60 p-5 rounded-2xl border border-white/5">
                                 <p className="text-[8px] text-slate-500 font-black uppercase mb-2">{m.label}</p>
                                 <p className={`text-sm font-black ${m.color}`}>{m.val}</p>
                              </div>
                            ))}
                         </div>
                      </div>
                    ))
                 )}
              </div>
            )}

            {tab === 'logic' && (
              <div className="space-y-6">
                 {/* Diagnostics Engine Output */}
                 <div className="bg-black/80 border border-white/5 rounded-3xl p-6 shadow-xl">
                    <h5 className="text-[10px] font-black text-cyan-400 uppercase tracking-widest mb-6 flex items-center">
                       <i className="fas fa-terminal mr-3"></i> Core Diagnostics Feed
                    </h5>
                    <div className="space-y-2 font-mono max-h-48 overflow-y-auto custom-scrollbar pr-2">
                       {diagnostics.length === 0 ? (
                         <p className="text-[9px] text-slate-700 italic">No diagnostic events recorded...</p>
                       ) : diagnostics.map((d, i) => (
                         <div key={i} className="text-[9px] flex items-center space-x-3 py-1 border-b border-white/[0.02]">
                           <span className="text-cyan-900 font-bold">[{i}]</span>
                           <span className="text-slate-500">{d}</span>
                         </div>
                       ))}
                    </div>
                 </div>

                 <div className="space-y-4">
                    {thoughtHistory.length === 0 ? (
                       <div className="py-20 text-center opacity-30">
                          <i className="fas fa-brain text-4xl mb-4 text-cyan-500 animate-pulse"></i>
                          <p className="text-[10px] font-black uppercase">Synthesizing Market Intelligence...</p>
                       </div>
                    ) : (
                      thoughtHistory.map((t, i) => (
                        <div key={i} className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl group hover:border-cyan-500/20 transition-all">
                           <div className="flex justify-between items-center mb-4">
                              <div className="flex items-center space-x-3">
                                 <span className="text-sm font-black text-white">{t.symbol}</span>
                                 <span className={`text-[8px] font-black px-2 py-1 rounded ${t.side === 'BUY' ? 'bg-emerald-500 text-black' : t.side === 'SELL' ? 'bg-rose-500 text-black' : 'bg-slate-800 text-slate-500'}`}>{t.side}</span>
                              </div>
                              <span className="text-[9px] font-black text-cyan-400">Reliability: {t.confidence}%</span>
                           </div>
                           <p className="text-[11px] text-slate-400 leading-relaxed mb-4">{t.thoughtProcess}</p>
                           <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                             <p className="text-[8px] text-slate-600 font-black uppercase mb-1">Technical Summary</p>
                             <p className="text-[10px] font-bold text-slate-300">{t.analysis}</p>
                           </div>
                        </div>
                      ))
                    )}
                 </div>
              </div>
            )}
         </div>
      </div>
    </div>
  );
};

export default TradingTerminal;
