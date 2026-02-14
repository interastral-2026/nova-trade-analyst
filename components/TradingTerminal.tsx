
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

  // ترکیب دارایی‌های کیف پول (موجود) و اهداف اسکن شده (Hunter Mode)
  const activeAssets = Object.keys(managedAssets)
    .map(key => managedAssets[key])
    .filter(asset => asset.amount > 0 || (asset.confidence >= 80));

  return (
    <div className="flex flex-col space-y-6 font-mono">
      {/* Metrics Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 bg-gradient-to-br from-[#050810] to-black border border-cyan-500/20 p-6 rounded-[2rem] relative overflow-hidden shadow-2xl">
           <div className="flex justify-between items-start">
              <div>
                 <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em] mb-2">Total Liquidity (EUR/USDC)</p>
                 <h2 className="text-3xl font-black text-white tracking-tighter">
                    €{liquidity.eur.toLocaleString()} <span className="text-slate-500 text-xl mx-2">/</span> <span className="text-cyan-400">${liquidity.usdc.toLocaleString()}</span>
                 </h2>
                 <p className="text-[10px] text-emerald-400 font-bold mt-2 uppercase tracking-widest flex items-center">
                    <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full mr-2 animate-pulse shadow-[0_0_8px_#10b981]"></span>
                    {liveActivity || "HUNTER_MODE_ACTIVE"}
                 </p>
              </div>
              <button onClick={onForceScan} className="w-12 h-12 bg-white/5 hover:bg-white/10 rounded-2xl flex items-center justify-center border border-white/10 text-white transition-all active:scale-95 shadow-inner">
                 <i className="fas fa-crosshairs"></i>
              </button>
           </div>
        </div>
        <div className="bg-[#050810] border border-white/5 p-6 rounded-[2rem] flex flex-col justify-center items-center shadow-lg">
           <p className="text-[8px] font-black text-slate-500 uppercase mb-1 tracking-widest">Neural Assets</p>
           <p className="text-3xl font-black text-indigo-400">{activeAssets.length}</p>
        </div>
        <div className="bg-[#050810] border border-white/5 p-6 rounded-[2rem] flex flex-col justify-center items-center shadow-lg">
           <p className="text-[8px] font-black text-slate-500 uppercase mb-1 tracking-widest">88% Auto-Sniper</p>
           <p className={`text-2xl font-black ${autoTradeEnabled ? 'text-emerald-400' : 'text-slate-600'}`}>
            {autoTradeEnabled ? 'ENABLED' : 'OFF'}
           </p>
        </div>
      </div>

      <div className="bg-[#050810]/80 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl min-h-[600px] flex flex-col">
         {/* Navigation Tabs */}
         <div className="px-8 pt-8 pb-4 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-indigo-950/20 to-transparent">
            <div className="flex space-x-12">
               {[
                 { id: 'exposure', label: 'Neural Matrix', icon: 'fa-layer-group' },
                 { id: 'logic', label: 'Neural Log', icon: 'fa-microchip' },
                 { id: 'orders', label: 'Robot Orders', icon: 'fa-robot' }
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

         <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
            {tab === 'exposure' && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                 {activeAssets.map(asset => {
                   const holdAmount = asset.amount || 0;
                   const entry = asset.entryPrice || 0;
                   const current = asset.currentPrice || 0;
                   const pnl = (entry > 0 && current > 0) ? ((current - entry) / entry) * 100 : 0;
                   const isHunting = holdAmount <= 0;
                   
                   return (
                     <div key={asset.currency} className={`bg-white/[0.03] border border-white/10 p-7 rounded-[2rem] hover:border-cyan-500/30 transition-all relative overflow-hidden group shadow-lg ${isHunting ? 'opacity-70 border-dashed' : ''}`}>
                        {asset.confidence >= 88 && (
                          <div className="absolute top-0 right-0 p-4">
                             <span className="text-[7px] font-black bg-emerald-600 text-white px-3 py-1 rounded-full uppercase tracking-widest shadow-lg animate-pulse">
                                {isHunting ? 'HUNTING_BUY_ZONE' : 'TARGET_LOCKED'}
                             </span>
                          </div>
                        )}
                        <div className="flex justify-between items-start mb-8">
                           <div className="flex items-center space-x-4">
                              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white font-black text-lg border border-white/10 shadow-inner ${isHunting ? 'bg-slate-800' : 'bg-gradient-to-br from-cyan-500/20 to-indigo-500/20'}`}>
                                 {asset.currency}
                              </div>
                              <div>
                                 <h4 className="text-base font-black text-white tracking-tight">{asset.currency} Node</h4>
                                 <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                                    {isHunting ? 'Scan Mode: Active' : `Hold: ${holdAmount.toFixed(holdAmount < 1 ? 6 : 4)}`}
                                 </p>
                              </div>
                           </div>
                           <div className="text-right">
                              <p className={`text-2xl font-black ${isHunting ? 'text-slate-500' : (pnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}`}>
                                {isHunting ? '---' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`}
                              </p>
                              <p className="text-[8px] text-slate-500 font-black uppercase tracking-tighter">Current ROI</p>
                           </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3 mb-6">
                           <div className="bg-black/50 p-4 rounded-2xl border border-white/5 shadow-inner">
                              <p className="text-[7px] text-slate-500 font-black uppercase mb-1">{isHunting ? 'Market Price' : 'Entry Ref'}</p>
                              <p className="text-[11px] font-black text-white">
                                €{current.toLocaleString(undefined, { minimumFractionDigits: current < 1 ? 4 : 2 })}
                              </p>
                           </div>
                           <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/20">
                              <p className="text-[7px] text-emerald-500 font-black uppercase mb-1">Neural TP</p>
                              <p className="text-[11px] font-black text-emerald-400">
                                {asset.tp ? `€${asset.tp.toLocaleString(undefined, { minimumFractionDigits: current < 1 ? 4 : 2 })}` : 'Calculating...'}
                              </p>
                           </div>
                           <div className="bg-rose-500/5 p-4 rounded-2xl border border-rose-500/20">
                              <p className="text-[7px] text-rose-500 font-black uppercase mb-1">Neural SL</p>
                              <p className="text-[11px] font-black text-rose-400">
                                {asset.sl ? `€${asset.sl.toLocaleString(undefined, { minimumFractionDigits: current < 1 ? 4 : 2 })}` : 'Calculating...'}
                              </p>
                           </div>
                        </div>

                        {asset.reason ? (
                          <div className="mt-2 pt-5 border-t border-white/5">
                             <div className="flex items-center space-x-3 mb-3">
                                <span className={`w-2 h-2 rounded-full ${asset.side === 'SELL' ? 'bg-rose-500' : asset.side === 'BUY' ? 'bg-emerald-500' : 'bg-cyan-500'} animate-pulse shadow-[0_0_8px_currentColor]`}></span>
                                <span className="text-[9px] font-black text-slate-300 uppercase tracking-[0.2em]">Strategy: {asset.side || 'NEUTRAL'} ({asset.confidence || 0}%)</span>
                             </div>
                             <p className="text-[10px] text-slate-500 leading-relaxed italic opacity-80">
                               "{asset.reason}"
                             </p>
                          </div>
                        ) : (
                          <div className="mt-2 pt-5 border-t border-white/5">
                             <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden mb-3">
                                <div className="h-full bg-cyan-500/30 animate-progress origin-left shadow-[0_0_10px_#22d3ee]"></div>
                             </div>
                             <p className="text-[8px] font-black text-center text-cyan-500/40 uppercase tracking-[0.3em] animate-pulse">Probing Neural Entry Points for {asset.currency}...</p>
                          </div>
                        )}
                     </div>
                   );
                 })}
              </div>
            )}

            {tab === 'logic' && (
              <div className="space-y-4">
                 {thoughtHistory.length > 0 ? thoughtHistory.map((t, i) => (
                    <div key={i} className="p-6 bg-white/[0.02] border border-white/10 rounded-3xl hover:border-indigo-500/30 transition-all group">
                       <div className="flex justify-between items-center mb-4">
                          <span className="text-sm font-black text-white group-hover:text-cyan-400 transition-colors">{t.symbol} Neural Pulse</span>
                          <span className="text-[8px] font-black bg-indigo-600 text-white px-3 py-1 rounded-full uppercase tracking-widest">{t.strategy || 'QUANTUM_SCAN'}</span>
                       </div>
                       <p className="text-[11px] text-slate-400 leading-relaxed italic mb-4">"{t.reason || t.analysis}"</p>
                       <div className="flex space-x-6 text-[9px] font-black uppercase tracking-widest">
                          <span className="text-emerald-400">Target TP: €{t.tp}</span>
                          <span className="text-rose-400">Safety SL: €{t.sl}</span>
                          <span className="text-cyan-400">Confidence: {t.confidence}%</span>
                       </div>
                    </div>
                 )) : (
                    <div className="py-40 text-center opacity-10 flex flex-col items-center justify-center grayscale">
                       <i className="fas fa-brain text-5xl mb-6"></i>
                       <p className="text-[10px] font-black uppercase tracking-[0.5em]">No logical insights processed yet</p>
                    </div>
                 )}
              </div>
            )}

            {tab === 'orders' && (
              <div className="bg-black/30 border border-white/5 rounded-3xl overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-white/5 text-[9px] font-black text-slate-500 uppercase tracking-widest">
                    <tr>
                      <th className="px-6 py-4">Execution Time</th>
                      <th className="px-6 py-4">Asset Node</th>
                      <th className="px-6 py-4">AI Side</th>
                      <th className="px-6 py-4">Price Point</th>
                      <th className="px-6 py-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {executedOrders.length > 0 ? executedOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-6 py-4 text-[10px] text-slate-400">{new Date(o.timestamp).toLocaleString()}</td>
                        <td className="px-6 py-4 text-xs font-black text-white">{o.symbol}</td>
                        <td className="px-6 py-4">
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded ${o.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                            {o.side} (AI {o.confidence}%)
                          </span>
                        </td>
                        <td className="px-6 py-4 text-[10px] text-slate-300">€{o.price.toLocaleString()}</td>
                        <td className="px-6 py-4 text-[9px] font-black text-emerald-500 uppercase tracking-tighter italic animate-pulse">{o.status}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={5} className="px-6 py-20 text-center opacity-20 text-[10px] uppercase font-black tracking-widest">The robot hasn't executed any orders yet. Scanning for 88% confidence signals...</td>
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
