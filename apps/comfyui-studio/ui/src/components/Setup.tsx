/**
 * [INPUT]: 依赖共享视觉原子、lucide 图标、i18n 与任务日志行
 * [OUTPUT]: 启动门 Setup 卡：环境未就绪时自动触发一次全量 comfy.prepare，展示计时、实时日志与失败重试
 * [POS]: ComfyUI 工作台的启动门；catalog.ready 之前整屏渲染此卡
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useEffect, useRef } from "react";
import { AlertTriangle, Clock3, Download, Loader2 } from "lucide-react";
import { interpolate, t, type Locale } from "../i18n";
import { Button, Card } from "../ui";
import type { LogLine } from "../types";

interface Props {
  locale: Locale;
  autoPrepare: boolean;
  busy: boolean;
  elapsedSeconds: number;
  failure: string;
  failureLogs: LogLine[];
  logs: LogLine[];
  message: string;
  onPrepare: () => void;
}

function formatElapsed(total: number): string {
  const seconds = Math.max(0, Math.floor(total));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function logClass(level: string): string {
  if (level === "error") return "text-destructive";
  if (level === "warn") return "text-warning";
  if (level === "ok") return "text-success";
  return "text-muted-foreground";
}

function LogBlock({ logs, locale, ariaLabel }: { logs: LogLine[]; locale: Locale; ariaLabel: string }) {
  return (
    <pre aria-label={ariaLabel} className="max-h-56 overflow-auto rounded-md border border-border/70 bg-secondary/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
      {logs.length
        ? logs.map((entry, index) => <div key={index} className={logClass(entry.level)}>{entry.message}</div>)
        : <span className="text-muted-foreground">{t(locale, "setup.logs-empty")}</span>}
    </pre>
  );
}

export function Setup({ locale, autoPrepare, busy, elapsedSeconds, failure, failureLogs, logs, message, onPrepare }: Props) {
  const started = useRef(false);
  useEffect(() => {
    if (autoPrepare && !started.current) {
      started.current = true;
      onPrepare();
    }
  }, [autoPrepare, onPrepare]);

  return (
    <main className="grid min-h-screen place-items-center p-4 sm:p-6">
      <Card className="w-full max-w-lg p-5">
        <div className="mb-3 grid size-10 place-items-center rounded-md border border-primary/40 bg-primary/10 text-primary">
          <Loader2 className={`size-5 ${busy ? "animate-spin" : ""}`} />
        </div>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">{t(locale, "setup.title")}</h1>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(locale, "setup.description")}</p>

        <div className="mt-4 space-y-3">
          {busy ? (
            <>
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-primary">
                <Clock3 className="size-3.5" />
                {interpolate(t(locale, "setup.running"), { time: formatElapsed(elapsedSeconds) })}
              </div>
              <LogBlock logs={logs} locale={locale} ariaLabel={t(locale, "setup.logs-label")} />
            </>
          ) : null}

          {failure ? (
            <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3.5" />{t(locale, "setup.failure-title")}</div>
              <p className="break-all leading-relaxed">{failure}</p>
              {failureLogs.length ? <LogBlock logs={failureLogs} locale={locale} ariaLabel={t(locale, "setup.failure-logs-label")} /> : null}
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col items-start gap-2">
          <Button variant="outline" disabled={busy} onClick={onPrepare}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {busy ? t(locale, "setup.preparing") : t(locale, "setup.retry")}
          </Button>
          <p className="text-[11px] leading-4 text-muted-foreground" role="status">{message}</p>
        </div>
      </Card>
    </main>
  );
}
