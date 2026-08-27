"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { renderCanvas, TypeWriter } from "@/components/ui/hero-designali";
import { 
  ChevronDown,
  Activity,
  Database,
  Archive,
  Video,
  ArrowRight,
} from "lucide-react";
import { motion } from "framer-motion";
import { ChannelProfile } from "@/components/ui/channel-profile";
import { MissionFooter } from "@/components/ui/mission-footer";
import { cn } from "@/lib/utils";

const API_BASE = "http://localhost:3000";

const PillarCard = ({ title, description, icon: Icon, onClick, active, isLink }: any) => (
  <motion.div 
    whileHover={{ y: -5 }}
    onClick={onClick}
    className={cn(
      "bg-[#121212] border rounded-3xl p-6 cursor-pointer transition-all relative overflow-hidden group",
      active ? "border-blue-500 shadow-[0_0_30px_-10px_#3b82f6]" : "border-white/5 hover:border-white/10"
    )}
  >
    <div className="absolute top-0 right-0 w-24 h-24 bg-white/[0.02] rounded-full -mr-12 -mt-12 pointer-events-none" />
    <div className="flex items-center justify-between mb-4">
      <div className={cn("p-3 rounded-2xl bg-white/5 group-hover:bg-blue-500/10 transition-colors", active && "bg-blue-500/20")}>
        <Icon className={cn("w-5 h-5", active ? "text-blue-400" : "text-white/20 group-hover:text-white transition-colors")} />
      </div>
      {isLink && <ArrowRight className="w-4 h-4 text-white/10 group-hover:text-white transition-all" />}
    </div>
    <div className="space-y-1">
      <h3 className="text-lg font-bold text-white tracking-tight italic">{title}</h3>
      <p className="text-[9px] uppercase tracking-widest font-bold text-white/30">{description}</p>
    </div>
  </motion.div>
);

export default function Home() {
  const router = useRouter();
  const talkAbout = [
    "Autonomous Shorts",
    "Viral Hooks",
    "Ghost Publishing",
    "AI Assembly",
    "Visual Generation"
  ];

  const [stats, setStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    renderCanvas();
    const fetchStats = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/analytics`);
        if (!res.ok) throw new Error("Sync Stalled");
        const data = await res.json();
        setStats(data);
      } catch (err) {
        console.warn("[MISSION] Identity Sync Stalled (Bridge Offline)...");
      } finally {
        setIsLoading(false);
      }
    };
    fetchStats();
  }, []);

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/analytics`);
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.warn("[MISSION] Refresh Stalled...");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen relative bg-black selection:bg-blue-500/30 overflow-x-hidden">
      
      {/* Global Background Elements - Fixed */}
      <div className="fixed inset-0 pointer-events-none -z-10">
        <div className="absolute inset-0 bg-transparent bg-[linear-gradient(to_right,#a8a29e_1px,transparent_1px),linear-gradient(to_bottom,#a8a29e_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-[0.03] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]"></div>
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600 rounded-full blur-[120px] animate-pulse opacity-10"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600 rounded-full blur-[120px] animate-pulse delay-700 opacity-10"></div>
      </div>

      <canvas className="pointer-events-none fixed inset-0 mx-auto z-0 mix-blend-screen opacity-60" id="canvas"></canvas>

      {/* Hero Header */}
      <section className="min-h-[90vh] w-full flex flex-col items-center justify-center relative z-10 px-6">
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-6xl flex flex-col items-center"
        >
          <div className="relative mx-auto py-6 group w-full text-center">
            <h1 className="text-5xl font-bold leading-tight tracking-tight md:text-6xl lg:text-7xl text-white italic">
              The ultimate factory for{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300">AURA-V2.</span>
            </h1>
            <div className="flex items-center mt-6 justify-center gap-3">
              <span className="relative flex h-3 w-3 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
              </span>
              <p className="text-[10px] font-bold text-green-500 tracking-[0.2em] uppercase">Ready to deploy</p>
            </div>
            
            <h2 className="mt-4 text-xl font-light text-white/30 tracking-tight italic">
              Unleashing <TypeWriter strings={talkAbout} />
            </h2>
          </div>

          {/* 4-Pillar Hub */}
          <div className="w-full mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <PillarCard 
              title="Video Factory" 
              description="Start Pipeline" 
              icon={Video} 
              isLink
              onClick={() => router.push('/factory')}
            />
            <PillarCard 
              title="Pulse Analytics" 
              description="Monitor Growth" 
              icon={Activity} 
              isLink
              onClick={() => router.push('/analytics')}
            />
            <PillarCard 
              title="Memory Registry" 
              description="Audit History" 
              icon={Database} 
              isLink
              onClick={() => router.push('/history')}
            />
            <PillarCard 
              title="Warehouse" 
              description="Draft Storage" 
              icon={Archive} 
              isLink
              onClick={() => router.push('/warehouse')}
            />
          </div>

        </motion.div>

        <motion.div 
          animate={{ y: [0, 10, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute bottom-10 flex flex-col items-center gap-2 text-white/20"
        >
          <span className="text-[10px] uppercase tracking-widest font-bold">Channel Profile</span>
          <ChevronDown className="w-5 h-5" />
        </motion.div>
      </section>

      {/* Identity Ledger on Scroll */}
      <ChannelProfile stats={stats} isLoading={isLoading} onRefresh={handleRefresh} />

      <MissionFooter />
    </main>
  );
}


