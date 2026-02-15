
import React, { useState, useEffect, useRef } from 'react';
import { AccountBalance, ExecutionLog } from '../types';
import { getApiBase } from '../services/tradingService';

interface TradingTerminalProps {
  balances: AccountBalance[];
  autoTradeEnabled: boolean;
  isEngineActive: boolean;
  onToggleEngine: () => void;
  onToggleAutoTrade: () => void;
  thoughtHistory: any[];
  liveActivity?: string;
  onForceScan?: () => void;
}

const TradingTerminal: React.FC<TradingTerminalProps> = ({ 
  autoTradeEnabled,
  thoughtHistory,
  liveActivity,
  onForceScan
}) => {
  const [liquidity, setLiquidity] = useState({ eur: 0, usdc: 0 });
  const [dailyStats, setDailyStats] = useState({ trades: 0, profit: 0, fees: 0 });
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [activeTab, setActiveTab] = useState<'thoughts' | 'logs'>('thoughts');
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchState = async () => {
      try {
        const urlBase = getApiBase();
        const res = await fetch(`${urlBase}/api/ghost/state`);
        const data = await res.json();
        if (data.liquidity) setLiquidity(data.liquidity);
        if (data.dailyStats) setDailyStats(data.dailyStats);
        if (data.executionLogs) setLogs(data.executionLogs);
      } catch (e) {}
    };
    fetchState();
    const inv = setInterval(fetchState, 3000);
    return () => clearInterval(inv);
  }, []);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = 0;
    }
  }, [thoughtHistory, logs]);

  return (
    <div className="flex flex-col space-y-6 font-mono h-full">
      {/* Predator Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 bg-[#050505] border border-indigo-500/30 p-6 rounded-3xl relative overflow-hidden shadow-2xl">
           <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-600/10 blur-[80px]"></div>
           <div className="relative z-10 flex justify-between items-center">
              <div>
                 <p className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.4em] mb-3">SYSTEM_LIQUIDITY_VAULT</p>
                 <div className="flex items-center space-x-6">
                    <h2 className="text-3xl font-black text-white">€{liquidity.eur.toLocaleString()}</h2>
                    <div className="h-8 w-px bg-white/10"></div>
                    <div className="text-emerald-400 text-sm font-black">ACTIVE_MINING</div>
                 </div>
              </div>
              <div className="text-right">
                 <p className="text-[8px] text-slate-500 uppercase tracking-widest mb-1">Total Fees Paid</p>
                 <p className="text-md font-black text-rose-400">€{dailyStats.fees.toFixed(3)}</p>
              </div>
           </div>
        </div>
        <div className="bg-[#050505] border border-white/5 p-6 rounded-3xl flex flex-col justify-center items-center">
           <p className="text-[8px] text-slate-500 uppercase mb-1">Hunter Status</p>
           <p className="text-xl font-black text-indigo-400 animate-pulse">{liveActivity?.split('_')[0] || "SCANNING"}</p>
        </div>
        <div className="bg-[#050505] border border-white/5 p-6 rounded-3xl flex flex-col justify-center items-center">
           <p className="text-[8px] text-slate-500 uppercase mb-1">Sniper Mode</p>
           <p className={`text-xl font-black ${autoTradeEnabled ? 'text-emerald-400' : 'text-slate-600'}`}>{autoTradeEnabled ? 'AUTO' : 'MANUAL'}</p>
        </div>
      </div>

      {/* Main Terminal UI */}
      <div className="flex-1 bg-black border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl flex flex-col min-h-[500px]">
        <div className="bg-white/5 p-4 flex justify-between items-center border-b border-white/5 px-8">
           <div className="flex space-x-8">
              <button 
                onClick={() => setActiveTab('thoughts')}
                className={`text-[10px] font-black uppercase tracking-widest pb-1 transition-all ${activeTab === 'thoughts' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-slate-500'}`}
              >
                Neural Thoughts
              </button>
              <button 
                onClick={() => setActiveTab('logs')}
                className={`text-[10px] font-black uppercase tracking-widest pb-1 transition-all ${activeTab === 'logs' ? 'text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-500'}`}
              >
                Order Kill-Logs
              </button>
           </div>
           <div className="flex items-center space-x-2 text-[8px] text-slate-600 font-black">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
              <span>LIVE_BRIDGE_STABLE</span>
           </div>
        </div>

        <div ref={terminalRef} className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-[radial-gradient(circle_at_center,_#050814_0%,_#000_100%)]">
           {activeTab === 'thoughts' ? (
             <div className="space-y-6">
                {thoughtHistory.map((t, i) => (
                  <div key={t.id || i} className="border-l-2 border-indigo-500/30 pl-6 py-2 group hover:border-indigo-400 transition-all">
                    <div className="flex items-center space-x-3 mb-2">
                       <span className="text-[10px] font-black text-indigo-500">[{new Date(t.timestamp).toLocaleTimeString()}]</span>
                       <span className="text-[10px] font-black text-white uppercase tracking-tighter">{t.symbol} Analysis</span>
                       <span className={`text-[8px] px-2 py-0.5 rounded font-black ${t.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>{t.side}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 italic leading-relaxed mb-3">"{t.thoughtProcess || t.reason}"</p>
                    <div className="flex space-x-6 text-[9px] font-black text-slate-600 uppercase tracking-widest">
                       <span>CONFIDENCE: <span className="text-indigo-400">{t.confidence}%</span></span>
                       <span>SAFE_TP: €{t.tp}</span>
                       <span>DEEP_SL: €{t.sl}</span>
                    </div>
                  </div>
                ))}
             </div>
           ) : (
             <div className="space-y-4">
                {logs.length === 0 ? (
                  <div className="text-center py-20 opacity-20 uppercase text-[10px] tracking-widest">No Executions Detected In Current Cycle</div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="bg-white/5 border border-white/5 p-5 rounded-2xl group hover:border-emerald-500/30 transition-all">
                       <div className="flex justify-between items-center mb-3">
                          <div className="flex items-center space-x-3">
                             <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-xs font-black">
                                <i className="fas fa-shopping-cart"></i>
                             </div>
                             <span className="text-xs font-black text-white">{log.symbol}</span>
                          </div>
                          <span className="text-[9px] text-slate-500">{new Date(log.timestamp).toLocaleString()}</span>
                       </div>
                       <div className="grid grid-cols-3 gap-4 text-[9px] font-black uppercase mb-3">
                          <div><span className="text-slate-600 block mb-1">Action</span><span className="text-emerald-400">{log.action}</span></div>
                          <div><span className="text-slate-600 block mb-1">Execution Price</span><span className="text-white">€{log.price.toLocaleString()}</span></div>
                          <div><span className="text-slate-600 block mb-1">Net Fee</span><span className="text-rose-400">€{log.fees?.toFixed(4)}</span></div>
                       </div>
                       <p className="text-[10px] text-slate-500 italic">Reason: {log.thought || "Auto-sniper trigger based on 85%+ confidence"}</p>
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
