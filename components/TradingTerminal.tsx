
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
  const [stats, setStats] = useState({ eur: 0, usdc: 0, trades: 0, profit: 0, isPaper: true, diag: '', dailyGoal: 50 });
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
        diag: data.diag || '',
        dailyGoal: data.dailyStats?.dailyGoal || 50
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

  const goalProgress = Math.max(0, Math.min(100, (stats.profit / stats.dailyGoal) * 100));

  return (
    <div className="flex flex-col space-y-6 h-full font-mono">
      {/* Daily Goal Tracker */}
      <div className="bg-zinc-900/40 border border-indigo-500/20 rounded-[2rem] p-6 relative overflow-hidden">
         <div className="flex justify-between items-end mb-3">
            <div>
              <p className="text-[8px] font-black text-indigo-400 uppercase tracking-[0.3em] mb-1">Daily_Profit_Directive</p>
              <h3 className="text-xl font-black text-white">€{stats.profit.toFixed(2)} / <span className="text-slate-500">€{stats.dailyGoal}</span></h3>
            </div>
            <div className="text-right">
              <span className={`text-[10px] font-black ${goalProgress >= 100 ? 'text-emerald-400' : 'text-indigo-400'}`}>
                {goalProgress.toFixed(1)}% REACHED
              </span>
            </div>
         </div>
         <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-1000 ${goalProgress >= 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-indigo-600 to-cyan-400 shadow-[0_0_15px_rgba(99,102,241,0.5)]'}`}
              style={{ width: `${goalProgress}%` }}
            ></div>
         </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`p-5 rounded-3xl border transition-all ${stats.isPaper ? 'bg-zinc-900/50 border-white/5 opacity-80' : 'bg-emerald-950/20 border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.1)]'}`}>
           <p className="text-[8px] font-black text-indigo-400 uppercase tracking-widest mb-1">AVAILABLE_LIQUIDITY</p>
           <h2 className="text-2xl font-black text-white">€{stats.eur.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h2>
           <p className="text-[7px] text-slate-500 mt-2 uppercase font-black">{stats.diag}</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 p-5 rounded-3xl">
           <p className="text-[8px] font-black text-cyan-400 uppercase tracking-widest mb-1">STABLE_COIN_USDC</p>
           <h2 className="text-2xl font-black text-white">${stats.usdc.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h2>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 p-5 rounded-3xl flex flex-col justify-center">
           <p className="text-[8px] font-black text-rose-500 uppercase tracking-widest mb-1">RADAR_TARGETING</p>
           <h2 className="text-[10px] font-black text-white truncate uppercase animate-pulse">{liveActivity}</h2>
        </div>
      </div>

      <div className="flex-1 bg-[#010103] border border-white/10 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl">
        <div className="px-8 py-5 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
           <div className="flex space-x-6">
              {[
                { id: 'stream', label: 'Neural Stream' },
                { id: 'activity', label: 'Execution Logs' },
                { id: 'holdings', label: 'Active Hunts', count: holdings.length }
              ].map((tab) => (
                <button 
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)} 
                  className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all flex items-center space-x-2 ${activeTab === tab.id ? 'text-indigo-400 border-indigo-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}
                >
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className="bg-indigo-500 text-white text-[8px] px-1.5 py-0.5 rounded-full animate-pulse">{tab.count}</span>
                  )}
                </button>
              ))}
           </div>
           {activeTab === 'activity' && (
             <button onClick={handlePurge} className="text-[8px] font-black bg-rose-500/10 border border-rose-500/20 text-rose-500 px-3 py-1 rounded-lg hover:bg-rose-500/20 uppercase">
               Purge Data
             </button>
           )}
        </div>

        <div ref={terminalRef} className="flex-1 overflow-y-auto p-8 custom-scrollbar">
           {activeTab === 'stream' && (
             <div className="space-y-4">
                {thoughtHistory.length === 0 ? (
                   <div className="h-64 flex flex-col items-center justify-center opacity-20 text-center">
                      <i className="fas fa-satellite-dish text-3xl mb-4 animate-bounce"></i>
                      <p className="text-[10px] font-black uppercase tracking-[0.5em]">Syncing Neural Hub...</p>
                   </div>
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
                       <p className="text-[11px] text-slate-400 pr-10 italic leading-relaxed">"{t.analysis}"</p>
                    </div>
                  ))
                )}
             </div>
           )}

           {activeTab === 'activity' && (
             <div className="space-y-3">
                {logs.length === 0 ? (
                  <div className="h-48 flex items-center justify-center opacity-20 uppercase text-[10px] font-black tracking-widest">Waiting for Sniper Activity...</div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-2xl group hover:border-indigo-500/30 transition-all">
                       <div className="flex items-center space-x-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[12px] font-black ${log.action === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                             {log.action === 'BUY' ? <i className="fas fa-arrow-up"></i> : <i className="fas fa-arrow-down"></i>}
                          </div>
                          <div>
                             <h5 className="text-[11px] font-black text-white uppercase">{log.symbol} <span className="text-[8px] text-indigo-400 ml-2 font-mono tracking-tighter opacity-70">{log.details}</span></h5>
                             <p className="text-[9px] text-slate-600 font-bold">{new Date(log.timestamp).toLocaleString()}</p>
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
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {holdings.length === 0 ? (
                   <div className="col-span-full h-64 flex flex-col items-center justify-center opacity-20 grayscale">
                      <i className="fas fa-crosshairs text-4xl mb-4"></i>
                      <p className="uppercase text-[10px] font-black tracking-[0.3em]">No Active Targets Found</p>
                   </div>
                ) : (
                  holdings.map((pos) => {
                    const entry = pos.entryPrice;
                    const current = pos.currentPrice;
                    const tp = pos.tp;
                    const sl = pos.sl;
                    
                    const distTP = Math.max(0, Math.min(100, ((current - entry) / (tp - entry)) * 100));
                    const distSL = Math.max(0, Math.min(100, ((current - entry) / (sl - entry)) * 100));

                    return (
                      <div key={pos.symbol} className={`bg-zinc-900/30 border p-6 rounded-[2.5rem] group transition-all relative overflow-hidden ${pos.isPaper ? 'border-white/5' : 'border-emerald-500/30 shadow-2xl shadow-emerald-500/5'}`}>
                         <div className="flex justify-between items-center mb-6">
                            <div>
                              <h4 className="text-lg font-black text-white flex items-center">
                                {pos.symbol}
                                <span className={`text-[7px] ${pos.isPaper ? 'bg-slate-700 text-slate-300' : 'bg-emerald-500 text-black'} px-1.5 py-0.5 ml-3 rounded font-black tracking-widest uppercase`}>
                                  {pos.isPaper ? 'SIM' : 'LIVE'}
                                </span>
                              </h4>
                              <p className="text-[9px] text-slate-500 uppercase mt-1 font-black">Market: <span className="text-white">€{pos.currentPrice?.toLocaleString()}</span></p>
                            </div>
                            <div className={`px-4 py-2 rounded-2xl font-black text-[12px] border ${pos.pnlPercent >= 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
                               {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
                            </div>
                         </div>
                         
                         <div className="grid grid-cols-2 gap-y-4 text-[10px] mb-6 border-b border-white/5 pb-6">
                            <div><span className="text-slate-600 uppercase block text-[7px] mb-1 font-black">Entry</span>€{pos.entryPrice?.toLocaleString()}</div>
                            <div><span className="text-emerald-500 uppercase block text-[7px] mb-1 font-black">Target</span>€{pos.tp?.toLocaleString()}</div>
                            <div><span className="text-indigo-400 uppercase block text-[7px] mb-1 font-black">Size</span>€{pos.amount?.toFixed(2)}</div>
                            <div><span className="text-rose-500 uppercase block text-[7px] mb-1 font-black">Stop</span>€{pos.sl?.toLocaleString()}</div>
                         </div>

                         <div className="space-y-4">
                           <div className="space-y-1">
                              <div className="flex justify-between text-[7px] font-black uppercase tracking-widest text-emerald-500">
                                <span>Momentum to TP</span>
                                <span>{distTP.toFixed(0)}%</span>
                              </div>
                              <div className="relative h-1.5 bg-white/5 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full transition-all duration-700 ${pos.pnlPercent >= 0 ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' : 'bg-slate-700'}`}
                                  style={{ width: `${distTP}%` }}
                                ></div>
                              </div>
                           </div>

                           <div className="space-y-1">
                              <div className="flex justify-between text-[7px] font-black uppercase tracking-widest text-rose-500">
                                <span>Risk Proximity</span>
                                <span>{distSL.toFixed(0)}%</span>
                              </div>
                              <div className="relative h-1.5 bg-white/5 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full transition-all duration-700 ${pos.pnlPercent < 0 ? 'bg-rose-500 shadow-[0_0_10px_#f43f5e]' : 'bg-slate-700'}`}
                                  style={{ width: `${distSL}%` }}
                                ></div>
                              </div>
                           </div>
                         </div>
                      </div>
                    )
                  })
                )}
             </div>
           )}
        </div>
      </div>
    </div>
  );
};

export default TradingTerminal;
