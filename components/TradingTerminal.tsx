 
import React, { useState, useEffect } from 'react';
import { AccountBalance, ActivePosition, TradeSignal, OpenOrder, ExecutionLog, PerformanceStats } from '../types';
import { getApiBase } from '../services/tradingService';

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
  thoughtHistory: any[];
  liveActivity?: string;
  openOrders: OpenOrder[];
  diagnostics?: string[];
  onForceScan?: () => void;
}

const TradingTerminal: React.FC<TradingTerminalProps> = ({ 
  balances, 
  autoTradeEnabled,
  isEngineActive,
  onToggleEngine,
  onToggleAutoTrade,
  thoughtHistory,
  liveActivity,
  onForceScan
}) => {
  const [tab, setTab] = useState<'exposure' | 'logic' | 'orders'>('exposure');
  const [managedAssets, setManagedAssets] = useState<any>({});
  const [executedOrders, setExecutedOrders] = useState<any[]>([]);
  const [liquidity, setLiquidity] = useState({ eur: 0, usdc: 0 });
  
  useEffect(() => {
    const fetchState = async () => {
      try {
        const urlBase = getApiBase();
        const res = await fetch(`${urlBase}/api/ghost/state`);
        const data = await res.json();
        if (data.managedAssets) setManagedAssets(data.managedAssets);
        if (data.executedOrders) setExecutedOrders(data.executedOrders);
        if (data.liquidity) setLiquidity(data.liquidity);
      } catch (e) {}
    };
    fetchState();
    const inv = setInterval(fetchState, 3000);
    return () => clearInterval(inv);
  }, []);

  const activeAssets = Object.keys(managedAssets)
    .map(key => managedAssets[key])
    .filter(asset => (asset.amount || 0) > 0 || asset.confidence >= 80);

  return (
    <div className="flex flex-col space-y-6 font-mono">
      {/* Precision Liquidity Hub */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 bg-gradient-to-br from-[#0a0f18] to-black border border-cyan-500/40 p-7 rounded-[2.5rem] relative overflow-hidden shadow-2xl">
           <div className="absolute top-0 right-0 w-40 h-40 bg-cyan-500/5 blur-[100px] rounded-full"></div>
           <div className="flex justify-between items-start relative z-10">
              <div>
                 <p className="text-[9px] font-black text-cyan-400 uppercase tracking-[0.4em] mb-4">Neural Reserve Fuel</p>
                 <div className="flex items-baseline space-x-8">
                    <div>
                       <span className="text-[7px] text-slate-500 block uppercase mb-1 tracking-widest">Reserve EUR/C</span>
                       <h2 className="text-4xl font-black text-white tracking-tighter">
                          €{liquidity.eur.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                       </h2>
                    </div>
                    <div className="w-[1px] h-10 bg-white/10"></div>
                    <div>
                       <span className="text-[7px] text-slate-500 block uppercase mb-1 tracking-widest">Reserve USDC/T</span>
                       <h2 className="text-2xl font-black text-indigo-400">
                          ${liquidity.usdc.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                       </h2>
                    </div>
                 </div>
                 <div className="mt-5 flex items-center space-x-4">
                    <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest flex items-center">
                       <span className="w-2 h-2 bg-emerald-500 rounded-full mr-2 animate-pulse shadow-[0_0_10px_#10b981]"></span>
                       {liveActivity || "STABLE_WATCH"}
                    </p>
                    <span className="text-[8px] text-slate-600 font-black tracking-widest uppercase">Sync: {new Date().toLocaleTimeString()}</span>
                 </div>
              </div>
              <button onClick={onForceScan} className="w-12 h-12 bg-white/5 hover:bg-white/10 rounded-2xl flex items-center justify-center border border-white/10 text-white transition-all shadow-lg active:scale-95 group">
                 <i className="fas fa-sync-alt group-hover:rotate-180 transition-transform duration-700"></i>
              </button>
           </div>
        </div>
        <div className="bg-[#050810] border border-white/5 p-6 rounded-[2.5rem] flex flex-col justify-center items-center shadow-lg group hover:border-indigo-500/30 transition-all">
           <p className="text-[8px] font-black text-slate-500 uppercase mb-1 tracking-widest">Active Nodes</p>
           <p className="text-3xl font-black text-indigo-400 group-hover:scale-110 transition-transform">{activeAssets.length}</p>
        </div>
        <div className="bg-[#050810] border border-white/5 p-6 rounded-[2.5rem] flex flex-col justify-center items-center shadow-lg group hover:border-emerald-500/30 transition-all">
           <p className="text-[8px] font-black text-slate-500 uppercase mb-1 tracking-widest">Anti-Trap AI</p>
           <p className={`text-2xl font-black ${autoTradeEnabled ? 'text-emerald-400' : 'text-slate-600'}`}>
            {autoTradeEnabled ? 'ACTIVE' : 'OFF'}
           </p>
        </div>
      </div>

      <div className="bg-[#050810]/90 backdrop-blur-3xl border border-white/10 rounded-[3rem] overflow-hidden shadow-2xl min-h-[600px] flex flex-col">
         <div className="px-10 pt-10 pb-4 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-cyan-950/10 to-transparent">
            <div className="flex space-x-12">
               {[
                 { id: 'exposure', label: 'Neural Assets', icon: 'fa-stream' },
                 { id: 'logic', label: 'AI Thought-Chain', icon: 'fa-brain' },
                 { id: 'orders', label: 'Execution Log', icon: 'fa-history' }
               ].map(t => (
                 <button 
                   key={t.id} 
                   onClick={() => setTab(t.id as any)} 
                   className={`flex items-center space-x-3 pb-4 text-[10px] font-black uppercase tracking-[0.3em] transition-all relative ${tab === t.id ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300'}`}
                 >
                   <i className={`fas ${t.icon} text-[12px]`}></i>
                   <span>{t.label}</span>
                   {tab === t.id && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-cyan-500 shadow-[0_0_20px_#22d3ee]"></div>}
                 </button>
               ))}
            </div>
         </div>

         <div className="flex-1 overflow-y-auto custom-scrollbar p-10">
            {tab === 'exposure' && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                 {activeAssets.map(asset => {
                   const amount = asset.amount || 0;
                   const entry = asset.entryPrice || 0;
                   const current = asset.currentPrice || 0;
                   const pnl = (entry > 0) ? ((current - entry) / entry) * 100 : 0;
                   const isHunting = amount <= 0;
                   
                   return (
                     <div key={asset.currency} className={`bg-white/[0.03] border border-white/10 p-8 rounded-[2.5rem] hover:border-cyan-500/40 transition-all relative overflow-hidden group shadow-xl ${isHunting ? 'opacity-50 grayscale-[0.2]' : 'border-l-4 border-l-cyan-500'}`}>
                        <div className="flex justify-between items-start mb-8">
                           <div className="flex items-center space-x-5">
                              <div className={`w-16 h-16 rounded-3xl flex items-center justify-center text-white font-black text-xl border border-white/10 shadow-inner ${isHunting ? 'bg-slate-800' : 'bg-gradient-to-br from-cyan-600/40 to-indigo-600/40'}`}>
                                 {asset.currency}
                              </div>
                              <div>
                                 <h4 className="text-lg font-black text-white tracking-tight">{asset.currency} Matrix</h4>
                                 <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                                    {isHunting ? 'Analyzing Market Gaps...' : `Balance: ${amount.toFixed(4)}`}
                                 </p>
                              </div>
                           </div>
                           <div className="text-right">
                              <p className={`text-2xl font-black ${isHunting ? 'text-slate-600' : (pnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}`}>
                                {isHunting ? 'HUNTING' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`}
                              </p>
                              <p className="text-[8px] text-slate-500 font-black uppercase tracking-widest">Live ROI</p>
                           </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4 mb-8">
                           <div className="bg-black/40 p-5 rounded-2xl border border-white/5">
                              <p className="text-[7px] text-slate-500 font-black uppercase mb-1">Spot Price</p>
                              <p className="text-[12px] font-black text-white">
                                €{current.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </p>
                           </div>
                           <div className={`p-5 rounded-2xl border transition-all ${!isHunting && current >= (asset.tp || 0) * 0.98 ? 'bg-emerald-500/20 border-emerald-500 animate-pulse' : 'bg-emerald-500/5 border-emerald-500/10'}`}>
                              <p className="text-[7px] text-emerald-500 font-black uppercase mb-1">Take Profit</p>
                              <p className="text-[12px] font-black text-emerald-400">
                                {asset.tp ? `€${asset.tp.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'N/A'}
                              </p>
                           </div>
                           <div className={`p-5 rounded-2xl border transition-all ${!isHunting && current <= (asset.sl || 0) * 1.02 ? 'bg-rose-500/20 border-rose-500 animate-bounce' : 'bg-rose-500/5 border-rose-500/10'}`}>
                              <p className="text-[7px] text-rose-500 font-black uppercase mb-1">Stop Loss</p>
                              <p className="text-[12px] font-black text-rose-400">
                                {asset.sl ? `€${asset.sl.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'N/A'}
                              </p>
                           </div>
                        </div>

                        {asset.reason ? (
                          <div className="mt-2 pt-6 border-t border-white/5">
                             <div className="flex items-center space-x-4 mb-4">
                                <span className={`w-2.5 h-2.5 rounded-full ${asset.side === 'SELL' ? 'bg-rose-500' : asset.side === 'BUY' ? 'bg-emerald-500' : 'bg-cyan-500'} animate-pulse shadow-[0_0_10px_currentColor]`}></span>
                                <span className="text-[9px] font-black text-slate-300 uppercase tracking-[0.3em]">AI Bias: {asset.side || 'NEUTRAL'} ({asset.confidence || 0}%)</span>
                             </div>
                             <p className="text-[10px] text-slate-500 leading-relaxed italic">
                               "{asset.reason}"
                             </p>
                          </div>
                        ) : (
                          <div className="mt-2 pt-6 border-t border-white/5 flex flex-col items-center">
                             <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden mb-3">
                                <div className="h-full bg-cyan-500/40 animate-progress origin-left"></div>
                             </div>
                             <p className="text-[8px] text-slate-600 font-black uppercase tracking-widest">Awaiting AI Calculation Node...</p>
                          </div>
                        )}
                     </div>
                   );
                 })}
              </div>
            )}

            {tab === 'logic' && (
              <div className="space-y-6">
                 {thoughtHistory.length > 0 ? thoughtHistory.map((t, i) => (
                    <div key={i} className="p-8 bg-white/[0.02] border border-white/10 rounded-[2rem] hover:border-indigo-500/30 transition-all group relative overflow-hidden">
                       <div className="absolute top-0 right-0 p-6 opacity-10">
                          <i className="fas fa-brain text-4xl"></i>
                       </div>
                       <div className="flex justify-between items-center mb-6">
                          <span className="text-sm font-black text-white group-hover:text-cyan-400 transition-colors uppercase tracking-tight">{t.symbol} Market Scan</span>
                          <span className="text-[8px] font-black bg-indigo-600/40 text-indigo-100 border border-indigo-500/20 px-4 py-1.5 rounded-full uppercase tracking-widest">QUANT_CORE_V3</span>
                       </div>
                       <p className="text-xs text-slate-400 leading-relaxed italic mb-6">"{t.reason || t.analysis}"</p>
                       <div className="flex space-x-12 text-[10px] font-black uppercase tracking-[0.2em] border-t border-white/5 pt-6">
                          <div className="flex flex-col"><span className="text-slate-600 mb-2">Target TP</span><span className="text-emerald-400">€{t.tp}</span></div>
                          <div className="flex flex-col"><span className="text-slate-600 mb-2">Safety SL</span><span className="text-rose-400">€{t.sl}</span></div>
                          <div className="flex flex-col ml-auto"><span className="text-slate-600 mb-2">Confidence</span><span className="text-cyan-400">{t.confidence}%</span></div>
                       </div>
                    </div>
                 )) : (
                    <div className="py-40 text-center opacity-10 flex flex-col items-center justify-center grayscale">
                       <i className="fas fa-microchip text-6xl mb-8"></i>
                       <p className="text-[11px] font-black uppercase tracking-[0.6em]">Neural pathways clear</p>
                    </div>
                 )}
              </div>
            )}

            {tab === 'orders' && (
              <div className="bg-black/40 border border-white/5 rounded-[2rem] overflow-hidden shadow-2xl">
                <table className="w-full text-left">
                  <thead className="bg-white/5 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    <tr>
                      <th className="px-8 py-5">Execution Time</th>
                      <th className="px-8 py-5">Asset Node</th>
                      <th className="px-8 py-5">Action Side</th>
                      <th className="px-8 py-5">Price Point</th>
                      <th className="px-8 py-5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {executedOrders.length > 0 ? executedOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-white/[0.03] transition-colors">
                        <td className="px-8 py-5 text-[11px] text-slate-400">{new Date(o.timestamp).toLocaleString()}</td>
                        <td className="px-8 py-5 text-sm font-black text-white">{o.symbol}</td>
                        <td className="px-8 py-5">
                          <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-tighter ${o.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                            {o.side} (AI {o.confidence}%)
                          </span>
                        </td>
                        <td className="px-8 py-5 text-[11px] text-slate-300 font-black">€{o.price.toLocaleString()}</td>
                        <td className="px-8 py-5 text-[10px] font-black text-emerald-500 uppercase tracking-widest italic animate-pulse">{o.status}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={5} className="px-8 py-24 text-center opacity-20 text-[11px] uppercase font-black tracking-widest">No robot executions recorded. Monitoring for 88%+ confidence.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
         </div>
      </div>
    </div>
  );
};

export default TradingTerminal;
