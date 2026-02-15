
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

  // اسکرول خودکار به بالا برای دیدن جدیدترین رویدادها
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = 0;
    }
  }, [thoughtHistory, logs, activeTab]);

  return (
    <div className="flex flex-col space-y-6 h-full font-mono">
      {/* Predator Analytics Header */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 bg-gradient-to-br from-[#0a0a0f] to-black border border-indigo-500/30 p-6 rounded-[2rem] shadow-2xl relative overflow-hidden group">
           <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 blur-[60px]"></div>
           <div className="flex justify-between items-center relative z-10">
              <div>
                 <p className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.4em] mb-2">LIQUIDITY_RESERVE_EUR</p>
                 <h2 className="text-4xl font-black text-white tracking-tighter">€{liquidity.eur.toLocaleString()}</h2>
              </div>
              <div className="text-right">
                 <p className="text-[8px] text-slate-500 uppercase tracking-widest mb-1">Session Fees</p>
                 <p className="text-lg font-black text-rose-400">€{dailyStats.fees.toFixed(3)}</p>
              </div>
           </div>
        </div>
        
        <div className="bg-[#08080c] border border-white/5 p-6 rounded-[2rem] flex flex-col justify-center items-center shadow-lg hover:border-indigo-500/20 transition-all">
           <p className="text-[8px] text-slate-500 uppercase mb-1 tracking-widest">Active Trades</p>
           <p className="text-2xl font-black text-white">{dailyStats.trades}</p>
        </div>

        <div className="bg-[#08080c] border border-white/5 p-6 rounded-[2rem] flex flex-col justify-center items-center shadow-lg">
           <p className="text-[8px] text-slate-500 uppercase mb-1 tracking-widest">AutoPilot Status</p>
           <p className={`text-xl font-black ${autoTradeEnabled ? 'text-emerald-400' : 'text-slate-600'}`}>
              {autoTradeEnabled ? 'ENGAGED' : 'STANDBY'}
           </p>
        </div>
      </div>

      {/* Neural Console Interface */}
      <div className="flex-1 bg-black border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl flex flex-col min-h-[400px]">
        <div className="bg-white/5 p-5 flex justify-between items-center border-b border-white/5 px-10">
           <div className="flex space-x-12">
              <button 
                onClick={() => setActiveTab('thoughts')}
                className={`text-[10px] font-black uppercase tracking-[0.2em] pb-1 transition-all ${activeTab === 'thoughts' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Neural Stream
              </button>
              <button 
                onClick={() => setActiveTab('logs')}
                className={`text-[10px] font-black uppercase tracking-[0.2em] pb-1 transition-all ${activeTab === 'logs' ? 'text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Execution Logs
              </button>
           </div>
           <div className="flex items-center space-x-3 text-[8px] font-black text-slate-600">
              <span className="text-indigo-500 animate-pulse">GATEWAY_ACTIVE</span>
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
           </div>
        </div>

        <div ref={terminalRef} className="flex-1 overflow-y-auto p-10 custom-scrollbar bg-[radial-gradient(circle_at_center,_rgba(99,102,241,0.03)_0%,_rgba(0,0,0,0)_80%)]">
           {activeTab === 'thoughts' ? (
             <div className="space-y-8">
                {thoughtHistory.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center opacity-20 italic text-xs uppercase tracking-[0.5em]">
                    Synchronizing Neural Bridge...
                  </div>
                ) : (
                  thoughtHistory.map((t, i) => (
                    <div key={t.id || i} className="group border-l border-indigo-500/20 pl-6 py-2 hover:border-indigo-500 transition-all">
                       <div className="flex items-center space-x-4 mb-3">
                          <span className="text-[10px] font-black text-indigo-500">[{new Date(t.timestamp).toLocaleTimeString()}]</span>
                          <span className="text-sm font-black text-white uppercase tracking-tighter">{t.symbol} ANALYZED</span>
                          <span className={`text-[8px] px-2 py-0.5 rounded font-black ${t.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : t.side === 'SELL' ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-800 text-slate-400'}`}>
                            {t.side}
                          </span>
                       </div>
                       <p className="text-[11px] text-slate-400 leading-relaxed mb-4 italic">
                        "{t.thoughtProcess || t.reason || t.analysis}"
                       </p>
                       <div className="grid grid-cols-3 gap-8 text-[9px] font-black text-slate-500 uppercase tracking-widest border-t border-white/5 pt-4">
                          <div>CONFIDENCE: <span className="text-indigo-400">{t.confidence}%</span></div>
                          <div>TARGET: <span className="text-emerald-500">€{t.tp || t.takeProfit}</span></div>
                          <div>STOP: <span className="text-rose-500">€{t.sl || t.stopLoss}</span></div>
                       </div>
                    </div>
                  ))
                )}
             </div>
           ) : (
             <div className="space-y-4">
                {logs.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center opacity-20 italic text-xs uppercase tracking-[0.5em]">
                    No Executions in Current Cycle
                  </div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="bg-white/[0.02] border border-white/5 p-6 rounded-2xl hover:border-emerald-500/30 transition-all group">
                       <div className="flex justify-between items-center mb-4">
                          <div className="flex items-center space-x-3">
                             <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 text-sm">
                                <i className="fas fa-crosshairs"></i>
                             </div>
                             <div>
                                <span className="text-sm font-black text-white block">{log.symbol} ORDER</span>
                                <span className="text-[8px] text-slate-500">{new Date(log.timestamp).toLocaleString()}</span>
                             </div>
                          </div>
                          <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest bg-emerald-500/10 px-3 py-1 rounded-full">
                            SUCCESS
                          </span>
                       </div>
                       <div className="grid grid-cols-3 gap-4 text-[10px] font-black uppercase mb-4">
                          <div className="bg-black/40 p-3 rounded-xl">
                            <span className="text-slate-600 block mb-1">Execution Price</span>
                            <span className="text-white">€{log.price.toLocaleString()}</span>
                          </div>
                          <div className="bg-black/40 p-3 rounded-xl">
                            <span className="text-slate-600 block mb-1">Quantity (EUR)</span>
                            <span className="text-white">€{log.amount.toFixed(2)}</span>
                          </div>
                          <div className="bg-black/40 p-3 rounded-xl">
                            <span className="text-slate-600 block mb-1">Net Fee (Taker)</span>
                            <span className="text-rose-400">€{log.fees?.toFixed(4)}</span>
                          </div>
                       </div>
                       <p className="text-[10px] text-slate-500 italic border-l-2 border-emerald-500/40 pl-4 py-1">
                        Reason: {log.thought || "Sniper trigger based on 85%+ neural confidence"}
                       </p>
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
