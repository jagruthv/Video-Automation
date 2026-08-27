"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { 
  Terminal, 
  Wand2, 
  Link as LinkIcon, 
  FileText,
  Clock,
  Cpu,
  Globe,
  Zap,
  Image as ImageIcon,
  Database,
  Video,
  RefreshCw,
  CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface ForgeArchitectProps {
  onCraft?: (data: any) => void;
}

export const ForgeArchitect: React.FC<ForgeArchitectProps> = ({ onCraft }) => {
  const [topic, setTopic] = useState("");
  const [contextPrompt, setContextPrompt] = useState("");
  const [script, setScript] = useState("");
  const [affiliateLink, setAffiliateLink] = useState("");
  const [injectedClips, setInjectedClips] = useState<string[]>([]);
  const [isCrafting, setIsCrafting] = useState(false);
  const [isMode8, setIsMode8] = useState(false);

  const isFormValid = topic.trim().length > 0 || script.trim().length > 0 || contextPrompt.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;
    
    setIsCrafting(true);
    try {
      const endpoint = isMode8
        ? "http://localhost:3001/api/forge/mode8"
        : "http://localhost:3000/api/forge";
      
      const body = isMode8
        ? { title: topic || contextPrompt, script: script || undefined, topic: topic || undefined, voice: "nova" }
        : { topic, contextPrompt: contextPrompt || undefined, script: script || undefined, affiliateLink: affiliateLink || undefined, injectedClips };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      
      if (!res.ok) throw new Error(isMode8 ? "Mode 8 Dispatch Failed" : "Forge Ignition Failed");
      
      const data = await res.json();
      onCraft?.(data);
      
      setTopic("");
      setContextPrompt("");
      setScript("");
      setAffiliateLink("");
      setInjectedClips([]);
    } catch (err) {
      console.error("Forge Error:", err);
    } finally {
      setIsCrafting(false);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-8 space-y-12 select-none">
      
      {/* Header: Lab Identity */}
      <div className="flex items-end justify-between border-b border-white/5 pb-8">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-blue-400">
            <Cpu className="w-5 h-5 animate-pulse" />
            <span className="text-[10px] uppercase tracking-[0.3em] font-bold">Laboratory Architect v3.0</span>
          </div>
          <h1 className="text-6xl font-bold text-white tracking-tighter italic">Quantum Forge</h1>
          <p className="text-[10px] text-white/20 font-mono mt-1">v5.0 · Wikimedia · BYOP · Veo 3.1 I2V · Mode 8</p>
        </div>
        <div className="flex flex-col items-end gap-3">
          {/* Mode Toggle */}
          <div className="flex items-center gap-3 p-1 bg-white/[0.03] border border-white/10 rounded-2xl">
            <button
              type="button"
              onClick={() => setIsMode8(false)}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all",
                !isMode8 ? "bg-blue-500 text-white" : "text-white/30 hover:text-white/60"
              )}
            >
              Standard
            </button>
            <button
              type="button"
              onClick={() => setIsMode8(true)}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all",
                isMode8 ? "bg-gradient-to-r from-yellow-500 to-orange-500 text-black" : "text-white/30 hover:text-white/60"
              )}
            >
              ✦ Mode 8 · Human-Crafted
            </button>
          </div>
          {isMode8 && (
            <p className="text-[10px] text-yellow-400/70 font-mono text-right">
              Tier-1 · Beat-Based · AI Images · Maps · Legal Docs · Pexels B-Roll
            </p>
          )}
          <p className="text-white/20 text-xs font-mono">Blueprint: <span className={cn(isFormValid ? "text-green-500" : "text-red-500")}>{isFormValid ? "Ready" : "Incomplete"}</span></p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        
        {/* PANEL 1: MASTER BLUEPRINT (FORM) */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="lg:col-span-2 space-y-10"
        >
          <div className={cn(
            "bg-[#121212] border rounded-3xl p-10 relative overflow-hidden group shadow-2xl transition-all duration-500",
            !isFormValid && topic === "" && script === "" && contextPrompt === "" ? "border-red-500/10 shadow-red-500/5" : "border-white/5 shadow-blue-500/5 hover:border-blue-500/20"
          )}>
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
            
            <form onSubmit={handleSubmit} className="relative z-10 space-y-8">
              {/* TOPIC INPUT */}
              <div className="space-y-4">
                <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-bold text-white/40">
                  <Terminal className="w-3 h-3" /> System Topic Vector
                </label>
                <input 
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="E.g., The Future of Cybernetics..."
                  className="w-full bg-white/[0.03] border border-white/5 rounded-2xl h-20 px-8 text-2xl font-medium text-white placeholder:text-white/10 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.05] transition-all"
                />
              </div>

              {/* VISION CONTEXT */}
              <div className="space-y-4">
                <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-bold text-white/40">
                  <Wand2 className="w-3 h-3 text-blue-400" /> Creative Vision / Context
                </label>
                <textarea 
                  value={contextPrompt}
                  onChange={(e) => setContextPrompt(e.target.value)}
                  placeholder="Describe the mood, story, or specific facts you want the AI to expand into a full mission..."
                  className="w-full bg-white/[0.03] border border-white/5 rounded-2xl p-6 h-32 text-sm text-white/70 placeholder:text-white/10 focus:outline-none focus:border-blue-500/40 transition-all no-scrollbar"
                />
              </div>

              {/* SCRIPT EDITOR (MONACO STYLE) */}
              <div className="space-y-4">
                 <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-bold text-white/40">
                      <FileText className="w-3 h-3" /> Script Injection Overwrite (Optional)
                    </label>
                    <span className="text-[10px] text-white/10 italic">Markdown Supported</span>
                 </div>
                 <textarea 
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  placeholder="[AUTO-GENERATE IF EMPTY]"
                  className="w-full bg-white/[0.02] border border-white/5 rounded-2xl p-8 h-48 font-mono text-sm text-white/60 placeholder:text-white/5 focus:outline-none focus:border-blue-500/30 transition-all no-scrollbar"
                 />
              </div>

              {/* MONETIZATION STRATEGY */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-bold text-white/40">
                    <LinkIcon className="w-3 h-3" /> Affiliate Link
                  </label>
                  <input 
                    value={affiliateLink}
                    onChange={(e) => setAffiliateLink(e.target.value)}
                    placeholder="https://amzn.to/..."
                    className="w-full bg-white/[0.03] border border-white/5 rounded-2xl h-16 px-6 text-sm text-blue-400 placeholder:text-white/5 focus:outline-none focus:border-blue-500/30"
                  />
                </div>
                <div className="space-y-4 opacity-50 pointer-events-none">
                  <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-bold text-white/40">
                    <Clock className="w-3 h-3" /> Scheduled Release
                  </label>
                  <div className="w-full bg-white/[0.03] border border-white/5 rounded-2xl h-16 px-6 flex items-center text-sm text-white/20">
                    Auto-Batch [Daily 18:00]
                  </div>
                </div>
              </div>

              <div className="pt-8 text-center space-y-4">
                <Button 
                  disabled={isCrafting || !isFormValid}
                  onClick={handleSubmit}
                  className={cn(
                    "w-full h-20 rounded-2xl text-2xl font-bold transition-all gap-4 flex items-center justify-center relative overflow-hidden",
                    !isFormValid ? "bg-white/5 text-white/10 cursor-not-allowed border border-white/5" :
                    isCrafting ? "bg-white/10 text-white/40" :
                    isMode8 ? "bg-gradient-to-r from-yellow-500 to-orange-600 text-black hover:from-yellow-400 hover:to-orange-500" :
                    "bg-white text-black hover:bg-blue-500 hover:text-white"
                  )}
                >
                  {isCrafting ? (
                    <><RefreshCw className="w-6 h-6 animate-spin" /> {isMode8 ? "Dispatching to Mode 8..." : "Forging..."}</>
                  ) : (
                    <>
                      <Wand2 className="w-6 h-6" />
                      {isFormValid
                        ? isMode8 ? "✦ Launch Human-Crafted Video" : "Ignite The Forge"
                        : "Blueprint Missing"}
                    </>
                  )}
                  {!isFormValid && !isCrafting && (
                     <div className="absolute inset-0 bg-red-500/5 animate-pulse pointer-events-none" />
                  )}
                </Button>
                {isMode8 && isFormValid && (
                  <p className="text-[10px] text-yellow-400/50 uppercase font-bold tracking-[0.2em]">
                    Mode 8 · Whisper beat sync · AI images · Maps · Legal docs · 5hr human-crafted look
                  </p>
                )}
                {!isFormValid && (
                  <p className="text-[10px] text-red-500/50 uppercase font-bold tracking-[0.2em] animate-pulse">
                    ⚠️ At least one field (Topic or Script) must be populated.
                  </p>
                )}
              </div>
            </form>
          </div>
        </motion.div>

        {/* PANEL 2: ASSET STACK (SIDEBAR) */}
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className="space-y-8"
        >
          <div className="bg-[#121212] border border-white/5 rounded-3xl p-8 space-y-6 flex flex-col h-full min-h-[600px]">
             <div className="space-y-1">
                <h3 className="text-xl font-bold text-white tracking-tight italic">Visual Pipeline</h3>
                <p className="text-[10px] text-white/20 uppercase tracking-widest font-bold">v5.0 · Provider Cascade</p>
             </div>

             {/* Provider Cascade */}
             <div className="flex-1 space-y-3">
               {[
                 { icon: <Globe className="w-4 h-4" />, name: "Wikimedia Commons", info: "Real landmark photos · No API key", color: "text-sky-400 bg-sky-500/10 border-sky-500/20" },
                 { icon: <Zap className="w-4 h-4" />, name: "Pollinations BYOP", info: "sk_ key · 10 images/hr · 20s throttle", color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20" },
                 { icon: <ImageIcon className="w-4 h-4" />, name: "Pollinations Free", info: "Unlimited free tier · FLUX model", color: "text-pink-400 bg-pink-500/10 border-pink-500/20" },
                 { icon: <Cpu className="w-4 h-4" />, name: "HuggingFace FLUX", info: "FLUX.1-schnell · HF Token", color: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
                 { icon: <Database className="w-4 h-4" />, name: "Pexels Safety Net", info: "Stock photos · Final fallback", color: "text-orange-400 bg-orange-500/10 border-orange-500/20" },
               ].map((item, i) => (
                 <div key={i} className={cn(
                   "flex items-center gap-3 p-3 border rounded-xl transition-all",
                   item.color
                 )}>
                   <div className="shrink-0">{item.icon}</div>
                   <div className="min-w-0">
                     <p className="text-xs font-bold truncate">{item.name}</p>
                     <p className="text-[9px] opacity-60 font-mono truncate">{item.info}</p>
                   </div>
                   <span className="text-[9px] shrink-0 font-bold opacity-50">P{i}</span>
                 </div>
               ))}

               <div className="flex items-center gap-3 p-3 border border-cyan-500/20 bg-cyan-500/10 text-cyan-400 rounded-xl">
                 <Video className="w-4 h-4 shrink-0" />
                 <div className="min-w-0">
                   <p className="text-xs font-bold">Veo 3.1 I2V</p>
                   <p className="text-[9px] opacity-60 font-mono">Animation layer · OAuth refresh</p>
                 </div>
                 <CheckCircle2 className="w-3 h-3 shrink-0 opacity-60" />
               </div>
             </div>

             {/* Queue Status */}
             <div className="p-4 bg-blue-500/5 border border-blue-500/10 rounded-2xl space-y-3">
                <div className="flex items-center gap-2 text-blue-400">
                  <Clock className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase tracking-widest">Pipeline Status</span>
                </div>
                <div className="space-y-2">
                  <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                    <motion.div 
                      animate={{ x: ["-100%", "100%"] }}
                      transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                      className="w-1/3 h-full bg-blue-500/50"
                    />
                  </div>
                  <p className="text-[9px] text-white/30">BYOP Resets Hourly · Free tier always active</p>
                </div>
             </div>
          </div>
        </motion.div>
      </div>

      {/* FOOTER: SLOT TIMELINE */}
      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="pt-8"
      >
        <div className="bg-[#121212] border border-white/5 rounded-3xl p-8 space-y-6">
           <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white tracking-widest uppercase">Pipeline Architecture</h3>
              <div className="flex gap-2">
                <div className="px-3 py-1 bg-green-500/10 text-green-500 rounded-full text-[10px] font-bold uppercase tracking-tighter">v5.0 Active</div>
                <div className="px-3 py-1 bg-cyan-500/10 text-cyan-400 rounded-full text-[10px] font-bold uppercase tracking-tighter">Veo Ready</div>
              </div>
           </div>

           <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
              {["Architect", "Visionary", "Marketer", "Visual Engine", "Audio", "Veo 3.1", "Assembly", "Publish", "Complete"].map((stage, i) => (
                <div key={i} className="flex-shrink-0 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/5 flex flex-col items-center gap-1.5 group hover:border-blue-500/30 transition-all relative overflow-hidden">
                   <div className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-500/0 group-hover:bg-blue-500/50 transition-colors" />
                   <span className="text-[8px] text-white/20 font-bold uppercase tracking-widest">S{i + 1}</span>
                   <span className="text-[10px] text-white/50 font-medium whitespace-nowrap">{stage}</span>
                </div>
              ))}
           </div>
        </div>
      </motion.div>

    </div>
  );
};


