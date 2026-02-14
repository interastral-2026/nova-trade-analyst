
import React, { useState, useEffect } from 'react';
import { AccountBalance, ActivePosition, TradeSignal, OpenOrder, ExecutionLog, PerformanceStats } from '../types';
// Fix: Import getApiBase instead of non-existent API_BASE from tradingService
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
  const [tab, setTab] = useState<'exposure' | 'logic' | 'stats'>('exposure');
  const [managedAssets, setManagedAssets] = useState<any>({});
  
  // سینک اطلاعات استراتژیک از بک‌اِند
  useEffect(() => {
    const fetchState = async () => {
      try {
        // Fix: Use getApiBase() utility function to retrieve the current bridge URL
        const urlBase = getApiBase();
        const res = await fetch(`${urlBase}/api/ghost/state`);
        const data = await res.json();
        if (data.managedAssets) setManagedAssets(data.managedAssets);
      } catch (e) {}
    };
    fetchState();
    const inv = setInterval(fetchState, 5000);
    return () => clearInterval(inv);
  }, []);

  const cashBalance = balances.find(b => b.currency === 'EUR');
  const eurValue = cashBalance?.total || 0;
  const cryptoHoldings = balances.filter(b => b.currency !== 'EUR' && b.total > 0.0000001);

  return (
    <div className="flex flex-col space-y-6 font-mono">
      {/* Top Header Card */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 bg-gradient-to-br from-[#050810] to-black border border-cyan-500/20 p-6 rounded-[2rem] relative overflow-hidden shadow-2xl">
           <div className="flex justify-between items-start">
              <div>
                 <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em] mb-2">Operational Liquidity (EUR)</p>
                 <h2 className="text-4xl font-black text-white tracking-tighter">
                    €{Number(eurValue).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                 </h2>
                 <p className="text-[10px] text-cyan-400 font-bold mt-2 uppercase tracking-widest flex items-center">
                    <span className="w-2.5 h-2.5 bg-cyan-500 rounded-full mr-2 animate-pulse shadow-[0_0_8px_#22d3ee]"></span>
                    {liveActivity || "LINKED_TO_NODE"}
                 </p>
              </div>
              <button onClick={onForceScan} className="w-12 h-12 bg-white/5 hover:bg-white/10 rounded-2xl flex items-center justify-center border border-white/10 text-white transition-all">
                 <i className="fas fa-sync-alt"></i>
              </button>
           </div>
        </div>
        <div className="bg-[#050810] border border-white/5 p-6 rounded-[2rem] flex flex-col justify-center">
           <p className="text-[8px] font-black text-slate-500 uppercase mb-1 tracking-widest">Active Assets</p>
           <p className="text-3xl font-black text-indigo-400">{cryptoHoldings.length}</p>
        </div>
        <div className="bg-[#050810] border border-white/5 p-6 rounded-[2rem] flex flex-col justify-center">
           <p className="text-[8px] font-black text-slate-500 uppercase mb-1 tracking-widest">Neural Analysis</p>
           <p className="text-3xl font-black text-emerald-400">{Object.keys(managedAssets).length}</p>
        </div>
      </div>

      <div className="bg-[#050810]/80 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl min-h-[600px] flex flex-col">
         <div className="px-8 pt-8 pb-4 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-indigo-950/20 to-transparent">
            <div className="flex space-x-12">
               {[
                 { id: 'exposure', label: 'Asset Matrix', icon: 'fa-layer-group' },
                 { id: 'logic', label: 'Neural Log', icon: 'fa-microchip' },
                 { id: 'stats', label: 'System PnL', icon: 'fa-chart-pie' }
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
                 {cryptoHoldings.length === 0 ? (
                   <div className="col-span-2 py-40 text-center opacity-10 flex flex-col items-center justify-center grayscale">
                     <i className="fas fa-database text-6xl mb-6"></i>
                     <p className="text-sm font-black uppercase tracking-[0.5em]">No Nodes Detected in Portfolio</p>
                   </div>
                 ) : cryptoHoldings.map(b => {
                   const aiData = managedAssets[b.currency];
                   const pnl = aiData && aiData.entryPrice > 0 
                    ? ((aiData.currentPrice - aiData.entryPrice) / aiData.entryPrice) * 100 
                    : 0;
                   
                   return (
                     <div key={b.currency} className="bg-white/[0.03] border border-white/10 p-7 rounded-[2rem] hover:border-cyan-500/30 transition-all relative overflow-hidden group shadow-lg">
                        {aiData && aiData.strategy && (
                          <div className="absolute top-0 right-0 p-4">
                             <span className="text-[7px] font-black bg-indigo-600 text-white px-3 py-1 rounded-full uppercase tracking-widest">{aiData.strategy}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-start mb-8">
                           <div className="flex items-center space-x-4">
                              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 flex items-center justify-center text-white font-black text-lg border border-white/10 shadow-inner">
                                 {b.currency}
                              </div>
                              <div>
                                 <h4 className="text-base font-black text-white tracking-tight">{b.currency} Asset Node</h4>
                                 <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Hold: {b.total.toFixed(6)}</p>
                              </div>
                           </div>
                           <div className="text-right">
                              <p className={`text-2xl font-black ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {aiData && aiData.entryPrice > 0 ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%` : '0.00%'}
                              </p>
                              <p className="text-[8px] text-slate-500 font-black uppercase tracking-tighter">Market Performance</p>
                           </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3 mb-6">
                           <div className="bg-black/50 p-4 rounded-2xl border border-white/5">
                              <p className="text-[7px] text-slate-500 font-black uppercase mb-1">Entry Value</p>
                              <p className="text-[11px] font-black text-white">
                                {aiData && aiData.entryPrice > 0 ? `€${aiData.entryPrice.toLocaleString()}` : '€---'}
                              </p>
                           </div>
                           <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/20">
                              <p className="text-[7px] text-emerald-500 font-black uppercase mb-1">AI Target (TP)</p>
                              <p className="text-[11px] font-black text-emerald-400">
                                {aiData && aiData.tp ? `€${aiData.tp.toLocaleString()}` : 'Awaiting...'}
                              </p>
                           </div>
                           <div className="bg-rose-500/5 p-4 rounded-2xl border border-rose-500/20">
                              <p className="text-[7px] text-rose-500 font-black uppercase mb-1">Defense (SL)</p>
                              <p className="text-[11px] font-black text-rose-400">
                                {aiData && aiData.sl ? `€${aiData.sl.toLocaleString()}` : 'Awaiting...'}
                              </p>
                           </div>
                        </div>

                        {aiData && aiData.advice ? (
                          <div className="mt-2 pt-5 border-t border-white/5">
                             <div className="flex items-center space-x-3 mb-3">
                                <span className={`w-2 h-2 rounded-full ${aiData.advice === 'SELL' ? 'bg-rose-500 animate-pulse' : aiData.advice === 'BUY' ? 'bg-emerald-500 animate-pulse' : 'bg-cyan-500'}`}></span>
                                <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">AI Bias: {aiData.advice}</span>
                             </div>
                             <p className="text-[11px] text-slate-500 leading-relaxed italic opacity-80">
                               "{aiData.reason}"
                             </p>
                          </div>
                        ) : (
                          <div className="mt-2 pt-5 border-t border-white/5 opacity-40">
                             <p className="text-[10px] text-center font-black uppercase tracking-widest animate-pulse">Neural Scan in Progress...</p>
                          </div>
                        )}
                     </div>
                   );
                 })}
              </div>
            )}

            {tab === 'logic' && (
              <div className="space-y-4">
                 {thoughtHistory.length === 0 ? (
                   <div className="py-20 text-center opacity-10 flex flex-col items-center">
                      <i className="fas fa-brain text-5xl mb-6"></i>
                      <p className="text-[10px] font-black uppercase tracking-widest">Neural cache empty</p>
                   </div>
                 ) : thoughtHistory.map((t, i) => (
                    <div key={i} className="p-6 bg-white/[0.02] border border-white/10 rounded-3xl hover:border-indigo-500/40 transition-all">
                       <div className="flex justify-between items-center mb-4">
                          <span className="text-sm font-black text-white">{t.symbol} Signal</span>
                          <span className="text-[8px] font-black bg-cyan-600 text-white px-3 py-1 rounded-full uppercase tracking-widest">{t.strategy}</span>
                       </div>
                       <p className="text-[12px] text-slate-400 leading-relaxed italic mb-4">"{t.reason}"</p>
                       <div className="flex space-x-6 text-[10px] font-black">
                          <span className="text-emerald-400">TP: €{t.tp}</span>
                          <span className="text-rose-400">SL: €{t.sl}</span>
                          <span className="text-slate-500">Confidence: {t.confidence}%</span>
                       </div>
                    </div>
                 ))}
              </div>
            )}
            
            {tab === 'stats' && (
              <div className="py-20 text-center opacity-20">
                 <i className="fas fa-chart-line text-6xl mb-6"></i>
                 <p className="text-sm font-black uppercase tracking-[0.4em]">Aggregating Historical PnL Data...</p>
              </div>
            )}
         </div>
      </div>
    </div>
  );
};

export default TradingTerminal;
