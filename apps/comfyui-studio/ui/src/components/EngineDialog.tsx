/**
 * [INPUT]: 依赖 comfy.engine.logs（server.log 尾部）、comfy.engine.start/stop、shadcn Dialog/Badge/Button、lucide 图标与 i18n
 * [OUTPUT]: 「ComfyUI 引擎」模态框：实时状态（运行/停止/启动中、端口、PID）+ 启动/关闭（进行中与失败反馈）+ 引擎实时日志（打开期间每 2s 轮询）
 * [POS]: App 头部的引擎管理面；用 shadcn Dialog 承载遮罩与进出场，动作完成后回调刷新目录与任务
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, RefreshCw, Square } from "lucide-react";
import { interpolate, t, type Locale } from "../i18n";
import { recut } from "../recut-sdk";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { EngineLogs, EngineStatus } from "../types";

interface Props {
  open: boolean;
  locale: Locale;
  status: EngineStatus | null;
  starting: boolean;
  onClose: () => void;
  onChanged: () => void;
}

function StatusCell({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] text-muted-foreground">{label}</span>
      <span className={cn("block truncate text-[11px] text-foreground", mono && "font-mono")} title={value}>{value}</span>
    </div>
  );
}

export function EngineDialog({ open, locale, status, starting, onClose, onChanged }: Props) {
  const [logs, setLogs] = useState<string[]>([]);
  const [logPath, setLogPath] = useState("");
  const [busy, setBusy] = useState<"" | "start" | "stop">("");
  const [error, setError] = useState("");
  const logRef = useRef<HTMLPreElement>(null);
  const pinnedRef = useRef(true);

  const call = useCallback(
    <T,>(name: string, input: Record<string, unknown> = {}) => recut.background.call(name, input) as Promise<T>,
    [],
  );

  const refreshLogs = useCallback(async () => {
    try {
      const result = await call<EngineLogs>("comfy.engine.logs", { lines: 200 });
      setLogs(result.lines ?? []);
      setLogPath(result.path ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [call]);

  useEffect(() => {
    if (!open) return;
    void refreshLogs();
    const timer = window.setInterval(() => void refreshLogs(), 2000);
    return () => window.clearInterval(timer);
  }, [open, refreshLogs]);

  // 贴底时才自动滚动，避免用户回看历史日志时被拽走。
  useEffect(() => {
    const node = logRef.current;
    if (node && pinnedRef.current) node.scrollTop = node.scrollHeight;
  }, [logs]);

  const run = async (action: "start" | "stop") => {
    setBusy(action);
    setError("");
    try {
      await call(action === "start" ? "comfy.engine.start" : "comfy.engine.stop");
      onChanged();
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setError(interpolate(t(locale, action === "start" ? "engine.start-failed" : "engine.stop-failed"), { error: detail }));
    } finally {
      setBusy("");
      await refreshLogs();
    }
  };

  const running = status?.running === true;
  const stateText = starting ? t(locale, "engine.starting") : running ? t(locale, "engine.running") : t(locale, "engine.stopped");
  const pending = busy !== "";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(locale, "engine.name")}</DialogTitle>
          <Badge variant="outline" className={cn("gap-1.5", starting ? "text-warning" : running ? "text-success" : "text-muted-foreground")}>
            <span className={cn("size-1.5 rounded-full", starting ? "bg-warning animate-pulse" : running ? "bg-success" : "bg-muted-foreground")} />
            {stateText}
          </Badge>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto p-5">
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-border/70 bg-secondary/30 p-2.5">
            <StatusCell label={t(locale, "engine.panel-state")} value={stateText} mono={false} />
            <StatusCell label={t(locale, "engine.panel-port")} value={status?.port ? String(status.port) : t(locale, "engine.panel-none")} />
            <StatusCell label={t(locale, "engine.panel-pid")} value={status?.pid || t(locale, "engine.panel-none")} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={pending || starting || running} onClick={() => void run("start")}>
              {busy === "start" ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {t(locale, "engine.start")}
            </Button>
            <Button size="sm" variant="outline" disabled={pending || starting || !running} onClick={() => void run("stop")}>
              {busy === "stop" ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
              {t(locale, "engine.stop")}
            </Button>
            {pending || starting ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
          </div>

          {error ? <p className="mt-2 break-all text-[11px] text-destructive">{error}</p> : null}
          <DialogDescription className="mt-2 text-[10px] leading-4">{t(locale, "engine.panel-hint")}</DialogDescription>

          <div className="mt-4 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-foreground">{t(locale, "engine.logs")}</span>
              <span className="text-[10px] text-muted-foreground">{t(locale, "engine.logs-hint")}</span>
              <span className="flex-1" />
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => void refreshLogs()}>
                <RefreshCw className="size-3.5" />{t(locale, "engine.logs-refresh")}
              </Button>
            </div>
            {logPath ? (
              <p className="truncate font-mono text-[10px] text-muted-foreground" title={logPath}>
                {t(locale, "engine.logs-file")}: {logPath}
              </p>
            ) : null}
            <pre
              ref={logRef}
              onScroll={(event) => {
                const node = event.currentTarget;
                pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
              }}
              className="max-h-72 overflow-auto rounded-lg border border-border/70 bg-terminal p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap text-terminal-fg"
            >
              {logs.length
                ? logs.map((line, index) => (
                  <div key={index} className={line.startsWith("[ERROR]") || line.includes("Error:") ? "text-destructive" : line.startsWith("[WARNING]") ? "text-warning" : ""}>{line}</div>
                ))
                : <span className="text-muted-foreground">{t(locale, "engine.logs-empty")}</span>}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
