"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Plus, Trash2, Play, RefreshCw, ChevronDown, ChevronRight,
  Globe, Zap, Image as ImageIcon, Database, Video, Cpu,
  FileText, Mic2, Layers, CheckCircle2, AlertCircle,
  Loader2, BarChart3, Archive, Film
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
type TargetStage = 'script' | 'images' | 'audio' | 'video' | 'complete';
type Status = 'pending' | 'running' | 'done' | 'failed';
type ActiveTab = 'queue' | 'vault';

interface QueueItem {
  id: number;
  title: string;
  topic: string | null;
  context: string | null;
  affiliate: string | null;
  template: string;
  target_stage: TargetStage;
  status: Status;
  stage_reached: string | null;
  path_script: string | null;
  path_images: string | null;
  path_audio: string | null;
  path_video: string | null;
  path_final: string | null;
  error: string | null;
  error_stage: string | null;
  created_at: string;
  completed_at: string | null;
  checkpoints: { script: boolean; images: boolean; audio: boolean; video: boolean; final: boolean };
}

interface MissionSummary {
  mission_id: string;
  total_scenes: number;
  images_done: number;
  videos_done: number;
  started_at: string;
  last_updated: string;
}

interface SceneCheckpoint {
  scene_index: number;
  image_path: string | null;
  video_path: string | null;
  provider: string | null;
  image_status: string;
  video_status: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const STAGES: { id: TargetStage; label: string; icon: any; color: string; desc: string }[] = [
  { id: 'script',   label: 'Script Only',    icon: FileText,     color: 'blue',    desc: 'AI script + metadata JSON' },
  { id: 'images',   label: '+ Images',       icon: ImageIcon,    color: 'emerald', desc: 'All scene images generated' },
  { id: 'audio',    label: '+ Audio',        icon: Mic2,         color: 'rose',    desc: 'Narration + score audio' },
  { id: 'video',    label: '+ Video Frames', icon: Video,        color: 'cyan',    desc: 'Veo-animated clips, no merge' },
  { id: 'complete', label: 'Full Pipeline',  icon: CheckCircle2, color: 'green',   desc: 'Assemble + save to library' },
];

const STATUS_CONFIG: Record<Status, { label: string; color: string; dot: string; pulse: boolean }> = {
  pending: { label: 'Pending', color: 'text-white/40',  dot: 'bg-white/20',  pulse: false },
  running: { label: 'Running', color: 'text-blue-400',  dot: 'bg-blue-500',  pulse: true  },
  done:    { label: 'Done',    color: 'text-green-400', dot: 'bg-green-500', pulse: false },
  failed:  { label: 'Failed',  color: 'text-red-400',   dot: 'bg-red-500',   pulse: false },
};

const COLOR_MAP: Record<string, { text: string; bg: string; border: string }> = {
  blue:    { text: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/30'    },
  emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  rose:    { text: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/30'    },
  cyan:    { text: 'text-cyan-400',    bg: 'bg-cyan-500/10',    border: 'border-cyan-500/30'    },
  green:   { text: 'text-green-400',   bg: 'bg-green-500/10',   border: 'border-green-500/30'   },
};

const scenePill = (status: string) => {
  if (status === 'done')    return 'bg-green-500/15 text-green-400 border-green-500/30';
  if (status === 'failed')  return 'bg-red-500/15 text-red-400 border-red-500/30';
  if (status === 'skipped') return 'bg-white/5 text-white/25 border-white/10';
  return 'bg-white/5 text-white/20 border-white/10';
};

// ── Render Vault ───────────────────────────────────────────────────────────────
function RenderVault() {
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [scenes, setScenes] = useState<Record<string, SceneCheckpoint[]>>({});
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchMissions = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:3000/api/checkpoints');
      const data = await res.json();
      if (data.success) setMissions(data.missions);
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchMissions(); }, [fetchMissions]);

  const toggle = async (id: string) => {
    const next = expanded === id ? null : id;
    setExpanded(next);
    if (next && !scenes[next]) {
      try {
        const res = await fetch(`http://localhost:3000/api/checkpoints/${next}`);
        const data = await res.json();
        if (data.success) setScenes(p => ({ ...p, [next]: data.scenes }));
      } catch (_) {}
    }
  };

  const deleteMission = async (id: string) => {
    if (!confirm(`Delete all checkpoints and files for this mission?`)) return;
    setDeleting(id);
    await fetch(`http://localhost:3000/api/checkpoints/${id}`, { method: 'DELETE' });
    setMissions(m => m.filter(x => x.mission_id !== id));
    setDeleting(null);
  };

  const deleteScene = async (missionId: string, index: number) => {
    await fetch(`http://localhost:3000/api/checkpoints/${missionId}/scene/${index}`, { method: 'DELETE' });
    setScenes(p => ({ ...p, [missionId]: (p[missionId] || []).filter(s => s.scene_index !== index) }));
  };

  if (loading) return (
    <div className="flex items-center gap-3 text-white/20 py-20 justify-center">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">Loading render vault...</span>
    </div>
  );

  if (missions.length === 0) return (
    <div className="border border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center py-20 gap-3">
      <Archive className="w-8 h-8 text-white/10" />
      <p className="text-white/20 text-sm">Render Vault is empty.</p>
      <p className="text-white/10 text-[11px]">Run a pipeline to see scene checkpoints here.</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {missions.map(m => {
        const isOpen = expanded === m.mission_id;
        const sceneList = scenes[m.mission_id] || [];
        const label = m.mission_id.replace(/^\d+_/, '').replace(/_/g, ' ');
        const pct = m.total_scenes > 0 ? Math.round((m.videos_done / m.total_scenes) * 100) : 0;

        return (
          <motion.div key={m.mission_id}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden"
          >
            {/* Mission header row */}
            <div className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-white/[0.02] transition-all"
              onClick={() => toggle(m.mission_id)}>
              <Archive className="w-4 h-4 text-white/20 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white capitalize truncate">{label}</p>
                <p className="text-[10px] text-white/30">
                  {m.total_scenes} scenes · {m.images_done} images · {m.videos_done} videos · {new Date(m.started_at).toLocaleString()}
                </p>
              </div>

              {/* Progress */}
              <div className="hidden md:flex flex-col items-end gap-1 shrink-0 w-28">
                <span className="text-[9px] text-white/30">{pct}% animated</span>
                <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                <button onClick={() => deleteMission(m.mission_id)} disabled={deleting === m.mission_id}
                  className="p-2 rounded-xl text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all"
                  title="Delete mission + files"
                >
                  {deleting === m.mission_id
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Trash2 className="w-3 h-3" />}
                </button>
                {isOpen
                  ? <ChevronDown className="w-4 h-4 text-white/20" />
                  : <ChevronRight className="w-4 h-4 text-white/20" />}
              </div>
            </div>

            {/* Scene breakdown */}
            <AnimatePresence>
              {isOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-white/5"
                >
                  <div className="px-5 py-4 space-y-2">
                    <p className="text-[9px] uppercase tracking-widest text-white/20 font-bold mb-3">Scene Breakdown</p>
                    {sceneList.length === 0 && (
                      <div className="flex items-center gap-2 text-white/20 py-4 justify-center">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span className="text-xs">Loading scenes...</span>
                      </div>
                    )}
                    {sceneList.map(scene => (
                      <div key={scene.scene_index}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04] group"
                      >
                        <span className="text-[9px] text-white/25 font-bold w-8 shrink-0">
                          S{scene.scene_index + 1}
                        </span>

                        {/* Image status */}
                        <div className="flex items-center gap-1.5">
                          <ImageIcon className="w-3 h-3 text-white/20" />
                          <span className={cn("text-[8px] px-2 py-0.5 rounded-lg font-bold uppercase border", scenePill(scene.image_status))}>
                            {scene.image_status}
                          </span>
                        </div>

                        {/* Video status */}
                        <div className="flex items-center gap-1.5">
                          <Film className="w-3 h-3 text-white/20" />
                          <span className={cn("text-[8px] px-2 py-0.5 rounded-lg font-bold uppercase border", scenePill(scene.video_status))}>
                            {scene.video_status}
                          </span>
                        </div>

                        {scene.provider && (
                          <span className="text-[9px] text-white/20 hidden md:block">{scene.provider}</span>
                        )}

                        <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => deleteScene(m.mission_id, scene.scene_index)}
                            className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all"
                            title="Delete scene files"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function ProductionStudio() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('queue');
  const [items, setItems] = useState<QueueItem[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [batchRunning, setBatchRunning] = useState(false);

  const [form, setForm] = useState({
    title: '', topic: '', context: '', affiliate: '',
    template: 'STANDARD' as 'STANDARD' | 'BRAINROT_SPLIT',
    target_stage: 'complete' as TargetStage,
  });
  const [saving, setSaving] = useState(false);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:3000/api/queue');
      const data = await res.json();
      if (data.success) setItems(data.items);
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchQueue();
    const iv = setInterval(() => {
      if (items.some(i => i.status === 'running')) fetchQueue();
    }, 5000);
    return () => clearInterval(iv);
  }, [fetchQueue, items]);

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await fetch('http://localhost:3000/api/queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form)
      });
      setForm({ title: '', topic: '', context: '', affiliate: '', template: 'STANDARD', target_stage: 'complete' });
      await fetchQueue();
    } catch (_) {}
    setSaving(false);
  };

  const handleRun    = async (id: number) => { await fetch(`http://localhost:3000/api/queue/${id}/run`, { method: 'POST' }); fetchQueue(); };
  const handleDelete = async (id: number) => { if (!confirm('Remove this item?')) return; await fetch(`http://localhost:3000/api/queue/${id}`, { method: 'DELETE' }); fetchQueue(); };
  const handleBatch  = async () => { setBatchRunning(true); await fetch('http://localhost:3000/api/queue/batch', { method: 'POST' }); fetchQueue(); setBatchRunning(false); };

  const pendingCount = items.filter(i => i.status === 'pending' || i.status === 'failed').length;
  const doneCount    = items.filter(i => i.status === 'done').length;
  const runningCount = items.filter(i => i.status === 'running').length;

  return (
    <main className="min-h-screen bg-black text-white font-mono select-none">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-end justify-between border-b border-white/5 pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-blue-400">
              <BarChart3 className="w-4 h-4" />
              <span className="text-[10px] uppercase tracking-[0.3em] font-bold">Production Studio v7.0</span>
            </div>
            <h1 className="text-4xl font-bold tracking-tighter text-white">Studio</h1>
            <p className="text-[11px] text-white/30">
              {items.length} projects · {doneCount} complete · {runningCount > 0 ? `${runningCount} running` : `${pendingCount} pending`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={fetchQueue} className="p-2 rounded-xl border border-white/10 text-white/40 hover:text-white hover:border-white/20 transition-all">
              <RefreshCw className="w-4 h-4" />
            </button>
            {activeTab === 'queue' && pendingCount > 0 && (
              <button onClick={handleBatch} disabled={batchRunning}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-[11px] uppercase tracking-widest transition-all border",
                  batchRunning
                    ? "bg-white/5 border-white/10 text-white/30 cursor-not-allowed"
                    : "bg-green-600 border-green-500 text-white hover:bg-green-500 shadow-[0_0_20px_-5px_#16a34a]"
                )}
              >
                {batchRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 fill-current" />}
                {batchRunning ? 'Running Batch...' : `Run All Pending (${pendingCount})`}
              </button>
            )}
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 p-1 bg-white/[0.03] border border-white/5 rounded-2xl w-fit">
          {([
            { id: 'queue' as ActiveTab, label: 'Video Queue',  icon: Layers  },
            { id: 'vault' as ActiveTab, label: 'Render Vault', icon: Archive },
          ]).map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-5 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all",
                activeTab === tab.id ? "bg-white/10 text-white border border-white/10" : "text-white/30 hover:text-white/60"
              )}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <AnimatePresence mode="wait">

          {/* ── QUEUE TAB ── */}
          {activeTab === 'queue' && (
            <motion.div key="queue"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8"
            >
              {/* Left: Queue list */}
              <div className="lg:col-span-2 space-y-3">
                {loading && (
                  <div className="flex items-center gap-3 text-white/20 py-12 justify-center">
                    <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading queue...</span>
                  </div>
                )}
                {!loading && items.length === 0 && (
                  <div className="border border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center py-16 text-center gap-3">
                    <FileText className="w-8 h-8 text-white/10" />
                    <p className="text-white/20 text-sm">No video briefs yet.</p>
                    <p className="text-white/10 text-[11px]">Add your first idea using the form →</p>
                  </div>
                )}
                <AnimatePresence>
                  {items.map(item => {
                    const sc = STATUS_CONFIG[item.status];
                    const stageInfo = STAGES.find(s => s.id === item.target_stage);
                    const isExpanded = expandedId === item.id;
                    const cp = item.checkpoints;
                    return (
                      <motion.div key={item.id}
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                        className={cn(
                          "rounded-2xl border transition-all duration-300 overflow-hidden",
                          item.status === 'running' ? "border-blue-500/30 bg-blue-500/5"       :
                          item.status === 'done'    ? "border-green-500/20 bg-green-500/[0.03]" :
                          item.status === 'failed'  ? "border-red-500/20 bg-red-500/[0.03]"     :
                          "border-white/5 bg-white/[0.02]"
                        )}
                      >
                        <div className="flex items-center gap-4 px-5 py-4 cursor-pointer"
                          onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                          <div className={cn("w-2 h-2 rounded-full shrink-0", sc.dot, sc.pulse && "animate-pulse")} />
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm text-white truncate">{item.title}</p>
                            <p className="text-[10px] text-white/30 truncate">
                              {item.topic || 'Auto topic'} · {stageInfo?.label || item.target_stage} · {new Date(item.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          <span className={cn("text-[9px] uppercase font-bold tracking-widest shrink-0", sc.color)}>
                            {item.status === 'running' ? `● ${item.stage_reached || 'Starting'}` : sc.label}
                          </span>
                          <div className="hidden md:flex items-center gap-1 shrink-0">
                            {(['script','images','audio','video','final'] as const).map(s => (
                              <div key={s} className={cn("w-1.5 h-1.5 rounded-full", cp[s] ? "bg-green-500" : "bg-white/10")} title={s} />
                            ))}
                          </div>
                          <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                            {(item.status === 'pending' || item.status === 'failed') && (
                              <button onClick={() => handleRun(item.id)}
                                className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition-all"
                              ><Play className="w-3 h-3 fill-current" /></button>
                            )}
                            {item.status === 'running' && (
                              <div className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/30">
                                <Loader2 className="w-3 h-3 animate-spin" />
                              </div>
                            )}
                            <button onClick={() => handleDelete(item.id)}
                              className="p-2 rounded-xl text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all"
                            ><Trash2 className="w-3 h-3" /></button>
                            <div className="text-white/20">
                              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </div>
                          </div>
                        </div>

                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-white/5"
                            >
                              <div className="px-5 py-4 space-y-4">
                                {/* Checkpoint pills */}
                                <div className="space-y-2">
                                  <p className="text-[9px] uppercase tracking-widest text-white/20 font-bold">Checkpoint Status</p>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {STAGES.map(stage => {
                                      const cpKey = stage.id === 'complete' ? 'final' : stage.id as keyof typeof cp;
                                      const cached = cp[cpKey];
                                      const isTarget = stage.id === item.target_stage;
                                      const Icon = stage.icon;
                                      const colors = COLOR_MAP[stage.color];
                                      return (
                                        <div key={stage.id} className={cn(
                                          "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[9px] font-bold uppercase tracking-wider",
                                          cached ? cn(colors.bg, colors.border, colors.text) :
                                          isTarget ? "border-white/20 bg-white/5 text-white/50" : "border-white/5 text-white/20"
                                        )}>
                                          <Icon className="w-3 h-3" />
                                          {stage.label}
                                          {cached && <CheckCircle2 className="w-2.5 h-2.5" />}
                                          {isTarget && !cached && <span className="text-[8px] opacity-50">target</span>}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                                {item.error && (
                                  <div className="flex gap-2 p-3 bg-red-500/5 border border-red-500/20 rounded-xl">
                                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                                    <div>
                                      <p className="text-[10px] text-red-400 font-bold">Failed at: {item.error_stage}</p>
                                      <p className="text-[10px] text-red-400/70 font-mono mt-1">{item.error}</p>
                                    </div>
                                  </div>
                                )}
                                <div className="grid grid-cols-2 gap-3 text-[10px] text-white/30">
                                  {item.topic && <div><span className="text-white/15">Topic:</span> {item.topic}</div>}
                                  {item.affiliate && <div><span className="text-white/15">Affiliate:</span> {item.affiliate.slice(0,30)}...</div>}
                                  {item.template && <div><span className="text-white/15">Template:</span> {item.template}</div>}
                                  {item.completed_at && <div><span className="text-white/15">Completed:</span> {new Date(item.completed_at).toLocaleString()}</div>}
                                </div>
                                {item.path_final && (
                                  <div className="p-3 bg-green-500/5 border border-green-500/20 rounded-xl">
                                    <p className="text-[9px] text-green-400 font-bold uppercase tracking-widest">Final Video</p>
                                    <p className="text-[10px] text-white/40 font-mono mt-1 break-all">{item.path_final}</p>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>

              {/* Right: New Brief Form */}
              <div className="space-y-4">
                <div className="bg-[#0a0a0a] border border-white/5 rounded-2xl p-6 space-y-5 sticky top-6">
                  <div className="space-y-1">
                    <h3 className="font-bold text-white text-base tracking-tight">New Video Brief</h3>
                    <p className="text-[10px] text-white/20 uppercase tracking-widest">Add to Production Queue</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] uppercase tracking-widest text-white/30 font-bold">Project Title <span className="text-red-500">*</span></label>
                    <input value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))}
                      placeholder="E.g. Secrets of Kumbh Mela"
                      className="w-full bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/15 focus:outline-none focus:border-blue-500/40 transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] uppercase tracking-widest text-white/30 font-bold">Video Topic</label>
                    <input value={form.topic} onChange={e => setForm(f => ({...f, topic: e.target.value}))}
                      placeholder="Kumbh Mela history and significance..."
                      className="w-full bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/15 focus:outline-none focus:border-blue-500/40 transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] uppercase tracking-widest text-white/30 font-bold">Creative Direction</label>
                    <textarea value={form.context} onChange={e => setForm(f => ({...f, context: e.target.value}))}
                      placeholder="Tone, angle, key facts to include..." rows={3}
                      className="w-full bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/15 focus:outline-none focus:border-blue-500/40 transition-all resize-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] uppercase tracking-widest text-white/30 font-bold">Affiliate Link</label>
                    <input value={form.affiliate} onChange={e => setForm(f => ({...f, affiliate: e.target.value}))}
                      placeholder="https://amzn.to/..."
                      className="w-full bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 text-sm text-blue-400 placeholder:text-white/10 focus:outline-none focus:border-blue-500/40 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] uppercase tracking-widest text-white/30 font-bold">Generate Up To</label>
                    <div className="space-y-1.5">
                      {STAGES.map(stage => {
                        const colors = COLOR_MAP[stage.color];
                        const Icon = stage.icon;
                        const isSelected = form.target_stage === stage.id;
                        return (
                          <button key={stage.id} onClick={() => setForm(f => ({...f, target_stage: stage.id}))}
                            className={cn(
                              "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left",
                              isSelected ? cn(colors.bg, colors.border, colors.text) : "border-white/5 text-white/30 hover:border-white/10 hover:text-white/50"
                            )}
                          >
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase tracking-wider">{stage.label}</p>
                              <p className="text-[9px] opacity-60 normal-case font-normal">{stage.desc}</p>
                            </div>
                            {isSelected && <CheckCircle2 className="w-3 h-3 shrink-0 ml-auto" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] uppercase tracking-widest text-white/30 font-bold">Layout</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['STANDARD', 'BRAINROT_SPLIT'] as const).map(t => (
                        <button key={t} onClick={() => setForm(f => ({...f, template: t}))}
                          className={cn("py-2 rounded-xl border text-[9px] uppercase font-bold tracking-widest transition-all",
                            form.template === t
                              ? t === 'STANDARD' ? "bg-white/10 border-white/20 text-white" : "bg-blue-500/10 border-blue-500/20 text-blue-400"
                              : "border-white/5 text-white/20 hover:border-white/10"
                          )}
                        >{t === 'STANDARD' ? 'Standard' : 'Brainrot'}</button>
                      ))}
                    </div>
                  </div>
                  <button onClick={handleSave} disabled={saving || !form.title.trim()}
                    className={cn(
                      "w-full h-11 rounded-xl flex items-center justify-center gap-2 font-bold uppercase text-[11px] tracking-widest transition-all",
                      !form.title.trim() ? "bg-white/5 text-white/20 cursor-not-allowed border border-white/5" :
                      saving ? "bg-blue-500/20 text-blue-400 border border-blue-500/20" :
                      "bg-blue-600 text-white hover:bg-blue-500 shadow-[0_0_20px_-5px_#2563eb] border border-transparent"
                    )}
                  >
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                    {saving ? 'Saving...' : 'Save to Queue'}
                  </button>
                </div>

                {/* Image Provider Reference */}
                <div className="bg-[#0a0a0a] border border-white/5 rounded-2xl p-5 space-y-3">
                  <p className="text-[9px] uppercase tracking-widest text-white/20 font-bold">Image Provider Cascade</p>
                  {[
                    { label: 'Wikimedia',   info: 'Real photos — no cost', color: 'text-sky-400',    icon: Globe    },
                    { label: 'BYOP sk_',    info: '10/hr · 20s throttle',  color: 'text-yellow-400', icon: Zap      },
                    { label: 'Pollinations',info: 'Free FLUX tier',         color: 'text-pink-400',   icon: ImageIcon},
                    { label: 'HuggingFace', info: 'FLUX.1-schnell',         color: 'text-purple-400', icon: Cpu      },
                    { label: 'Pexels',      info: 'Stock fallback',         color: 'text-orange-400', icon: Database },
                  ].map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-white/20 text-[9px] font-bold w-4">P{i}</span>
                      <p.icon className={cn("w-3 h-3", p.color)} />
                      <span className={cn("text-[10px] font-bold", p.color)}>{p.label}</span>
                      <span className="text-[9px] text-white/20 ml-auto">{p.info}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* ── VAULT TAB ── */}
          {activeTab === 'vault' && (
            <motion.div key="vault"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            >
              <RenderVault />
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </main>
  );
}


