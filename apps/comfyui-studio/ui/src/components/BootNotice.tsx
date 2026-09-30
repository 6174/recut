/**
 * [INPUT]: 依赖 shadcn Button、lucide 图标与 i18n
 * [OUTPUT]: 首屏探测状态卡：宿主未连接 / 正在读取目录 / 读取失败（含错误原因与重试），并显示已用时与探测次数
 * [POS]: App 首屏的非阻塞替代品；取代原先的整屏 spinner，保证进入工作台时没有无法感知的等待
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { interpolate, t, type Locale } from "../i18n";
import { Button } from "@/components/ui/button";

interface Props {
  locale: Locale;
  connected: boolean;
  phase: "loading" | "error";
  elapsedSeconds: number;
  attempts: number;
  error: string;
  onRetry: () => void;
}

function formatElapsed(total: number): string {
  const seconds = Math.max(0, Math.floor(total));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function BootNotice({ locale, connected, phase, elapsedSeconds, attempts, error, onRetry }: Props) {
  const waiting = !connected;
  const failed = connected && phase === "error";
  const title = waiting ? t(locale, "boot.connecting") : failed ? t(locale, "boot.error-title") : t(locale, "boot.probing");
  const hint = waiting ? t(locale, "boot.connecting-hint") : failed ? t(locale, "boot.error-hint") : t(locale, "boot.probing-hint");
  // 探测超过 15s 也给出重试入口：长等待必须有出口（未连接时给的是刷新页面，不是空按钮）。
  const showRetry = connected && (failed || elapsedSeconds >= 15);

  return (
    <div className="grid min-h-40 place-items-center px-4 py-10">
      <div className="grid max-w-sm justify-items-center gap-3 text-center">
        {failed
          ? <AlertTriangle className="size-5 text-warning" />
          : <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        <div className="grid gap-1">
          <p className="text-xs font-semibold text-foreground">{title}</p>
          <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p>
        </div>
        {failed ? <p className="max-w-full break-all text-[11px] leading-4 text-destructive">{error}</p> : null}
        <p className="font-mono text-[11px] text-muted-foreground">
          {interpolate(t(locale, "boot.elapsed"), { time: formatElapsed(elapsedSeconds) })}
          {attempts > 1 ? ` · ${interpolate(t(locale, "boot.attempt"), { count: attempts })}` : ""}
        </p>
        {showRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="size-3.5" />{t(locale, "boot.retry")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
