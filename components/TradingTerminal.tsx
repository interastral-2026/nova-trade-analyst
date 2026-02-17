
import React, { useState, useEffect, useRef } from 'react';
import { ExecutionLog, ActivePosition, TradeSignal } from '../types';
import { getApiBase } from '../services/tradingService';

interface TradingTerminalProps {
  thoughtHistory: TradeSignal[];
  liveActivity: string;
}

const TradingTerminal: React.FC<TradingTerminalProps> = ({ 
  thoughtHistory,
  liveActivity
}) => {
  const [stats, setStats] = useState({ eur: 0, usdc: 0, trades: 0, profit: 0, isPaper: true, diag: '' });
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [holdings, setHoldings] = useState<ActivePosition[]>([]);
  const [activeTab, setActiveTab] = useState<'stream' | 'activity' | 'holdings'>('stream');
  const terminalRef = useRef<HTMLDivElement>(null);

  const fetchState = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/ghost/state`);
      const data = await res.json();
      setStats({ 
        eur: data.liquidity?.eur || 0, 
        usdc: data.liquidity?.usdc || 0,
        trades: data.dailyStats?.trades || 0, 
        profit: data.dailyStats?.profit || 0,
        isPaper: data.isPaperMode,
        diag: data.diag || ''
      });
      setLogs(data.executionLogs || []);
      setHoldings(data.activePositions || []);
    } catch (e) {
      console.error("Terminal fetch failed");
    }
  };

  const handlePurge = async () => {
    if (!confirm("Remove all simulated history and legacy data?")) return;
    try {
      const res = await fetch(`${getApiBase()}/api/ghost/clear-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearPositions: true })
      });
      if (res.ok) fetchState();
    } catch (e) {}
  };

  useEffect(() => {
    fetchState();
    const i = setInterval(fetchState, 3000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="flex flex-col space-y-6 h-full font-mono">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className={`p-5 rounded-3xl border ${stats.isPaper ? 'bg-zinc-900/50 border-white/5 opacity-80' : 'bg-emerald-950/20 border-emerald-500/30'}`}>
           <p className="text-[8px] font-black text-indigo-400 uppercase tracking-widest mb-1">REAL_LIQUIDITY</p>
           <h2 className="text-2xl font-black text-white">€{stats.eur.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h2>
           <p className="text-[7px] text-slate-500 mt-2 uppercase">{stats.diag}</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 p-5 rounded-3xl">
           <p className="text-[8px] font-black text-cyan-400 uppercase tracking-widest mb-1">STABLE_COIN</p>
           <h2 className="text-2xl font-black text-white">${stats.usdc.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h2>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 p-5 rounded-3xl">
           <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mb-1">ACCUMULATED_PNL</p>
           <h2 className={`text-2xl font-black ${stats.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
             {stats.profit >= 0 ? '+' : ''}€{stats.profit.toFixed(2)}
           </h2>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 p-5 rounded-3xl flex flex-col justify-center">
           <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">LIVE_RADAR</p>
           <h2 className="text-[10px] font-black text-white truncate uppercase animate-pulse">{liveActivity}</h2>
        </div>
      </div>

      <div className="flex-1 bg-[#010103] border border-white/10 rounded-[2rem] overflow-hidden flex flex-col shadow-2xl">
        <div className="px-8 py-5 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
           <div className="flex space-x-6">
              {['stream', 'activity', 'holdings'].map((tab) => (
                <button 
                  key={tab}
                  onClick={() => setActiveTab(tab as any)} 
                  className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === tab ? 'text-indigo-400 border-indigo-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}
                >
                  {tab.replace(/^\w/, c => c.toUpperCase())}
                </button>
              ))}
           </div>
           {activeTab === 'activity' && (
             <button onClick={handlePurge} className="text-[8px] font-black bg-rose-500/10 border border-rose-500/20 text-rose-500 px-3 py-1 rounded-lg hover:bg-rose-500/20 uppercase">
               Purge Sim Data
             </button>
           )}
        </div>

        <div ref={terminalRef} className="flex-1 overflow-y-auto p-8 custom-scrollbar">
           {activeTab === 'stream' && (
             <div className="space-y-4">
                {thoughtHistory.length === 0 ? (
                   <div className="h-64 flex items-center justify-center opacity-20 text-[10px] font-black uppercase">Intercepting Neural Signals...</div>
                ) : (
                  thoughtHistory.map((t, i) => (
                    <div key={t.id || i} className={`border-l-2 pl-6 py-4 transition-all ${t.side === 'BUY' ? 'border-emerald-500 bg-emerald-500/5' : 'border-white/5'}`}>
                       <div className="flex items-center space-x-4 mb-1">
                          <span className="text-[8px] font-black text-indigo-500/60">[{new Date(t.timestamp).toLocaleTimeString()}]</span>
                          <span className="text-sm font-black text-white uppercase">{t.symbol}</span>
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded border ${t.side === 'BUY' ? 'border-emerald-500/40 text-emerald-400' : 'text-slate-600'}`}>
                            {t.side} ({t.confidence}%)
                          </span>
                       </div>
                       <p className="text-[11px] text-slate-400 pr-10">"{t.analysis}"</p>
                    </div>
                  ))
                )}
             </div>
           )}

           {activeTab === 'activity' && (
             <div className="space-y-3">
                {logs.length === 0 ? (
                  <div className="h-48 flex items-center justify-center opacity-20 uppercase text-[10px] font-black">History Cleaned. Waiting for Live Fills...</div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
                       <div className="flex items-center space-x-4">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black ${log.action === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                             {log.action[0]}
                          </div>
                          <div>
                             <h5 className="text-[11px] font-black text-white uppercase">{log.symbol} <span className="text-[8px] text-indigo-400 ml-2">{log.details}</span></h5>
                             <p className="text-[9px] text-slate-600">{new Date(log.timestamp).toLocaleString()}</p>
                          </div>
                       </div>
                       <div className="text-right font-black">
                          <div className="text-[11px] text-white">€{log.price.toLocaleString()}</div>
                          {log.pnl !== undefined && (
                             <div className={`text-[9px] ${log.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                               {log.pnl >= 0 ? '+' : ''}€{log.pnl.toFixed(2)}
                             </div>
                          )}
                       </div>
                    </div>
                  ))
                )}
             </div>
           )}

           {activeTab === 'holdings' && (
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {holdings.length === 0 ? (
                   <div className="col-span-2 h-48 flex items-center justify-center opacity-20 uppercase text-[10px] font-black">Scanning for Real Entries...</div>
                ) : (
                  holdings.map((pos) => (
                    <div key={pos.symbol} className={`bg-zinc-900/30 border p-6 rounded-3xl group transition-all ${pos.isPaper ? 'border-white/5 opacity-50' : 'border-emerald-500/30 shadow-lg shadow-emerald-500/5'}`}>
                       <div className="flex justify-between items-center mb-6">
                          <div>
                            <h4 className="text-md font-black text-white">{pos.symbol}-EUR <span className="text-[7px] bg-emerald-500 text-black px-1 ml-2 rounded">COINBASE_LIVE</span></h4>
                            <p className="text-[8px] text-slate-500 uppercase mt-1">Live Price: €{pos.currentPrice?.toLocaleString()}</p>
                          </div>
                          <div className={`px-3 py-1.5 rounded-xl font-black text-[10px] border ${pos.pnlPercent >= 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
                             {pos.pnlPercent >= 0 ? '▲' : '▼'} {Math.abs(pos.pnlPercent || 0).toFixed(2)}%
                          </div>
                       </div>
                       
                       <div className="grid grid-cols-2 gap-y-4 text-[10px] mb-6">
                          <div><span className="text-slate-600 uppercase block text-[7px] mb-1">Entry Point</span>€{pos.entryPrice?.toLocaleString()}</div>
                          <div><span className="text-emerald-500/70 uppercase block text-[7px] mb-1">TP Sniper</span>€{pos.tp?.toLocaleString()}</div>
                          <div><span className="text-indigo-400 uppercase block text-[7px] mb-1">Position Size</span>€{pos.amount?.toFixed(2)}</div>
                          <div><span className="text-rose-500/70 uppercase block text-[7px] mb-1">SL Guard</span>€{pos.sl?.toLocaleString()}</div>
                       </div>

                       <div className="relative h-1 bg-white/5 rounded-full overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-1000 ${pos.pnlPercent >= 0 ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-rose-500 shadow-[0_0_8px_#f43f5e]'}`}
                            style={{ width: `${Math.min(100, Math.max(0, 50 + (pos.pnlPercent * 5)))}%` }}
                          ></div>
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
