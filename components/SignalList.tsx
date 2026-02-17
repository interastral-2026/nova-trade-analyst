
import React from 'react';
import { TradeSignal } from '../types';

interface SignalListProps {
  signals: TradeSignal[];
}

const SignalList: React.FC<SignalListProps> = ({ signals }) => {
  const safeSignals = Array.isArray(signals) ? signals : [];
  
  const activeSignals = safeSignals
    .filter(s => s.side !== 'NEUTRAL')
    .sort((a, b) => {
      const scoreA = (a.confidence || 0) + (a.potentialRoi || 0);
      const scoreB = (b.confidence || 0) + (b.potentialRoi || 0);
      return scoreB - scoreA;
    });

  return (
    <div className="flex flex-col h-full bg-[#020204] font-mono select-none">
      <div className="p-4 border-b border-white/5 bg-[#08080c] flex items-center justify-between shadow-xl">
        <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] flex items-center space-x-2">
          <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse shadow-[0_0_10px_#6366f1]"></span>
          <span>Ghost Signals</span>
        </h3>
        <span className="text-[8px] text-slate-600 font-bold uppercase tracking-tighter">V32_SYNC</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {activeSignals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 opacity-20 grayscale border border-dashed border-white/5 rounded-3xl mx-2 text-center">
            <i className="fas fa-satellite-dish text-3xl mb-4 animate-bounce"></i>
            <p className="text-[9px] font-black uppercase tracking-[0.3em]">HUNTING SMC GAPS...</p>
          </div>
        ) : (
          activeSignals.map((signal) => {
            const isBuy = signal.side === 'BUY';
            const roi = signal.potentialRoi || 0;
            const confidence = signal.confidence || 0;

            return (
              <div 
                key={signal.id} 
                className={`group border-2 rounded-[1.8rem] p-5 transition-all relative overflow-hidden bg-gradient-to-br from-white/[0.04] to-transparent ${
                  isBuy ? 'border-emerald-500/20' : 'border-rose-500/20'
                } hover:border-indigo-500/50 shadow-2xl`}
              >
                <div className="absolute top-0 left-0 h-1 bg-white/5 w-full">
                  <div 
                    className={`h-full transition-all duration-1000 ${isBuy ? 'bg-emerald-500 shadow-[0_0_12px_#10b981]' : 'bg-rose-500'}`}
                    style={{ width: `${confidence}%` }}
                  ></div>
                </div>

                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h4 className="text-base font-black text-white uppercase tracking-tighter">{signal.symbol}</h4>
                    <div className="flex items-center space-x-2 mt-1">
                       <span className={`text-[8px] font-black px-1.5 py-0.5 rounded shadow-sm ${isBuy ? 'bg-emerald-500 text-black' : 'bg-rose-500 text-white'}`}>
                        {signal.side}
                       </span>
                       <span className="text-[8px] text-slate-500 font-bold uppercase">{confidence}% CONF</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-sm font-black tracking-tighter ${isBuy ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {roi > 0 ? `+${roi.toFixed(1)}% ROI` : 'SCALP'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="bg-black/60 border border-white/5 p-2.5 rounded-xl text-center shadow-inner">
                    <p className="text-[7px] text-slate-600 uppercase font-black mb-1">Entry</p>
                    <p className="text-[10px] font-black text-white truncate">€{signal.entryPrice?.toLocaleString()}</p>
                  </div>
                  <div className="bg-emerald-500/[0.03] border border-emerald-500/10 p-2.5 rounded-xl text-center shadow-inner">
                    <p className="text-[7px] text-emerald-500 uppercase font-black mb-1">Target</p>
                    <p className="text-[10px] font-black text-emerald-400 truncate">€{signal.tp?.toLocaleString()}</p>
                  </div>
                  <div className="bg-rose-500/[0.03] border border-rose-500/10 p-2.5 rounded-xl text-center shadow-inner">
                    <p className="text-[7px] text-rose-500 uppercase font-black mb-1">Stop</p>
                    <p className="text-[10px] font-black text-rose-400 truncate">€{signal.sl?.toLocaleString()}</p>
                  </div>
                </div>

                <p className="text-[10px] text-slate-400 leading-tight italic font-medium border-t border-white/5 pt-3">
                  "{signal.analysis}"
                </p>
                
                <div className="mt-4 flex justify-between items-center text-[7px] font-black text-slate-600 uppercase tracking-widest">
                  <span className="flex items-center space-x-1">
                    <i className="fas fa-check-double text-indigo-500"></i>
                    <span>SMC_CORE_V32</span>
                  </span>
                  <span className="opacity-40">{new Date(signal.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default SignalList;
