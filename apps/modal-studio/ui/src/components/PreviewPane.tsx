/**
 * [INPUT]: 依赖选中任务详情（modal.task.get）、生成产物（modal.generation.complete）、运行参数（modal.task.params）、持久日志（modal.task.logs）、shadcn Badge/Button/Progress 与 recut.media.preview 全屏预览
 * [OUTPUT]: Right 面板：任务头（状态/取消）+ 生成预览（按 output.kind 渲染图片/视频/音频；图片可全屏预览并含「以此为参考图运行」「重新调整参数」入口）+ **常驻「运行参数」section（始终回显全部参数；参考素材按真实类型渲染——图带尺寸标注、点击经 asset modal 全屏预览，视频/音频内联播放，多类型时按 参考图/参考视频/参考音频 分组）** + **常驻「运行日志」section（成功任务同样展示完整日志，不再因成功而隐藏；生成过程中新日志到达时自动贴底滚动，用户上滚查看时不打扰）**
 * [POS]: Right 的统一生产预览 / 参数 / 日志面；参数与日志各自独立成节、恒定可见
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, SlidersHorizontal, Wand2, X } from "lucide-react";
import { interpolate, t, type Locale } from "../i18n";
import { recut } from "../recut-sdk";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatDateTime, formatDuration } from "../lib/format";
import { absoluteURL, mediaContentPath, mediaContentURL } from "../lib/media";
import type { Generation, GenerationParams, LogLine, TaskDetail } from "../types";

interface Props {
  task: TaskDetail | null;
  generation: Generation | null;
  params: GenerationParams | null;
  logs: LogLine[];
  /** 日志超过单次拉取上限、仍有更早的行未载入时为 true（避免"看着像完整日志"的静默截断）。 */
  logsTruncated?: boolean;
  locale: Locale;
  onCancel: () => void;
  onSave: (generationId: string, kind: "image" | "video" | "audio") => void;
  onEdit: (generationId: string) => void;
  onRemix: (params: GenerationParams) => void;
}

const TONE: Record<string, string> = {
  completed: "border-success/40 text-success",
  failed: "border-destructive/40 text-destructive",
  cancelled: "border-destructive/40 text-destructive",
  queued: "border-warning/40 text-warning",
  running: "border-warning/40 text-warning",
};
const DOT: Record<string, string> = {
  completed: "bg-success",
  failed: "bg-destructive",
  cancelled: "bg-destructive",
  queued: "bg-warning animate-pulse",
  running: "bg-warning animate-pulse",
};
const TERMINAL = new Set(["completed", "failed", "cancelled", "interrupted"]);

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <p className="text-[11px] font-semibold text-foreground">{title}</p>
      {children}
    </section>
  );
}

function TimingCell({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] text-muted-foreground">{label}</span>
      <span className={cn("block truncate text-[11px] text-foreground", mono && "font-mono")} title={value}>{value}</span>
    </div>
  );
}

function ParamRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 break-words text-[11px] text-foreground", mono && "font-mono")}>{value}</span>
    </div>
  );
}

// 参考素材类型归一：历史任务或未知值一律按图片回落。
function referenceKind(kind?: string): "image" | "video" | "audio" {
  return kind === "video" || kind === "audio" ? kind : "image";
}

const REFERENCE_KIND_ORDER = ["image", "video", "audio"] as const;
const REFERENCE_KIND_LABEL: Record<string, string> = {
  image: "preview.params-refs-image",
  video: "preview.params-refs-video",
  audio: "preview.params-refs-audio",
};

// 参考素材缩略：按真实类型渲染——图片给缩略图（点击经宿主 asset modal 全屏预览，图下标注真实像素尺寸，
// 排查「输入图过小」一类失败时一眼就能看到输入到底是什么）；视频给静音首帧；音频给可播放控件。
// 宿主的全屏预览（image.preview → ImageLightbox）只认图片，故视频/音频只内联播放、不走上层预览。
function RefMedia({ id, name, kind, locale }: { id: string; name?: string; kind?: string; locale: Locale }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const resolved = referenceKind(kind);
  if (resolved === "audio") {
    return (
      <div className="grid w-56 gap-1">
        <audio className="h-9 w-full" src={mediaContentPath(id)} controls preload="metadata" />
        <span className="truncate text-center font-mono text-[9px] text-muted-foreground" title={name || id}>{name || id}</span>
      </div>
    );
  }
  if (resolved === "video") {
    return (
      <div className="grid w-24 gap-1">
        <video className="h-14 w-24 rounded-md border bg-muted object-cover" src={mediaContentPath(id)} controls muted playsInline preload="metadata" />
        <span className="truncate text-center font-mono text-[9px] text-muted-foreground" title={name || id}>{name || id}</span>
      </div>
    );
  }
  const label = size ? `${size.w}×${size.h}` : name || id;
  return (
    <div className="grid w-14 gap-1">
      <button
        type="button"
        className="size-14 cursor-zoom-in overflow-hidden rounded-md border bg-muted"
        onClick={() => void recut.media.preview(mediaContentURL(id), { name: name || id })}
        title={t(locale, "preview.preview-image")}
      >
        <img
          className="size-full object-cover"
          src={mediaContentPath(id)}
          alt={name || id}
          onLoad={(event) => setSize({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
        />
      </button>
      <span className="truncate text-center font-mono text-[9px] text-muted-foreground" title={label}>{label}</span>
    </div>
  );
}

function ParamsPanel({ params, locale }: { params: GenerationParams | null; locale: Locale }) {
  if (!params) return null;
  const missing = params.referenceAssetIds.filter((item) => item.available === false).length;
  const entries = Object.entries(params.values ?? {});
  // 按类型分组（图/视频/音频），只保留非空组：参考音频不再被归到「参考图」下。
  const referenceGroups = REFERENCE_KIND_ORDER
    .map((kind) => ({ kind, items: params.referenceAssetIds.filter((item) => referenceKind(item.kind) === kind) }))
    .filter((group) => group.items.length > 0);
  return (
    <div className="grid gap-2 rounded-lg border border-border/70 bg-secondary/30 p-3">
      <ParamRow label={t(locale, "preview.params-model")} value={`${params.modalapp} / ${params.function}`} />
      {params.gpuTier ? <ParamRow label={t(locale, "preview.params-gpu")} value={params.gpuTier} /> : null}
      {entries.length === 0 ? (
        <span className="text-[11px] text-muted-foreground">{t(locale, "preview.params-refs-none")}</span>
      ) : (
        entries.map(([key, value]) => <ParamRow key={key} label={key} value={String(value)} mono={false} />)
      )}
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
        <span className="text-[10px] text-muted-foreground">{t(locale, "preview.params-refs")}</span>
        {params.referenceAssetIds.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">{t(locale, "preview.params-refs-none")}</span>
        ) : (
          <div className="grid gap-1.5">
            {referenceGroups.map(({ kind, items }) => (
              <div key={kind} className="grid gap-1">
                {/* 只有多种类型同时存在时才逐类标注，纯图片任务不额外加一层标签。 */}
                {referenceGroups.length > 1 ? <span className="text-[10px] text-muted-foreground">{t(locale, REFERENCE_KIND_LABEL[kind])}</span> : null}
                <div className="flex flex-wrap items-start gap-2">
                  {items.map((item) => (
                    item.available === false ? (
                      <div key={item.id} className="grid w-14 gap-1 opacity-40">
                        <div className="grid size-14 place-items-center rounded-md border bg-muted px-1 text-center text-[9px] text-muted-foreground">{t(locale, "preview.params-refs-none")}</div>
                        <span className="truncate text-center font-mono text-[9px] text-muted-foreground" title={item.id}>{item.id}</span>
                      </div>
                    ) : (
                      <RefMedia key={item.id} id={item.id} name={item.name} kind={item.kind} locale={locale} />
                    )
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {missing > 0 ? <p className="text-[10px] text-warning">{interpolate(t(locale, "preview.params-refs-missing"), { count: missing })}</p> : null}
    </div>
  );
}

/**
 * 运行日志面板：新日志到达时自动贴住底部（生成过程中始终能看到最新一行）。
 *
 * 只在「用户没有主动往上滚」时自动滚动——否则会一边看历史一边被拽回底部。
 * 判断依据是滚动位置距底部的距离；切换任务时重置为「贴底」。
 */
function LogsPanel({ logs, locale, truncated, taskKey }: { logs: LogLine[]; locale: Locale; truncated?: boolean; taskKey?: string }) {
  const preRef = useRef<HTMLPreElement | null>(null);
  const stick = useRef(true);

  const handleScroll = () => {
    const el = preRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  // 切换任务 → 回到「贴底」（effects 按声明顺序执行，先重置再滚动）。
  useEffect(() => { stick.current = true; }, [taskKey]);
  useEffect(() => {
    const el = preRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [logs, taskKey]);

  return (
    <div className="rounded-lg border bg-terminal p-3 font-mono text-[11px] leading-5 text-terminal-fg">
      {logs.length === 0 ? (
        <span className="text-muted-foreground">{t(locale, "preview.no-logs")}</span>
      ) : (
        <>
          <pre ref={preRef} onScroll={handleScroll} className="max-h-[60vh] overflow-auto whitespace-pre-wrap">
            {logs.map((line, index) => (
              <div key={index} className={line.level === "error" ? "text-destructive" : line.level === "ok" ? "text-success" : line.level === "warn" ? "text-warning" : ""}>
                <span className="mr-2 text-muted-foreground">[{line.level}]</span>{line.message}
              </div>
            ))}
          </pre>
          {truncated ? <p className="mt-1 text-warning">{interpolate(t(locale, "preview.logs-truncated"), { count: String(logs.length) })}</p> : null}
        </>
      )}
    </div>
  );
}

function OutputPreview({ generation, locale, onEdit }: { generation: Generation; locale: Locale; onEdit: (id: string) => void }) {
  const url = absoluteURL(generation.outputURL);
  if (generation.outputKind === "video") {
    return <video className="mx-auto max-h-[60vh] w-auto rounded-lg border bg-terminal" src={url} controls />;
  }
  if (generation.outputKind === "audio") {
    return <audio className="w-full" src={url} controls />;
  }
  return (
    <div className="group relative overflow-hidden rounded-lg border bg-terminal">
      <button
        type="button"
        className="block w-full cursor-zoom-in"
        onClick={() => void recut.media.preview(url, { name: generation.modalapp })}
        title={t(locale, "preview.preview-image")}
      >
        <img className="mx-auto max-h-[60vh] w-auto" src={generation.outputURL} alt="generated" />
      </button>
      <Button
        variant="outline"
        size="sm"
        className="absolute right-2 top-2 bg-card/90 shadow-sm backdrop-blur-sm"
        onClick={() => onEdit(generation.id)}
      >
        <Wand2 className="size-3.5" />{t(locale, "preview.edit")}
      </Button>
    </div>
  );
}

export function PreviewPane({ task, generation, params, logs, logsTruncated, locale, onCancel, onSave, onEdit, onRemix }: Props) {
  const running = task?.state === "running";
  const now = useNow(running);

  if (!task) {
    return (
      <div className="grid h-full min-h-72 place-items-center rounded-lg border border-dashed text-center text-xs text-muted-foreground">
        {t(locale, "preview.empty")}
      </div>
    );
  }
  const busy = task.state === "queued" || task.state === "running";
  const terminal = TERMINAL.has(task.state);
  const showOutput = task.action === "generate" && task.state === "completed" && generation;
  const showParams = task.action === "generate";
  const startIso = task.startedAt || null;
  const endIso = terminal ? task.resolvedAt || null : null;
  const seconds = startIso ? Math.max(0, ((terminal && endIso ? Date.parse(endIso) : now) - Date.parse(startIso)) / 1000) : null;

  return (
    <div className="grid gap-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn("size-2 shrink-0 rounded-full", DOT[task.state] ?? "bg-muted-foreground")} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{task.name || task.action}</span>
        <Badge variant="outline" className={TONE[task.state] ?? "text-muted-foreground"}>{t(locale, `state.${task.state}`)}</Badge>
        <Button variant="ghost" size="sm" disabled={!busy} onClick={onCancel}>
          <X className="size-3.5" />{t(locale, "preview.cancel")}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-lg border border-border/70 bg-secondary/30 p-2.5">
        <TimingCell label={t(locale, "timing.start")} value={startIso ? formatDateTime(startIso) : task.state === "queued" ? t(locale, "timing.pending") : "—"} />
        <TimingCell label={t(locale, "timing.end")} value={terminal ? formatDateTime(endIso) : running ? t(locale, "timing.running") : "—"} />
        <TimingCell label={t(locale, "timing.duration")} value={seconds === null ? "—" : formatDuration(seconds)} />
      </div>

      {busy ? <Progress value={task.progress ?? (task.state === "running" ? 45 : 8)} /> : null}

      {showOutput ? (
        <div className="grid gap-3">
          <OutputPreview generation={generation} locale={locale} onEdit={onEdit} />
          <p className="font-mono text-[11px] text-muted-foreground">
            {interpolate(t(locale, "preview.meta"), {
              model: generation.modalapp,
              function: generation.function,
              gpu: generation.gpuTier || "—",
              width: generation.width,
              height: generation.height,
              duration: generation.duration,
            })}
          </p>
          <Button disabled={!!generation.savedAssetId} onClick={() => onSave(generation.id, generation.outputKind)}>
            <Download className="size-3.5" />
            {generation.savedAssetId ? t(locale, "preview.saved") : t(locale, "preview.save")}
          </Button>
        </div>
      ) : null}

      {/* 参数节恒定存在（生成任务）：完整回显提交时的全部参数与参考图，不再被日志挤到视野之外。 */}
      {showParams ? (
        <Section title={t(locale, "preview.params")}>
          {params ? (
            <ParamsPanel params={params} locale={locale} />
          ) : (
            <p className="text-[11px] text-muted-foreground">{t(locale, "preview.params-empty")}</p>
          )}
          {params ? (
            <Button variant="outline" onClick={() => onRemix(params)}>
              <SlidersHorizontal className="size-3.5" />{t(locale, "preview.remix")}
            </Button>
          ) : null}
        </Section>
      ) : null}

      {/* 日志节恒定存在：成功任务同样给出完整日志，与产物/参数并存。 */}
      <Section title={t(locale, "preview.logs")}>
        <LogsPanel logs={logs} locale={locale} truncated={logsTruncated} taskKey={task.id} />
      </Section>
    </div>
  );
}
