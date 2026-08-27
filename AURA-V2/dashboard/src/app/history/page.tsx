"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { Film, Clock, CheckCircle2, XCircle, Loader2, RefreshCw, Upload, Play, X, Calendar, Hash, ChevronDown, ChevronUp, Anchor } from "lucide-react";
import { cn } from "@/lib/utils";
import { AlertTriangle, Wifi, WifiOff } from "lucide-react";

const API_BASE = "http://localhost:3000";

type Video = {
  id: number;
  title: string;
  description: string;
  file_path: string;
  affiliate_link: string;
  status: string;
  created_at: string;
  metadata: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  pending_approval:   { label: "Pending", color: "text-amber-500", icon: Clock },
  approved:           { label: "Approved", color: "text-sky-500", icon: CheckCircle2 },
  published:          { label: "Published", color: "text-emerald-500", icon: Upload },
  failed:             { label: "Rejected", color: "text-rose-500", icon: XCircle },
  failed_interrupted: { label: "Interrupted", color: "text-orange-500", icon: XCircle },
  queued:             { label: "Queued", color: "text-amber-400/80", icon: Clock },
  processing:         { label: "Processing", color: "text-blue-400", icon: RefreshCw },
  completed:          { label: "Completed", color: "text-emerald-400", icon: CheckCircle2 },
  error:              { label: "Error", color: "text-red-500", icon: XCircle },
};

const RESTORABLE_STATUSES = ['failed', 'error', 'failed_interrupted'];

const DropdownBox = ({ title, children, defaultOpen = false }: { title: string, children: React.ReactNode, defaultOpen?: boolean }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-white/5 bg-transparent rounded-lg overflow-hidden flex flex-col">
      <button 
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 bg-white/[0.01] hover:bg-white/[0.03] text-left transition-colors shrink-0"
      >
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
      </button>
      <div className={cn("overflow-hidden border-t border-white/5 bg-transparent w-full", open ? "block" : "hidden")}>
        <div className="p-4">
          {children}
        </div>
      </div>
    </div>
  );
};

export default function HistoryPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [inlinePlayId, setInlinePlayId] = useState<number | null>(null);
  const [anchorDate, setAnchorDate] = useState<string>("");
  const [anchorStatus, setAnchorStatus] = useState<string>("");
  const [serverOnline, setServerOnline] = useState<boolean>(true);

  const formatDateForInput = (timestamp: number) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const tzOffset = date.getTimezoneOffset() * 60000;
    const localISOTime = new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
    return localISOTime;
  };

  const fetchAnchor = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/db/get-anchor`);
      if (!res.ok) throw new Error("Server error");
      const data = await res.json();
      if (data.anchor) {
        setAnchorDate(formatDateForInput(data.anchor));
      }
      setServerOnline(true);
    } catch (err) {
      console.error("Failed to fetch anchor", err);
      setServerOnline(false);
    }
  };

  const handleSetAnchor = async () => {
    const ts = anchorDate ? new Date(anchorDate).getTime() : 0;
    try {
      const res = await fetch("http://localhost:3000/api/db/set-anchor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timestamp: ts })
      });
      const data = await res.json();
      setAnchorStatus(ts > 0 ? `Anchor set: ${new Date(ts).toLocaleString()}` : "Anchor cleared");
      setTimeout(() => setAnchorStatus(""), 4000);
      fetchAnchor(); // Sync back
    } catch {
      setAnchorStatus("Failed to reach server");
      setTimeout(() => setAnchorStatus(""), 4000);
    }
  };

  const fetchLibrary = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/library`);
      if (!res.ok) throw new Error("Server error");
      const data = await res.json();
      setVideos(data.videos || []);
      setServerOnline(true);
      fetchAnchor(); 
    } catch (err) {
      setVideos([]);
      setServerOnline(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { 
    fetchLibrary();
    fetchAnchor();
  }, []);

  const handleAction = async (id: number, action: 'approve' | 'reject') => {
    await fetch(`http://localhost:3000/api/db/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    fetchLibrary();
    if (selectedVideo && selectedVideo.id === id) {
      setSelectedVideo({ ...selectedVideo, status: action === 'approve' ? 'approved' : 'failed' });
    }
  };

  const handleRestore = async (id: number) => {
    try {
      const res = await fetch(`http://localhost:3000/api/db/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      if (!res.ok) {
        console.error(`[RESTORE] Server returned ${res.status}`);
        return;
      }
      const data = await res.json();
      if (!data.success) {
        console.error(`[RESTORE] Server error:`, data.message);
        return;
      }
      await fetchLibrary();
      if (selectedVideo && selectedVideo.id === id) {
        setSelectedVideo({ ...selectedVideo, status: 'pending_approval' });
      }
    } catch (err) {
      console.error(`[RESTORE] Network error:`, err);
    }
  };

  const filtered = filter === "all" ? videos : videos.filter(v => v.status === filter);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "—";
    // SQLite CURRENT_TIMESTAMP gives '2026-04-12 13:57:00' (no Z, no T).
    // Normalize to a proper UTC ISO string so the browser always parses it as UTC,
    // then toLocaleString converts to the user's local timezone.
    const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
    return new Date(normalized).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  };

  const getMeta = (raw: string) => {
    try { return JSON.parse(raw); } catch { return {}; }
  };

  const getTags = (desc: string) => {
    if (!desc) return { plainText: "", tags: [] };
    const tags = desc.match(/#[a-zA-Z0-9_]+/g) || [];
    const plainText = desc.replace(/#[a-zA-Z0-9_]+/g, '').trim();
    return { plainText, tags };
  };

  const getVideoSrc = (id: number) => {
    return `http://localhost:3000/api/video/stream?id=${id}`;
  };

  return (
    <main className="min-h-screen bg-[#050505] text-white font-mono pt-24 pb-16 px-8 relative overflow-hidden">
      
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-10 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black uppercase tracking-[0.2em] text-white/90">Mission Archive</h1>
            <div className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border",
              serverOnline ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-500 border-rose-500/20 animate-pulse"
            )}>
              {serverOnline ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
              {serverOnline ? "Bridge Online" : "Bridge Offline"}
            </div>
          </div>
          <p className="text-[10px] uppercase tracking-widest text-white/30 mt-1">
            {videos.length} Database entries mapped
          </p>
        </div>
        <button 
          onClick={fetchLibrary}
          className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/30 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.05] rounded-full px-5 py-2.5"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh Registry
        </button>
      </div>

      {!serverOnline && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-7xl mx-auto mb-6 p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-3 text-rose-500"
        >
          <AlertTriangle className="w-5 h-5" />
          <div className="flex-1">
            <h4 className="text-[11px] font-bold uppercase tracking-widest">Connection Error</h4>
            <p className="text-[9px] opacity-70">The AURA-V2 Backend (Port 3000) is unreachable. Ensure the node server is running.</p>
          </div>
          <button onClick={fetchLibrary} className="px-4 py-2 bg-rose-500 text-black text-[9px] font-black uppercase tracking-widest rounded-lg">Reconnect</button>
        </motion.div>
      )}

      {/* Schedule Anchor Override */}
      <div className="max-w-7xl mx-auto mb-6 flex flex-wrap items-center gap-3 p-4 rounded-xl border border-white/5 bg-white/[0.015]">
        <Anchor className="w-4 h-4 text-sky-400/60" />
        <span className="text-[9px] uppercase tracking-[0.2em] text-white/40 mr-2">Last Mission Ref</span>
        <input
          type="datetime-local"
          value={anchorDate}
          onChange={(e) => setAnchorDate(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[11px] text-white/80 outline-none focus:border-sky-500/50 transition-colors"
        />
        <button
          onClick={handleSetAnchor}
          className="text-[9px] uppercase tracking-[0.15em] px-4 py-1.5 rounded-lg bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 transition-colors font-bold"
        >
          {anchorDate ? "Set Anchor" : "Clear Anchor"}
        </button>
        {anchorStatus && (
          <span className="text-[9px] text-emerald-400/70 uppercase tracking-widest animate-pulse">{anchorStatus}</span>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="max-w-7xl mx-auto mb-8 flex flex-wrap items-center gap-3">
        {["all", "pending_approval", "approved", "published", "failed"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[9px] uppercase tracking-[0.2em] px-5 py-2.5 rounded-full transition-all ${
              filter === f 
                ? "bg-white/10 text-white" 
                : "bg-transparent text-white/30 hover:text-white/60 hover:bg-white/5"
            }`}
          >
            {f === "all" ? "All Missions" : STATUS_CONFIG[f]?.label ?? f}
          </button>
        ))}
      </div>

      {/* List Layout */}
      <div className="max-w-7xl mx-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-white/20">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-[10px] uppercase tracking-[0.2em]">Synchronizing...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-white/10">
            <Film className="w-16 h-16 opacity-50" />
            <p className="text-[10px] uppercase tracking-[0.2em]">No missions match filters</p>
          </div>
        ) : (
          <LayoutGroup>
            <div className="flex flex-col gap-2">
              {filtered.map((video, i) => {
                const statusCfg = STATUS_CONFIG[video.status] || STATUS_CONFIG.pending_approval;
                const StatusIcon = statusCfg.icon;
                const isInlinePlaying = inlinePlayId === video.id;

                return (
                  <motion.div
                    layout
                    key={video.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="group flex flex-col sm:flex-row items-center gap-6 p-5 rounded-none bg-gradient-to-r from-white/[0.01] to-transparent hover:from-white/[0.03] transition-all cursor-default"
                  >
                    {/* Thumbnail Icon Block */}
                    <div 
                      className={`relative overflow-hidden rounded-md bg-black shadow-2xl transition-all cursor-pointer ${isInlinePlaying ? 'w-[200px] aspect-[9/16]' : 'w-20 aspect-[9/16] ring-1 ring-white/10 group-hover:ring-white/30'}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isInlinePlaying) {
                           setInlinePlayId(null);
                        } else {
                           if (inlinePlayId) setInlinePlayId(null);
                           setInlinePlayId(video.id);
                        }
                      }}
                    >
                       {isInlinePlaying && video.file_path ? (
                          <video 
                             src={getVideoSrc(video.id)}
                             autoPlay controls
                             className="absolute inset-0 w-full h-full object-contain bg-black"
                          />
                       ) : (
                          <>
                             {video.file_path ? (
                               <video 
                                 src={`${getVideoSrc(video.id)}#t=0.5`}
                                 className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity"
                                 preload="metadata" muted playsInline
                               />
                             ) : (
                               <div className="absolute inset-0 flex items-center justify-center">
                                 <Film className="w-6 h-6 text-white/10" />
                               </div>
                             )}
                             <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                               <div className="w-8 h-8 rounded-full border border-white/40 bg-black/60 flex items-center justify-center text-white backdrop-blur-md">
                                 <Play className="w-3 h-3 ml-0.5" />
                               </div>
                             </div>
                          </>
                       )}
                    </div>

                    {/* Metadata Line - CLICKABLE TO OPEN SIDEBAR */}
                    <div 
                      className="flex-1 min-w-0 py-2 flex flex-col justify-center cursor-pointer group/meta"
                      onClick={() => setSelectedVideo(video)}
                    >
                      <div className="flex items-center gap-3 mb-1.5 leading-none">
                        <span className="text-[10px] text-white/20 font-bold group-hover/meta:text-white/40 transition-colors">#{video.id}</span>
                        <div className={`flex items-center gap-1.5 text-[9px] uppercase tracking-widest font-bold ${statusCfg.color}`}>
                          <StatusIcon className="w-3 h-3" />
                          {statusCfg.label}
                        </div>
                      </div>
                      <h3 className="text-sm font-bold text-white/80 group-hover/meta:text-white transition-colors truncate pr-4">
                        {video.title || "Untitled Mission"}
                      </h3>
                      <p className="text-[10px] text-white/30 mt-1.5 uppercase tracking-widest truncate leading-none">
                        {formatDate(video.created_at)} • {getMeta(video.metadata).mode || "Auto"}
                      </p>
                    </div>

                    {/* Actions Inline - ALWAYS VISIBLE for pending */}
                    <div className="flex items-center gap-3">
                       {video.status === 'pending_approval' && (
                         <div className="flex gap-2">
                           <button 
                             onClick={(e) => { e.stopPropagation(); handleAction(video.id, 'approve'); }} 
                             className="px-6 py-2.5 rounded-none bg-white/5 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500 text-black hover:border-emerald-500 text-[9px] uppercase tracking-[0.2em] font-black transition-all"
                           >
                             Approve
                           </button>
                           <button 
                             onClick={(e) => { e.stopPropagation(); handleAction(video.id, 'reject'); }} 
                             className="px-6 py-2.5 rounded-none bg-white/5 border border-rose-500/20 text-rose-400 hover:bg-rose-500 text-black hover:border-rose-500 text-[9px] uppercase tracking-[0.2em] font-black transition-all"
                           >
                             Reject
                           </button>
                         </div>
                       )}
                       {RESTORABLE_STATUSES.includes(video.status) && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleRestore(video.id); }} 
                            className="px-6 py-2.5 rounded-none bg-white/5 border border-white/20 text-white/70 hover:bg-white text-black hover:border-white text-[9px] uppercase tracking-[0.2em] font-black transition-all flex items-center gap-2"
                          >
                            <RefreshCw className="w-3 h-3" /> Restore
                          </button>
                       )}
                       {/* Subtle Detail Arrow */}
                       <button onClick={() => setSelectedVideo(video)} className="w-10 h-10 flex items-center justify-center text-white/10 hover:text-white/40 transition-colors">
                          <CheckCircle2 className="w-4 h-4" />
                       </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </LayoutGroup>
        )}
      </div>

      {/* Right Sidebar */}
      <AnimatePresence>
        {selectedVideo && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelectedVideo(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            />

            <motion.div
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 w-full sm:w-[500px] bg-[#050505] border-l border-white/5 z-50 flex flex-col shadow-2xl"
            >
              <div className="flex items-center justify-between p-6">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 flex items-center gap-3">
                  <Hash className="w-3 h-3" /> Mission Data
                </span>
                <button onClick={() => setSelectedVideo(null)} className="text-white/30 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 pb-20 flex flex-col gap-6 min-h-0">
                
                {/* 1. Main Video Display in Accordion */}
                <DropdownBox title="VIDEO PREVIEW" defaultOpen={true}>
                  <div className="w-full max-w-[300px] mx-auto aspect-[9/16] bg-black rounded-xl overflow-hidden relative shadow-2xl flex items-center justify-center border border-white/10">
                    {selectedVideo.file_path ? (
                      <video 
                        src={getVideoSrc(selectedVideo.id)} 
                        controls 
                        autoPlay 
                        className="absolute inset-0 w-full h-full object-cover bg-black" 
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-2 text-white/20 h-full">
                        <Film className="w-8 h-8" />
                        <span className="text-[10px] uppercase tracking-widest font-bold">Media Offline</span>
                      </div>
                    )}
                  </div>
                </DropdownBox>

                {/* 2. Core Metadata block */}
                <div className="flex flex-col gap-2 mt-4">
                  <h2 className="text-xl font-bold text-white leading-tight">
                    {selectedVideo.title}
                  </h2>
                  <div className="flex items-center gap-4 text-[10px] uppercase tracking-widest text-white/40">
                     <span className="flex items-center gap-1.5"><Calendar className="w-3 h-3"/> {formatDate(selectedVideo.created_at)}</span>
                     <span className={`flex items-center gap-1.5 ${STATUS_CONFIG[selectedVideo.status]?.color || 'text-white'}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {STATUS_CONFIG[selectedVideo.status]?.label ?? selectedVideo.status}
                     </span>
                  </div>
                </div>

                {/* 3. Description & Tags in Accordion */}
                <div className="flex flex-col gap-3 mt-2">
                  <DropdownBox title="DESCRIPTION" defaultOpen={true}>
                    <div className="text-xs text-white/60 leading-relaxed max-w-prose">
                      {getTags(selectedVideo.description).plainText || <span className="italic opacity-50">No description provided</span>}
                    </div>
                  </DropdownBox>

                  <DropdownBox title="TAGS" defaultOpen={true}>
                     {getTags(selectedVideo.description).tags.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {getTags(selectedVideo.description).tags.map(tag => (
                            <span key={tag} className="px-3 py-1.5 bg-white/[0.03] border border-white/10 rounded-lg text-[10px] font-bold tracking-widest text-white/70">
                              {tag}
                            </span>
                          ))}
                        </div>
                     ) : (
                        <span className="text-[10px] text-white/30 uppercase tracking-widest">No tags found</span>
                     )}
                  </DropdownBox>

                  <DropdownBox title="Raw Telemetry">
                    <pre className="text-[10px] text-emerald-500/70 overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(getMeta(selectedVideo.metadata), null, 2)}
                    </pre>
                  </DropdownBox>
                </div>
              </div>

              {/* 4. Docked Action Buttons */}
              <div className="absolute bottom-0 inset-x-0 p-6 bg-gradient-to-t from-[#050505] via-[#050505] to-transparent flex gap-3">
                 {selectedVideo.status === "pending_approval" ? (
                   <>
                     <button
                      onClick={() => handleAction(selectedVideo.id, 'reject')}
                      className="flex-1 py-4 px-4 bg-rose-500/10 text-rose-500 font-bold text-[10px] uppercase tracking-[0.2em] hover:bg-rose-500/20 rounded-xl transition-colors flex items-center justify-center gap-2"
                     >
                       <XCircle className="w-4 h-4" /> Reject
                     </button>
                     <button
                      onClick={() => handleAction(selectedVideo.id, 'approve')}
                      className="flex-1 py-4 px-4 bg-white text-black font-bold text-[10px] uppercase tracking-[0.2em] hover:opacity-90 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-xl shadow-white/10"
                     >
                       <CheckCircle2 className="w-4 h-4" /> Approve
                     </button>
                   </>
                  ) : RESTORABLE_STATUSES.includes(selectedVideo.status) ? (
                     <button
                       onClick={() => handleRestore(selectedVideo.id)}
                       className="flex-1 py-4 px-4 bg-white/10 text-white font-bold text-[10px] uppercase tracking-[0.2em] hover:bg-white hover:text-black rounded-xl transition-all flex items-center justify-center gap-2 border border-white/20"
                     >
                       <RefreshCw className="w-4 h-4" /> Restore Mission
                     </button>
                   ) : (
                     <div className="flex-1 py-4 px-4 bg-white/5 text-white/40 font-bold text-[10px] uppercase tracking-[0.2em] rounded-xl flex items-center justify-center gap-3">
                        {(() => {
                           const Icon = STATUS_CONFIG[selectedVideo.status]?.icon || Film;
                           return <Icon className={cn("w-4 h-4", selectedVideo.status === 'processing' && "animate-spin")} />;
                        })()}
                        Mission Archive Locked
                     </div>
                   )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </main>
  );
}


