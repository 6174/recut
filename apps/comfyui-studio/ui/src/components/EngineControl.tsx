/**
 * [INPUT]: 依赖 ComfyUI 引擎状态（comfy.engine.status）、shadcn Badge/Button、lucide 图标与 i18n
 * [OUTPUT]: 顶栏右侧的 ComfyUI 引擎状态灯；点击打开「ComfyUI 引擎」管理面板（启动/关闭与实时日志都在面板内）
 * [POS]: App 头部的引擎入口；只负责展示与触发，状态由 App 轮询
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Settings2 } from "lucide-react";
import { interpolate, t, type Locale } from "../i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EngineStatus } from "../types";

interface Props {
  locale: Locale;
  status: EngineStatus | null;
  starting: boolean;
  onOpen: () => void;
}

export function EngineControl({ locale, status, starting, onOpen }: Props) {
  const running = status?.running === true;
  const dot = starting ? "bg-warning animate-pulse" : running ? "bg-success" : "bg-muted-foreground";
  const stateText = starting ? t(locale, "engine.starting") : running ? t(locale, "engine.running") : t(locale, "engine.stopped");

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onOpen}
      title={t(locale, "engine.manage")}
      className="h-auto w-auto shrink-0 gap-2.5 px-3 py-2"
    >
      <span className={cn("size-2 shrink-0 rounded-full", dot)} />
      <span className="grid min-w-0 text-left leading-tight">
        <span className="text-xs font-semibold text-foreground">{t(locale, "engine.name")}</span>
        <span className="text-[10px] font-normal text-muted-foreground">
          {stateText}{status?.port ? ` · ${interpolate(t(locale, "engine.port"), { port: status.port })}` : ""}
        </span>
      </span>
      <Settings2 className="size-3.5 shrink-0 text-muted-foreground" />
    </Button>
  );
}
