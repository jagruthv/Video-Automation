"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { 
  FileText, 
  Mic2, 
  Video, 
  Layers, 
  Gamepad2, 
  Share2, 
  Database,
  Cpu,
  Terminal,
  ChevronDown,
  ChevronUp
} from "lucide-react";

export type StepStatus = "completed" | "active" | "pending";

export interface PipelineStep {
  id: string;
  name: string;
  description: string;
  status: StepStatus;
  type: "single" | "parallel";
  icon?: React.ReactNode;
  subSteps?: PipelineStep[]; // For parallel steps
  fastPass?: boolean;
  logs?: string[];
}

interface LogTerminalProps {
  logs: string[];
  direction: "up" | "down";
  onClose: () => void;
}

const LogTerminal: React.FC<LogTerminalProps> = ({ logs, direction, onClose }) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: direction === "down" ? -10 : 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: direction === "down" ? -10 : 10 }}
      className={cn(
        "absolute left-0 right-0 z-[100] p-4 bg-black/80 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl overflow-hidden min-w-[300px]",
        direction === "down" ? "top-[105%]" : "bottom-[105%]"
      )}
    >
      <div className="flex items-center justify-between mb-2 border-b border-white/10 pb-2">
        <div className="flex items-center gap-2">
          <Terminal className="w-3 h-3 text-blue-400" />
          <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Process Logs</span>
        </div>
        <div className="flex gap-1">
          <div className="w-2 h-2 rounded-full bg-red-500/50" />
          <div className="w-2 h-2 rounded-full bg-yellow-500/50" />
          <div className="w-2 h-2 rounded-full bg-green-500/50" />
        </div>
      </div>
      <div className="max-h-48 overflow-y-auto no-scrollbar font-mono text-[11px] leading-relaxed space-y-1">
        {logs.map((log, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-white/20">[{i+1}]</span>
            <span className={cn(
              "text-white/80",
              log.includes("Error") ? "text-red-400" : log.includes("Success") ? "text-green-400" : ""
            )}>{log}</span>
          </div>
        ))}
        <motion.div 
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 1, repeat: Infinity }}
          className="w-2 h-4 bg-blue-500/50 inline-block align-middle ml-1"
        />
      </div>
    </motion.div>
  );
};

const RevolvingBorder = () => (
  <div className="absolute inset-0 z-0 overflow-hidden rounded-2xl">
    <div 
      className="absolute inset-[-100%] animate-[revolving-border_3s_linear_infinite]"
      style={{
        background: "conic-gradient(from 0deg, transparent 0%, transparent 70%, var(--aura-glow) 85%, var(--aura-accent) 100%)",
      }}
    />
    <div className="absolute inset-[2px] bg-[var(--aura-factory-bg)] rounded-[14px] z-10" />
  </div>
);

export const PipelineVisualizer = ({ 
  steps, 
  activeStepId, 
  onNodeClick 
}: { 
  steps: PipelineStep[], 
  activeStepId: string,
  onNodeClick?: (step: PipelineStep) => void
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [clickedId, setClickedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeNodeRef = useRef<HTMLDivElement>(null);

  // Default logs if none provided
  const getLogs = (step: PipelineStep) => step.logs || [
    "Initializing engine pipeline...",
    "Allocating VRAM (8GB required)",
    "Pulling neural weights: gemini-2.5",
    "Stage: 🔨 In Progress...",
    "Processing frame buffer..."
  ];

  // Click outside to close logs
  useEffect(() => {
    const handleClickOutside = () => setClickedId(null);
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, []);

  // Auto-scroll logic: Keep the active node centered
  useEffect(() => {
    if (activeNodeRef.current && containerRef.current) {
      const container = containerRef.current;
      const node = activeNodeRef.current;
      const scrollLeft = node.offsetLeft - container.offsetWidth / 2 + node.offsetWidth / 2;
      container.scrollTo({ left: scrollLeft, behavior: "smooth" });
    }
  }, [activeStepId]);

  return (
    <div className="w-full bg-[var(--aura-factory-bg)] py-32 overflow-hidden select-none border-y border-white/5 shadow-2xl relative">
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[radial-gradient(circle_at_center,var(--aura-accent)_0,transparent_1px)] bg-[size:24px_24px]" />
      
      <div 
        ref={containerRef}
        className="flex items-center gap-24 px-[45%] overflow-x-auto no-scrollbar scroll-smooth"
        style={{ scrollbarWidth: 'none' }}
      >
        <AnimatePresence mode="popLayout">
          {steps.map((step, index) => {
            const isActive = step.id === activeStepId;
            const isCompleted = step.status === "completed";
            const showLogs = (hoveredId === step.id || clickedId === step.id) && step.status !== "pending";

            return (
              <motion.div
                key={step.id}
                layoutId={step.id}
                animate={{ 
                  opacity: isActive ? 1 : 0.4, 
                  scale: isActive ? 1.15 : 0.9,
                }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                ref={isActive ? activeNodeRef : null}
                className={cn(
                  "relative flex-shrink-0 cursor-pointer group",
                  isActive ? "z-20" : "z-10"
                )}
                onMouseEnter={() => setHoveredId(step.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  setClickedId(clickedId === step.id ? null : step.id);
                  onNodeClick?.(step);
                }}
              >
                {/* Horizontal Connector Line */}
                {index < steps.length - 1 && (
                  <div className="absolute top-1/2 -right-24 w-24 h-[1px] bg-white/10 overflow-hidden">
                    {isCompleted && (
                      <motion.div 
                        initial={{ x: "-100%" }}
                        animate={{ x: "100%" }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                        className="w-full h-full bg-gradient-to-r from-transparent via-[var(--aura-glow)] to-transparent"
                      />
                    )}
                  </div>
                )}

                {/* THE NODE CARD */}
                <div className={cn(
                  "relative w-72 h-44 rounded-2xl flex flex-col items-center justify-center gap-3 transition-all duration-500",
                  "bg-black/40 backdrop-blur-md border border-white/10",
                  isActive && "border-transparent",
                  isCompleted && "border-[var(--aura-accent)]/30",
                  clickedId === step.id && "ring-2 ring-blue-500/50 shadow-2xl"
                )}>
                  {isActive && <RevolvingBorder />}

                  <div className="relative z-20 flex flex-col items-center text-center gap-2 px-4 w-full">
                    <div className={cn(
                      "p-4 rounded-2xl transition-colors duration-500",
                      isActive ? "bg-white/10 text-white" : "bg-white/5 text-white/40",
                      isCompleted && "text-[var(--aura-glow)]"
                    )}>
                      {step.type === "parallel" ? <Cpu className="w-10 h-10" /> : (step.icon || <Database className="w-10 h-10" />)}
                    </div>
                    
                    <div className="w-full space-y-1">
                      <h3 className={cn(
                        "font-bold text-xl tracking-tight transition-colors duration-500 truncate",
                        isActive ? "text-white" : "text-white/30",
                        isCompleted && "text-white/80"
                      )}>
                        {step.name}
                      </h3>
                      <div className="flex items-center justify-center gap-2">
                        <p className={cn(
                          "text-[10px] uppercase tracking-[0.2em] font-medium transition-colors duration-500",
                          isActive ? "text-[var(--aura-glow)] animate-pulse" : "text-white/10"
                        )}>
                          {step.fastPass && isActive ? "Fast-Pass Injected" : step.status}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Single Step Log Overlay */}
                  <AnimatePresence>
                    {showLogs && step.type !== "parallel" && (
                      <LogTerminal 
                        logs={getLogs(step)} 
                        direction="down" 
                        onClose={() => setClickedId(null)} 
                      />
                    )}
                  </AnimatePresence>

                  {/* Parallel Stack Handler - BIG GAP & DOUBLE DIRECTION LOGS */}
                  {step.type === "parallel" && step.subSteps && (
                    <div className="absolute -inset-x-20 -bottom-96 top-64 flex flex-col justify-between items-center py-12 pointer-events-none">
                       {step.subSteps.map((sub, i) => {
                         const direction = i === 0 ? "down" : "up";
                         const isSubShowLogs = (hoveredId === sub.id || clickedId === sub.id) && step.status !== "pending";

                         return (
                           <motion.div 
                              key={sub.id}
                              initial={{ opacity: 0, y: direction === "down" ? -40 : 40 }}
                              animate={{ opacity: 1, y: 0 }}
                              onMouseEnter={() => setHoveredId(sub.id)}
                              onMouseLeave={() => setHoveredId(null)}
                              onClick={(e) => {
                                e.stopPropagation();
                                setClickedId(clickedId === sub.id ? null : sub.id);
                              }}
                              className={cn(
                                "w-64 h-24 bg-black/60 rounded-2xl border border-white/10 flex items-center px-6 gap-4 relative cursor-pointer pointer-events-auto",
                                isActive && "border-[var(--aura-accent)]/50 shadow-[0_0_30px_-10px_var(--aura-glow)]",
                                clickedId === sub.id && "ring-2 ring-blue-500/50"
                              )}
                           >
                              {isActive && <RevolvingBorder />}
                              <div className="relative z-20 flex items-center gap-4">
                                <div className="p-3 bg-white/5 rounded-xl">
                                  {sub.icon}
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs font-bold text-white/90">{sub.name}</span>
                                  <span className="text-[9px] uppercase tracking-widest text-white/30 font-bold">{sub.status}</span>
                                </div>
                              </div>

                              {/* Directional Log Overlay (Top down, Bottom up) */}
                              <AnimatePresence>
                                {isSubShowLogs && (
                                  <LogTerminal 
                                    logs={getLogs(sub)} 
                                    direction={direction} 
                                    onClose={() => setClickedId(null)} 
                                  />
                                )}
                              </AnimatePresence>
                           </motion.div>
                         );
                       })}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Viewport Rails */}
      <div className="absolute top-0 bottom-0 left-0 w-64 bg-gradient-to-r from-[var(--aura-factory-bg)] to-transparent z-30 pointer-events-none" />
      <div className="absolute top-0 bottom-0 right-0 w-64 bg-gradient-to-l from-[var(--aura-factory-bg)] to-transparent z-30 pointer-events-none" />
    </div>
  );
};
