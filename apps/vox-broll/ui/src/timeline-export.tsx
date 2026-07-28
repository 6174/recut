/**
 * [INPUT]: 依赖 B-roll Scene/Audio 资源、共享 Asset 预览与平台 delivery.export API
 * [OUTPUT]: 对外提供固定视频轨、固定音频轨、顺序预览和基础编码设置的确定性导出工作台
 * [POS]: vox-broll Delivery 阶段的专用编辑器；只装配已有 Asset，不把导出意图交给 Agent 创作
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { ChevronDown, ChevronUp, Download, LoaderCircle, Music2, Plus, Trash2, Video } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Resource } from "./main";
import { AssetVideoPreview, resourceVideoAssetIDs } from "./resource-view";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui";

type Value = Record<string, unknown>;
type Source = { assetId: string; durationSec: number; label: string; resourceId: string };
type TrackClip = Source & { id: string };
type ExportSettings = { width: number; height: number; fps: number; quality: "high" | "balanced" | "small" };
type ExportResult = { id?: string };

const mediaURL = (assetId: string) => `/v1/media/assets/${encodeURIComponent(assetId)}/content`;
const record = (value: unknown): Value => value && typeof value === "object" && !Array.isArray(value) ? value as Value : {};
const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
const clipID = (source: Source) => `${source.assetId}-${crypto.randomUUID()}`;

function videoSources(resources: Resource[]) {
  return resources.filter((resource) => resource.kind.toLowerCase() === "scenes").flatMap((resource) => {
    const content = record(resource.content);
    const durationSec = positive(content.durationSec);
    return resourceVideoAssetIDs(resource).map((assetId) => ({ assetId, durationSec: durationSec || 5, label: resource.title, resourceId: resource.id }));
  });
}

function audioSources(resources: Resource[]) {
  return resources.filter((resource) => resource.kind.toLowerCase() === "audio").flatMap((resource) => {
    const content = record(resource.content);
    const scenes = Array.isArray(content.scenes) ? content.scenes : [];
    return scenes.flatMap((scene, index) => {
      const item = record(scene);
      const audio = record(item.audio);
      const assetId = typeof audio.assetId === "string" ? audio.assetId : "";
      const durationSec = positive(item.durationSec);
      if (!assetId) return [];
      return [{ assetId, durationSec: durationSec || 5, label: `${resource.title} · ${typeof item.narration === "string" ? item.narration : `声音 ${index + 1}`}`, resourceId: resource.id }];
    });
  });
}

function sequential(track: TrackClip[]) {
  let startSec = 0;
  return track.map((clip) => {
    const timelineClip = { assetId: clip.assetId, startSec, durationSec: clip.durationSec };
    startSec += clip.durationSec;
    return timelineClip;
  });
}

function duration(track: TrackClip[]) { return track.reduce((total, clip) => total + clip.durationSec, 0); }
function formatTime(value: number) { const seconds = Math.max(0, Math.round(value)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

function SourcePicker({ icon, label, onAdd, sources }: { icon: ReactNode; label: string; onAdd: (source: Source) => void; sources: Source[] }) {
  return <div className="grid gap-2"><p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{icon}{label}</p><div className="max-h-36 overflow-auto rounded-md border bg-muted/20 p-1">{sources.length ? sources.map((source) => <button className="flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left text-xs hover:bg-muted" key={`${source.resourceId}-${source.assetId}`} onClick={() => onAdd(source)} type="button"><span className="min-w-0 truncate">{source.label}</span><span className="shrink-0 font-mono text-muted-foreground">{formatTime(source.durationSec)}</span><Plus className="size-3.5 shrink-0 text-primary" /></button>) : <p className="px-2 py-3 text-xs text-muted-foreground">还没有可用素材。</p>}</div></div>;
}

function TrackLane({ clips, icon, label, onMove, onRemove, total }: { clips: TrackClip[]; icon: ReactNode; label: string; onMove: (index: number, offset: number) => void; onRemove: (id: string) => void; total: number }) {
  return <section className="grid gap-2 rounded-lg border bg-card p-3"><header className="flex items-center gap-2 text-sm font-medium">{icon}{label}<span className="font-mono text-[11px] font-normal text-muted-foreground">{formatTime(duration(clips))}</span></header><div className="flex min-h-16 overflow-hidden rounded border bg-muted/40">{clips.length ? clips.map((clip, index) => <div className="group relative min-w-20 border-r border-background bg-primary/15 px-2 py-2 last:border-r-0" key={clip.id} style={{ width: `${Math.max(12, (clip.durationSec / Math.max(total, 1)) * 100)}%` }}><p className="truncate text-xs font-medium">{clip.label}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{formatTime(clip.durationSec)}</p><div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex"><button aria-label="上移片段" className="rounded bg-card p-0.5 shadow-sm" disabled={index === 0} onClick={() => onMove(index, -1)} type="button"><ChevronUp className="size-3" /></button><button aria-label="下移片段" className="rounded bg-card p-0.5 shadow-sm" disabled={index === clips.length - 1} onClick={() => onMove(index, 1)} type="button"><ChevronDown className="size-3" /></button><button aria-label="移除片段" className="rounded bg-card p-0.5 text-destructive shadow-sm" onClick={() => onRemove(clip.id)} type="button"><Trash2 className="size-3" /></button></div></div>) : <p className="grid flex-1 place-items-center text-xs text-muted-foreground">从上方素材库加入片段</p>}</div></section>;
}

function moveClip(track: TrackClip[], index: number, offset: number) {
  const next = index + offset;
  if (next < 0 || next >= track.length) return track;
  const result = [...track];
  [result[index], result[next]] = [result[next], result[index]];
  return result;
}

function TimelinePreview({ audio, video }: { audio: TrackClip[]; video: TrackClip[] }) {
  const [videoIndex, setVideoIndex] = useState(0);
  const [audioIndex, setAudioIndex] = useState(0);
  const audioElement = useRef<HTMLAudioElement>(null);
  const videoClip = video[videoIndex];
  const audioClip = audio[audioIndex];
  useEffect(() => { setVideoIndex(0); setAudioIndex(0); }, [video.length, audio.length]);
  if (!videoClip) return <div className="grid aspect-video place-items-center rounded-lg border border-dashed bg-muted/30 text-sm text-muted-foreground">加入视频片段后即可预览。</div>;
  const nextVideo = () => setVideoIndex((index) => index < video.length - 1 ? index + 1 : index);
  return <div className="grid gap-2"><div className="aspect-video overflow-hidden rounded-lg border bg-black"><video autoPlay className="size-full object-contain" controls key={videoClip.id} muted onEnded={nextVideo} onPlay={() => void audioElement.current?.play()} playsInline src={mediaURL(videoClip.assetId)} /></div>{audioClip ? <audio controls key={audioClip.id} onEnded={() => setAudioIndex((index) => index < audio.length - 1 ? index + 1 : index)} ref={audioElement} src={mediaURL(audioClip.assetId)} /> : <p className="text-xs text-muted-foreground">未选择音频；将导出无声视频。</p>}<p className="text-[11px] text-muted-foreground">预览按轨道顺序播放；导出时由平台精确拼接为单一视频。</p></div>;
}

export function TimelineExport({ onExport, onTroubleshoot, resources }: { onExport: (input: { videoTimeline: ReturnType<typeof sequential>; audioTimeline: ReturnType<typeof sequential>; settings: ExportSettings; dependencies: string[] }) => Promise<ExportResult>; onTroubleshoot: (message: string) => Promise<void>; resources: Resource[] }) {
  const sources = useMemo(() => ({ video: videoSources(resources), audio: audioSources(resources) }), [resources]);
  const [videoTrack, setVideoTrack] = useState<TrackClip[]>([]);
  const [audioTrack, setAudioTrack] = useState<TrackClip[]>([]);
  const [settings, setSettings] = useState<ExportSettings>({ width: 1920, height: 1080, fps: 30, quality: "balanced" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [assetId, setAssetId] = useState("");
  const total = Math.max(duration(videoTrack), duration(audioTrack));
  const add = (source: Source, target: "video" | "audio") => target === "video" ? setVideoTrack((track) => [...track, { ...source, id: clipID(source) }]) : setAudioTrack((track) => [...track, { ...source, id: clipID(source) }]);
  const exportTimeline = async () => {
    setSubmitting(true); setError("");
    try {
      const result = await onExport({ videoTimeline: sequential(videoTrack), audioTimeline: sequential(audioTrack), settings, dependencies: [...new Set([...videoTrack, ...audioTrack].map((clip) => clip.resourceId))] });
      setAssetId(result.id || "");
    } catch (cause) { const message = cause instanceof Error ? cause.message : "导出失败"; setError(message); void onTroubleshoot(message); }
    finally { setSubmitting(false); }
  };
  return <div className="grid gap-5"><div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]"><div className="grid gap-3"><TrackLane clips={videoTrack} icon={<Video className="size-4 text-primary" />} label="视频轨" onMove={(index, offset) => setVideoTrack((track) => moveClip(track, index, offset))} onRemove={(id) => setVideoTrack((track) => track.filter((clip) => clip.id !== id))} total={total} /><TrackLane clips={audioTrack} icon={<Music2 className="size-4 text-primary" />} label="音频轨" onMove={(index, offset) => setAudioTrack((track) => moveClip(track, index, offset))} onRemove={(id) => setAudioTrack((track) => track.filter((clip) => clip.id !== id))} total={total} /></div><TimelinePreview audio={audioTrack} video={videoTrack} /></div><div className="grid gap-4 rounded-lg border bg-muted/20 p-4"><div className="grid gap-3 sm:grid-cols-2"><SourcePicker icon={<Video className="size-3.5" />} label="场景视频" onAdd={(source) => add(source, "video")} sources={sources.video} /><SourcePicker icon={<Music2 className="size-3.5" />} label="配音与音乐" onAdd={(source) => add(source, "audio")} sources={sources.audio} /></div><div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1.5 text-xs font-medium" htmlFor="export-size">画幅<select className="h-9 rounded-md border bg-background px-2 text-sm" id="export-size" onChange={(event) => { const [width, height] = event.target.value.split("x").map(Number); setSettings((current) => ({ ...current, width, height })); }} value={`${settings.width}x${settings.height}`}><option value="1920x1080">横版 1920 × 1080</option><option value="1080x1920">竖版 1080 × 1920</option><option value="1080x1080">方形 1080 × 1080</option></select></label><label className="grid gap-1.5 text-xs font-medium" htmlFor="export-fps">帧率<select className="h-9 rounded-md border bg-background px-2 text-sm" id="export-fps" onChange={(event) => setSettings((current) => ({ ...current, fps: Number(event.target.value) }))} value={settings.fps}><option value="24">24 fps</option><option value="30">30 fps</option></select></label><label className="grid gap-1.5 text-xs font-medium" htmlFor="export-quality">画质<select className="h-9 rounded-md border bg-background px-2 text-sm" id="export-quality" onChange={(event) => setSettings((current) => ({ ...current, quality: event.target.value as ExportSettings["quality"] }))} value={settings.quality}><option value="high">高画质</option><option value="balanced">均衡</option><option value="small">较小文件</option></select></label></div><div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-xs text-muted-foreground">总时长 {formatTime(duration(videoTrack))} · MP4（H.264 + AAC）</p><Button disabled={!videoTrack.length || submitting} onClick={() => void exportTimeline()} type="button">{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}导出新视频素材</Button></div>{error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"><span>{error}</span><Button className="h-8 px-2 text-xs" onClick={() => void onTroubleshoot(error)} type="button" variant="outline">再次请求 Codex</Button></div>}{assetId && <div className="grid gap-2 rounded-md border bg-background p-3"><p className="text-xs font-medium text-primary">导出完成，已创建新的视频素材</p><div className="aspect-video max-w-md overflow-hidden rounded border"><AssetVideoPreview assetId={assetId} title="最终导出" /></div></div>}</div></div>;
}

export function DeliveryExportDialog({ onExport, onOpenChange, onTroubleshoot, open, resources }: { onExport: ComponentProps<typeof TimelineExport>["onExport"]; onOpenChange: (open: boolean) => void; onTroubleshoot: ComponentProps<typeof TimelineExport>["onTroubleshoot"]; open: boolean; resources: Resource[] }) {
  return <Dialog onOpenChange={onOpenChange} open={open}><DialogContent className="max-w-6xl"><DialogHeader><DialogTitle>导出时间线</DialogTitle><DialogDescription>选择已有视频和声音，按固定两轨排列后由 Recut 直接合成为新素材；此步骤不会调用 AI 创作。</DialogDescription></DialogHeader><TimelineExport onExport={onExport} onTroubleshoot={onTroubleshoot} resources={resources} /></DialogContent></Dialog>;
}
