"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export const MissionFooter = () => {
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch("http://localhost:3000/api/health");
        const data = await res.json();
        setHealth(data);
      } catch (err) {
        setHealth({ status: "offline" });
      }
    };
    fetchHealth();
    const timer = setInterval(fetchHealth, 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <motion.footer 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative w-full h-24 border-t border-white/5 flex items-center px-12 justify-between"
    >
      <div className="flex items-center gap-12">
         {/* AI Engine Status */}
         <div className="flex items-center gap-3">
            <p className="text-[9px] text-white/20 uppercase font-bold tracking-[0.2em]">Engine</p>
            <div className="flex items-center gap-2">
               <div className={cn("w-1.5 h-1.5 rounded-full", health?.status === "offline" ? "bg-red-500 shadow-[0_0_8px_#ef4444]" : "bg-green-500 shadow-[0_0_8px_#22c55e]")} />
               <span className="text-[10px] font-mono text-white/60 tracking-tight uppercase">Titanium V2</span>
            </div>
         </div>

         {/* Database Status */}
         <div className="flex items-center gap-3 border-l border-white/5 pl-8">
            <p className="text-[9px] text-white/20 uppercase font-bold tracking-[0.2em]">Archive</p>
            <div className="flex items-center gap-2">
               <div className={cn("w-1.5 h-1.5 rounded-full", health?.database === "failsafe_json" ? "bg-yellow-500" : (health?.database === "sqlite_active" ? "bg-blue-500 shadow-[0_0_8px_#3b82f6]" : "bg-red-500"))} />
               <span className="text-[10px] font-mono text-white/60 tracking-tight uppercase">
                 {health?.database === "failsafe_json" ? "Failsafe" : "SQLite 3"}
               </span>
            </div>
         </div>

         {/* Sync Status */}
         <div className="flex items-center gap-3 border-l border-white/5 pl-8">
            <p className="text-[9px] text-white/20 uppercase font-bold tracking-[0.2em]">Broadcast</p>
            <div className="flex items-center gap-2">
               <div className={cn("w-1.5 h-1.5 rounded-full", health?.youtube === "connected" ? "bg-cyan-500 shadow-[0_0_8px_#06b6d4]" : "bg-white/10")} />
               <span className="text-[10px] font-mono tracking-tight uppercase text-white/60">
                 {health?.youtube === "connected" ? "SYNCED" : "OFFLINE"}
               </span>
            </div>
         </div>
      </div>

      <div className="flex items-center gap-4">
        <p className="text-[9px] text-white/20 uppercase font-bold tracking-[0.4em]">AURA v2.0 // TITANIUM EDITION</p>
      </div>
    </motion.footer>
  );
};


