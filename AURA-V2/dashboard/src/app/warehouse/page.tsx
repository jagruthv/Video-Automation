"use client";

import { useState, useEffect, useRef } from "react";
import { Play, Package, Loader2, AlertCircle, Trash2, Check,
         XCircle, RefreshCw, BookOpen, Mic, CheckCircle, Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const V2_API  = "http://localhost:3000";
const V3_API  = "http://localhost:8001";

// ── V2 stage meta ──────────────────────────────────────────────────────────
const STAGE_META: Record<string, { icon: string; color: string }> = {
  scripted:        { icon: "📝", color: "text-blue-400" },
  has_audio:       { icon: "🎙️", color: "text-rose-400" },
  has_images:      { icon: "🖼️", color: "text-emerald-400" },
  has_video_clips: { icon: "🎬", color: "text-cyan-400" },
  renderable:      { icon: "✅", color: "text-green-400" },
  rendering:       { icon: "⚙️", color: "text-blue-400" },
  error:           { icon: "⚠️", color: "text-red-400" },
};

// ── Remix status badges ─────────────────────────────────────────────────────
const REMIX_STATUS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:       { label: "Pending",        color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",  icon: <Clock className="w-3 h-3" /> },
  audio_done:    { label: "Audio Done",     color: "bg-blue-500/20 text-blue-400 border-blue-500/30",        icon: <Mic className="w-3 h-3" /> },
  rendered:      { label: "Rendered",       color: "bg-green-500/20 text-green-400 border-green-500/30",     icon: <CheckCircle className="w-3 h-3" /> },
  error:         { label: "Error",          color: "bg-red-500/20 text-red-400 border-red-500/30",           icon: <AlertCircle className="w-3 h-3" /> },
  audio_partial: { label: "Paused — Low Credits", color: "bg-amber-500/20 text-amber-400 border-amber-500/30", icon: <Loader2 className="w-3 h-3" /> },
};

const V2_TABS   = ["All", "standard", "gaming", "sand", "pinterest", "error"] as const;
type AnyTab     = typeof V2_TABS[number] | "remix";
const ALL_TABS: AnyTab[] = [...V2_TABS, "remix"];

export default function Warehouse() {
  const router = useRouter();
  // V2 state
  const [blueprints,   setBlueprints]   = useState<any[]>([]);
  const [loadingV2,    setLoadingV2]    = useState(true);
  const [selectedIds,  setSelectedIds]  = useState<Set<string>>(new Set());

  // V3 remix state
  const [remixQueue,   setRemixQueue]   = useState<any[]>([]);
  const [loadingV3,    setLoadingV3]    = useState(true);
  const [v3Online,     setV3Online]     = useState(false);
  const [renderingIds, setRenderingIds] = useState<Set<string>>(new Set());
  const [bulkFiring,   setBulkFiring]   = useState(false);

  const [activeTab,    setActiveTab]    = useState<AnyTab>("All");
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // ── Fetch V2 blueprints ─────────────────────────────────────────────────
  const fetchV2 = async () => {
    try {
      const r = await fetch(`${V2_API}/api/warehouse/list`);
      const d = await r.json();
      if (d.success) setBlueprints(d.data);
    } catch {} finally { setLoadingV2(false); }
  };

  // ── Fetch V3 remix queue ────────────────────────────────────────────────
  const fetchV3 = async () => {
    try {
      const r = await fetch(`${V3_API}/api/queue`);
      if (!r.ok) throw new Error();
      const d = await r.json();
      const videos = d.videos || [];
      setRemixQueue(videos);
      setV3Online(true);
      // Clean up renderingIds for any video that has moved past pending/rendering
      setRenderingIds(prev => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        videos.forEach((v: any) => {
          if (v.generation_status !== "pending" && v.generation_status !== "rendering") {
            next.delete(v.video_id);
          }
        });
        return next.size === prev.size ? prev : next; // avoid re-render if nothing changed
      });
    } catch {
      setV3Online(false);
    } finally { setLoadingV3(false); }
  };

  useEffect(() => {
    fetchV2(); fetchV3();
    intervalRef.current = setInterval(() => { fetchV2(); fetchV3(); }, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // ── V2 actions ──────────────────────────────────────────────────────────
  const handleResume = async (id: string) => {
    setBlueprints(prev => prev.map(b => b.id === id ? { ...b, status: "rendering", stage: "rendering" } : b));
    try { await fetch(`${V2_API}/api/warehouse/resume`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); } catch {}
  };
  const handleBulkResume = async () => {
    const ids = Array.from(selectedIds).filter(id => { const bp = blueprints.find(b => b.id === id); return bp && bp.status !== "rendering"; });
    if (!ids.length) return;
    setBlueprints(prev => prev.map(b => ids.includes(b.id) ? { ...b, status: "rendering", stage: "rendering" } : b));
    setSelectedIds(new Set());
    try { await fetch(`${V2_API}/api/warehouse/batch-resume`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }); } catch {}
  };
  const handleDelete = async (id: string) => {
    try { await fetch(`${V2_API}/api/warehouse/${id}`, { method: "DELETE" }); setBlueprints(prev => prev.filter(b => b.id !== id)); setSelectedIds(prev => { prev.delete(id); return new Set(prev); }); } catch {}
  };
  const handleStop = async (id: string) => {
    try { await fetch(`${V2_API}/api/warehouse/stop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); setBlueprints(prev => prev.map(b => b.id === id ? { ...b, status: "error", stage: "error", failure_reason: "Halted manually by Operator" } : b)); } catch {}
  };
  const toggleSelect = (id: string) => setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  // ── Remix actions ───────────────────────────────────────────────────────
  const handleRemixSingle = async (video_id: string) => {
    setRenderingIds(prev => new Set(prev).add(video_id));
    try {
      const res = await fetch(`${V3_API}/api/render/single`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_id }),
      });
      // API returned a non-2xx (e.g. 409 already rendering) — clear spinner
      if (!res.ok) {
        setRenderingIds(prev => { const s = new Set(prev); s.delete(video_id); return s; });
      }
    } catch {
      // Network failure — clear spinner immediately so user can retry
      setRenderingIds(prev => { const s = new Set(prev); s.delete(video_id); return s; });
    }
    // On success the status will change to 'rendering' on next poll and
    // cleanupRenderingIds will handle the eventual 'rendered'/'error' clear.
  };

  const handleRemixAll = async () => {
    setBulkFiring(true);
    const pending = remixQueue.filter(v => v.generation_status === "pending");
    pending.forEach(v => setRenderingIds(prev => new Set(prev).add(v.video_id)));
    try { await fetch(`${V3_API}/api/render`, { method: "POST" }); } catch {}
    setBulkFiring(false);
  };

  const handleRemixRetry = async (video_id: string) => {
    // Reset error/partial videos back to pending so the pipeline re-runs cleanly
    try {
      await fetch(`${V3_API}/api/reset/${video_id}`, { method: "POST" });
    } catch {}
    handleRemixSingle(video_id);
  };

  const handleRemixDelete = async (video_id: string) => {
    try { await fetch(`${V3_API}/api/queue/${video_id}`, { method: "DELETE" }); setRemixQueue(prev => prev.filter(v => v.video_id !== video_id)); } catch {}
  };

  const handleRenderChunk = async (video_id: string, part_num: 2 | 3) => {
    const key = `${video_id}_p${part_num}`;
    setRenderingIds(prev => new Set(prev).add(key));
    try {
      await fetch(`${V3_API}/api/render/chunk`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_id, part_num }),
      });
    } catch {
      setRenderingIds(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  const handleContinueChunks = async (video_id: string) => {
    // Fire Part 2 and Part 3 in parallel — compositing happens automatically once both are done
    await Promise.all([handleRenderChunk(video_id, 2), handleRenderChunk(video_id, 3)]);
  };

  const handleTransfer = async (video_id: string) => {
    setRenderingIds(prev => new Set(prev).add(video_id));
    try {
      await fetch(`${V3_API}/api/transfer`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_id }),
      });
      fetchV3();
    } catch {
      setRenderingIds(prev => { const s = new Set(prev); s.delete(video_id); return s; });
    }
  };

  // ── Derived counts ──────────────────────────────────────────────────────
  const pendingRemix = remixQueue.filter(v => v.generation_status === "pending").length;

  const filtered = activeTab === "remix" ? [] :
    activeTab === "All" ? blueprints :
    activeTab === "error" ? blueprints.filter(b => b.stage === "error" || b.status === "error") :
    activeTab === "standard" ? blueprints.filter(b => b.bg_mode === null || b.bg_mode === "standard") :
    blueprints.filter(b => b.bg_mode === activeTab);

  const tabCount = (tab: AnyTab) => {
    if (tab === "remix")    return remixQueue.length;
    if (tab === "All")      return blueprints.length;
    if (tab === "error")    return blueprints.filter(b => b.stage === "error" || b.status === "error").length;
    if (tab === "standard") return blueprints.filter(b => b.bg_mode === null || b.bg_mode === "standard").length;
    return blueprints.filter(b => b.bg_mode === tab).length;
  };

  const isLoading = activeTab === "remix" ? loadingV3 : loadingV2;

  return (
    <main className="min-h-screen bg-[#050505] text-white font-mono pt-16">
      <div className="max-w-5xl mx-auto px-6 py-8">

        {/* Action Bar */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            {activeTab === "remix" && (
              <div className={cn("flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full border",
                v3Online ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-red-400 border-red-500/30 bg-red-500/10"
              )}>
                <span className={cn("w-1.5 h-1.5 rounded-full", v3Online ? "bg-green-400 animate-pulse" : "bg-red-400")} />
                {v3Online ? "Remix Engine Online" : "Remix Engine Offline"}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => { fetchV2(); fetchV3(); }} className="text-white/20 hover:text-white/50 transition-colors p-1.5">
              <RefreshCw className="w-4 h-4" />
            </button>
            <AnimatePresence>
              {selectedIds.size > 0 && activeTab !== "remix" && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                  <Button onClick={handleBulkResume} size="sm" className="bg-emerald-600 hover:bg-emerald-500 font-bold text-xs">
                    <Play className="w-3 h-3 mr-1.5" /> Compile {selectedIds.size}
                  </Button>
                </motion.div>
              )}
              {activeTab === "remix" && pendingRemix > 0 && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                  <Button onClick={handleRemixAll} disabled={bulkFiring || !v3Online} size="sm"
                    className="bg-orange-500 hover:bg-orange-400 text-black font-bold text-xs disabled:opacity-40">
                    {bulkFiring ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Play className="w-3 h-3 mr-1.5 fill-black" />}
                    Render All Pending ({pendingRemix})
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-1.5 mb-5 flex-wrap">
          {ALL_TABS.map(tab => {
            const count = tabCount(tab);
            const isRemix = tab === "remix";
            return (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={cn("px-3 py-1.5 rounded-xl text-[10px] uppercase tracking-widest font-bold border transition-all flex items-center gap-1.5",
                  activeTab === tab
                    ? tab === "error"  ? "bg-red-500/15 border-red-500/40 text-red-400"
                    : isRemix          ? "bg-orange-500/15 border-orange-500/40 text-orange-400"
                                       : "bg-white/10 border-white/20 text-white"
                    : "bg-transparent border-white/5 text-white/30 hover:border-white/10"
                )}>
                {isRemix && <BookOpen className="w-3 h-3" />}
                {tab} {count > 0 && <span className="opacity-60">{count}</span>}
              </button>
            );
          })}
        </div>

        {/* ── V3 REMIX QUEUE ─────────────────────────────────────────────── */}
        {activeTab === "remix" && (
          isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-white/20" /></div>
          ) : !v3Online ? (
            <div className="border border-red-500/20 rounded-2xl py-12 text-center bg-red-500/5">
              <p className="text-red-400 text-xs uppercase tracking-widest font-bold">Remix Engine Offline</p>
              <p className="text-white/30 text-[10px] mt-2">Start the V3 API server: <code className="font-mono bg-white/5 px-2 py-0.5 rounded">python api.py</code></p>
            </div>
          ) : remixQueue.length === 0 ? (
            <div className="border border-white/5 rounded-2xl py-12 text-center">
              <p className="text-white/20 text-xs uppercase tracking-widest font-bold">No stories in queue.</p>
              <p className="text-white/15 text-[10px] mt-2">Go to Video Factory → Remix Story to add scripts.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence>
                {remixQueue.map(v => {
                  const s = REMIX_STATUS[v.generation_status] || REMIX_STATUS.pending;
                  const isRendering   = renderingIds.has(v.video_id) && v.generation_status === "pending";
                  const isRendered    = v.generation_status === "rendered";
                  const isError       = v.generation_status === "error";
                  const isPartial     = v.generation_status === "audio_partial";
                  const isAudioDone   = v.generation_status === "audio_done";
                  const isContinuing  = renderingIds.has(`${v.video_id}_p2`) || renderingIds.has(`${v.video_id}_p3`);
                  return (
                    <motion.div key={v.video_id} layout
                      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className={cn("border rounded-xl overflow-hidden transition-all",
                        isRendered  ? "bg-green-900/5 border-green-500/15" :
                        isError     ? "bg-red-900/5 border-red-500/20" :
                        isPartial   ? "bg-amber-900/5 border-amber-500/20" :
                        isRendering ? "bg-blue-900/5 border-blue-500/15" :
                        "bg-[#0d0d0d] border-white/[0.06] hover:border-white/10"
                      )}>

                      {/* Progress bar */}
                      <div className="h-0.5 w-full bg-white/5">
                        {isRendered  && <div className="h-full bg-green-500/60 w-full" />}
                        {isRendering && <motion.div className="h-full bg-blue-500" animate={{ width: ["20%","80%","20%"] }} transition={{ duration: 2, repeat: Infinity }} />}
                        {v.generation_status === "audio_done" && <div className="h-full bg-blue-500/40 w-[60%]" />}
                        {isError     && <div className="h-full bg-red-500/40 w-full" />}
                      </div>

                      <div className="flex items-center gap-3 px-4 py-3">
                        {/* Status badge */}
                        <span className={cn("flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border shrink-0", s.color)}>
                          {isRendering ? <Loader2 className="w-3 h-3 animate-spin" /> : s.icon}
                          {isRendering ? "Rendering" : s.label}
                        </span>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-white/80 truncate">{v.title}</p>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-[9px] font-mono text-white/20">{v.video_id}</span>
                            <span className="text-[9px] text-white/20">voice: {v.voice}</span>
                            {v.output_filename && (
                              <span className="text-[9px] text-green-400/60 font-mono truncate max-w-[200px]">{v.output_filename}</span>
                            )}
                          </div>
                          {isError && v.error_message && (
                            <div className="mt-1 flex items-start gap-1 text-[9px] text-red-400/80 font-mono bg-red-500/5 rounded-lg px-2 py-1">
                              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                              <span className="line-clamp-1">{v.error_message}</span>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {!isRendered && (
                            <button onClick={() => handleRemixDelete(v.video_id)}
                              className="p-1.5 border border-white/5 rounded-lg hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400 transition-all text-white/30">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isAudioDone && (
                            <Button
                              onClick={() => handleContinueChunks(v.video_id)}
                              disabled={isContinuing || !v3Online}
                              size="sm"
                              className="font-bold text-xs px-3 bg-blue-600 hover:bg-blue-500 text-white">
                              {isContinuing ? <Loader2 className="w-3 h-3 animate-spin" /> : <>&#9654; Continue</>}
                            </Button>
                          )}
                          {!isRendered && !isAudioDone && (
                            <Button
                              onClick={() =>
                                isError
                                  ? handleRemixRetry(v.video_id)
                                  : handleRemixSingle(v.video_id)
                              }
                              disabled={isRendering || !v3Online}
                              size="sm"
                              className={cn("font-bold text-xs px-3",
                                isError   ? "bg-amber-600 hover:bg-amber-500 text-white" :
                                isPartial ? "bg-amber-500 hover:bg-amber-400 text-black" :
                                "bg-orange-500 hover:bg-orange-400 text-black"
                              )}>
                              {isRendering ? <Loader2 className="w-3 h-3 animate-spin" /> :
                                isError    ? <>&#x21A9; Retry</> :
                                isPartial  ? <>&#9654; Continue</> :
                                             <><Play className="w-3 h-3 mr-1 fill-black" />Start</>}
                            </Button>
                          )}
                          {isRendered && (
                            <span className="flex items-center gap-1.5 text-[10px] text-green-400 font-bold uppercase tracking-wider">
                              <CheckCircle className="w-3.5 h-3.5" /> Done
                            </span>
                          )}
                          {isRendered && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => !isRendering && handleTransfer(v.video_id)}
                                disabled={isRendering || !v3Online}
                                className={cn(
                                  "flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border transition-all",
                                  isRendering ? "opacity-50 border-white/10 text-white/30" : "border-emerald-500/30 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20"
                                )}>
                                {isRendering ? "Pushing..." : "Push to V2"}
                              </button>
                              <button
                                onClick={() => router.push("/history")}
                                className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border border-blue-500/30 text-blue-400 bg-blue-500/10 hover:opacity-80 transition-all">
                                &#8594; Registry
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                    {/* Part 2 / Part 3 chunk status — shown when chunks are queued */}
                    {(v.part_2_status || v.part_3_status) && (
                      <div className="flex items-center gap-2 px-4 pb-3">
                        <span className="text-[9px] text-white/20 font-mono uppercase tracking-widest mr-1">Parts:</span>
                        {[2, 3].map((pn) => {
                          const st = pn === 2 ? v.part_2_status : v.part_3_status;
                          const chunkKey = `${v.video_id}_p${pn}`;
                          const isChunkRendering = renderingIds.has(chunkKey);
                          const statusColor =
                            st === "done"      ? "border-green-500/30 text-green-400 bg-green-500/10" :
                            st === "rendering" ? "border-blue-500/30 text-blue-400 bg-blue-500/10" :
                            st === "error"     ? "border-red-500/30 text-red-400 bg-red-500/10" :
                                                 "border-white/10 text-white/30 bg-white/5";
                          return (
                            <button
                              key={pn}
                              onClick={() => st !== "done" && !isChunkRendering && handleRenderChunk(v.video_id, pn as 2 | 3)}
                              disabled={st === "done" || isChunkRendering || !v3Online}
                              className={cn(
                                "flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border transition-all",
                                statusColor,
                                st !== "done" && !isChunkRendering && "hover:opacity-80 cursor-pointer"
                              )}
                            >
                              {isChunkRendering ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> :
                               st === "done"    ? <CheckCircle className="w-2.5 h-2.5" /> :
                               st === "error"   ? <AlertCircle className="w-2.5 h-2.5" /> :
                                                  <Play className="w-2.5 h-2.5" />}
                              Part {pn}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )
      )}


        {/* ── V2 BLUEPRINTS ──────────────────────────────────────────────── */}
        {activeTab !== "remix" && (
          loadingV2 ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-white/20" /></div>
          ) : filtered.length === 0 ? (
            <div className="border border-white/5 rounded-2xl py-12 text-center">
              <p className="text-white/20 text-xs uppercase tracking-widest font-bold">No drafts here.</p>
              <button onClick={() => router.push("/factory")} className="mt-3 text-[10px] text-blue-400 hover:text-blue-300 uppercase tracking-wider">
                → Go to Factory to generate
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(bp => {
                const isSelected  = selectedIds.has(bp.id);
                const stageMeta   = STAGE_META[bp.stage] || { icon: "📄", color: "text-white/40" };
                const isRendering = bp.status === "rendering";
                const isError     = bp.stage === "error" || bp.status === "error";
                const stageOrder  = ["scripted","has_audio","has_images","has_video_clips","renderable"];
                const stageIdx    = stageOrder.indexOf(bp.stage);
                const progress    = stageIdx >= 0 ? ((stageIdx + 1) / stageOrder.length) * 100 : 0;

                return (
                  <motion.div key={bp.id} layout
                    className={cn("border rounded-xl overflow-hidden transition-all",
                      isSelected  ? "bg-blue-900/10 border-blue-500/30" :
                      isError     ? "bg-red-900/5 border-red-500/20" :
                      isRendering ? "bg-blue-900/5 border-blue-500/15" :
                      "bg-[#0d0d0d] border-white/[0.06] hover:border-white/10"
                    )}>
                    {!isError && (<div className="h-0.5 w-full bg-white/5"><div className={cn("h-full transition-all duration-1000", isRendering ? "bg-blue-500 animate-pulse" : "bg-emerald-500/60")} style={{ width: `${isRendering ? 50 : progress}%` }} /></div>)}
                    {isError && <div className="h-0.5 w-full bg-red-500/40" />}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <button onClick={() => toggleSelect(bp.id)} disabled={isRendering}
                        className={cn("w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors",
                          isSelected ? "bg-blue-500 border-blue-500" : "border-white/15 hover:border-white/30 bg-transparent"
                        )}>
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </button>
                      <span className={cn("text-base shrink-0", stageMeta.color)}>{stageMeta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[9px] uppercase tracking-widest font-bold text-white/30">{bp.bg_mode}</span>
                          <span className={cn("text-[9px] font-bold uppercase tracking-widest", stageMeta.color)}>{bp.stage}</span>
                          {isRendering && <span className="text-[9px] text-blue-400 font-bold animate-pulse">rendering…</span>}
                        </div>
                        <p className="text-xs font-bold text-white/80 truncate leading-tight">{bp.title}</p>
                        <div className="flex items-center gap-1 mt-1.5">
                          {stageOrder.map((s, i) => <div key={s} className={cn("w-4 h-0.5 rounded-full", stageOrder.indexOf(bp.stage) >= i ? "bg-emerald-500/60" : "bg-white/10")} />)}
                          <span className="text-[8px] text-white/20 ml-1">{stageOrder.indexOf(bp.stage) + 1}/5</span>
                        </div>
                        {isError && bp.failure_reason && (
                          <div className="mt-1.5 flex items-start gap-1 text-[9px] text-red-400/80 font-mono bg-red-500/5 rounded-lg px-2 py-1">
                            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                            <span className="line-clamp-2">{bp.failure_reason}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={() => handleDelete(bp.id)} className="p-1.5 border border-white/5 rounded-lg hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400 transition-all text-white/30"><Trash2 className="w-3.5 h-3.5" /></button>
                        <Button onClick={() => isRendering ? handleStop(bp.id) : handleResume(bp.id)} size="sm"
                          className={cn("font-bold text-xs px-3",
                            isRendering ? "bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-black border border-red-500/20 hover:border-red-500" :
                            isError     ? "bg-amber-600 hover:bg-amber-500 text-white" : "bg-white text-black hover:bg-white/80"
                          )}>
                          {isRendering ? <><XCircle className="w-3 h-3 mr-1" />Stop</> : isError ? <>↩ Retry</> : <><Play className="w-3 h-3 mr-1" />Continue</>}
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )
        )}
      </div>
    </main>
  );
}
