
import React from 'react';
import { AnalysisStatus } from '../types';

interface HeaderProps {
  status: AnalysisStatus;
  onGenerate: () => void;
  autoPilot: boolean;
  scanningSymbol: string | null;
  engineActive?: boolean;
}

const Header: React.FC<HeaderProps> = ({ status, autoPilot, scanningSymbol, engineActive = true }) => {
  const getStatusColor = () => {
    if (!engineActive) return 'bg-slate-800 shadow-none';
    switch (status) {
      case AnalysisStatus.ANALYZING: return 'bg-cyan-400 shadow-cyan-400/50';
      case AnalysisStatus.FETCHING: return 'bg-indigo-500 shadow-indigo-500/50';
      case AnalysisStatus.COMPLETED: return 'bg-emerald-500 shadow-emerald-500/50';
      case AnalysisStatus.RATE_LIMITED: 
      case AnalysisStatus.OVERLOADED: return 'bg-rose-600 shadow-rose-600/50';
      case AnalysisStatus.KEY_REQUIRED: return 'bg-amber-500 shadow-amber-500/50';
      case AnalysisStatus.ERROR: return 'bg-rose-500 shadow-rose-500/50';
      default: return 'bg-emerald-500';
    }
  };

  const getStatusLabel = () => {
    if (!engineActive) return 'Core Engine Off';
    switch (status) {
      case AnalysisStatus.RATE_LIMITED: return 'Rate Limited';
      case AnalysisStatus.OVERLOADED: return 'Model Overloaded';
      case AnalysisStatus.KEY_REQUIRED: return 'Key Required';
      case AnalysisStatus.ANALYZING: return 'Neural 2.5 Lite Probing';
      case AnalysisStatus.IDLE: return 'Ghost Scan Active';
      default: return `System: ${status}`;
    }
  };

  return (
    <header className="h-16 border-b border-cyan-500/10 px-6 flex items-center justify-between bg-black/80 backdrop-blur-xl z-20">
      <div className="flex items-center space-x-3">
        <div className={`w-10 h-10 ${engineActive ? 'bg-indigo-600' : 'bg-slate-800'} rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.2)] transition-all`}>
          <i className={`fas ${engineActive ? 'fa-bolt animate-pulse' : 'fa-power-off'} text-white text-xl`}></i>
        </div>
        <div>
          <h1 className="text-xl font-black tracking-tight bg-gradient-to-r from-indigo-400 via-white to-cyan-400 bg-clip-text text-transparent">
            SPECTRAL OVERLORD V2.5
          </h1>
          <div className="flex items-center space-x-2">
             <p className="text-[9px] text-slate-500 font-black uppercase tracking-[0.2em]">
              Neural 2.5 Flash Lite Core
            </p>
            {engineActive && (
               <span className="flex h-1.5 w-1.5 rounded-full bg-cyan-500 shadow-[0_0_5px_#22d3ee]"></span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-6">
        {scanningSymbol && engineActive && (
          <div className="hidden lg:flex items-center space-x-3 bg-indigo-500/5 border border-indigo-500/20 px-4 py-1.5 rounded-full">
            <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Target Node:</span>
            <span className="text-xs font-mono font-black text-white">{scanningSymbol}</span>
          </div>
        )}

        <div className="flex items-center space-x-3">
          <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor()} ${engineActive ? 'animate-pulse' : ''} shadow-[0_0_8px] shadow-current transition-all`}></div>
          <span className={`text-[10px] font-black uppercase tracking-widest ${(!engineActive) ? 'text-slate-600' : (status === AnalysisStatus.RATE_LIMITED) ? 'text-rose-500' : (status === AnalysisStatus.KEY_REQUIRED) ? 'text-amber-500' : 'text-cyan-400'}`}>
            {getStatusLabel()}
          </span>
        </div>
        
        <div className="h-8 w-[1px] bg-white/5"></div>
        
        <div className={`flex items-center space-x-2 ${autoPilot ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-slate-800/20 border-white/5'} py-1.5 px-4 rounded-full border transition-all`}>
          <span className={`text-[9px] font-black uppercase tracking-widest ${autoPilot ? 'text-emerald-400' : 'text-slate-500'}`}>
            {autoPilot ? 'AUTO_SNIPER_ON' : 'MANUAL_MODE'}
          </span>
        </div>
      </div>
    </header>
  );
};

export default Header;
