/*
 * [INPUT]: 依赖 context-catalog/types 的 ContextPreview、useI18n 与 Agent 消息的媒体渲染原语
 * [OUTPUT]: 对外提供 ContextPreviewPane：按 ContextPreview 渲染媒体/标题/事实行/正文/主操作，键盘高亮时 aria-live 更新
 * [POS]: web/components/context-panel 的预览容器；由面板右侧渲染，数据由各 source.preview() 归一化产出
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ExternalLink, Plus } from "lucide-react";
import { VideoFrame } from "@/components/video-frame";
import { useI18n } from "@/lib/i18n/index";
import type { ContextBadge, ContextPreview } from "@/lib/context-catalog/types";

function badgeClass(tone: ContextBadge["tone"]): string {
  if (tone === "primary") return "border-primary/30 bg-primary/10 text-primary";
  if (tone === "warning") return "border-warning/40 bg-warning/10 text-warning";
  if (tone === "muted") return "border-border bg-muted/50 text-muted-foreground";
  return "border-border bg-background text-foreground";
}

export function ContextPreviewPane({
  preview,
  insertMode,
  onInsert,
}: {
  preview: ContextPreview | null;
  insertMode: "inline" | "attach";
  onInsert?: () => void;
}) {
  const { t } = useI18n();
  if (!preview) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-xs text-muted-foreground">
        {t("agent.context.preview.empty")}
      </div>
    );
  }
  return (
    <div aria-live="polite" className="flex h-full min-h-0 flex-col overflow-y-auto p-4 text-xs">
      {preview.media && (
        <div className="mb-3 overflow-hidden rounded-sm border bg-muted">
          {preview.media.kind === "video" ? (
            <VideoFrame alt={preview.title} className="aspect-video w-full" src={preview.media.url} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={preview.title} className="aspect-video w-full object-cover" src={preview.media.url} />
          )}
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{preview.title}</p>
          {preview.subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{preview.subtitle}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {preview.badges?.map((badge) => (
            <span className={`rounded-xs border px-1.5 py-0.5 text-[9px] font-medium leading-none ${badgeClass(badge.tone)}`} key={badge.key}>
              {badge.label ?? badge.key}
            </span>
          ))}
        </div>
      </div>
      {preview.body && <p className="mt-3 whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">{preview.body}</p>}
      {preview.facts.length > 0 && (
        <dl className="mt-3 space-y-2">
          {preview.facts.map((fact) => (
            <div className="flex items-start justify-between gap-3" key={fact.key}>
              <dt className="shrink-0 pt-0.5 text-muted-foreground">{fact.label}</dt>
              <dd className="min-w-0 text-right font-medium break-words">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {(onInsert || preview.open) && (
        <div className="mt-4 flex items-center gap-2 border-t pt-3">
          {onInsert && (
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              onClick={onInsert}
              type="button"
            >
              <Plus className="size-3.5" />
              {insertMode === "attach" ? t("agent.context.preview.attach") : t("agent.context.preview.insert")}
              <kbd className="ml-0.5 rounded-xs bg-primary-foreground/20 px-1 text-[9px]">↵</kbd>
            </button>
          )}
          {preview.open && (
            preview.open.href ? (
              <a className="inline-flex h-8 items-center gap-1.5 rounded-sm border px-3 text-xs hover:bg-muted" href={preview.open.href} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" />
                {t(preview.open.labelKey)}
              </a>
            ) : (
              <button className="inline-flex h-8 items-center gap-1.5 rounded-sm border px-3 text-xs hover:bg-muted" onClick={preview.open.onClick} type="button">
                <ExternalLink className="size-3.5" />
                {t(preview.open.labelKey)}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
