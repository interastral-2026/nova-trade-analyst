
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
  liveActivity
}) => {
  const [stats, setStats] = useState({ eur: 0, usdc: 0, trades: 0, fees: 0, profit: 0, isPaper: true });
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
          profit: data.dailyStats?.profit || 0,
          isPaper: data.isPaperMode || false
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

  return (
    <div className="flex flex-col space-y-6 h-full font-mono">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#050508] border border-indigo-500/30 p-5 rounded-[2rem] shadow-xl relative overflow-hidden group">
           <div className="absolute inset-0 bg-indigo-500/5 translate-y-full group-hover:translate-y-0 transition-transform"></div>
           {stats.isPaper && <div className="absolute top-0 right-0 bg-amber-500 text-black text-[7px] font-black px-2 py-0.5 rounded-bl-lg z-10">SIMULATED</div>}
           <p className="text-[8px] font-black text-indigo-400 uppercase tracking-widest mb-1 relative z-10">EUR_LIQUIDITY</p>
           <h2 className="text-2xl font-black text-white relative z-10">€{stats.eur.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h2>
        </div>
        <div className="bg-[#050508] border border-cyan-500/20 p-5 rounded-[2rem]">
           <p className="text-[8px] font-black text-cyan-400 uppercase tracking-widest mb-1">USDC_VAULT</p>
           <h2 className="text-2xl font-black text-white">${stats.usdc.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h2>
        </div>
        <div className="bg-[#050508] border border-emerald-500/20 p-5 rounded-[2rem]">
           <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mb-1">REALIZED_ROI</p>
           <h2 className={`text-2xl font-black ${stats.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
             {stats.profit >= 0 ? '+' : ''}€{stats.profit.toFixed(2)}
           </h2>
        </div>
        <div className="bg-[#050508] border border-white/5 p-5 rounded-[2rem]">
           <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">ENGINE_PULSE</p>
           <h2 className="text-[10px] font-black text-white truncate uppercase animate-pulse">{liveActivity || "STABLE"}</h2>
        </div>
      </div>

      {/* Main Console */}
      <div className="flex-1 bg-black border border-white/10 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl">
        <div className="px-8 py-5 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
           <div className="flex space-x-6">
              <button onClick={() => setActiveTab('stream')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'stream' ? 'text-indigo-400 border-indigo-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}>
                Neural Feed (60%)
              </button>
              <button onClick={() => setActiveTab('activity')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'activity' ? 'text-amber-400 border-amber-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}>
                Market Scans
              </button>
              <button onClick={() => setActiveTab('holdings')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'holdings' ? 'text-cyan-400 border-cyan-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}>
                Active Hunt ({holdings.length})
              </button>
              <button onClick={() => setActiveTab('orders')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'orders' ? 'text-emerald-400 border-emerald-500' : 'text-slate-600 border-transparent hover:text-slate-400'}`}>
                Execution Log
              </button>
           </div>
        </div>

        <div ref={terminalRef} className="flex-1 overflow-y-auto p-8 custom-scrollbar">
           {activeTab === 'stream' && (
             <div className="space-y-8">
                {thoughtHistory.length === 0 ? (
                  <div className="h-48 flex items-center justify-center opacity-10 italic text-xs uppercase tracking-[0.5em]">Neural Engine Warming Up...</div>
                ) : (
                  thoughtHistory.map((t, i) => (
                    <div key={t.id || i} className={`group border-l-2 pl-6 py-1 transition-all relative ${t.confidence >= 75 ? 'border-emerald-500' : 'border-indigo-500/30'}`}>
                       <div className="flex items-center space-x-4 mb-2">
                          <span className="text-[9px] font-black text-indigo-500">[{new Date(t.timestamp).toLocaleTimeString()}]</span>
                          <span className="text-sm font-black text-white uppercase">{t.symbol}</span>
                          <span className={`text-[8px] px-2 py-0.5 rounded font-black ${t.confidence >= 75 ? 'bg-emerald-500 text-black' : 'bg-slate-800 text-slate-400'}`}>
                            {t.confidence >= 75 ? 'AUTO_TRIGGER' : 'DISPLAY_ONLY'}
                          </span>
                          <span className={`text-[8px] font-black px-2 rounded border ${t.confidence >= 70 ? 'border-emerald-500/40 text-emerald-400' : 'border-white/10 text-slate-500'}`}>
                            CONFIDENCE: {t.confidence}%
                          </span>
                       </div>
                       <p className="text-[11px] text-slate-400 leading-relaxed mb-4 italic max-w-3xl pr-12">
                        "{t.reason}"
                       </p>
                       {t.confidence >= 75 && (
                         <div className="flex space-x-4 text-[9px] font-black uppercase text-emerald-500/60">
                           <span>Target: €{t.tp}</span>
                           <span>Safety: €{t.sl}</span>
                         </div>
                       )}
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
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded ${scan.confidence >= 75 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                          {scan.confidence}% PROBABILITY
                        </span>
                     </div>
                     <p className="text-[10px] text-slate-500 italic">Core Analysis: {scan.reason}</p>
                   </div>
                 </div>
               ))}
             </div>
           )}

           {activeTab === 'holdings' && (
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {holdings.length === 0 ? (
                   <div className="col-span-2 h-48 flex flex-col items-center justify-center opacity-20 grayscale">
                      <i className="fas fa-crosshairs text-4xl mb-4 animate-ping"></i>
                      <p className="text-[10px] font-black uppercase tracking-widest">Scanning for Hunt Entry...</p>
                   </div>
                ) : (
                  holdings.map((pos) => (
                    <div key={pos.symbol} className="bg-white/[0.02] border border-emerald-500/20 p-5 rounded-2xl relative overflow-hidden group">
                       <div className="flex justify-between items-start mb-6">
                          <div className="flex items-center space-x-4">
                             <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-400">
                                <i className="fas fa-bolt"></i>
                             </div>
                             <div>
                                <h4 className="text-sm font-black text-white">{pos.symbol}-EUR</h4>
                                <p className="text-[8px] text-slate-500 uppercase">Entry: €{pos.entryPrice.toLocaleString()}</p>
                             </div>
                          </div>
                          <div className="bg-emerald-500 text-black text-[8px] font-black px-2 py-1 rounded">LIVE</div>
                       </div>
                       <div className="grid grid-cols-3 gap-2">
                          <div className="bg-black/40 p-2 rounded-lg border border-white/5">
                             <span className="text-[7px] text-slate-600 block uppercase">Allocated</span>
                             <span className="text-[10px] font-black text-white">€{pos.amount}</span>
                          </div>
                          <div className="bg-black/40 p-2 rounded-lg border border-emerald-500/10">
                             <span className="text-[7px] text-emerald-600 block uppercase">Goal</span>
                             <span className="text-[10px] font-black text-emerald-400">€{pos.tp}</span>
                          </div>
                          <div className="bg-black/40 p-2 rounded-lg border border-rose-500/10">
                             <span className="text-[7px] text-rose-600 block uppercase">Floor</span>
                             <span className="text-[10px] font-black text-rose-400">€{pos.sl}</span>
                          </div>
                       </div>
                    </div>
                  ))
                )}
             </div>
           )}

           {activeTab === 'orders' && (
             <div className="space-y-3">
                {logs.length === 0 ? (
                  <div className="h-48 flex items-center justify-center opacity-10 italic text-xs uppercase tracking-[0.5em]">History Empty</div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="bg-white/[0.02] border border-white/5 p-4 rounded-xl flex items-center justify-between">
                       <div className="flex items-center space-x-4">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs ${log.action === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                             <i className={`fas ${log.action === 'BUY' ? 'fa-shopping-cart' : 'fa-hand-holding-usd'}`}></i>
                          </div>
                          <div>
                             <span className="text-[10px] font-black text-white block uppercase">{log.symbol} | {log.action}</span>
                             <span className="text-[8px] text-slate-500">{new Date(log.timestamp).toLocaleString()}</span>
                          </div>
                       </div>
                       <div className="text-right">
                          <div className="text-[10px] font-black text-white">€{log.amount}</div>
                          <div className="text-[8px] text-slate-500">Price: €{log.price}</div>
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
