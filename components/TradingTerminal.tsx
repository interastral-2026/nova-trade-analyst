
import React, { useState, useEffect, useRef } from 'react';
import { ExecutionLog } from '../types';
import { getApiBase } from '../services/tradingService';

interface TradingTerminalProps {
  balances: any[];
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
}) => {
  const [stats, setStats] = useState({ eur: 0, trades: 0, fees: 0 });
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [activeTab, setActiveTab] = useState<'stream' | 'orders'>('stream');
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchState = async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/ghost/state`);
        const data = await res.json();
        setStats({ 
          eur: data.liquidity?.eur || 0, 
          trades: data.dailyStats?.trades || 0, 
          fees: data.dailyStats?.fees || 0 
        });
        setLogs(data.executionLogs || []);
      } catch (e) {}
    };
    fetchState();
    const i = setInterval(fetchState, 4000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = 0;
  }, [thoughtHistory, logs, activeTab]);

  return (
    <div className="flex flex-col space-y-6 h-full font-mono">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#050508] border border-indigo-500/20 p-6 rounded-[2rem] shadow-[0_20px_50px_rgba(79,70,229,0.1)]">
           <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-1">AVAILABLE_LIQUIDITY</p>
           <h2 className="text-3xl font-black text-white">€{stats.eur.toLocaleString()}</h2>
        </div>
        <div className="bg-[#050508] border border-white/5 p-6 rounded-[2rem]">
           <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">DAILY_EXECUTIONS</p>
           <h2 className="text-3xl font-black text-emerald-400">{stats.trades}</h2>
        </div>
        <div className="bg-[#050508] border border-white/5 p-6 rounded-[2rem]">
           <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">ACCUMULATED_FEES</p>
           <h2 className="text-3xl font-black text-rose-400">€{stats.fees.toFixed(2)}</h2>
        </div>
      </div>

      {/* Main Console */}
      <div className="flex-1 bg-black border border-white/10 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl">
        <div className="px-8 py-5 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
           <div className="flex space-x-10">
              <button onClick={() => setActiveTab('stream')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'stream' ? 'text-indigo-400 border-indigo-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}>
                Neural Stream
              </button>
              <button onClick={() => setActiveTab('orders')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'orders' ? 'text-emerald-400 border-emerald-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}>
                Order Logs
              </button>
           </div>
           <div className="flex items-center space-x-2 text-[8px] font-black text-slate-600 uppercase tracking-tighter">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
              <span>Secure Bridge Active</span>
           </div>
        </div>

        <div ref={terminalRef} className="flex-1 overflow-y-auto p-8 custom-scrollbar">
           {activeTab === 'stream' ? (
             <div className="space-y-8">
                {thoughtHistory.length === 0 ? (
                  <div className="h-48 flex items-center justify-center opacity-10 italic text-xs uppercase tracking-[0.5em]">Scanning Neural Pathways...</div>
                ) : (
                  thoughtHistory.map((t, i) => (
                    <div key={t.id || i} className="group border-l-2 border-indigo-500/20 pl-6 py-1 hover:border-indigo-500 transition-all">
                       <div className="flex items-center space-x-4 mb-2">
                          <span className="text-[9px] font-black text-indigo-500">[{new Date(t.timestamp).toLocaleTimeString()}]</span>
                          <span className="text-sm font-black text-white uppercase">{t.symbol} STRUCTURE</span>
                          <span className={`text-[8px] px-2 py-0.5 rounded font-black ${t.side === 'BUY' ? 'bg-emerald-500 text-black' : t.side === 'SELL' ? 'bg-rose-500 text-black' : 'bg-slate-800 text-slate-400'}`}>
                            {t.side}
                          </span>
                       </div>
                       <p className="text-[11px] text-slate-400 leading-relaxed mb-4 italic max-w-2xl">
                        "{t.thoughtProcess || t.reason}"
                       </p>
                       <div className="flex space-x-12 text-[9px] font-black text-slate-500 uppercase border-t border-white/5 pt-3">
                          <span>Confidence: <span className="text-indigo-400">{t.confidence}%</span></span>
                          <span>Target: <span className="text-emerald-500">€{t.tp || t.takeProfit}</span></span>
                          <span>Stop: <span className="text-rose-500">€{t.sl || t.stopLoss}</span></span>
                       </div>
                    </div>
                  ))
                )}
             </div>
           ) : (
             <div className="space-y-4">
                {logs.length === 0 ? (
                  <div className="h-48 flex items-center justify-center opacity-10 italic text-xs uppercase tracking-[0.5em]">No Executions in current cycle</div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="bg-white/[0.02] border border-white/5 p-5 rounded-2xl hover:border-emerald-500/30 transition-all">
                       <div className="flex justify-between items-center mb-4">
                          <div className="flex items-center space-x-3">
                             <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 text-xs">
                                <i className="fas fa-crosshairs"></i>
                             </div>
                             <div>
                                <span className="text-xs font-black text-white block">{log.symbol}</span>
                                <span className="text-[8px] text-slate-500">{new Date(log.timestamp).toLocaleString()}</span>
                             </div>
                          </div>
                          <span className="text-[9px] font-black text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full uppercase">Executed</span>
                       </div>
                       <div className="grid grid-cols-3 gap-4 text-[9px] font-black uppercase">
                          <div className="bg-black/40 p-2 rounded-lg">
                            <span className="text-slate-600 block">Price</span>
                            <span className="text-white">€{log.price.toLocaleString()}</span>
                          </div>
                          <div className="bg-black/40 p-2 rounded-lg">
                            <span className="text-slate-600 block">Amount</span>
                            <span className="text-white">€{log.amount}</span>
                          </div>
                          <div className="bg-black/40 p-2 rounded-lg">
                            <span className="text-slate-600 block">Fee</span>
                            <span className="text-rose-400">€{log.fees?.toFixed(3)}</span>
                          </div>
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
