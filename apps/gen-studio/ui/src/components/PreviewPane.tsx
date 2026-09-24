/**
 * [INPUT]: 依赖选中任务详情（gen.task.get）、生成产物（gen.generation.complete）、生成参数（gen.task.params）与持久日志（gen.task.logs）
 * [OUTPUT]: Right 面板：任务头（状态/取消）+ 生成预览（含「以此为参考图编辑」「重新调整参数」入口）与生成参数回显 + 入库 / 环境下载实时日志
 * [POS]: Right 的统一生产预览与进度日志面
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useEffect, useState } from "react";
import { Download, ImageIcon, SlidersHorizontal, Wand2, X } from "lucide-react";
import { interpolate, t, type Locale } from "../i18n";
import { Badge, Button, Progress, StatusDot } from "../ui";
import { formatDateTime, formatDuration } from "../lib/format";
import type { Generation, GenerationParams, LogLine, TaskDetail } from "../types";

interface Props {
  task: TaskDetail | null;
  generation: Generation | null;
  params: GenerationParams | null;
  logs: LogLine[];
  locale: Locale;
  onCancel: () => void;
  onSave: (generationId: string) => void;
  onEdit: (generationId: string) => void;
  onRemix: (params: GenerationParams) => void;
}

const TONE: Record<string, "success" | "destructive" | "warning" | "muted"> = {
  completed: "success",
  failed: "destructive",
  cancelled: "destructive",
  queued: "warning",
  running: "warning",
};
const DOT: Record<string, "idle" | "active" | "success" | "error"> = {
  completed: "success",
  failed: "error",
  cancelled: "error",
  queued: "active",
  running: "active",
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

function TimingCell({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] text-muted-foreground">{label}</span>
      <span className={`block truncate text-[11px] text-foreground ${mono ? "font-mono" : ""}`} title={value}>{value}</span>
    </div>
  );
}

function ParamRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={`min-w-0 break-words text-[11px] text-foreground ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function ParamsPanel({ params, locale }: { params: GenerationParams | null; locale: Locale }) {
  if (!params) return null;
  const missing = params.referenceAssetIds.filter((item) => item.available === false).length;
  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-secondary/30 p-3">
      <p className="text-[11px] font-semibold text-foreground">{t(locale, "preview.params")}</p>
      <ParamRow label={t(locale, "preview.params-model")} value={params.model} />
      <ParamRow label={t(locale, "preview.params-prompt")} value={params.prompt || "—"} mono={false} />
      <ParamRow label={t(locale, "preview.params-negative")} value={params.negativePrompt || "—"} mono={false} />
      <ParamRow label={t(locale, "preview.params-aspect")} value={params.aspectRatio || "—"} />
      <ParamRow label={t(locale, "preview.params-seed")} value={params.seed === "" ? "—" : params.seed} />
      <ParamRow label={t(locale, "preview.params-steps")} value={params.steps === "" ? "—" : params.steps} />
      <ParamRow label={t(locale, "preview.params-cfg")} value={params.cfg === "" ? "—" : params.cfg} />
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
        <span className="text-[10px] text-muted-foreground">{t(locale, "preview.params-refs")}</span>
        {params.referenceAssetIds.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">{t(locale, "preview.params-refs-none")}</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {params.referenceAssetIds.map((item) => (
              <div key={item.id} className={`relative size-12 overflow-hidden rounded-md border bg-muted ${item.available === false ? "opacity-40" : ""}`}>
                <img className="size-full object-cover" src={`/v1/media/assets/${encodeURIComponent(item.id)}/content`} alt={item.name || item.id} title={item.name || item.id} />
              </div>
            ))}
          </div>
        )}
      </div>
      {missing > 0 ? <p className="text-[10px] text-warning">{interpolate(t(locale, "preview.params-refs-missing"), { count: missing })}</p> : null}
    </div>
  );
}

export function PreviewPane({ task, generation, params, logs, locale, onCancel, onSave, onEdit, onRemix }: Props) {
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
  const showImage = task.action === "generate" && task.state === "completed" && generation;
  const showParams = task.action === "generate";
  const startIso = task.startedAt || null;
  const endIso = terminal ? task.resolvedAt || null : null;
  const seconds = startIso ? Math.max(0, ((terminal && endIso ? Date.parse(endIso) : now) - Date.parse(startIso)) / 1000) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <StatusDot tone={DOT[task.state] ?? "idle"} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{task.name || task.action}</span>
        <Badge tone={TONE[task.state] ?? "muted"}>{t(locale, `state.${task.state}`)}</Badge>
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

      {showImage ? (
        <div className="space-y-3">
          <div className="group relative overflow-hidden rounded-lg border bg-terminal">
            <img className="mx-auto max-h-[60vh] w-auto" src={generation.outputURL} alt="generated" />
            <Button
              variant="outline"
              size="sm"
              className="absolute right-2 top-2 bg-card/90 shadow-sm backdrop-blur-sm"
              onClick={() => onEdit(generation.id)}
            >
              <Wand2 className="size-3.5" />{t(locale, "preview.edit")}
            </Button>
          </div>
          <p className="font-mono text-[11px] text-muted-foreground">
            {interpolate(t(locale, "preview.meta"), {
              model: generation.model,
              width: generation.width,
              height: generation.height,
              seed: generation.seed,
              steps: generation.steps,
              duration: generation.duration,
            })}
          </p>
          <Button disabled={!!generation.savedAssetId} onClick={() => onSave(generation.id)}>
            <Download className="size-3.5" />
            {generation.savedAssetId ? t(locale, "preview.saved") : t(locale, "preview.save")}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border bg-terminal p-3 font-mono text-[11px] leading-5 text-terminal-fg">
          {logs.length === 0 ? (
            <span className="text-muted-foreground">{t(locale, "preview.no-logs")}</span>
          ) : (
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap">
              {logs.map((line, index) => (
                <div key={index} className={line.level === "error" ? "text-destructive" : line.level === "ok" ? "text-success" : line.level === "warn" ? "text-warning" : ""}>
                  <span className="mr-2 text-muted-foreground">[{line.level}]</span>{line.message}
                </div>
              ))}
            </pre>
          )}
        </div>
      )}

      {showParams ? (
        <>
          <ParamsPanel params={params} locale={locale} />
          {params ? (
            <Button variant="outline" onClick={() => onRemix(params)}>
              <SlidersHorizontal className="size-3.5" />{t(locale, "preview.remix")}
            </Button>
          ) : terminal ? (
            <p className="text-[11px] text-muted-foreground">{t(locale, "preview.params-empty")}</p>
          ) : null}
        </>
      ) : null}

      {!showImage && task.action === "generate" && task.state !== "completed" ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><ImageIcon className="size-3.5" />{t(locale, "preview.title")}</p>
      ) : null}
    </div>
  );
}
