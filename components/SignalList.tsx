
import React from 'react';
import { TradeSignal } from '../types';

interface SignalListProps {
  signals: TradeSignal[];
}

const SignalList: React.FC<SignalListProps> = ({ signals }) => {
  const limitedSignals = signals.slice(0, 15);

  return (
    <div className="bg-[#050507] border border-white/5 rounded-2xl flex flex-col h-full shadow-2xl overflow-hidden font-mono">
      <div className="p-5 border-b border-white/5 bg-[#0a0a0c] flex items-center justify-between">
        <h3 className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.2em] flex items-center space-x-2">
           <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-ping"></span>
           <span>Predator Hunt-Feed</span>
        </h3>
        <span className="text-[8px] font-black text-slate-600">v10.2_LIVE</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
        {limitedSignals.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 opacity-20 text-center grayscale">
             <i className="fas fa-radar text-4xl mb-4 animate-pulse"></i>
             <p className="text-[9px] font-black uppercase tracking-widest">Awaiting tactical data...</p>
          </div>
        ) : (
          limitedSignals.map((signal) => (
            <div 
              key={signal.id} 
              className={`border rounded-xl p-4 transition-all relative overflow-hidden group hover:border-indigo-500/40 ${
                signal.side === 'BUY' ? 'border-emerald-500/20 bg-emerald-500/[0.02]' : 
                signal.side === 'SELL' ? 'border-rose-500/20 bg-rose-500/[0.02]' : 'border-white/5 bg-white/[0.01]'
              }`}
            >
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-black text-white">{signal.symbol}</span>
                <span className={`text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-tighter ${
                  signal.side === 'BUY' ? 'bg-emerald-500 text-black' : 
                  signal.side === 'SELL' ? 'bg-rose-500 text-black' : 'bg-slate-800 text-slate-400'
                }`}>
                  {signal.side}
                </span>
              </div>

              <p className="text-[10px] text-slate-400 leading-tight mb-4 group-hover:text-slate-200 transition-colors">
                {signal.analysis}
              </p>

              {signal.side !== 'NEUTRAL' && (
                <div className="grid grid-cols-3 gap-2 border-t border-white/5 pt-4 mb-3">
                  <div className="text-left">
                    <p className="text-[7px] text-slate-600 font-black uppercase mb-1">Entry</p>
                    <p className="text-[10px] font-black text-white">€{signal.entryPrice.toLocaleString()}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[7px] text-emerald-600 font-black uppercase mb-1">Target</p>
                    <p className="text-[10px] font-black text-emerald-400">€{signal.takeProfit.toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[7px] text-rose-600 font-black uppercase mb-1">Stop</p>
                    <p className="text-[10px] font-black text-rose-400">€{signal.stopLoss.toLocaleString()}</p>
                  </div>
                </div>
              )}
              
              <div className="flex justify-between items-center pt-2 border-t border-white/5">
                 <div className="flex items-center space-x-2">
                    <div className="w-16 h-1 bg-slate-800 rounded-full overflow-hidden">
                       <div className="h-full bg-indigo-500" style={{width: `${signal.confidence}%`}}></div>
                    </div>
                    <span className="text-[8px] font-black text-slate-500">{signal.confidence}%</span>
                 </div>
                 <span className="text-[7px] text-slate-600 font-bold uppercase">{new Date(signal.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default SignalList;
