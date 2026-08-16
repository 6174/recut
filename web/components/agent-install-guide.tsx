/*
 * [INPUT]: 依赖 React 状态能力、lucide 图标与本地 Recut service /v1/agents HTTP API
 * [OUTPUT]: 对外提供 AgentRuntimeStatus 与 Runtime 类型、三个 runtime 的安装命令/登录步骤、复制到剪贴板与失败兜底、SetupStep/CopyFeedback 原子，以及被恢复面板和主动安装对话框共用的 AgentInstallGuide 三步正文（受控：checking 与 checkFailed 由调用方管理）
 * [POS]: web/components 的本地 Agent CLI 安装引导共享层；面板的 recovery 模式、空态的安装卡与未来 settings 本地 Agent 分类都消费它
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Check, Copy, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";

import { t, useI18n } from "@/lib/i18n/index";
import { useLocaleStore } from "@/lib/i18n/locale-store";
import { interpolate } from "@/lib/i18n/workspace-dict";

export type AgentRuntimeStatus = { id: string; name: string; command: string; available: boolean };
export type Runtime = "codex" | "claude" | "opencode";
export const RUNTIME_ORDER: ReadonlyArray<Runtime> = ["codex", "opencode", "claude"];

export function runtimeAgentName(runtime: string): string {
  return runtime === "codex" ? "Codex" : runtime === "opencode" ? "OpenCode" : "Claude Code";
}

export function syntheticAgent(runtime: string): AgentRuntimeStatus {
  return { id: runtime, name: runtimeAgentName(runtime), command: runtime, available: false };
}

const opencodeInstallCommand = "npm install -g opencode-ai";
const opencodeLoginCommands = ["opencode auth login", "opencode --version"];

export function recoveryInstallCommand(agent: AgentRuntimeStatus): string {
  if (agent.id === "codex") return "npm install -g @openai/codex";
  if (agent.id === "opencode") return opencodeInstallCommand;
  return interpolate(
    t("workspace", useLocaleStore.getState().locale, "agent.recovery.claudeInstallDoc"),
    { name: agent.name },
  );
}

export function recoveryLoginCommands(agent: AgentRuntimeStatus): string[] {
  if (agent.id === "codex") return ["codex login", "codex --version"];
  if (agent.id === "opencode") return opencodeLoginCommands;
  return [`${agent.command} --version`];
}

export function recoveryTitle(agent: AgentRuntimeStatus, missing: boolean): string {
  const locale = useLocaleStore.getState().locale;
  if (missing) return interpolate(t("workspace", locale, "agent.recovery.title.missing"), { name: agent.name });
  return interpolate(t("workspace", locale, "agent.recovery.title.installed"), { name: agent.name });
}

export function recoverySubtitle(agent: AgentRuntimeStatus, missing: boolean): string {
  const locale = useLocaleStore.getState().locale;
  if (missing) return interpolate(t("workspace", locale, "agent.recovery.subtitle.missing"), { name: agent.name });
  return interpolate(t("workspace", locale, "agent.recovery.subtitle.installed"), { name: agent.name });
}

export async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to the textarea fallback below
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;opacity:0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied;
}

export function CopyFeedback({ status }: { status: "idle" | "copied" | "failed" }) {
  const { t: text } = useI18n();
  if (status === "idle") return null;
  return <p aria-live="polite" className={`mt-2 text-[11px] ${status === "copied" ? "text-success" : "text-destructive"}`}>{status === "copied" ? text("agent.install.copiedFeedback") : text("agent.install.copyBlocked")}</p>;
}

export function SetupStep({ children, index, title }: { children: ReactNode; index: string; title: string }) {
  return <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-3"><span className="grid size-5 place-items-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">{index}</span><div><p className="text-xs font-medium">{title}</p>{children}</div></div>;
}

export function AgentInstallGuide({ agent, checking, checkFailed, onRecheck }: { agent: AgentRuntimeStatus; checking: boolean; checkFailed: boolean; onRecheck: () => Promise<unknown> }) {
  const { t: text } = useI18n();
  const install = recoveryInstallCommand(agent);
  const loginCommands = recoveryLoginCommands(agent);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    const copied = await copyToClipboard(install);
    setCopyStatus(copied ? "copied" : "failed");
    if (copied) window.setTimeout(() => setCopyStatus("idle"), 2200);
  }
  async function recheck() {
    if (checking) return;
    await onRecheck();
  }
  return <div className="space-y-5">
    <SetupStep index="1" title={interpolate(text("agent.install.step1"), { name: agent.name })}>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-sm bg-muted px-3 py-2 text-xs text-foreground">{install}</code>
        <button className="grid size-8 shrink-0 place-items-center rounded-sm border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => void copy()} title={copyStatus === "copied" ? text("agent.install.copied") : text("agent.install.copy")} type="button">
          {copyStatus === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      <CopyFeedback status={copyStatus} />
    </SetupStep>
    <SetupStep index="2" title={text("agent.install.step2")}>
      {loginCommands.map((command, index) => <p className={`text-xs leading-5 text-muted-foreground${index === 0 ? " mt-1" : " mt-0.5"}`} key={command}>{interpolate(text("agent.install.execute"), { command: "" })}<code>{command}</code>{text(index === loginCommands.length - 1 ? "agent.install.execute.period" : "agent.install.execute.comma")}</p>)}
    </SetupStep>
    <SetupStep index="3" title={text("agent.install.step3")}>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{text("agent.install.recheckDesc")}</p>
      {checking && <p aria-live="polite" className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><RefreshCw className="size-3 animate-spin" />{interpolate(text("agent.install.checking"), { name: agent.name })}</p>}
      {checkFailed && <p aria-live="polite" className="mt-2 text-xs text-destructive">{text("agent.recovery.offline")}</p>}
      <div className="mt-3">
        <button className="inline-flex h-8 items-center gap-1.5 rounded-sm border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50" disabled={checking} onClick={() => void recheck()} type="button">
          <RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} />
          {checking ? text("agent.install.rechecking") : text("agent.install.recheck")}
        </button>
      </div>
    </SetupStep>
  </div>;
}
