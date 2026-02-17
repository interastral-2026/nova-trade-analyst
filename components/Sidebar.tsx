
import React, { useState } from 'react';
import { AssetInfo } from '../types';

interface SidebarProps {
  assets: AssetInfo[];
  selected: string;
  onSelect: (id: string) => void;
  autoPilot: boolean;
  onToggleAuto: () => void;
  engineActive: boolean;
  onToggleEngine: () => void;
  viewMode: string;
  onViewChange: (mode: any) => void;
  bridgeUrl: string;
  onUpdateBridge: (url: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  assets, 
  selected, 
  onSelect, 
  autoPilot, 
  onToggleAuto, 
  engineActive,
  onToggleEngine,
  bridgeUrl,
  onUpdateBridge
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const [urlInput, setUrlInput] = useState(bridgeUrl || "");

  const handleReconnect = () => {
    onUpdateBridge(urlInput);
    setShowSettings(false);
  };

  return (
    <aside className="w-80 border-r border-cyan-500/10 bg-[#05070a] flex flex-col">
      <div className="p-6 border-b border-white/5 bg-gradient-to-b from-cyan-900/10 to-transparent">
        <div className="flex justify-between items-center mb-6">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Neural Link v18.5</span>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${showSettings ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/20' : 'bg-white/5 text-slate-500 hover:text-white'}`}
          >
            <i className="fas fa-network-wired"></i>
          </button>
        </div>

        <div className="space-y-3">
          <button 
            onClick={onToggleEngine}
            className={`w-full p-5 rounded-2xl border transition-all flex flex-col items-center justify-center space-y-3 relative overflow-hidden group ${
              engineActive ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-rose-500/20 bg-rose-500/5 opacity-60'
            }`}
          >
            {engineActive && <div className="absolute top-0 left-0 w-full h-1 bg-cyan-500/50 animate-pulse"></div>}
            <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${engineActive ? 'bg-cyan-500/20 text-cyan-400 shadow-[0_0_20px_#22d3ee]' : 'bg-rose-500/20 text-rose-400 shadow-[0_0_20px_#f43f5e33]'}`}>
              <i className={`fas ${engineActive ? 'fa-satellite-dish animate-bounce' : 'fa-power-off'} text-xl`}></i>
            </div>
            <div className="text-center">
              <span className={`text-[10px] font-black uppercase tracking-[0.3em] block ${engineActive ? 'text-cyan-400' : 'text-rose-400'}`}>
                {engineActive ? 'RADAR_ARMED' : 'SYSTEM_OFF'}
              </span>
              <p className="text-[8px] text-slate-500 mt-1 font-bold">{engineActive ? 'MONITORING_LIVE' : 'IDLE'}</p>
            </div>
          </button>

          <button 
            onClick={onToggleAuto}
            className={`w-full py-3 rounded-xl border transition-all flex items-center justify-center space-x-3 ${
              autoPilot && engineActive ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-400 shadow-[0_0_10px_#10b98133]' : 'border-white/5 bg-white/[0.02] text-slate-500'
            }`}
          >
            <i className={`fas ${autoPilot ? 'fa-crosshairs' : 'fa-circle'} text-[10px]`}></i>
            <span className="text-[9px] font-black uppercase tracking-widest">
              PREDATOR_80%_AUTO: {autoPilot ? 'ENGAGED' : 'OFF'}
            </span>
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="m-4 p-5 bg-[#0a0f18] border border-cyan-500/20 rounded-2xl shadow-2xl space-y-4">
          <div>
            <p className="text-[9px] font-black text-cyan-500 uppercase tracking-widest mb-1">Bridge API Gateway</p>
            <input 
              type="text" 
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://..."
              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-[10px] font-mono text-white outline-none focus:border-cyan-500 transition-all mb-2"
            />
            <button 
              onClick={handleReconnect}
              className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-[8px] font-black uppercase rounded-lg transition-all"
            >
              Sync Neural Bridge
            </button>
          </div>
        </div>
      )}

      <div className="px-6 py-4 flex-1 overflow-hidden flex flex-col">
        <div className="flex justify-between items-center mb-6">
           <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Live Radar Watchlist</span>
           <span className={`text-[8px] font-black px-2 py-0.5 rounded bg-white/5 tracking-widest ${engineActive ? 'text-emerald-500' : 'text-slate-600'}`}>
            {engineActive ? 'SCANNING' : 'IDLE'}
           </span>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
          {assets.map((asset) => (
            <button
              key={asset.id}
              onClick={() => onSelect(asset.id)}
              className={`w-full flex items-center justify-between px-4 py-4 rounded-2xl transition-all border group ${
                selected === asset.id ? 'bg-cyan-500/10 border-cyan-500/40 shadow-lg' : 'bg-white/[0.02] border-white/5 hover:border-white/10'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-[10px] transition-all ${selected === asset.id ? 'bg-cyan-500 text-black' : 'bg-slate-800 text-slate-500'}`}>
                  {asset.name[0]}
                </div>
                <div className="text-left">
                  <h4 className="text-[11px] font-black text-white uppercase tracking-tight">{asset.id.split('-')[0]}</h4>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-black text-white">€{parseFloat(asset.price).toLocaleString()}</div>
                <div className={`text-[8px] font-black ${asset.change24h >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
