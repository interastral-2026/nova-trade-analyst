
import React from 'react';
import { TradeSignal } from '../types';

interface SignalListProps {
  signals: any[];
}

const SignalList: React.FC<SignalListProps> = ({ signals }) => {
  // Ensure we have a valid array and filter out any duplicates by ID if they exist
  const safeSignals = Array.isArray(signals) ? signals : [];
  
  const sortedSignals = [...safeSignals].sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  
  const limitedSignals = sortedSignals.slice(0, 30);

  return (
    <div className="bg-[#050507] border border-white/5 rounded-2xl flex flex-col h-full shadow-2xl overflow-hidden font-mono">
      <div className="p-5 border-b border-white/5 bg-[#0a0a0c] flex items-center justify-between">
        <h3 className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.2em] flex items-center space-x-2">
           <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-ping"></span>
           <span>Predator Signals (v19)</span>
        </h3>
        <span className="text-[8px] font-black text-slate-600">FLASH_SCAN</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {limitedSignals.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 opacity-20 text-center grayscale">
             <i className="fas fa-crosshairs text-4xl mb-4 animate-pulse"></i>
             <p className="text-[9px] font-black uppercase tracking-widest">Intercepting Neural Signals...</p>
          </div>
        ) : (
          limitedSignals.map((signal, idx) => {
            const tp = signal.tp || 0;
            const sl = signal.sl || 0;
            const entry = signal.entryPrice || 0;
            // Generate a truly unique key using ID and index as fallback
            const uniqueKey = signal.id || `signal-${idx}-${signal.timestamp}`;

            return (
              <div 
                key={uniqueKey} 
                className={`border rounded-xl p-4 transition-all relative overflow-hidden group hover:border-indigo-500/40 ${
                  signal.side === 'BUY' ? 'border-emerald-500/30 bg-emerald-500/[0.03]' : 'border-white/5 bg-white/[0.01]'
                }`}
              >
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-black text-white">{signal.symbol}</span>
                  <span className={`text-[8px] font-black px-2 py-0.5 rounded uppercase ${
                    signal.side === 'BUY' ? 'bg-emerald-500 text-black' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {signal.side} ({signal.confidence}%)
                  </span>
                </div>

                <p className="text-[10px] text-slate-400 leading-tight mb-4 pr-8 italic">
                  "{signal.analysis}"
                </p>

                <div className="grid grid-cols-3 gap-2 border-t border-white/5 pt-4">
                  <div>
                    <p className="text-[7px] text-slate-600 font-black uppercase mb-1">Entry</p>
                    <p className="text-[10px] font-black text-white">€{Number(entry).toLocaleString()}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[7px] text-emerald-600 font-black uppercase mb-1">Target</p>
                    <p className="text-[10px] font-black text-emerald-400">€{Number(tp).toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[7px] text-rose-600 font-black uppercase mb-1">Safety</p>
                    <p className="text-[10px] font-black text-rose-400">€{Number(sl).toLocaleString()}</p>
                  </div>
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
