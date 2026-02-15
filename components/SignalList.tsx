
import React from 'react';
import { TradeSignal } from '../types';

interface SignalListProps {
  signals: any[];
}

const SignalList: React.FC<SignalListProps> = ({ signals }) => {
  // Sort signals by expectedROI (highest first)
  const sortedSignals = Array.isArray(signals) 
    ? [...signals].sort((a, b) => (b.expectedROI || 0) - (a.expectedROI || 0))
    : [];
  
  const limitedSignals = sortedSignals.slice(0, 20);

  return (
    <div className="bg-[#050507] border border-white/5 rounded-2xl flex flex-col h-full shadow-2xl overflow-hidden font-mono">
      <div className="p-5 border-b border-white/5 bg-[#0a0a0c] flex items-center justify-between">
        <h3 className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.2em] flex items-center space-x-2">
           <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-ping"></span>
           <span>ROI-Sorted Signals</span>
        </h3>
        <span className="text-[8px] font-black text-slate-600">PREDATOR_ELITE</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {limitedSignals.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 opacity-20 text-center grayscale">
             <i className="fas fa-crosshairs text-4xl mb-4 animate-pulse"></i>
             <p className="text-[9px] font-black uppercase tracking-widest">Scanning for 70% Confidence...</p>
          </div>
        ) : (
          limitedSignals.map((signal) => {
            const tp = signal.takeProfit || signal.tp || 0;
            const sl = signal.stopLoss || signal.sl || 0;
            const entry = signal.entryPrice || signal.price || 0;
            const roi = signal.expectedROI || 0;

            return (
              <div 
                key={signal.id} 
                className={`border rounded-xl p-4 transition-all relative overflow-hidden group hover:border-indigo-500/40 ${
                  signal.side === 'BUY' ? 'border-emerald-500/30 bg-emerald-500/[0.03]' : 
                  signal.side === 'SELL' ? 'border-rose-500/30 bg-rose-500/[0.03]' : 'border-white/5 bg-white/[0.01]'
                }`}
              >
                {/* ROI Badge */}
                <div className="absolute top-0 right-0 p-2">
                   <div className="bg-indigo-600 text-[8px] font-black text-white px-2 py-0.5 rounded shadow-lg">
                      +{roi.toFixed(1)}% ROI
                   </div>
                </div>

                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-black text-white">{signal.symbol}</span>
                  <span className={`text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-tighter mr-12 ${
                    signal.side === 'BUY' ? 'bg-emerald-500 text-black' : 
                    signal.side === 'SELL' ? 'bg-rose-500 text-black' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {signal.side}
                  </span>
                </div>

                <p className="text-[10px] text-slate-400 leading-tight mb-4 pr-10">
                  {signal.reason || signal.analysis}
                </p>

                <div className="grid grid-cols-3 gap-2 border-t border-white/5 pt-4 mb-3">
                  <div className="text-left">
                    <p className="text-[7px] text-slate-600 font-black uppercase mb-1">Entry</p>
                    <p className="text-[10px] font-black text-white">€{Number(entry).toLocaleString()}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[7px] text-emerald-600 font-black uppercase mb-1">TP</p>
                    <p className="text-[10px] font-black text-emerald-400">€{Number(tp).toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[7px] text-rose-600 font-black uppercase mb-1">SL</p>
                    <p className="text-[10px] font-black text-rose-400">€{Number(sl).toLocaleString()}</p>
                  </div>
                </div>
                
                <div className="flex justify-between items-center pt-2 border-t border-white/5">
                   <div className="flex items-center space-x-2">
                      <span className="text-[8px] font-black text-slate-500">Confidence</span>
                      <div className="w-16 h-1 bg-slate-800 rounded-full overflow-hidden">
                         <div className="h-full bg-indigo-500" style={{width: `${signal.confidence || 0}%`}}></div>
                      </div>
                      <span className="text-[8px] font-black text-indigo-400">{signal.confidence || 0}%</span>
                   </div>
                   <span className="text-[7px] text-slate-600 font-bold uppercase">{new Date(signal.timestamp).toLocaleTimeString()}</span>
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
