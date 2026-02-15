
import React, { useState, useEffect } from 'react';
import { AccountBalance, ExecutionLog } from '../types';
import { getApiBase } from '../services/tradingService';

interface TradingTerminalProps {
  balances: AccountBalance[];
  positions: any[];
  logs: ExecutionLog[];
  autoTradeEnabled: boolean;
  isEngineActive: boolean;
  onToggleEngine: () => void;
  onToggleAutoTrade: () => void;
  totalValue: number;
  performance: {
    netProfit: number;
    grossLoss: number;
    winRate: number;
    totalTrades: number;
    history: any[];
  };
  thoughtHistory: any[];
  liveActivity?: string;
  openOrders: any[];
  onForceScan?: () => void;
}

const TradingTerminal: React.FC<TradingTerminalProps> = ({ 
  autoTradeEnabled,
  thoughtHistory,
  liveActivity,
  onForceScan
}) => {
  const [managedAssets, setManagedAssets] = useState<any>({});
  const [liquidity, setLiquidity] = useState({ eur: 0, usdc: 0 });
  const [dailyStats, setDailyStats] = useState({ trades: 0, profit: 0, fees: 0 });
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  
  useEffect(() => {
    const fetchState = async () => {
      try {
        const urlBase = getApiBase();
        const res = await fetch(`${urlBase}/api/ghost/state`);
        const data = await res.json();
        if (data.managedAssets) setManagedAssets(data.managedAssets);
        if (data.liquidity) setLiquidity(data.liquidity);
        if (data.dailyStats) setDailyStats(data.dailyStats);
        if (data.executionLogs) setLogs(data.executionLogs);
      } catch (e) {}
    };
    fetchState();
    const inv = setInterval(fetchState, 3000);
    return () => clearInterval(inv);
  }, []);

  return (
    <div className="flex flex-col space-y-6 font-mono">
      {/* Predator Dashboard Header */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 bg-gradient-to-br from-[#0a0514] to-black border border-indigo-500/50 p-8 rounded-[2rem] relative overflow-hidden shadow-[0_0_50px_rgba(99,102,241,0.1)]">
           <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 blur-[120px] rounded-full"></div>
           <div className="flex justify-between items-start relative z-10">
              <div>
                 <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.5em] mb-4 flex items-center">
                    <span className="w-2 h-2 bg-indigo-500 rounded-full mr-2 animate-ping"></span>
                    ELITE PREDATOR HUB
                 </p>
                 <div className="flex items-baseline space-x-10">
                    <div>
                       <span className="text-[8px] text-slate-500 block uppercase mb-1 tracking-widest">Available Reserve</span>
                       <h2 className="text-4xl font-black text-white tracking-tighter">
                          €{liquidity.eur.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                       </h2>
                    </div>
                    <div className="w-[1px] h-12 bg-white/10"></div>
                    <div>
                       <span className="text-[8px] text-slate-500 block uppercase mb-1 tracking-widest">Net Daily Profit</span>
                       <h2 className={`text-2xl font-black ${dailyStats.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          €{dailyStats.profit.toFixed(2)}
                       </h2>
                    </div>
                 </div>
                 <div className="mt-6 flex items-center space-x-6 text-[9px] font-black uppercase tracking-widest">
                    <span className="text-indigo-400">FEES: €{dailyStats.fees.toFixed(3)}</span>
                    <span className="text-slate-600">|</span>
                    <span className="text-cyan-400">ACTIVITY: {liveActivity || "HUNTING"}</span>
                 </div>
              </div>
              <button onClick={onForceScan} className="w-14 h-14 bg-white/5 hover:bg-white/10 rounded-2xl flex items-center justify-center border border-white/10 text-white transition-all shadow-xl active:scale-90 group">
                 <i className="fas fa-crosshairs group-hover:scale-125 transition-transform text-indigo-400"></i>
              </button>
           </div>
        </div>
        
        <div className="bg-[#050810] border border-white/5 p-6 rounded-[2rem] flex flex-col justify-center items-center group hover:border-indigo-500/30 transition-all shadow-lg">
           <p className="text-[8px] font-black text-slate-500 uppercase mb-2 tracking-widest">Confidence Floor</p>
           <p className="text-3xl font-black text-indigo-400">80%</p>
           <p className="text-[7px] text-slate-700 mt-2">MIN_SIGNAL_DISPLAY</p>
        </div>
        
        <div className="bg-[#050810] border border-white/5 p-6 rounded-[2rem] flex flex-col justify-center items-center group hover:border-emerald-500/30 transition-all shadow-lg">
           <p className="text-[8px] font-black text-slate-500 uppercase mb-2 tracking-widest">Sniper Protocol</p>
           <p className={`text-2xl font-black ${autoTradeEnabled ? 'text-emerald-400' : 'text-slate-600'}`}>
            {autoTradeEnabled ? 'ACTIVE' : 'READY'}
           </p>
           <p className="text-[7px] text-slate-700 mt-2">THRESHOLD: 85%+</p>
        </div>
      </div>

      {/* Main Terminal Interface */}
      <div className="bg-[#050810]/95 border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl min-h-[500px] flex flex-col">
         <div className="p-8 border-b border-white/5 bg-indigo-950/5 flex justify-between items-center">
            <div className="flex space-x-10 text-[10px] font-black uppercase tracking-[0.3em]">
               <button className="text-indigo-400 border-b-2 border-indigo-500 pb-2">HUNT_RADAR</button>
               <button className="text-slate-500 hover:text-slate-300 transition-colors">KILL_LOGS</button>
            </div>
            <div className="flex items-center space-x-2 text-[8px] font-black text-slate-600">
               <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
               <span>SYSTEM_SYNCHRONIZED_WITH_COINBASE</span>
            </div>
         </div>

         <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
               {thoughtHistory.filter(t => t.confidence >= 80).map((t, i) => (
                  <div key={i} className="p-6 bg-white/[0.02] border border-white/5 rounded-3xl relative group overflow-hidden hover:border-indigo-500/40 transition-all">
                     <div className="flex justify-between items-start mb-4">
                        <div>
                           <span className="text-lg font-black text-white">{t.symbol}</span>
                           <span className={`ml-3 text-[10px] px-2 py-0.5 rounded font-black ${t.side === 'BUY' ? 'bg-emerald-500 text-black' : 'bg-rose-500 text-black'}`}>
                              {t.side}
                           </span>
                        </div>
                        <div className="text-right">
                           <p className="text-xl font-black text-indigo-400">{t.confidence}%</p>
                           <p className="text-[7px] text-slate-600 uppercase font-black">Confidence</p>
                        </div>
                     </div>
                     <p className="text-[10px] text-slate-400 mb-6 italic leading-relaxed">"{t.reason}"</p>
                     <div className="grid grid-cols-3 gap-4 text-[10px] font-black">
                        <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                           <span className="text-slate-600 block text-[7px] mb-1">ENTRY</span>
                           <span className="text-white">€{t.price?.toLocaleString()}</span>
                        </div>
                        <div className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/10">
                           <span className="text-emerald-600 block text-[7px] mb-1">SAFE TP</span>
                           <span className="text-emerald-400">€{t.tp?.toLocaleString()}</span>
                        </div>
                        <div className="bg-rose-500/5 p-3 rounded-xl border border-rose-500/10">
                           <span className="text-rose-600 block text-[7px] mb-1">DEEP SL</span>
                           <span className="text-rose-400">€{t.sl?.toLocaleString()}</span>
                        </div>
                     </div>
                     {t.confidence >= 85 && (
                        <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between text-[8px] font-black text-indigo-500 animate-pulse">
                           <span>SNIPER_TRIGGER_ARMED</span>
                           <i className="fas fa-bolt"></i>
                        </div>
                     )}
                  </div>
               ))}
            </div>
         </div>
      </div>
    </div>
  );
};

export default TradingTerminal;
