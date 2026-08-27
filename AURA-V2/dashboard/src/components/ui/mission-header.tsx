"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronLeft, Activity, Database, LayoutDashboard, Layers, Package, Clapperboard, Cpu, History } from "lucide-react";

export const MissionHeader = () => {
  const pathname = usePathname();

  if (pathname === "/") return null;

  const getPageTitle = () => {
    if (pathname.includes("/studio"))    return { title: "Production Studio",  icon: <Clapperboard className="w-5 h-5" />, sub: "Video Queue & Briefs" };
    if (pathname.includes("/forge"))     return { title: "Director's Studio",  icon: <Cpu className="w-5 h-5" />,         sub: "Custom Production" };
    if (pathname.includes("/factory"))   return { title: "Video Factory",      icon: <Layers className="w-5 h-5" />,      sub: "Pipeline Monitor" };
    if (pathname.includes("/analytics")) return { title: "Pulse Analytics",    icon: <Activity className="w-5 h-5" />,    sub: "Performance Data" };
    if (pathname.includes("/database"))  return { title: "Video Library",      icon: <Database className="w-5 h-5" />,    sub: "Completed Projects" };
    if (pathname.includes("/history"))   return { title: "Memory Registry",    icon: <History className="w-5 h-5" />,     sub: "Audit History" };
    if (pathname.includes("/warehouse")) return { title: "Warehouse",          icon: <Package className="w-5 h-5" />,     sub: "Drafts · Remix Queue" };
    return                                      { title: "Control Center",     icon: <LayoutDashboard className="w-5 h-5" />, sub: "AURA-V2" };
  };

  const { title, icon, sub } = getPageTitle();

  return (
    <motion.header
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className="fixed top-0 inset-x-0 z-[10] h-16 bg-transparent flex items-center px-6 pointer-events-none"
    >
      <div className="flex items-center gap-5 pointer-events-auto">
        <Link href="/">
          <motion.button
            whileHover={{ x: -2 }}
            whileTap={{ scale: 0.95 }}
            className="flex items-center gap-2 group text-white/30 hover:text-white transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center border border-white/5 group-hover:border-white/20">
              <ChevronLeft className="w-4 h-4" />
            </div>
          </motion.button>
        </Link>

        <div className="h-6 w-px bg-white/10" />

        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500/10 text-blue-400 border border-blue-500/20">
            {icon}
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-bold text-white tracking-tight italic">{title}</span>
            <span className="text-[9px] uppercase tracking-widest font-bold text-white/25 mt-0.5">{sub}</span>
          </div>
        </div>
      </div>
    </motion.header>
  );
};
