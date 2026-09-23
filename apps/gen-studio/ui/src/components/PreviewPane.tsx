/**
 * [INPUT]: 依赖选中任务详情（gen.task.get）、生成产物（gen.generation.complete）与持久日志（gen.task.logs）
 * [OUTPUT]: Right 面板：任务头（状态/取消）+ 生成预览与入库 / 环境下载实时日志
 * [POS]: Right 的统一生产预览与进度日志面
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Download, ImageIcon, X } from "lucide-react";
import { interpolate, t, type Locale } from "../i18n";
import { Badge, Button, Progress, StatusDot } from "../ui";
import type { Generation, LogLine, TaskDetail } from "../types";

interface Props {
  task: TaskDetail | null;
  generation: Generation | null;
  logs: LogLine[];
  locale: Locale;
  onCancel: () => void;
  onSave: (generationId: string) => void;
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

export function PreviewPane({ task, generation, logs, locale, onCancel, onSave }: Props) {
  if (!task) {
    return (
      <div className="grid h-full min-h-72 place-items-center rounded-lg border border-dashed text-center text-xs text-muted-foreground">
        {t(locale, "preview.empty")}
      </div>
    );
  }
  const busy = task.state === "queued" || task.state === "running";
  const showImage = task.action === "generate" && task.state === "completed" && generation;

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

      {busy ? <Progress value={task.progress ?? (task.state === "running" ? 45 : 8)} /> : null}

      {showImage ? (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-lg border bg-terminal">
            <img className="mx-auto max-h-[60vh] w-auto" src={generation.outputURL} alt="generated" />
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

      {!showImage && task.action === "generate" && task.state !== "completed" ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><ImageIcon className="size-3.5" />{t(locale, "preview.title")}</p>
      ) : null}
    </div>
  );
}
