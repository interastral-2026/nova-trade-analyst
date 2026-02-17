
import React from 'react';
import { TradeSignal } from '../types';

interface SignalListProps {
  signals: any[];
}

const SignalList: React.FC<SignalListProps> = ({ signals }) => {
  const safeSignals = Array.isArray(signals) ? signals : [];
  
  // V28.0: Sort by Profitability Priority (Confidence + potentialRoi)
  const prioritizedSignals = [...safeSignals]
    .filter(s => s.side !== 'NEUTRAL')
    .sort((a, b) => {
      const priorityA = (a.confidence || 0) + (a.potentialRoi || 0) * 10;
      const priorityB = (b.confidence || 0) + (b.potentialRoi || 0) * 10;
      return priorityB - priorityA;
    });
  
  const recentThoughts = [...safeSignals]
    .filter(s => s.side === 'NEUTRAL')
    .slice(0, 5);

  return (
    <div className="flex flex-col h-full bg-[#030305] border-l border-white/5 font-mono">
      {/* Dynamic Header */}
      <div className="p-6 border-b border-white/5 bg-gradient-to-r from-indigo-900/10 to-transparent">
        <div className="flex justify-between items-center mb-1">
          <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em]">Neural Sniper Feed</h3>
          <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
        </div>
        <p className="text-[8px] text-slate-500 font-bold uppercase">Priority: High ROI + High Confidence</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {prioritizedSignals.length === 0 ? (
          <div className="h-40 flex flex-col items-center justify-center opacity-30 grayscale border border-dashed border-white/10 rounded-2xl mx-2">
            <i className="fas fa-radar text-2xl mb-3 animate-spin"></i>
            <p className="text-[9px] font-black uppercase">Hunting Liquidity...</p>
          </div>
        ) : (
          prioritizedSignals.map((signal, idx) => {
            const isBuy = signal.side === 'BUY';
            const roi = signal.potentialRoi || 0;
            
            return (
              <div 
                key={signal.id || idx} 
                className={`group border rounded-2xl p-5 transition-all relative overflow-hidden bg-gradient-to-br ${
                  isBuy ? 'border-emerald-500/30 from-emerald-500/[0.05] to-transparent' : 'border-rose-500/30 from-rose-500/[0.05] to-transparent'
                } hover:border-indigo-500/50 shadow-xl`}
              >
                {/* Priority Badge */}
                <div className={`absolute top-0 right-0 px-3 py-1 text-[8px] font-black uppercase rounded-bl-xl ${
                  signal.confidence >= 85 ? 'bg-indigo-500 text-white shadow-[0_0_10px_#6366f1]' : 'bg-white/5 text-slate-500'
                }`}>
                  {signal.confidence >= 85 ? 'HIGH_PRIORITY' : 'VALID_SETUP'}
                </div>

                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h4 className="text-sm font-black text-white tracking-tighter">{signal.symbol}</h4>
                    <span className="text-[8px] text-slate-500 font-bold uppercase">SMC_ALGO_V28</span>
                  </div>
                  <div className="text-right">
                    <span className={`text-[11px] font-black ${isBuy ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {roi > 0 ? `+${roi}% ROI` : 'SCALP'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-5 p-3 bg-black/40 border border-white/5 rounded-xl">
                  <div>
                    <p className="text-[7px] font-black text-slate-600 uppercase mb-1 tracking-widest">Entry Target</p>
                    <p className="text-[11px] font-black text-white">€{signal.entryPrice?.toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[7px] font-black text-indigo-500 uppercase mb-1 tracking-widest">Confidence</p>
                    <p className="text-[11px] font-black text-indigo-400">{signal.confidence}%</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                   <div className="bg-emerald-500/10 border border-emerald-500/20 p-2 rounded-lg text-center">
                      <p className="text-[7px] font-black text-emerald-500 uppercase mb-0.5">Take Profit</p>
                      <p className="text-[10px] font-black text-emerald-400">€{signal.tp?.toLocaleString()}</p>
                   </div>
                   <div className="bg-rose-500/10 border border-rose-500/20 p-2 rounded-lg text-center">
                      <p className="text-[7px] font-black text-rose-500 uppercase mb-0.5">Stop Loss</p>
                      <p className="text-[10px] font-black text-rose-400">€{signal.sl?.toLocaleString()}</p>
                   </div>
                </div>

                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                   <div 
                     className="h-full bg-indigo-500 shadow-[0_0_8px_#6366f1]" 
                     style={{ width: `${signal.confidence}%` }}
                   ></div>
                </div>
              </div>
            );
          })
        )}

        {/* Neural Activity Footer */}
        <div className="mt-8 opacity-40">
           <p className="text-[8px] font-black text-slate-600 uppercase tracking-widest mb-4 text-center">Latest Neural Scans</p>
           <div className="space-y-2">
              {recentThoughts.map((t, i) => (
                <div key={i} className="flex justify-between items-center text-[9px] border-b border-white/5 pb-2 px-2">
                   <span className="text-white font-bold">{t.symbol}</span>
                   <span className="text-slate-600">STRUCTURE_VALIDATED</span>
                </div>
              ))}
           </div>
        </div>
      </div>
    </div>
  );
};

export default SignalList;
