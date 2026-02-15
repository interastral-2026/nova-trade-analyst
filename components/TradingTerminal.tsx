
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
  const [liquidity, setLiquidity] = useState({ eur: 0, usdc: 0 });
  
  useEffect(() => {
    const fetchState = async () => {
      try {
        const urlBase = getApiBase();
        const res = await fetch(`${urlBase}/api/ghost/state`);
        const data = await res.json();
        if (data.managedAssets) setManagedAssets(data.managedAssets);
        if (data.liquidity) setLiquidity(data.liquidity);
      } catch (e) {}
    };
    fetchState();
    const inv = setInterval(fetchState, 3000);
    return () => clearInterval(inv);
  }, []);

  const activeAssets = Object.keys(managedAssets)
    .map(key => managedAssets[key])
    .filter(asset => (asset.amount || 0) > 0 || (asset.confidence || 0) >= 70);

  return (
    <div className="flex flex-col space-y-6 font-mono">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 bg-gradient-to-br from-[#050a14] to-black border border-indigo-500/40 p-7 rounded-[2.5rem] relative overflow-hidden shadow-2xl">
           <div className="absolute top-0 right-0 w-40 h-40 bg-indigo-500/10 blur-[100px] rounded-full"></div>
           <div className="flex justify-between items-start relative z-10">
              <div>
                 <p className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.4em] mb-4">PREDATOR LIQUIDITY HUB</p>
                 <div className="flex items-baseline space-x-8">
                    <div>
                       <span className="text-[7px] text-slate-500 block uppercase mb-1 tracking-widest">Reserve EUR</span>
                       <h2 className="text-4xl font-black text-white tracking-tighter">
                          €{liquidity.eur.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                       </h2>
                    </div>
                    <div className="w-[1px] h-10 bg-white/10"></div>
                    <div>
                       <span className="text-[7px] text-slate-500 block uppercase mb-1 tracking-widest">Reserve USDC</span>
                       <h2 className="text-2xl font-black text-cyan-400">
                          ${liquidity.usdc.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                       </h2>
                    </div>
                 </div>
                 <div className="mt-5 flex items-center space-x-4">
                    <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest flex items-center">
                       <span className="w-2 h-2 bg-indigo-500 rounded-full mr-2 animate-ping"></span>
                       {liveActivity || "HUNTING_GAPS"}
                    </p>
                    <span className="text-[8px] text-slate-600 font-black tracking-widest uppercase">ANTI-TRAP: ENABLED</span>
                 </div>
              </div>
              <button onClick={onForceScan} className="w-12 h-12 bg-white/5 hover:bg-white/10 rounded-2xl flex items-center justify-center border border-white/10 text-white transition-all shadow-lg active:scale-95 group">
                 <i className="fas fa-satellite group-hover:animate-spin"></i>
              </button>
           </div>
        </div>
        <div className="bg-[#050810] border border-white/5 p-6 rounded-[2.5rem] flex flex-col justify-center items-center shadow-lg group hover:border-indigo-500/30 transition-all">
           <p className="text-[8px] font-black text-slate-500 uppercase mb-1 tracking-widest">Hunter Nodes</p>
           <p className="text-3xl font-black text-indigo-400">{activeAssets.length}</p>
        </div>
        <div className="bg-[#050810] border border-white/5 p-6 rounded-[2.5rem] flex flex-col justify-center items-center shadow-lg group hover:border-emerald-500/30 transition-all">
           <p className="text-[8px] font-black text-slate-500 uppercase mb-1 tracking-widest">SMC Execution</p>
           <p className={`text-2xl font-black ${autoTradeEnabled ? 'text-emerald-400' : 'text-slate-600'}`}>
            {autoTradeEnabled ? 'AUTO' : 'MANUAL'}
           </p>
        </div>
      </div>

      <div className="bg-[#050810]/95 backdrop-blur-3xl border border-white/10 rounded-[3rem] overflow-hidden shadow-2xl min-h-[600px] flex flex-col">
         <div className="px-10 pt-10 pb-4 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-indigo-950/10 to-transparent">
            <div className="flex space-x-12">
               {[
                 { id: 'exposure', label: 'Predator Matrix', icon: 'fa-crosshairs' },
                 { id: 'logic', label: 'Neural Insights', icon: 'fa-bolt' },
                 { id: 'orders', label: 'Kill History', icon: 'fa-skull' }
               ].map(t => (
                 <button 
                   key={t.id} 
                   onClick={() => setTab(t.id as any)} 
                   className={`flex items-center space-x-3 pb-4 text-[10px] font-black uppercase tracking-[0.3em] transition-all relative ${tab === t.id ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
                 >
                   <i className={`fas ${t.icon} text-[12px]`}></i>
                   <span>{t.label}</span>
                   {tab === t.id && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-indigo-500 shadow-[0_0_20px_#6366f1]"></div>}
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
                     <div key={asset.currency} className={`bg-white/[0.02] border border-white/5 p-8 rounded-[2.5rem] hover:border-indigo-500/40 transition-all relative overflow-hidden group shadow-xl ${isHunting ? 'border-dashed' : 'border-l-4 border-l-indigo-500'}`}>
                        <div className="flex justify-between items-start mb-8">
                           <div className="flex items-center space-x-5">
                              <div className={`w-16 h-16 rounded-3xl flex items-center justify-center text-white font-black text-xl border border-white/10 ${isHunting ? 'bg-slate-900 shadow-none' : 'bg-gradient-to-br from-indigo-600/30 to-blue-600/30 shadow-lg shadow-indigo-500/10'}`}>
                                 {asset.currency}
                              </div>
                              <div>
                                 <h4 className="text-lg font-black text-white tracking-tight">{asset.currency} Target</h4>
                                 <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                                    {isHunting ? 'Watching for Stop Hunts...' : `HODL: ${amount.toFixed(4)}`}
                                 </p>
                              </div>
                           </div>
                           <div className="text-right">
                              <p className={`text-2xl font-black ${isHunting ? 'text-indigo-400 animate-pulse' : (pnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}`}>
                                {isHunting ? 'SNIPING' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`}
                              </p>
                              <p className="text-[8px] text-slate-500 font-black uppercase tracking-widest">Predator ROI</p>
                           </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4 mb-8">
                           <div className="bg-black/40 p-5 rounded-2xl border border-white/5">
                              <p className="text-[7px] text-slate-500 font-black uppercase mb-1">Live Feed</p>
                              <p className="text-[12px] font-black text-white">€{current.toLocaleString()}</p>
                           </div>
                           <div className="bg-emerald-500/5 border border-emerald-500/10 p-5 rounded-2xl">
                              <p className="text-[7px] text-emerald-500 font-black uppercase mb-1">Safe TP (85%)</p>
                              <p className="text-[12px] font-black text-emerald-400">€{asset.tp?.toLocaleString() || '---'}</p>
                           </div>
                           <div className="bg-rose-500/5 border border-rose-500/10 p-5 rounded-2xl">
                              <p className="text-[7px] text-rose-500 font-black uppercase mb-1">Deep SL</p>
                              <p className="text-[12px] font-black text-rose-400">€{asset.sl?.toLocaleString() || '---'}</p>
                           </div>
                        </div>

                        <div className="pt-6 border-t border-white/5">
                           <div className="flex items-center space-x-3 mb-3">
                              <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Strategy: {asset.strategy || 'Wait for Retest'}</span>
                           </div>
                           <p className="text-[10px] text-slate-500 leading-relaxed line-clamp-2 italic">"{asset.reason || 'Scanning for institutional footprints and liquidity zones...'}"</p>
                        </div>
                     </div>
                   );
                 })}
              </div>
            )}
            
            {tab === 'logic' && (
              <div className="space-y-6">
                {thoughtHistory.map((t, i) => (
                  <div key={i} className="p-8 bg-indigo-500/[0.02] border border-white/5 rounded-[2rem] relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 text-indigo-500/10 text-6xl"><i className="fas fa-shield-virus"></i></div>
                    <div className="flex justify-between items-center mb-6">
                       <span className="text-sm font-black text-white uppercase tracking-tight">{t.symbol} Market Scan</span>
                       <span className="text-[8px] font-black bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full border border-emerald-500/10">ANTI_TRAP_OK</span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed mb-6 italic">"{t.reason || t.analysis}"</p>
                    <div className="grid grid-cols-3 gap-8 pt-6 border-t border-white/5 text-[10px] font-black uppercase tracking-widest">
                       <div><span className="text-slate-600 block mb-1">Safe Exit</span><span className="text-emerald-400">€{t.tp}</span></div>
                       <div><span className="text-slate-600 block mb-1">Safety SL</span><span className="text-rose-400">€{t.sl}</span></div>
                       <div className="text-right"><span className="text-slate-600 block mb-1">Confidence</span><span className="text-indigo-400">{t.confidence}%</span></div>
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
