/**
 * [INPUT]: 依赖 ComfyUI 引擎状态（comfy.engine.status）、共享视觉原子、lucide 图标与 i18n
 * [OUTPUT]: 顶栏右侧的 ComfyUI 核心引擎状态灯与启动/关闭控制
 * [POS]: App 头部的引擎控制面；只负责展示与触发，状态由 App 轮询
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Loader2, Play, Square } from "lucide-react";
import { interpolate, t, type Locale } from "../i18n";
import { Button } from "../ui";
import type { EngineStatus } from "../types";

interface Props {
  locale: Locale;
  status: EngineStatus | null;
  starting: boolean;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function EngineControl({ locale, status, starting, busy, onStart, onStop }: Props) {
  const running = status?.running === true;
  const dot = starting ? "bg-warning animate-pulse" : running ? "bg-success" : "bg-muted-foreground";
  const stateText = starting ? t(locale, "engine.starting") : running ? t(locale, "engine.running") : t(locale, "engine.stopped");

  return (
    <div className="flex shrink-0 items-center gap-2.5 rounded-lg border border-border/70 bg-card px-3 py-2">
      <span className={`size-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 leading-tight">
        <div className="text-xs font-semibold text-foreground">{t(locale, "engine.name")}</div>
        <div className="text-[10px] text-muted-foreground">
          {stateText}{status?.port ? ` · ${interpolate(t(locale, "engine.port"), { port: status.port })}` : ""}
        </div>
      </div>
      {running ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={onStop}>
          <Square className="size-3.5" />{t(locale, "engine.stop")}
        </Button>
      ) : (
        <Button size="sm" disabled={busy} onClick={onStart}>
          {starting ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          {starting ? t(locale, "engine.starting") : t(locale, "engine.start")}
        </Button>
      )}
    </div>
  );
}
