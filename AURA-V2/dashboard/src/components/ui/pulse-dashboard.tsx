"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { 
  BarChart3, 
  TrendingUp, 
  Users, 
  DollarSign, 
  ArrowUpRight, 
  Activity,
  PlayCircle,
  Clock,
  Eye,
  RefreshCw
} from "lucide-react";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer
} from "recharts";
import { cn } from "@/lib/utils";

const StatCard = ({ title, value, change, icon: Icon, color, isLoading }: any) => (
  <motion.div 
    whileHover={{ y: -5 }}
    className="bg-[#121212] border border-white/5 rounded-3xl p-8 space-y-4 hover:border-white/10 transition-all relative overflow-hidden"
  >
    <div className="absolute top-0 right-0 w-32 h-32 bg-white/[0.02] rounded-full -mr-16 -mt-16 pointer-events-none" />
    <div className="flex items-center justify-between">
      <div className={cn("p-3 rounded-2xl bg-white/5", color)}>
        <Icon className="w-6 h-6" />
      </div>
      {!isLoading && (
        <div className="flex items-center gap-1 text-green-500 text-xs font-bold">
          <ArrowUpRight className="w-4 h-4" />
          {change}
        </div>
      )}
    </div>
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/30">{title}</p>
      {isLoading ? (
        <div className="h-9 w-24 bg-white/5 animate-pulse rounded-lg" />
      ) : (
        <h3 className="text-3xl font-bold text-white tracking-tighter italic">{value}</h3>
      )}
    </div>
  </motion.div>
);

export const PulseDashboard = () => {
  const [stats, setStats] = useState<any>(null);
  const [velocityData, setVelocityData] = useState<any>(null);
  const [activeRange, setActiveRange] = useState("1d");
  const [isLoading, setIsLoading] = useState(true);

  const timeframes = ["1h", "6h", "1d", "2d", "7d", "1m", "3m", "6m", "Custom"];

  const fetchStats = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`http://localhost:3000/api/analytics?range=${activeRange}`);
      const data = await res.json();
      setStats(data);
      if (data.velocity) {
        setVelocityData(data.velocity);
      }
    } catch (err) {
      console.error("Failed to fetch mission stats:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 60000); // Pulse every minute
    return () => clearInterval(interval);
  }, [activeRange]);

  const chartData = velocityData || [];

  return (
    <div className="w-full max-w-7xl mx-auto p-8 space-y-12 select-none">
      
      {/* Header: Global Pulse */}
      <div className="flex items-end justify-between border-b border-white/5 pb-8">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-blue-400">
            <Activity className="w-5 h-5 animate-pulse" />
            <span className="text-[10px] uppercase tracking-[0.3em] font-bold">Performance Pulse v3.0</span>
          </div>
          <h1 className="text-6xl font-bold text-white tracking-tighter italic">Mission Analytics</h1>
        </div>
        <div className="text-right flex items-center gap-6">
           <motion.button
              whileHover={{ rotate: 180 }}
              whileTap={{ scale: 0.9 }}
              onClick={fetchStats}
              className="p-3 bg-white/5 border border-white/10 rounded-2xl text-white/40 hover:text-white hover:bg-white/10 transition-all group"
              title="Refresh Analytics"
           >
              <RefreshCw className={cn("w-5 h-5", isLoading && "animate-spin")} />
           </motion.button>
           <div className="h-12 w-[1px] bg-white/5" />
           <div className="text-right">
              <p className="text-white/20 text-[10px] font-bold uppercase tracking-widest">Live Sync</p>
              <p className="text-blue-500 text-xs font-mono">0.8ms Latency</p>
           </div>
           <div className="h-12 w-[1px] bg-white/5" />
           <div className="text-right">
              <p className="text-white/20 text-[10px] font-bold uppercase tracking-widest">Active Channels</p>
              <p className="text-white text-xs font-mono">01 Connected</p>
           </div>
        </div>
      </div>

      {/* TOP ROW: CORE METRICS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        <StatCard 
          title="Total Views" 
          value={stats?.total_views || "---"} 
          change={stats?.views_delta || "SYNCED"} 
          icon={Eye} 
          color="text-blue-400" 
          isLoading={isLoading}
        />
        <div className="relative group">
          <StatCard 
            title={stats?.audited ? "Audited Revenue" : "Projected Revenue"} 
            value={stats?.estimated_earnings || "---"} 
            change={stats?.audited ? "Verified" : "AURA-Calc"} 
            icon={DollarSign} 
            color={stats?.audited ? "text-green-500 shadow-[0_0_15px_-5px_#22c55e]" : "text-green-400"} 
            isLoading={isLoading}
          />
          <div className={cn(
            "absolute bottom-4 left-8 text-[9px] font-bold uppercase tracking-widest italic animate-pulse",
            stats?.audited ? "text-green-500/80" : "text-blue-500/80"
          )}>
            {stats?.revenue_source || "Based on $2.00 CPM Floor"}
          </div>
        </div>
        <StatCard 
          title="Subscribers" 
          value={stats?.total_subscribers || "---"} 
          change={stats?.subs_delta || "LIVE"} 
          icon={Users} 
          color="text-purple-400" 
          isLoading={isLoading}
        />
        <StatCard 
          title="Gen Velocity" 
          value={stats?.gen_velocity || "---"} 
          change="Real-Time" 
          icon={TrendingUp} 
          color="text-orange-400" 
          isLoading={isLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        {/* MAIN CHART: VIEWERSHIP VELOCITY */}
        <div className="lg:col-span-2 bg-[#121212] border border-white/5 rounded-4xl p-10 space-y-8 relative overflow-hidden">
           <div className="absolute top-0 right-0 p-4 z-10">
              <div className="flex bg-white/5 p-1 rounded-xl gap-1 border border-white/5 shadow-2xl">
                 {timeframes.map((tf) => (
                    <button 
                      key={tf}
                      onClick={() => tf !== "Custom" && setActiveRange(tf)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all tracking-tighter",
                        activeRange === tf ? "bg-blue-500 text-white shadow-[0_0_15px_-5px_#3b82f6]" : "text-white/30 hover:text-white hover:bg-white/5"
                      )}
                    >
                      {tf}
                    </button>
                 ))}
              </div>
           </div>

           <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h3 className="text-xl font-bold text-white tracking-tight italic">Viewership Velocity</h3>
                <p className="text-[10px] text-white/20 uppercase tracking-widest font-bold">Trading Resolution: {activeRange}</p>
              </div>
           </div>

           <div className="h-[400px] w-full min-w-0 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                {isLoading ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="flex flex-col items-center gap-4">
                       <Activity className="w-8 h-8 text-blue-500/20 animate-pulse" />
                       <span className="text-[9px] uppercase tracking-[0.3em] text-white/10 font-bold">Synchronizing Stream...</span>
                    </div>
                  </div>
                ) : (
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 9, fontWeight: 'bold' }}
                      dy={10}
                      interval={activeRange === '1d' ? 3 : activeRange === '1m' ? 4 : 0}
                    />
                    <YAxis hide />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                      itemStyle={{ color: '#fff', fontSize: '11px', fontWeight: 'bold' }}
                      cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="value" 
                      stroke="#3b82f6" 
                      strokeWidth={3}
                      fillOpacity={1} 
                      fill="url(#colorViews)" 
                      animationDuration={1500}
                    />
                  </AreaChart>
                )}
              </ResponsiveContainer>
           </div>
        </div>

        {/* SIDEBAR: RECENT OPS */}
        <div className="space-y-8">
           <div className="bg-[#121212] border border-white/5 rounded-4xl p-8 flex flex-col h-full space-y-8">
              <div className="space-y-1">
                <h3 className="text-xl font-bold text-white tracking-tight italic">Live Terminal</h3>
                <p className="text-[10px] text-white/20 uppercase tracking-widest font-bold">Ghost Publishing Status</p>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto max-h-[400px] pr-2 custom-scrollbar">
                 {stats?.recent_activity?.length > 0 ? (
                   stats.recent_activity.map((item: any, i: number) => (
                     <motion.div 
                       initial={{ opacity: 0, x: -20 }}
                       animate={{ opacity: 1, x: 0 }}
                       transition={{ delay: i * 0.1 }}
                       key={i} 
                       className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-2xl group hover:border-blue-500/20 transition-all cursor-pointer"
                     >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                            <PlayCircle className="w-5 h-5 text-white/20 group-hover:text-blue-500 transition-colors" />
                          </div>
                          <div className="flex flex-col">
                             <span className="text-xs font-bold text-white/80 group-hover:text-white transition-colors truncate max-w-[150px]">{item.title}</span>
                             <span className="text-[9px] text-white/20 font-bold uppercase tracking-wider">{item.timestamp}</span>
                          </div>
                        </div>
                        <span className={cn(
                          "text-[9px] font-bold uppercase tracking-tighter px-2 py-1 rounded-md",
                          item.status === "PUBLISHED" ? "bg-green-500/10 text-green-500" : "bg-blue-500/10 text-blue-500"
                        )}>{item.status}</span>
                     </motion.div>
                   ))
                 ) : (
                   <div className="flex flex-col items-center justify-center h-full py-12 opacity-20 border border-dashed border-white/10 rounded-3xl">
                      <Activity className="w-8 h-8 mb-2 animate-pulse" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Searching for History...</span>
                   </div>
                 )}
              </div>

              <div className="p-6 bg-green-500/5 border border-green-500/10 rounded-3xl space-y-4">
                 <div className="flex items-center gap-2 text-green-500">
                    <TrendingUp className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Efficiency Rating</span>
                 </div>
                 <div className="flex items-baseline gap-2">
                    <h4 className="text-4xl font-bold text-white">98.4<span className="text-xl text-white/20">%</span></h4>
                    <span className="text-[10px] text-green-500 font-bold tracking-tighter">+1.2% this week</span>
                 </div>
              </div>
           </div>
        </div>
      </div>

    </div>
  );
};


