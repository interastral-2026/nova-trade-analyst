
import React from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { AssetInfo, MarketData } from '../types';

interface MarketDashboardProps {
  asset?: AssetInfo;
  candles: MarketData[];
}

const MarketDashboard: React.FC<MarketDashboardProps> = ({ asset, candles }) => {
  if (!asset || !candles || candles.length === 0) {
    return (
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 h-[460px] flex items-center justify-center">
        <p className="text-slate-500 font-bold uppercase tracking-widest animate-pulse">Loading Chart Data...</p>
      </div>
    );
  }

  const chartData = candles.map(c => ({
    time: new Date(c.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    price: c.close
  }));

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-900 border border-slate-700 p-2 rounded shadow-xl">
          <p className="text-[10px] text-slate-400 uppercase mb-1">{payload[0].payload.time}</p>
          <p className="text-sm font-mono font-bold text-white">${payload[0].value.toFixed(2)}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 backdrop-blur-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-3 mb-1">
              <h2 className="text-3xl font-bold tracking-tight text-white">{asset.id}</h2>
              <span className={`px-2 py-0.5 rounded-md text-xs font-bold uppercase tracking-widest ${
                asset.change24h >= 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
              }`}>
                {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%
              </span>
            </div>
            <p className="text-slate-400 text-sm font-medium">Real-time TradingView Analysis Enabled</p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-3 gap-8">
            <div>
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Price</p>
              <p className="text-xl font-mono font-bold text-white">
                ${parseFloat(asset.price).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">24h Vol</p>
              <p className="text-xl font-mono font-bold text-slate-300">
                {parseFloat(asset.volume).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div className="hidden md:block">
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Liquidity</p>
              <div className="flex items-center space-x-1">
                <div className="flex space-x-0.5">
                  {[1,2,3,4,5].map(i => <div key={i} className={`w-1.5 h-3 rounded-sm ${i <= 4 ? 'bg-cyan-500' : 'bg-slate-700'}`}></div>)}
                </div>
                <span className="text-xs font-bold text-cyan-500 ml-1">High</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 h-[400px]">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4">
            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest">Price History</h3>
            <div className="flex bg-slate-800/50 p-1 rounded-lg">
              <button className="px-3 py-1 text-[10px] font-bold rounded bg-indigo-600 text-white">1H</button>
              <button className="px-3 py-1 text-[10px] font-bold rounded text-slate-500 hover:text-slate-300">4H</button>
              <button className="px-3 py-1 text-[10px] font-bold rounded text-slate-500 hover:text-slate-300">1D</button>
            </div>
          </div>
        </div>
        
        <div className="w-full h-full -ml-4">
          <ResponsiveContainer width="100%" height="90%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
              <XAxis 
                dataKey="time" 
                axisLine={false} 
                tickLine={false} 
                tick={{fill: '#475569', fontSize: 10}}
              />
              <YAxis 
                domain={['auto', 'auto']} 
                axisLine={false} 
                tickLine={false} 
                tick={{fill: '#475569', fontSize: 10}}
                orientation="right"
              />
              <Tooltip content={<CustomTooltip />} />
              <Area 
                type="monotone" 
                dataKey="price" 
                stroke="#6366f1" 
                strokeWidth={2}
                fillOpacity={1} 
                fill="url(#colorPrice)" 
                animationDuration={1500}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default MarketDashboard;
