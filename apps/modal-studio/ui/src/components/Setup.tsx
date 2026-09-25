/**
 * [INPUT]: 依赖共享视觉原子、lucide 图标、i18n 与任务日志行
 * [OUTPUT]: 启动门：本机环境未就绪时自动触发一次 modal.prepare（mode=env）；环境就绪但未配置 token 时渲染 token 表单（mode=token，写入 profile 并验证连接）
 * [POS]: Modal 云函数的启动门；环境或连接未就绪时整屏渲染此卡
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Clock3, KeyRound, Loader2 } from "lucide-react";
import { interpolate, t, type Locale } from "../i18n";
import { Button, Card, Field, Input } from "../ui";
import type { LogLine } from "../types";

interface Props {
  locale: Locale;
  mode: "env" | "token";
  busy: boolean;
  elapsedSeconds: number;
  failure: string;
  failureLogs: LogLine[];
  logs: LogLine[];
  onPrepare: () => void;
  onConnect: (name: string, tokenId: string, tokenSecret: string) => Promise<void>;
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

function EnvGate({ locale, busy, elapsedSeconds, failure, failureLogs, logs, onPrepare }: Omit<Props, "mode" | "onConnect">) {
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      onPrepare();
    }
  }, [onPrepare]);

  return (
    <>
      <div className="mb-3 grid size-10 place-items-center rounded-md border border-primary/40 bg-primary/10 text-primary">
        <Loader2 className={`size-5 ${busy ? "animate-spin" : ""}`} />
      </div>
      <h1 className="mt-1 text-lg font-semibold tracking-tight">{t(locale, "setup.env-title")}</h1>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(locale, "setup.env-description")}</p>
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
      <div className="mt-4">
        <Button variant="outline" disabled={busy} onClick={onPrepare}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Clock3 className="size-4" />}
          {busy ? t(locale, "setup.preparing") : t(locale, "setup.retry")}
        </Button>
      </div>
    </>
  );
}

function TokenGate({ locale, busy, failure, onConnect }: Pick<Props, "locale" | "busy" | "failure" | "onConnect">) {
  const [name, setName] = useState("default");
  const [tokenId, setTokenId] = useState("");
  const [tokenSecret, setTokenSecret] = useState("");
  const [localError, setLocalError] = useState("");

  const connect = async () => {
    setLocalError("");
    if (!tokenId.trim() || !tokenSecret.trim()) {
      setLocalError(t(locale, "setup.failed").replace("{error}", "tokenId / tokenSecret"));
      return;
    }
    try {
      await onConnect(name.trim() || "default", tokenId.trim(), tokenSecret.trim());
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <div className="mb-3 grid size-10 place-items-center rounded-md border border-primary/40 bg-primary/10 text-primary">
        <KeyRound className="size-5" />
      </div>
      <h1 className="mt-1 text-lg font-semibold tracking-tight">{t(locale, "setup.title")}</h1>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(locale, "setup.description")}</p>

      <div className="mt-4 space-y-3">
        <Field label={t(locale, "setup.token-name")}>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="default" />
        </Field>
        <Field label={t(locale, "setup.token-id")}>
          <Input value={tokenId} onChange={(event) => setTokenId(event.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label={t(locale, "setup.token-secret")}>
          <Input type="password" value={tokenSecret} onChange={(event) => setTokenSecret(event.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <p className="text-[11px] leading-4 text-muted-foreground">{t(locale, "setup.hint")}</p>
        {failure || localError ? (
          <div className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span className="break-all leading-relaxed">{interpolate(t(locale, "setup.failed"), { error: localError || failure })}</span>
          </div>
        ) : null}
      </div>

      <div className="mt-4">
        <Button disabled={busy} onClick={() => void connect()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          {busy ? t(locale, "setup.verifying") : t(locale, "setup.verify")}
        </Button>
      </div>
    </>
  );
}

export function Setup(props: Props) {
  return (
    <main className="grid min-h-screen place-items-center p-4 sm:p-6">
      <Card className="w-full max-w-lg p-5">
        {props.mode === "env" ? <EnvGate {...props} /> : <TokenGate {...props} />}
      </Card>
    </main>
  );
}
