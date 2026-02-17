
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

  useEffect(() => {
    fetchState();
    const i = setInterval(fetchState, 3000);
    return () => clearInterval(i);
  }, []);

  const goalProgress = Math.max(0, Math.min(100, (stats.profit / stats.dailyGoal) * 100));

  return (
    <div className="flex flex-col space-y-6 h-full font-mono">
      {/* Hyper-Active Status Header */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="col-span-2 bg-zinc-900/40 border border-indigo-500/20 rounded-[2rem] p-6 relative overflow-hidden">
           <div className="flex justify-between items-end mb-3">
              <div>
                <p className="text-[8px] font-black text-indigo-400 uppercase tracking-[0.3em] mb-1">PROFIT_DIRECTIVE_V25</p>
                <h3 className="text-xl font-black text-white">€{stats.profit.toFixed(2)} / <span className="text-slate-500">€{stats.dailyGoal}</span></h3>
              </div>
              <div className="text-right">
                <span className={`text-[10px] font-black ${goalProgress >= 100 ? 'text-emerald-400' : 'text-indigo-400'}`}>
                  {goalProgress.toFixed(1)}% SUCCESS
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
        
        <div className="bg-zinc-900/40 border border-white/5 p-6 rounded-[2rem] flex flex-col justify-center">
           <p className="text-[8px] font-black text-emerald-400 uppercase tracking-widest mb-1">LIQUIDITY</p>
           <h2 className="text-xl font-black text-white">€{stats.eur.toLocaleString()}</h2>
        </div>

        <div className="bg-zinc-900/40 border border-white/5 p-6 rounded-[2rem] flex flex-col justify-center relative overflow-hidden">
           <div className="absolute top-0 right-0 p-2">
              <span className="flex h-2 w-2 rounded-full bg-rose-500 animate-ping"></span>
           </div>
           <p className="text-[8px] font-black text-rose-500 uppercase tracking-widest mb-1">RADAR_LINK</p>
           <h2 className="text-[9px] font-black text-white truncate uppercase">{liveActivity}</h2>
        </div>
      </div>

      <div className="flex-1 bg-[#010103] border border-white/10 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl">
        <div className="px-8 py-5 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
           <div className="flex space-x-6">
              {[
                { id: 'stream', label: 'Intelligence Stream' },
                { id: 'activity', label: 'Sniper History' },
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
        </div>

        <div ref={terminalRef} className="flex-1 overflow-y-auto p-8 custom-scrollbar">
           {activeTab === 'stream' && (
             <div className="space-y-4">
                {thoughtHistory.length === 0 ? (
                   <div className="h-64 flex flex-col items-center justify-center opacity-20 text-center">
                      <div className="w-12 h-12 border-2 border-indigo-500 rounded-full border-t-transparent animate-spin mb-4"></div>
                      <p className="text-[10px] font-black uppercase tracking-[0.5em]">Establishing Neural Connection...</p>
                   </div>
                ) : (
                  thoughtHistory.map((t, i) => (
                    <div key={t.id || i} className={`border-l-2 pl-6 py-4 transition-all hover:bg-white/[0.02] ${t.side === 'BUY' ? 'border-emerald-500 bg-emerald-500/5' : 'border-white/5'}`}>
                       <div className="flex items-center space-x-4 mb-2">
                          <span className="text-[8px] font-black text-indigo-500/60">[{new Date(t.timestamp).toLocaleTimeString()}]</span>
                          <span className="text-sm font-black text-white uppercase">{t.symbol}</span>
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded border ${t.side === 'BUY' ? 'border-emerald-500/40 text-emerald-400' : t.side === 'SELL' ? 'border-rose-500/40 text-rose-400' : 'text-slate-600'}`}>
                            {t.side} {t.confidence > 0 ? `(${t.confidence}%)` : ''}
                          </span>
                          {t.entryPrice && <span className="text-[10px] text-slate-500 font-bold">€{t.entryPrice.toLocaleString()}</span>}
                       </div>
                       <p className="text-[11px] text-slate-300 pr-10 italic leading-relaxed font-medium">"{t.analysis}"</p>
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
                             {log.action === 'BUY' ? <i className="fas fa-crosshairs"></i> : <i className="fas fa-check-double"></i>}
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
                      <i className="fas fa-bullseye text-4xl mb-4 animate-ping"></i>
                      <p className="uppercase text-[10px] font-black tracking-[0.3em]">Scoping New Targets...</p>
                   </div>
                ) : (
                  holdings.map((pos) => {
                    const distTP = Math.max(0, Math.min(100, ((pos.currentPrice - pos.entryPrice) / (pos.tp - pos.entryPrice)) * 100));
                    return (
                      <div key={pos.symbol} className="bg-zinc-900/30 border border-emerald-500/30 p-6 rounded-[2.5rem] relative overflow-hidden">
                         <div className="flex justify-between items-center mb-6">
                            <h4 className="text-lg font-black text-white">{pos.symbol}</h4>
                            <div className={`px-4 py-2 rounded-2xl font-black text-[12px] border ${pos.pnlPercent >= 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
                               {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
                            </div>
                         </div>
                         <div className="grid grid-cols-2 gap-4 text-[10px] mb-6">
                            <div><span className="text-slate-600 block text-[7px] font-black uppercase">Entry</span>€{pos.entryPrice.toLocaleString()}</div>
                            <div><span className="text-emerald-500 block text-[7px] font-black uppercase">Target</span>€{pos.tp.toLocaleString()}</div>
                         </div>
                         <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 shadow-[0_0_10px_#10b981]" style={{ width: `${distTP}%` }}></div>
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
