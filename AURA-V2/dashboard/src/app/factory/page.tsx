"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Square, FileText, Mic2, Video, Layers, Share2,
  Globe, Zap, Image as ImageIcon, Database, Cpu,
  Terminal, CheckCircle2, ArrowLeft, Package, Gamepad2, Wind, Camera,
  ChevronUp, ChevronDown, Monitor, LayoutTemplate, Music, BookOpen, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Suspense } from "react";

const API_BASE = "http://localhost:3000";

const AVAILABLE_MODELS = [
  { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash",   provider: "Google" },
  { id: "llama-3.3-70b-versatile",       name: "Llama 3.3 70B",      provider: "Groq" },
  { id: "llama3.1-70b",                  name: "Llama 3.1 70B",      provider: "Cerebras" },
  { id: "gemini-2.5-flash",              name: "Gemini 2.5 Flash",   provider: "Google" },
];

const PIPELINE_STEPS = [
  { id: "scripting",    title: "Architect",      subtitle: "Neural Scripting",   icon: FileText,     color: "blue",   description: "AI writes the cinematic story script" },
  { id: "visionary",   title: "Visionary",       subtitle: "Prompt Engineering", icon: Cpu,          color: "violet", description: "Generates image + video prompts per scene" },
  { id: "marketer",    title: "Marketer",        subtitle: "Metadata Forge",     icon: Terminal,     color: "amber",  description: "Creates viral title, tags & thumbnail concept" },
  { id: "parallel_gen",title: "Visual Engine",   subtitle: "Image Generation",   icon: ImageIcon,    color: "emerald",description: "5-tier cascade: Wikimedia → BYOP → Pollinations → HF → Pexels",
    subSteps: [
      { id: "wiki",        label: "Wikimedia",    info: "Real landmark photos", icon: Globe,      color: "sky"    },
      { id: "byop",        label: "BYOP",         info: "10/hr budget key",     icon: Zap,        color: "yellow" },
      { id: "pollinations",label: "Pollinations", info: "Free AI generation",   icon: ImageIcon,  color: "pink"   },
      { id: "hf",          label: "HuggingFace",  info: "FLUX.1-schnell",       icon: Cpu,        color: "purple" },
      { id: "pexels",      label: "Pexels",       info: "Stock safety net",     icon: Database,   color: "orange" },
    ]
  },
  { id: "audio",    title: "Audio Synthesis", subtitle: "Voice + Score",    icon: Mic2,        color: "rose",   description: "Cartesia TTS narration synthesis" },
  { id: "veo",      title: "Motion Engine",   subtitle: "Image-to-Video",   icon: Video,       color: "cyan",   description: "Animates each frame via AI motion providers" },
  { id: "assembly", title: "Core Assembly",   subtitle: "Video Composition",icon: Layers,      color: "teal",   description: "Stitches scenes, overlays captions & transitions" },
  { id: "publish",  title: "Ghost Publish",   subtitle: "Auto-Upload",      icon: Share2,      color: "indigo", description: "Publishes to YouTube with AI-crafted metadata" },
  { id: "complete", title: "Mission Complete",subtitle: "Success",           icon: CheckCircle2,color: "green",  description: "Mission committed to SQLite. Done." },
];

const COLOR_MAP: Record<string, { border: string; text: string; bg: string; glow: string; dot: string }> = {
  blue:    { border:"border-blue-500/50",    text:"text-blue-400",    bg:"bg-blue-500/10",    glow:"shadow-[0_0_40px_-10px_#3b82f6]", dot:"bg-blue-500" },
  violet:  { border:"border-violet-500/50",  text:"text-violet-400",  bg:"bg-violet-500/10",  glow:"shadow-[0_0_40px_-10px_#7c3aed]", dot:"bg-violet-500" },
  amber:   { border:"border-amber-500/50",   text:"text-amber-400",   bg:"bg-amber-500/10",   glow:"shadow-[0_0_40px_-10px_#f59e0b]", dot:"bg-amber-500" },
  emerald: { border:"border-emerald-500/50", text:"text-emerald-400", bg:"bg-emerald-500/10", glow:"shadow-[0_0_40px_-10px_#10b981]", dot:"bg-emerald-500" },
  rose:    { border:"border-rose-500/50",    text:"text-rose-400",    bg:"bg-rose-500/10",    glow:"shadow-[0_0_40px_-10px_#f43f5e]", dot:"bg-rose-500" },
  cyan:    { border:"border-cyan-500/50",    text:"text-cyan-400",    bg:"bg-cyan-500/10",    glow:"shadow-[0_0_40px_-10px_#06b6d4]", dot:"bg-cyan-500" },
  teal:    { border:"border-teal-500/50",    text:"text-teal-400",    bg:"bg-teal-500/10",    glow:"shadow-[0_0_40px_-10px_#14b8a6]", dot:"bg-teal-500" },
  indigo:  { border:"border-indigo-500/50",  text:"text-indigo-400",  bg:"bg-indigo-500/10",  glow:"shadow-[0_0_40px_-10px_#6366f1]", dot:"bg-indigo-500" },
  green:   { border:"border-green-500/50",   text:"text-green-400",   bg:"bg-green-500/10",   glow:"shadow-[0_0_40px_-10px_#22c55e]", dot:"bg-green-500" },
  sky:     { border:"border-sky-500/50",     text:"text-sky-400",     bg:"bg-sky-500/10",     glow:"shadow-[0_0_40px_-10px_#0ea5e9]", dot:"bg-sky-500" },
  yellow:  { border:"border-yellow-500/50",  text:"text-yellow-400",  bg:"bg-yellow-500/10",  glow:"shadow-[0_0_40px_-10px_#eab308]", dot:"bg-yellow-500" },
  pink:    { border:"border-pink-500/50",    text:"text-pink-400",    bg:"bg-pink-500/10",    glow:"shadow-[0_0_40px_-10px_#ec4899]", dot:"bg-pink-500" },
  purple:  { border:"border-purple-500/50",  text:"text-purple-400",  bg:"bg-purple-500/10",  glow:"shadow-[0_0_40px_-10px_#a855f7]", dot:"bg-purple-500" },
  orange:  { border:"border-orange-500/50",  text:"text-orange-400",  bg:"bg-orange-500/10",  glow:"shadow-[0_0_40px_-10px_#f97316]", dot:"bg-orange-500" },
};

const BG_MODES = [
  {
    id: "standard",
    label: "Standard",
    desc: "Standard full-screen video background",
    sub: "Clean & professional style",
    icon: Video,
    gradient: "from-blue-500/20 via-sky-500/10 to-transparent",
    border: "border-blue-500/40",
    glow: "shadow-[0_0_60px_-15px_#3b82f6]",
    text: "text-blue-400",
    accent: "bg-blue-500",
  },
  {
    id: "gaming",
    label: "Gaming",
    desc: "GTA / Minecraft / Subway Surfers split-screen",
    sub: "High-retention brainrot style",
    icon: Gamepad2,
    gradient: "from-green-500/20 via-emerald-500/10 to-transparent",
    border: "border-green-500/40",
    glow: "shadow-[0_0_60px_-15px_#22c55e]",
    text: "text-green-400",
    accent: "bg-green-500",
  },
  {
    id: "sand",
    label: "Kinetic Sand",
    desc: "12-hour ASMR / satisfying loop clips",
    sub: "Meditative long-form content",
    icon: Wind,
    gradient: "from-amber-500/20 via-yellow-500/10 to-transparent",
    border: "border-amber-500/40",
    glow: "shadow-[0_0_60px_-15px_#f59e0b]",
    text: "text-amber-400",
    accent: "bg-amber-500",
  },
  {
    id: "pinterest",
    label: "Cinematic",
    desc: "Pinterest vault / aesthetic B-roll",
    sub: "Visually-driven storytelling",
    icon: Camera,
    gradient: "from-purple-500/20 via-violet-500/10 to-transparent",
    border: "border-purple-500/40",
    glow: "shadow-[0_0_60px_-15px_#a855f7]",
    text: "text-purple-400",
    accent: "bg-purple-500",
  },
  {
    id: "image_short",
    label: "Image Short",
    desc: "AI image + music clip — meme/aesthetic format",
    sub: "Loop-worthy viral rewatch bait",
    icon: ImageIcon,
    gradient: "from-pink-500/20 via-rose-500/10 to-transparent",
    border: "border-pink-500/40",
    glow: "shadow-[0_0_60px_-15px_#ec4899]",
    text: "text-pink-400",
    accent: "bg-pink-500",
  },
  {
    id: "remix_story",
    label: "Remix Story",
    desc: "Vault clip + AI voiceover — no source footage used",
    sub: "Clean satisfying storyteller format",
    icon: BookOpen,
    gradient: "from-orange-500/20 via-amber-500/10 to-transparent",
    border: "border-orange-500/40",
    glow: "shadow-[0_0_60px_-15px_#f97316]",
    text: "text-orange-400",
    accent: "bg-orange-500",
  },
];

const V3_API = "http://localhost:8001";

function FactoryPage() {
  const router = useRouter();
  const [machineState, setMachineState] = useState<'idle' | 'picking_gaming' | 'picking_ai' | 'picking_remix' | 'running' | 'complete'>('idle');
  const [activePhaseId, setActivePhaseId] = useState<string>('idle');
  const [logs, setLogs] = useState<Record<string, string[]>>(
    Object.fromEntries(PIPELINE_STEPS.map(s => [s.id, ['Awaiting ignition...']]))
  );
  const [selectedStep, setSelectedStep] = useState<string | null>(null);

  // Settings
  const [amount, setAmount] = useState(1);
  const [customTopic, setCustomTopic] = useState("");
  const [selectedVoice, setSelectedVoice] = useState("nova");
  const [affiliateLink, setAffiliateLink] = useState("");
  const [selectedBgMode, setSelectedBgMode] = useState<string>("gaming");
  const [gamingSubMode, setGamingSubMode] = useState<'fullscreen' | 'sandwich' | null>(null);
  // Image Short extra fields
  const [imageDesc, setImageDesc] = useState("");
  const [songQuery, setSongQuery] = useState("");
  const [clipSec, setClipSec] = useState(20);

  // Final pick state
  const [activeModels, setActiveModels] = useState<string[]>([]);
  // Remix Story state
  const [remixTopics, setRemixTopics]   = useState<any[]>([]);
  const [remixLoading, setRemixLoading] = useState(false);
  const [remixFiring, setRemixFiring]   = useState<string | null>(null);
  const [remixV3Online, setRemixV3Online] = useState(false);

  // Fetch priority config
  useEffect(() => {
    fetch(`${API_BASE}/api/config/llm-priority`)
      .then(r => r.json())
      .then(d => setActiveModels((d.priorityStr || '').split(',').filter(Boolean)))
      .catch(() => setActiveModels(AVAILABLE_MODELS.map(m => m.id)));
  }, []);

  const saveConfig = async (models: string[]) => {
    if (models.length === 0) return;
    setActiveModels(models);
    try {
      await fetch(`${API_BASE}/api/config/llm-priority`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priorityStr: models.join(',') })
      });
    } catch {}
  };

  // SSE log stream
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/logs`);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
          const msg = data.message.replace(/^\n+/, '').trim();
          if (!msg || msg.includes('[WATCHER]') || msg.includes('Snapshot Recorded')) return;
          setLogs(prev => {
            const next = { ...prev };
            setActivePhaseId(curr => {
              const target = curr === 'idle' ? 'scripting' : curr;
              next[target] = [msg, ...(next[target] || [])].slice(0, 150);
              if (msg.includes('[WIKIMEDIA]') || msg.includes('[BYOP]') || msg.includes('[POLLINATIONS]') || msg.includes('[PEXELS]'))
                next['parallel_gen'] = [msg, ...(next['parallel_gen'] || [])].slice(0, 150);
              if (msg.includes('[VEO'))   next['veo']      = [msg, ...(next['veo'] || [])].slice(0, 150);
              if (msg.includes('[AUDIO]'))next['audio']    = [msg, ...(next['audio'] || [])].slice(0, 150);
              if (msg.includes('[ARCHITECT]') || msg.includes('[BRAIN]'))
                next['scripting'] = [msg, ...(next['scripting'] || [])].slice(0, 150);
              return curr;
            });
            return next;
          });
        } else if (data.type === 'phase') {
          if (data.phase === 'complete') { setActivePhaseId('complete'); setMachineState('complete'); }
          else if (data.phase === 'error') setMachineState('idle');
          else { setActivePhaseId(data.phase); setMachineState('running'); }
        }
      } catch {}
    };
    return () => es.close();
  }, []);

  const handleIgnite = async (targetMode: string, pipelineMode: string = 'single') => {
    // IMAGE_SHORT goes to its own route
    if (targetMode === 'image_short') {
      if (!imageDesc || !songQuery) return;
      setMachineState('running');
      setActivePhaseId('scripting');
      setLogs(Object.fromEntries(Object.keys(logs).map(k => [k, ['Initializing...']])));
      try {
        await fetch(`${API_BASE}/api/image-short`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageQuery: imageDesc, songQuery, clipSec })
        });
      } catch { setMachineState('idle'); }
      return;
    }

    setMachineState('running');
    setActivePhaseId('scripting');
    setLogs(Object.fromEntries(Object.keys(logs).map(k => [k, ['Initializing...']])));

    // Map each UI template to the correct backend template + bgMode
    const TEMPLATE_MAP: Record<string, { apiTemplate: string; apiBgMode: string | null }> = {
      standard:          { apiTemplate: 'STANDARD',      apiBgMode: null },
      gaming_fullscreen: { apiTemplate: 'FULLSCREEN_BG', apiBgMode: 'gaming' },
      gaming_sandwich:   { apiTemplate: 'GAMING_OVERLAY', apiBgMode: 'gaming' },
      sand:              { apiTemplate: 'FULLSCREEN_BG', apiBgMode: 'sand' },
      pinterest:         { apiTemplate: 'FULLSCREEN_BG', apiBgMode: 'pinterest' },
    };
    const { apiTemplate, apiBgMode } = TEMPLATE_MAP[targetMode] || { apiTemplate: 'STANDARD', apiBgMode: null };

    try {
      await fetch(`${API_BASE}/api/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
          mode: pipelineMode, quota: amount,
          topic: customTopic || null,
          affiliateLink: affiliateLink || '',
          template: apiTemplate,
          bgMode: apiBgMode,
          voice: selectedVoice,
        })
      });
    } catch { setMachineState('idle'); }
  };

  const getStepStatus = (stepId: string) => {
    const order = PIPELINE_STEPS.map(s => s.id);
    const ai = order.indexOf(activePhaseId), si = order.indexOf(stepId);
    if (machineState === 'idle' || machineState === 'picking_ai') return 'idle';
    if (machineState === 'complete') return 'completed';
    if (si < ai) return 'completed';
    if (si === ai) return 'active';
    return 'pending';
  };

  const isRunning        = machineState === 'running';
  const isPickingAi      = machineState === 'picking_ai';
  const isPickingGaming  = machineState === 'picking_gaming';
  const isPickingRemix   = machineState === 'picking_remix';

  const fetchRemixTopics = async () => {
    setRemixLoading(true);
    try {
      const r = await fetch(`${V3_API}/api/queue?status=pending`);
      if (!r.ok) throw new Error();
      const d = await r.json();
      setRemixTopics(d.videos || []);
      setRemixV3Online(true);
    } catch {
      setRemixV3Online(false);
    } finally { setRemixLoading(false); }
  };

  const handleRemixFire = async (video_id: string) => {
    setRemixFiring(video_id);
    try {
      await fetch(`${V3_API}/api/render/single`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id }),
      });
      // Remove from list immediately
      setRemixTopics(prev => prev.filter(v => v.video_id !== video_id));
    } catch {}
    setRemixFiring(null);
  };

  return (
    <main className="min-h-screen bg-black text-white flex font-mono select-none overflow-hidden text-sm pt-16">

      {/* ── SIDEBAR ──────────────────────────────────────────────── */}
      <div className="w-[280px] h-[calc(100vh-4rem)] bg-[#070707] border-r border-white/5 p-5 flex flex-col gap-4 z-50 shadow-2xl overflow-y-auto shrink-0">

        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full shrink-0 transition-all duration-500",
              isRunning ? "bg-red-500 shadow-[0_0_10px_#ef4444] animate-pulse" :
              machineState === 'complete' ? "bg-green-500 shadow-[0_0_10px_#22c55e]" :
              isPickingAi ? "bg-amber-500 shadow-[0_0_10px_#f59e0b] animate-pulse" : "bg-white/20"
            )} />
            <span className="text-[9px] uppercase tracking-[0.3em] font-black text-white/30">AURA-V2 · Factory</span>
          </div>
          <h2 className="text-lg font-bold italic tracking-tighter text-white">Video Factory</h2>
          <p className="text-[9px] text-white/20 uppercase tracking-widest">
            {isRunning ? `⚡ ${activePhaseId}` : machineState === 'complete' ? '✅ Complete' : isPickingAi ? '🧠 Config AI Priority' : 'Configure settings'}
          </p>
        </div>

        <div className="h-px bg-white/5" />

        {/* Amount */}
        <div className="space-y-1.5">
          <label className="text-[9px] uppercase tracking-widest text-white/30 font-bold">Amount</label>
          <input type="number" min={1} max={100} value={amount}
            onChange={e => setAmount(parseInt(e.target.value) || 1)}
            disabled={isRunning}
            className="w-full bg-black border border-white/10 rounded-xl p-3 text-white text-sm focus:border-white/30 outline-none disabled:opacity-40"
          />
        </div>

        {/* Topic */}
        <div className="space-y-1.5">
          <label className="text-[9px] uppercase tracking-widest text-white/30 font-bold">
            Topic <span className="text-white/20 normal-case font-normal">optional</span>
          </label>
          <textarea value={customTopic} onChange={e => setCustomTopic(e.target.value)}
            placeholder="Leave blank for AI auto-story..."
            disabled={isRunning}
            className="w-full bg-black border border-white/10 rounded-xl p-3 text-white/70 text-xs resize-none focus:border-white/30 outline-none min-h-[60px] disabled:opacity-40"
          />
        </div>

        {/* Affiliate */}
        <div className="space-y-1.5">
          <label className="text-[9px] uppercase tracking-widest text-white/30 font-bold">
            Affiliate <span className="text-white/20 normal-case font-normal">optional</span>
          </label>
          <input value={affiliateLink} onChange={e => setAffiliateLink(e.target.value)}
            placeholder="https://amzn.to/..."
            disabled={isRunning}
            className="w-full bg-black border border-white/10 rounded-xl p-3 text-white/50 text-xs focus:border-white/30 outline-none disabled:opacity-40"
          />
        </div>

        {/* Template */}
        <div className="space-y-1.5">
          <label className="text-[9px] uppercase tracking-widest text-white/30 font-bold">Template</label>
          <div className="grid grid-cols-2 gap-1.5">
            {BG_MODES.map(t => (
              <button key={t.id} onClick={() => setSelectedBgMode(t.id)} disabled={isRunning}
                className={cn("py-2.5 rounded-xl text-[9px] uppercase font-bold tracking-wider border transition-all disabled:opacity-40",
                  selectedBgMode === t.id ? "bg-white/10 border-white/25 text-white" : "bg-transparent border-white/5 text-white/30 hover:border-white/10"
                )}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Image Short extra fields */}
        {selectedBgMode === 'image_short' && (
          <>
            <div className="space-y-1.5">
              <label className="text-[9px] uppercase tracking-widest text-white/30 font-bold">Image Description</label>
              <textarea value={imageDesc} onChange={e => setImageDesc(e.target.value)}
                placeholder="e.g. dramatic storm over Tokyo cityscape..."
                disabled={isRunning}
                className="w-full bg-black border border-pink-500/20 rounded-xl p-3 text-white/70 text-xs resize-none focus:border-pink-500/50 outline-none min-h-[60px] disabled:opacity-40"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[9px] uppercase tracking-widest text-white/30 font-bold">Song Name</label>
              <input value={songQuery} onChange={e => setSongQuery(e.target.value)}
                placeholder="e.g. Blinding Lights The Weeknd"
                disabled={isRunning}
                className="w-full bg-black border border-pink-500/20 rounded-xl p-3 text-white/70 text-xs focus:border-pink-500/50 outline-none disabled:opacity-40"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[9px] uppercase tracking-widest text-white/30 font-bold">Clip Length (sec)</label>
              <input type="number" min={10} max={60} value={clipSec} onChange={e => setClipSec(parseInt(e.target.value)||20)}
                disabled={isRunning}
                className="w-full bg-black border border-pink-500/20 rounded-xl p-3 text-white text-xs focus:border-pink-500/50 outline-none disabled:opacity-40"
              />
            </div>
          </>
        )}

        <div className="mt-auto space-y-2 pt-2">
          {machineState === 'idle' || machineState === 'complete' ? (
            <Button
              onClick={() => {
                if (selectedBgMode === 'gaming')       { setMachineState('picking_gaming'); return; }
                if (selectedBgMode === 'remix_story')  { fetchRemixTopics(); setMachineState('picking_remix'); return; }
                setMachineState('picking_ai');
              }}
              disabled={selectedBgMode === 'image_short' && (!imageDesc || !songQuery)}
              className="w-full h-11 rounded-xl font-black uppercase text-[10px] tracking-widest border-none bg-white text-black hover:bg-white/90 shadow-[0_0_25px_-5px_rgba(255,255,255,0.3)] disabled:opacity-40"
            >
              Next Step ➔
            </Button>
          ) : isPickingGaming || isPickingAi || isPickingRemix ? (
            <Button onClick={() => setMachineState('idle')}
              className="w-full h-11 rounded-xl bg-white hover:bg-gray-200 text-black text-[10px] font-black uppercase tracking-widest">
              ← Back to Settings
            </Button>
          ) : (
            <Button onClick={() => { setMachineState('idle'); setActivePhaseId('idle'); }}
              className="w-full h-11 bg-red-900/50 hover:bg-red-600 text-white rounded-xl border border-red-500/50 font-bold uppercase tracking-widest text-[9px]">
              <Square className="w-3 h-3 fill-current mr-2" /> Terminate
            </Button>
          )}
          <button onClick={() => router.push('/warehouse')}
            className="w-full text-[9px] text-white/20 hover:text-white/40 uppercase tracking-widest flex items-center justify-center gap-1.5 py-1">
            <Package className="w-3 h-3" /> View Warehouse
          </button>
        </div>
      </div>

      {/* ── MAIN PANEL ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <AnimatePresence mode="wait">

          {/* ── REMIX STORY TOPIC PICKER ─────────────────────── */}
          {isPickingRemix && (
            <motion.div key="remix-picker"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="flex-1 flex flex-col items-center justify-center px-12 py-12 gap-8"
            >
              <div className="text-center space-y-2">
                <p className="text-[9px] uppercase tracking-[0.4em] font-black text-white/25">Remix Engine</p>
                <h2 className="text-3xl font-bold italic tracking-tighter text-white">Pick a Story</h2>
                <p className="text-white/30 text-xs">Select a pending script to render. Completed stories are removed automatically.</p>
              </div>

              {!remixV3Online ? (
                <div className="text-center py-8">
                  <p className="text-red-400 text-sm font-bold">Remix Engine Offline</p>
                  <p className="text-white/30 text-xs mt-1">Run <code className="font-mono bg-white/5 px-2 py-0.5 rounded">python api.py</code> in the AURA-V3 folder.</p>
                </div>
              ) : remixLoading ? (
                <div className="flex items-center gap-3 text-white/30">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Loading pending stories…</span>
                </div>
              ) : remixTopics.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-white/40 text-sm font-bold">No pending stories in queue.</p>
                  <p className="text-white/20 text-xs mt-1">Ingest a new payload JSON first.</p>
                </div>
              ) : (
                <div className="w-full max-w-2xl space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                  {remixTopics.map(v => (
                    <motion.div key={v.video_id}
                      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-4 bg-[#0c0c0c] border border-white/5 hover:border-orange-500/30 px-5 py-3 rounded-2xl transition-all group">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white truncate">{v.title}</p>
                        <p className="text-[9px] font-mono text-white/20 mt-0.5">voice: {v.voice} · {v.video_id}</p>
                      </div>
                      <button onClick={() => handleRemixFire(v.video_id)}
                        disabled={remixFiring === v.video_id}
                        className="flex items-center gap-2 h-9 px-5 bg-orange-500 hover:bg-orange-400 text-black font-black text-[10px] uppercase tracking-widest rounded-xl transition-all disabled:opacity-50 shrink-0">
                        {remixFiring === v.video_id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <><Play className="w-3 h-3 fill-black mr-1" />Render</>}
                      </button>
                    </motion.div>
                  ))}
                </div>
              )}

              <button onClick={fetchRemixTopics} className="text-[9px] text-white/20 hover:text-white/50 uppercase tracking-widest flex items-center gap-1.5 transition-colors">
                ↺ Refresh List
              </button>
            </motion.div>
          )}

          {/* ── GAMING SUB-MODE PICKER ──────────────────────── */}
          {isPickingGaming && (
            <motion.div key="gaming-picker"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="flex-1 flex flex-col items-center justify-center px-12 py-12 gap-10"
            >
              <div className="text-center space-y-2">
                <p className="text-[9px] uppercase tracking-[0.4em] font-black text-white/25">Gaming Layout</p>
                <h2 className="text-3xl font-bold italic tracking-tighter text-white">Choose Gaming Style</h2>
                <p className="text-white/30 text-xs">How should the gaming footage be arranged?</p>
              </div>

              <div className="grid grid-cols-2 gap-6 w-full max-w-2xl">
                {/* Full Screen */}
                <button onClick={() => { setGamingSubMode('fullscreen'); setMachineState('picking_ai'); }}
                  className="group flex flex-col gap-4 p-8 rounded-3xl border border-green-500/20 bg-green-500/5 hover:bg-green-500/10 hover:border-green-500/40 transition-all text-left">
                  <div className="w-12 h-12 rounded-2xl bg-green-500/20 flex items-center justify-center">
                    <Monitor className="w-6 h-6 text-green-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-sm mb-1">Full Screen</h3>
                    <p className="text-[10px] text-white/40 leading-relaxed">Gaming video fills the entire 9:16 canvas. Narration + subtitles overlay on top.</p>
                  </div>
                  {/* Layout preview */}
                  <div className="w-full h-28 rounded-xl border border-white/10 bg-black/40 overflow-hidden flex flex-col">
                    <div className="flex-1 bg-green-900/30 flex items-center justify-center">
                      <span className="text-[8px] text-green-400/60 uppercase tracking-widest">Gaming BG (Full)</span>
                    </div>
                    <div className="absolute inset-0 flex items-end pb-2 px-2 pointer-events-none">
                      <div className="w-full h-1 bg-white/20 rounded" />
                    </div>
                  </div>
                </button>

                {/* Sandwich */}
                <button onClick={() => { setGamingSubMode('sandwich'); setMachineState('picking_ai'); }}
                  className="group flex flex-col gap-4 p-8 rounded-3xl border border-green-500/20 bg-green-500/5 hover:bg-green-500/10 hover:border-green-500/40 transition-all text-left">
                  <div className="w-12 h-12 rounded-2xl bg-green-500/20 flex items-center justify-center">
                    <LayoutTemplate className="w-6 h-6 text-green-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-sm mb-1">Sandwich</h3>
                    <p className="text-[10px] text-white/40 leading-relaxed">Top 5% gaming → 16:9 AI content video → remaining gaming background below.</p>
                  </div>
                  {/* Layout preview */}
                  <div className="w-full h-28 rounded-xl border border-white/10 bg-black/40 overflow-hidden flex flex-col gap-0">
                    <div className="h-[8%] bg-green-900/40 flex items-center justify-center">
                      <span className="text-[6px] text-green-400/50">GAMING</span>
                    </div>
                    <div className="flex-1 bg-white/10 flex items-center justify-center">
                      <span className="text-[7px] text-white/40">16:9 AI Video</span>
                    </div>
                    <div className="h-[35%] bg-green-900/40 flex items-center justify-center">
                      <span className="text-[6px] text-green-400/50">GAMING</span>
                    </div>
                  </div>
                </button>
              </div>
            </motion.div>
          )}

          {/* ── AI PRIORITY PICKER (Final Confirmation) ─────────── */}
          {isPickingAi && (
            <motion.div
              key="ai-picker"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="flex-1 flex flex-col items-center justify-center px-12 py-12 gap-10"
            >
              <div className="text-center space-y-2">
                <p className="text-[9px] uppercase tracking-[0.4em] font-black text-white/25">Final Check</p>
                <h2 className="text-3xl font-bold italic tracking-tighter text-white">Confirm Intelligence Order</h2>
                <p className="text-white/30 text-xs">
                  Configure primary logic models and fallbacks for text processing. Left is highest priority.
                </p>
              </div>

              <div className="w-full max-w-2xl bg-[#0c0c0c] border border-white/5 rounded-3xl p-8 flex flex-col gap-6">
                
                <div className="flex flex-col gap-3">
                  {activeModels.map((modelId, i) => {
                    const info = AVAILABLE_MODELS.find(m => m.id === modelId) || { name: modelId, provider: 'custom' };
                    return (
                      <div key={modelId} className="flex items-center gap-4 bg-black border border-white/10 px-5 py-4 rounded-2xl group">
                        <div className="flex flex-col gap-1 border-r border-white/5 pr-4 shrink-0">
                          <button disabled={i === 0} onClick={() => { const n=[...activeModels]; [n[i],n[i-1]]=[n[i-1],n[i]]; saveConfig(n); }} className="text-white/20 hover:text-white disabled:opacity-0 transition-all"><ChevronUp className="w-4 h-4"/></button>
                          <button disabled={i === activeModels.length-1} onClick={() => { const n=[...activeModels]; [n[i],n[i+1]]=[n[i+1],n[i]]; saveConfig(n); }} className="text-white/20 hover:text-white disabled:opacity-0 transition-all"><ChevronDown className="w-4 h-4"/></button>
                        </div>
                        
                        <div className="flex-1 flex flex-col">
                          <span className="text-sm font-bold tracking-tight text-white mb-0.5">{info.name}</span>
                          <span className="text-[9px] uppercase tracking-[0.2em] text-white/30">{info.provider} — Priority {i + 1}</span>
                        </div>
                        
                        <button disabled={activeModels.length === 1}
                          onClick={() => saveConfig(activeModels.filter(id => id !== modelId))}
                          className="text-[10px] text-red-500/0 group-hover:text-red-500/80 hover:!text-red-400 disabled:opacity-0 transition-all ml-2 font-bold uppercase tracking-wider flex items-center gap-1.5 p-2 bg-red-500/10 rounded-xl">
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
                
                <div className="flex flex-wrap gap-2 items-center justify-between pt-2 border-t border-white/5">
                  <div className="flex flex-wrap gap-2">
                    {AVAILABLE_MODELS.filter(m => !activeModels.includes(m.id)).map(m => (
                      <button key={m.id} onClick={() => saveConfig([...activeModels, m.id])}
                        className="text-[9px] text-white/30 hover:text-white border border-white/10 px-3 py-2 rounded-lg transition-colors font-bold uppercase tracking-wider shrink-0 bg-white/5">
                        + Add {m.name}
                      </button>
                    ))}
                  </div>

                  <button 
                    onClick={() => saveConfig(AVAILABLE_MODELS.map(m => m.id))}
                    className="text-[9px] text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-widest font-black"
                  >
                    Set Default Order
                  </button>
                </div>

                  {/* Qwen3-TTS Flash compatible voices only */}
                  <p className="text-[10px] uppercase tracking-widest font-bold text-white/40 mb-3">Narrator Voice <span className="text-white/20 normal-case font-normal">(Qwen3-TTS Flash)</span></p>
                  <div className="grid grid-cols-3 gap-3">
                    {['nova', 'onyx', 'echo', 'fable', 'alloy', 'shimmer'].map(v => (
                      <button
                        key={v}
                        onClick={() => setSelectedVoice(v)}
                        className={`capitalize py-3 rounded-xl border text-sm font-bold transition-all ${
                          selectedVoice === v 
                            ? 'bg-blue-500/20 border-blue-500 text-blue-400' 
                            : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white/80'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center gap-4">
                <Button
                  onClick={() => {
                    const subMode = selectedBgMode === 'gaming'
                      ? (gamingSubMode === 'fullscreen' ? 'gaming_fullscreen' : 'gaming_sandwich')
                      : selectedBgMode;
                    handleIgnite(subMode, 'single');
                  }}
                  className="h-14 px-12 bg-white hover:bg-white/90 text-black text-xs font-black uppercase tracking-[0.2em] rounded-2xl shadow-[0_0_30px_-5px_rgba(255,255,255,0.4)] transition-all transform hover:scale-105"
                >
                  <Play className="w-4 h-4 mr-2 fill-current" />
                  IGNITE FULL PIPELINE
                </Button>

                <div className="flex gap-3">
                  <Button
                    onClick={() => {
                      const subMode = selectedBgMode === 'gaming'
                        ? (gamingSubMode === 'fullscreen' ? 'gaming_fullscreen' : 'gaming_sandwich')
                        : selectedBgMode;
                      handleIgnite(subMode, 'script_only');
                    }}
                    className="h-10 px-6 bg-white hover:bg-gray-200 text-black text-[9px] font-black uppercase tracking-widest rounded-xl transition-all"
                  >
                    <FileText className="w-3 h-3 mr-2" />
                    Scripting Only
                  </Button>
                  <Button
                    onClick={() => {
                      const subMode = selectedBgMode === 'gaming'
                        ? (gamingSubMode === 'fullscreen' ? 'gaming_fullscreen' : 'gaming_sandwich')
                        : selectedBgMode;
                      handleIgnite(subMode, 'script_audio');
                    }}
                    className="h-10 px-6 bg-white hover:bg-gray-200 text-black text-[9px] font-black uppercase tracking-widest rounded-xl transition-all"
                  >
                    <Mic2 className="w-3 h-3 mr-2" />
                    Up To Audio
                  </Button>
                </div>
              </div>

            </motion.div>
          )}

          {/* ── PIPELINE MONITOR ─────────────────────────── */}
          {!(isPickingAi || isPickingGaming || isPickingRemix) && (
            <motion.div
              key="pipeline"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="flex-1 flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-black/50 backdrop-blur-md shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-[9px] uppercase tracking-widest font-black text-white/30">
                    Pipeline · {PIPELINE_STEPS.length} Stages
                  </span>
                </div>
                {machineState === 'complete' && (
                  <span className="text-[9px] text-green-400 font-bold uppercase tracking-widest">✅ Mission Complete</span>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
                <div className="grid grid-cols-1 gap-3 max-w-3xl mx-auto">
                  {PIPELINE_STEPS.map((step, index) => {
                    const status = getStepStatus(step.id);
                    const isActive = status === 'active', isCompleted = status === 'completed';
                    const c = COLOR_MAP[step.color] || COLOR_MAP.blue;
                    const Icon = step.icon;
                    const stepLogs = logs[step.id] || [];

                    return (
                      <motion.div key={step.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}
                        className={cn("rounded-xl border transition-all duration-500 overflow-hidden cursor-pointer",
                          isActive ? cn("border-transparent", c.glow, c.bg) :
                          isCompleted ? "border-white/10 bg-white/[0.02]" : "border-white/5 bg-white/[0.01]"
                        )}
                        onClick={() => setSelectedStep(selectedStep === step.id ? null : step.id)}>

                        <div className="flex items-center gap-3 px-4 py-3">
                          <div className={cn("w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[9px] font-black",
                            isActive ? cn(c.bg, "ring-2 ring-offset-1 ring-offset-black") :
                            isCompleted ? "bg-white/10 text-white/60" : "bg-white/5 text-white/20"
                          )}>
                            {isCompleted ? "✓" : index + 1}
                          </div>
                          <div className={cn("p-1.5 rounded-lg transition-all", isActive ? cn(c.bg, c.text) : isCompleted ? "bg-white/5 text-white/40" : "bg-white/[0.02] text-white/15")}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h3 className={cn("font-bold text-xs", isActive ? "text-white" : isCompleted ? "text-white/60" : "text-white/20")}>{step.title}</h3>
                              {isActive && <span className={cn("text-[8px] uppercase font-bold px-1.5 py-0.5 rounded-full animate-pulse", c.bg, c.text)}>● ACTIVE</span>}
                              {isCompleted && <span className="text-[8px] uppercase font-bold px-1.5 py-0.5 rounded-full bg-white/5 text-white/30">done</span>}
                            </div>
                            <p className={cn("text-[10px]", isActive ? c.text : "text-white/20")}>{step.subtitle}</p>
                          </div>
                          {(isActive || isCompleted) && stepLogs[0] && stepLogs[0] !== 'Awaiting ignition...' && (
                            <div className="hidden lg:block max-w-[200px] truncate text-[9px] text-white/25 font-mono">{stepLogs[0].slice(0, 50)}</div>
                          )}
                          <span className={cn("text-[9px] shrink-0", isActive ? c.text : "text-white/10")}>{selectedStep === step.id ? "▲" : "▼"}</span>
                        </div>

                        <div className={cn("px-4 pb-2 text-[9px]", isActive ? "text-white/35" : "text-white/10")}>{step.description}</div>

                        {step.subSteps && (
                          <div className="px-4 pb-3 flex gap-1.5 flex-wrap">
                            {step.subSteps.map(sub => {
                              const sc = COLOR_MAP[sub.color] || COLOR_MAP.blue;
                              const SubIcon = sub.icon;
                              return (
                                <div key={sub.id} className={cn("flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[8px] font-bold uppercase tracking-wider",
                                  isActive ? cn(sc.bg, sc.border, sc.text) : "border-white/[0.03] text-white/10")}>
                                  <SubIcon className="w-2.5 h-2.5" />{sub.label}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <AnimatePresence>
                          {selectedStep === step.id && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                              <div className={cn("mx-3 mb-3 rounded-xl p-3 border font-mono", c.bg, "border-white/10")}>
                                <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-white/10">
                                  <div className="flex gap-1">
                                    {['bg-red-500/60','bg-yellow-500/60','bg-green-500/60'].map(cl => <div key={cl} className={cn("w-2 h-2 rounded-full", cl)} />)}
                                  </div>
                                  <span className="text-[8px] text-white/30 uppercase tracking-widest">{step.title} · Telemetry</span>
                                  <span className={cn("ml-auto text-[8px] font-bold", isActive ? c.text : "text-white/20")}>{stepLogs.length} entries</span>
                                </div>
                                <div className="max-h-40 overflow-y-auto space-y-0.5 custom-scrollbar">
                                  {stepLogs.map((log, i) => (
                                    <div key={i} className={cn("text-[9px] leading-relaxed flex gap-1.5",
                                      i === 0 ? cn("font-bold", isActive ? c.text : "text-white/60") : "text-white/25")}>
                                      <span className="text-white/15 shrink-0">[{stepLogs.length - i}]</span>
                                      <span className={cn("break-all",
                                        log.includes('❌') || log.includes('FAILED') ? "text-red-400" :
                                        log.includes('✅') || log.includes('SUCCESS') ? "text-green-400" :
                                        log.includes('⚠️') ? "text-yellow-400" : ""
                                      )}>{log}</span>
                                    </div>
                                  ))}
                                  {isActive && <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity }} className={cn("w-1 h-3 inline-block rounded-sm", c.dot)} />}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {isActive && <div className="h-0.5 w-full overflow-hidden"><motion.div animate={{ x: ["-100%", "100%"] }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }} className={cn("w-1/2 h-full bg-gradient-to-r from-transparent via-current to-transparent", c.text)} /></div>}
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <style dangerouslySetInnerHTML={{__html: `.custom-scrollbar::-webkit-scrollbar{width:3px}.custom-scrollbar::-webkit-scrollbar-track{background:transparent}.custom-scrollbar::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.07);border-radius:4px}`}} />
    </main>
  );
}

export default function FactoryArchitectureMap() {
  return <Suspense fallback={<div className="min-h-screen bg-black" />}><FactoryPage /></Suspense>;
}


