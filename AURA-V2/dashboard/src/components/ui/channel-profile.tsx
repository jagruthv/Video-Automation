"use client";

import React from "react";
import { motion } from "framer-motion";
import { 
  Users, 
  Eye, 
  PlaySquare, 
  ShieldCheck, 
  Activity,
  RefreshCw
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ChannelProfileProps {
  stats: any;
  isLoading: boolean;
  onRefresh?: () => void;
}

export const ChannelProfile = ({ stats, isLoading, onRefresh }: ChannelProfileProps) => {
  return (
    <section className="w-full py-24 border-t border-white/5 relative overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none" />
      
      <div className="max-w-7xl mx-auto px-8 relative z-10">
        <div className="flex flex-col lg:flex-row items-center gap-16">
          
          {/* Logo & Identity */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="flex flex-col items-center gap-6"
          >
            <div className="relative">
              <div className="absolute inset-0 bg-emerald-500/20 blur-3xl rounded-full animate-pulse" />
              {isLoading ? (
                <div className="w-48 h-48 rounded-full bg-white/5 animate-pulse border border-white/10" />
              ) : (
                <img 
                  src={stats?.channel_logo} 
                  alt="Channel Logo" 
                  className="w-48 h-48 rounded-full border-2 border-white/10 shadow-2xl relative z-10"
                />
              )}
              <div className="absolute -bottom-2 -right-2 bg-[#121212] border border-emerald-500/30 p-3 rounded-2xl z-20">
                <ShieldCheck className="w-6 h-6 text-emerald-500" />
              </div>
            </div>
            
            <div className="text-center space-y-2 relative group">
              <h2 className="text-4xl font-bold text-white tracking-tighter italic">
                {isLoading ? "Synchronizing..." : stats?.channel_name}
              </h2>
              <div className="flex items-center justify-center gap-2 text-emerald-500/60 uppercase text-[10px] font-bold tracking-[0.3em]">
                <Activity className="w-3 h-3" />
                Verified Mission Partner
              </div>
              
              {/* Manual Refresh Trigger */}
              {onRefresh && (
                <motion.button
                  whileHover={{ rotate: 180 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={onRefresh}
                  className="absolute -top-12 left-1/2 -translate-x-1/2 p-3 bg-white/5 border border-white/10 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all"
                  title="Refresh Telemetry"
                >
                  <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
                </motion.button>
              )}
            </div>
          </motion.div>

          {/* Atomic Stats Ledger */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-8">
            <StatDetail 
              label="Total Views" 
              value={stats?.total_views || "---"} 
              icon={Eye} 
              color="text-blue-400" 
              isLoading={isLoading}
            />
            <StatDetail 
              label="Subscribers" 
              value={stats?.total_subscribers || "---"} 
              icon={Users} 
              color="text-purple-400" 
              isLoading={isLoading}
            />
            <StatDetail 
              label="Total Videos" 
              value={stats?.total_videos || "---"} 
              icon={PlaySquare} 
              color="text-orange-400" 
              isLoading={isLoading}
            />
          </div>

        </div>
      </div>
    </section>
  );
};

const StatDetail = ({ label, value, icon: Icon, color, isLoading }: any) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
    className="bg-white/[0.02] border border-white/5 rounded-3xl p-8 space-y-3 group hover:border-white/10 transition-all"
  >
    <div className={cn("p-2 w-fit rounded-lg bg-white/5", color)}>
      <Icon className="w-5 h-5" />
    </div>
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-widest font-bold text-white/30">{label}</p>
      {isLoading ? (
        <div className="h-8 w-24 bg-white/5 animate-pulse rounded-md" />
      ) : (
        <h3 className="text-3xl font-bold text-white italic tracking-tight">{value}</h3>
      )}
    </div>
  </motion.div>
);
