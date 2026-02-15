
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
  const [stats, setStats] = useState({ eur: 0, usdc: 0, trades: 0, fees: 0, profit: 0 });
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [holdings, setHoldings] = useState<any[]>([]);
  const [lastScans, setLastScans] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'stream' | 'activity' | 'holdings' | 'orders'>('stream');
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchState = async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/ghost/state`);
        const data = await res.json();
        setStats({ 
          eur: data.liquidity?.eur || 0, 
          usdc: data.liquidity?.usdc || 0,
          trades: data.dailyStats?.trades || 0, 
          fees: data.dailyStats?.fees || 0,
          profit: data.dailyStats?.profit || 0
        });
        setLogs(data.executionLogs || []);
        setHoldings(data.activePositions || []);
        setLastScans(data.lastScans || []);
      } catch (e) {}
    };
    fetchState();
    const i = setInterval(fetchState, 3000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = 0;
  }, [thoughtHistory, logs, holdings, activeTab, lastScans]);

  return (
    <div className="flex flex-col space-y-6 h-full font-mono">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#050508] border border-indigo-500/20 p-5 rounded-[2rem] shadow-xl">
           <p className="text-[8px] font-black text-indigo-400 uppercase tracking-widest mb-1">LIQUIDITY_EUR</p>
           <h2 className="text-2xl font-black text-white">€{stats.eur.toLocaleString()}</h2>
        </div>
        <div className="bg-[#050508] border border-cyan-500/20 p-5 rounded-[2rem]">
           <p className="text-[8px] font-black text-cyan-400 uppercase tracking-widest mb-1">LIQUIDITY_USDC</p>
           <h2 className="text-2xl font-black text-white">${stats.usdc.toLocaleString()}</h2>
        </div>
        <div className="bg-[#050508] border border-emerald-500/20 p-5 rounded-[2rem]">
           <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mb-1">REALIZED_PNL</p>
           <h2 className={`text-2xl font-black ${stats.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
             {stats.profit >= 0 ? '+' : ''}€{stats.profit.toFixed(2)}
           </h2>
        </div>
        <div className="bg-[#050508] border border-white/5 p-5 rounded-[2rem]">
           <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">ACTIVE_HOLDINGS</p>
           <h2 className="text-2xl font-black text-white">{holdings.length}</h2>
        </div>
      </div>

      {/* Main Console */}
      <div className="flex-1 bg-black border border-white/10 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl">
        <div className="px-8 py-5 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
           <div className="flex space-x-6">
              <button onClick={() => setActiveTab('stream')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'stream' ? 'text-indigo-400 border-indigo-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}>
                Neural ROI-Feed
              </button>
              <button onClick={() => setActiveTab('activity')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'activity' ? 'text-amber-400 border-amber-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}>
                Live Activity
              </button>
              <button onClick={() => setActiveTab('holdings')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'holdings' ? 'text-cyan-400 border-cyan-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}>
                Positions
              </button>
              <button onClick={() => setActiveTab('orders')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'orders' ? 'text-emerald-400 border-emerald-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}>
                History
              </button>
           </div>
           <div className="flex items-center space-x-2 text-[8px] font-black text-slate-600 uppercase tracking-tighter">
              <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${autoTradeEnabled ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
              <span>{autoTradeEnabled ? 'AUTO_SNIPER' : 'WATCH_ONLY'}</span>
           </div>
        </div>

        <div ref={terminalRef} className="flex-1 overflow-y-auto p-8 custom-scrollbar">
           {activeTab === 'stream' && (
             <div className="space-y-8">
                {thoughtHistory.length === 0 ? (
                  <div className="h-48 flex items-center justify-center opacity-10 italic text-xs uppercase tracking-[0.5em]">Searching for High-Confidence setups...</div>
                ) : (
                  thoughtHistory.map((t, i) => (
                    <div key={t.id || i} className="group border-l-2 border-indigo-500/20 pl-6 py-1 hover:border-indigo-500 transition-all relative">
                       <div className="flex items-center space-x-4 mb-2">
                          <span className="text-[9px] font-black text-indigo-500">[{new Date(t.timestamp).toLocaleTimeString()}]</span>
                          <span className="text-sm font-black text-white uppercase">{t.symbol}</span>
                          <span className={`text-[8px] px-2 py-0.5 rounded font-black ${t.side === 'BUY' ? 'bg-emerald-500 text-black' : 'bg-slate-800 text-slate-400'}`}>
                            {t.side}
                          </span>
                          <span className="bg-indigo-500/10 text-indigo-400 text-[8px] font-black px-2 rounded">CONFIDENCE: {t.confidence}%</span>
                       </div>
                       <p className="text-[11px] text-slate-400 leading-relaxed mb-4 italic max-w-3xl">
                        "{t.reason}"
                       </p>
                    </div>
                  ))
                )}
             </div>
           )}

           {activeTab === 'activity' && (
             <div className="space-y-4">
               {lastScans.map((scan) => (
                 <div key={scan.id} className="flex items-start space-x-4 border-b border-white/5 pb-4 last:border-0">
                   <div className="text-[9px] font-black text-slate-600 mt-1">[{new Date(scan.timestamp).toLocaleTimeString()}]</div>
                   <div className="flex-1">
                     <div className="flex items-center space-x-3 mb-1">
                        <span className="text-xs font-black text-white">{scan.symbol}</span>
                        <span className="text-[9px] text-slate-500">@ €{scan.price.toLocaleString()}</span>
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded ${scan.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                          {scan.side} ({scan.confidence}%)
                        </span>
                     </div>
                     <p className="text-[10px] text-slate-500 italic">Decision: {scan.reason}</p>
                   </div>
                 </div>
               ))}
             </div>
           )}

           {activeTab === 'holdings' && (
             <div className="grid grid-cols-1 gap-4">
                {holdings.length === 0 ? (
                   <div className="h-48 flex flex-col items-center justify-center opacity-20 grayscale">
                      <i className="fas fa-box-open text-4xl mb-4"></i>
                      <p className="text-[10px] font-black uppercase tracking-widest">No Active Positions</p>
                   </div>
                ) : (
                  holdings.map((pos) => (
                    <div key={pos.id} className="bg-white/[0.02] border border-cyan-500/20 p-5 rounded-2xl relative overflow-hidden group">
                       <div className="flex justify-between items-start mb-6">
                          <div className="flex items-center space-x-4">
                             <div className="w-10 h-10 bg-cyan-500/10 rounded-xl flex items-center justify-center text-cyan-400">
                                <i className="fas fa-wallet"></i>
                             </div>
                             <div>
                                <h4 className="text-sm font-black text-white">{pos.symbol}</h4>
                                <p className="text-[8px] text-slate-500 uppercase">Entry: €{pos.entryPrice.toLocaleString()}</p>
                             </div>
                          </div>
                          <div className="text-right">
                             <span className="text-[9px] font-black text-cyan-400 bg-cyan-500/10 px-3 py-1 rounded-full uppercase">Monitoring</span>
                          </div>
                       </div>
                       <div className="grid grid-cols-3 gap-4 mb-4">
                          <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                             <span className="text-[8px] text-slate-600 block uppercase mb-1">Size</span>
                             <span className="text-xs font-black text-white">€{pos.amount}</span>
                          </div>
                          <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                             <span className="text-[8px] text-emerald-600 block uppercase mb-1">TP</span>
                             <span className="text-xs font-black text-emerald-400">€{pos.tp.toLocaleString()}</span>
                          </div>
                          <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                             <span className="text-[8px] text-rose-600 block uppercase mb-1">SL</span>
                             <span className="text-xs font-black text-rose-400">€{pos.sl.toLocaleString()}</span>
                          </div>
                       </div>
                    </div>
                  ))
                )}
             </div>
           )}

           {activeTab === 'orders' && (
             <div className="space-y-4">
                {logs.length === 0 ? (
                  <div className="h-48 flex items-center justify-center opacity-10 italic text-xs uppercase tracking-[0.5em]">History Empty</div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="bg-white/[0.02] border border-white/5 p-5 rounded-2xl">
                       <div className="flex justify-between items-center mb-4">
                          <div className="flex items-center space-x-3">
                             <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs ${log.status.includes('PROFIT') ? 'bg-emerald-500/20 text-emerald-400' : 'bg-indigo-500/10 text-indigo-400'}`}>
                                <i className={`fas ${log.action === 'BUY' ? 'fa-arrow-down' : 'fa-arrow-up'}`}></i>
                             </div>
                             <div>
                                <span className="text-xs font-black text-white block">{log.symbol} / {log.action}</span>
                                <span className="text-[8px] text-slate-500">{new Date(log.timestamp).toLocaleString()}</span>
                             </div>
                          </div>
                          <div className="text-right">
                             <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase bg-slate-800 text-slate-500`}>
                               {log.status}
                             </span>
                          </div>
                       </div>
                       <p className="text-[9px] text-slate-500 italic">"{log.thought}"</p>
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
