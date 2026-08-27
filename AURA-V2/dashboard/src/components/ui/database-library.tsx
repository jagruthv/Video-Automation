"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { 
  Search, 
  Filter, 
  Database as DbIcon, 
  CheckCircle2, 
  Clock, 
  ExternalLink,
  MoreVertical,
  Calendar,
  Layers,
  ArrowRight
} from "lucide-react";
import { cn } from "@/lib/utils";

export const DatabaseLibrary = () => {
  const [videos, setVideos] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState("All");

  useEffect(() => {
    const fetchVideos = async () => {
      try {
        const res = await fetch("http://localhost:3000/api/videos");
        const data = await res.json();
        setVideos(data);
      } catch (err) {
        console.error("Failed to fetch memory archives:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchVideos();
  }, []);

  return (
    <div className="w-full max-w-7xl mx-auto p-8 space-y-12 select-none">
      
      {/* Header: Central Registry */}
      <div className="flex items-end justify-between border-b border-white/5 pb-8">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-blue-400">
            <DbIcon className="w-5 h-5 animate-pulse" />
            <span className="text-[10px] uppercase tracking-[0.3em] font-bold">Central Memory Registry</span>
          </div>
          <h1 className="text-6xl font-bold text-white tracking-tighter italic">Library Database</h1>
        </div>
        <div className="flex items-center gap-4">
           <div className="bg-[#121212] border border-white/5 rounded-2xl p-4 flex items-center gap-3 w-64 group focus-within:border-blue-500/50 transition-all">
              <Search className="w-4 h-4 text-white/20 group-focus-within:text-blue-500" />
              <input 
                placeholder="Search Archives..." 
                className="bg-transparent border-none text-sm text-white/80 placeholder:text-white/10 focus:outline-none w-full"
              />
           </div>
           <button className="p-4 bg-white/5 border border-white/5 rounded-2xl text-white/40 hover:bg-white/10 hover:text-white transition-all">
              <Filter className="w-5 h-5" />
           </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-12">
        {/* MAIN LIST: STUNNING TABLE */}
        <div className="bg-[#121212] border border-white/5 rounded-4xl overflow-hidden">
           <div className="grid grid-cols-5 p-8 border-b border-white/5 bg-white/[0.01]">
              <span className="text-[10px] uppercase tracking-widest font-bold text-white/20">Video Identity</span>
              <span className="text-[10px] uppercase tracking-widest font-bold text-white/20">Manufacturing Status</span>
              <span className="text-[10px] uppercase tracking-widest font-bold text-white/20">Timeline Stamp</span>
              <span className="text-[10px] uppercase tracking-widest font-bold text-white/20">Affiliate Payload</span>
              <span className="text-[10px] uppercase tracking-widest font-bold text-white/20 text-right">Actions</span>
           </div>

           <div className="divide-y divide-white/5">
              {isLoading ? (
                <div className="p-20 text-center space-y-4">
                  <DbIcon className="w-10 h-10 text-blue-500/20 mx-auto animate-pulse" />
                  <p className="text-xs font-bold text-white/10 uppercase tracking-widest">Accessing Secure Archives...</p>
                </div>
              ) : videos.length === 0 ? (
                <div className="p-20 text-center space-y-4">
                   <p className="text-xs font-bold text-white/10 uppercase tracking-widest">No Records Found In Memory</p>
                </div>
              ) : videos.map((item: any, i: number) => (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.05, 0.5) }}
                  key={item.id} 
                  className="grid grid-cols-5 p-8 hover:bg-white/[0.02] transition-colors items-center group"
                >
                   <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-white/20 group-hover:text-blue-500 transition-colors">
                        <Layers className="w-5 h-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-white/80 group-hover:text-white transition-colors tracking-tight">{item.title || "Untitled Blueprint"}</span>
                        <span className="text-[10px] text-white/20 font-bold tracking-widest">{item.id}</span>
                      </div>
                   </div>

                   <div>
                      <span className={cn(
                        "px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 w-fit",
                        item.status === "Published" ? "bg-green-500/10 text-green-500 border border-green-500/20" : 
                        item.status === "Approved" ? "bg-blue-500/10 text-blue-500 border border-blue-500/20" :
                        "bg-white/5 text-white/20 border border-white/10"
                      )}>
                        {item.status === "Published" && <CheckCircle2 className="w-3 h-3" />}
                        {item.status === "Approved" && <Calendar className="w-3 h-3" />}
                        {item.status === "Pending" && <Clock className="w-3 h-3" />}
                        {item.status || "Initializing"}
                      </span>
                   </div>

                   <div className="flex items-center gap-2 text-white/40">
                      <Clock className="w-4 h-4 opacity-50" />
                      <span className="text-xs font-mono">{new Date(item.timestamp || Date.now()).toLocaleString()}</span>
                   </div>

                   <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-xs font-mono truncate max-w-[150px]",
                        item.affiliate_link?.startsWith("http") ? "text-blue-400" : "text-white/10"
                      )}>{item.affiliate_link || "No Payload"}</span>
                      {item.affiliate_link?.startsWith("http") && <ExternalLink className="w-3 h-3 text-blue-500/50" />}
                   </div>

                   <div className="flex items-center justify-end gap-4">
                      <button className="px-4 py-2 bg-white/5 border border-white/5 rounded-xl text-[10px] font-bold uppercase text-white/40 hover:text-white hover:bg-blue-500 transition-all flex items-center gap-2 group/btn">
                        Details <ArrowRight className="w-3 h-3 opacity-0 group-hover/btn:opacity-100 group-hover/btn:translate-x-1 transition-all" />
                      </button>
                      <button className="text-white/10 hover:text-white transition-colors">
                        <MoreVertical className="w-5 h-5" />
                      </button>
                   </div>
                </motion.div>
              ))}
           </div>
        </div>

        {/* STATS OVERVIEW: FOOTER */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
           <div className="p-8 bg-[#121212] border border-white/5 rounded-4xl space-y-2">
              <p className="text-[10px] text-white/20 uppercase font-bold tracking-widest leading-none">Total Library Assets</p>
              <h4 className="text-4xl font-bold text-white italic">{videos.length}</h4>
           </div>
           <div className="p-8 bg-[#121212] border border-white/5 rounded-4xl space-y-2">
              <p className="text-[10px] text-white/20 uppercase font-bold tracking-widest leading-none">Monetized Reach</p>
              <h4 className="text-4xl font-bold text-blue-500 italic">
                {videos.length > 0 ? (videos.filter(v => v.affiliate_link).length / videos.length * 100).toFixed(1) : 0}%
              </h4>
           </div>
           <div className="p-8 bg-[#121212] border border-white/5 rounded-4xl space-y-2">
              <p className="text-[10px] text-white/20 uppercase font-bold tracking-widest leading-none">Global Sync Rate</p>
              <h4 className="text-4xl font-bold text-green-500 italic">0.8ms</h4>
           </div>
        </div>
      </div>

    </div>
  );
};


