
import React, { useState } from 'react';
import { TradeSignal } from '../types';

interface HistoryViewProps {
  signals: any[];
  onClear: () => void;
}

const HistoryView: React.FC<HistoryViewProps> = ({ signals, onClear }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const safeSignals = Array.isArray(signals) ? signals : [];
  const filteredSignals = safeSignals.filter(s => 
    s.symbol?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.side?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (s.analysis || s.reason || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 backdrop-blur-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">Signal Archive</h2>
          <p className="text-slate-400 text-sm">Review historical AI performance and market calls.</p>
        </div>
        
        <div className="flex items-center space-x-4">
          <div className="relative">
            <i className="fas fa-filter absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs"></i>
            <input 
              type="text" 
              placeholder="Filter signals..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-slate-800/50 border border-slate-700 rounded-lg py-2 pl-9 pr-4 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-200 w-64"
            />
          </div>
          <button 
            onClick={onClear}
            className="text-xs font-bold text-rose-500 hover:text-rose-400 transition-colors uppercase tracking-widest bg-rose-500/10 px-4 py-2 rounded-lg border border-rose-500/20"
          >
            Clear All
          </button>
        </div>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden flex-1 flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900/80 border-b border-slate-800">
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Timestamp</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Asset</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Type</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Confidence</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Entry</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Target/Stop</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredSignals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center">
                      <i className="fas fa-database text-slate-700 text-4xl mb-4"></i>
                      <p className="text-slate-500 font-medium">No archived signals found matching criteria.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredSignals.map((signal) => {
                  const tp = signal.takeProfit || signal.tp || 0;
                  const sl = signal.stopLoss || signal.sl || 0;
                  const entry = signal.entryPrice || signal.price || 0;
                  const analysis = signal.analysis || signal.reason || "N/A";

                  return (
                    <tr key={signal.id} className="hover:bg-indigo-500/5 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="text-xs font-mono text-slate-300">
                          {signal.timestamp ? new Date(signal.timestamp).toLocaleDateString() : 'N/A'}<br/>
                          <span className="text-slate-500">{signal.timestamp ? new Date(signal.timestamp).toLocaleTimeString() : ''}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-2">
                          <div className="w-6 h-6 rounded bg-slate-800 flex items-center justify-center text-[10px] font-bold text-indigo-400">
                            {signal.symbol?.[0] || '?'}
                          </div>
                          <span className="text-sm font-bold text-white tracking-tight">{signal.symbol}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-[10px] px-2 py-1 rounded font-black uppercase ${
                          signal.side === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 
                          signal.side === 'SELL' ? 'bg-rose-500/10 text-rose-400' : 'bg-slate-700 text-slate-400'
                        }`}>
                          {signal.side}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-2">
                          <div className="flex-1 h-1.5 w-12 bg-slate-800 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-indigo-500" 
                              style={{ width: `${signal.confidence || 0}%` }}
                            ></div>
                          </div>
                          <span className="text-xs font-mono font-bold text-indigo-400">{signal.confidence || 0}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-sm text-slate-300">
                        €{Number(entry).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-[10px] font-mono">
                          <span className="text-emerald-500 font-bold">T: €{Number(tp).toLocaleString()}</span><br/>
                          <span className="text-rose-500 font-bold">S: €{Number(sl).toLocaleString()}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="max-w-xs overflow-hidden text-ellipsis whitespace-nowrap text-xs text-slate-500 group-hover:whitespace-normal group-hover:text-slate-400 transition-all">
                          {analysis}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default HistoryView;
