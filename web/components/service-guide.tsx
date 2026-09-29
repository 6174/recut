/*
 * [INPUT]: 依赖工作台 i18n 字典、Button 原子与 PostHog 语义埋点
 * [OUTPUT]: 对外提供服务不可用时的整屏状态层——离线落地页 ServiceGuide（讲清一个核心故事 + 复制安装命令 + GitHub / 远程连接入口）与连接中骨架 ServiceChecking，
 *           以及仅供本模块消费的本机断连恢复页 ServiceRecoveryGuide 与诊断修复提示 RepairGuide
 * [POS]: web/components 的 service 生命周期展示层；由工作区根壳在 service checking/offline 时渲染，不读取其他工作台状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowRight, Code2, Copy, Download, Terminal } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { trackEvent } from "@/components/posthog-analytics";
import { useI18n } from "@/lib/i18n/index";

const SERVICE_INSTALL_COMMAND =
  "curl -fsSL https://recut.video/install.sh | sh";

export function ServiceGuide({
  embedded,
  error,
  onConnectRemote,
}: {
  embedded?: boolean;
  error?: string;
  onConnectRemote: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  async function copyInstallCommand() {
    try {
      await navigator.clipboard.writeText(SERVICE_INSTALL_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }
  if (embedded) return <ServiceRecoveryGuide error={error} />;
  return (
    <section className="mx-auto max-w-3xl py-8 pb-12 text-center sm:py-16">
      <h1 className="marketing-display text-[clamp(2.4rem,6vw,4.25rem)] font-semibold leading-[1.06]">
        <span className="block">{t("landing.title")}</span>
        <span className="marketing-story-accent block">
          {t("landing.title2")}
        </span>
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-muted-foreground">
        {t("landing.desc")}
      </p>
      <p className="mt-4 font-mono text-[11px] tracking-[0.16em] text-muted-foreground">
        {t("landing.subtext")}
      </p>
      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <button
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => {
            trackEvent("recut_install_clicked", { location: "service_guide" });
            void copyInstallCommand();
          }}
          type="button"
        >
          <Download className="size-4" />
          {copied ? t("landing.install.copied") : t("landing.install")}
        </button>
        <a
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border bg-background px-5 text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          href="https://github.com/6174/recut"
          onClick={() =>
            trackEvent("recut_external_clicked", { target: "github" })
          }
          rel="noreferrer"
          target="_blank"
        >
          <Code2 className="size-4" />
          {t("landing.github")}
        </a>
      </div>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Terminal className="size-3.5" />
        {t("landing.install.hint")}
      </p>
      <div className="mx-auto mt-8 flex max-w-xl items-center gap-3 rounded-lg bg-muted px-4 py-3 text-left">
        <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs">
          {SERVICE_INSTALL_COMMAND}
        </code>
        <button
          aria-label={t("landing.copy.aria")}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-xs font-medium text-foreground transition hover:bg-secondary"
          onClick={() => void copyInstallCommand()}
          type="button"
        >
          <Copy className="size-3.5" />
          {copied ? t("landing.copied") : t("landing.copy")}
        </button>
      </div>
      <button
        className="mt-6 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        onClick={onConnectRemote}
        type="button"
      >
        {t("landing.connectRemote")}
        <ArrowRight className="size-3.5" />
      </button>
    </section>
  );
}

export function ServiceChecking() {
  const { t } = useI18n();
  return (
    <section
      aria-busy="true"
      aria-label={t("service.checking.aria")}
      className="grid min-h-80 place-items-center p-8 text-center"
    >
      <div>
        <span className="mx-auto block size-2 animate-pulse rounded-full bg-muted-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">
          {t("service.checking.label")}
        </p>
      </div>
    </section>
  );
}

function ServiceRecoveryGuide({ error }: { error?: string }) {
  const { t } = useI18n();
  return (
    <section className="mx-auto flex min-h-[30rem] max-w-2xl flex-col items-center justify-center py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
        <Download className="size-6" />
      </span>
      <p className="mt-6 font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">
        LOCAL SERVICE
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {t("recovery.title")}
      </h1>
      <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
        {t("recovery.desc")}
      </p>
      {error && (
        <div className="mt-8 w-full max-w-2xl">
          <RepairGuide message={error} />
        </div>
      )}
    </section>
  );
}

function RepairGuide({ message }: { message: string }) {
  const { t } = useI18n();
  const prompt = `Recut 本地环境遇到问题：${message}\n请先检查 service 日志、Git 状态和 manifest.json；解释根因并给出最小、可验证的修复。不要跳过现有本地修改。`;
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-left">
      <p className="text-xs font-medium">{message}</p>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
        {t("repair.desc")}
      </p>
      <Button
        className="mt-2 h-7"
        onClick={() => void navigator.clipboard.writeText(prompt)}
        type="button"
        variant="outline"
      >
        <Code2 className="size-3.5" />
        {t("repair.copy")}
      </Button>
    </div>
  );
}
