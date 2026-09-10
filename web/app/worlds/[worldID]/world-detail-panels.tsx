/*
 * [INPUT]: 依赖统一 Entity 模型（attrs）、媒体 API 与 world-detail-settings 的 attrs 投影助手
 * [OUTPUT]: 对外提供设定卡片（intro + 非 media 属性摘要 + media 属性缩略图 + attrs 完整度徽标）、
 * 详情对话框（detail 正文 + 全量属性与媒体网格 + 图片灯箱）与空态；证据面板已随 evidence 写入冻结而删除
 * [POS]: worlds/[worldID] 的展示区；将 Entity attrs 投影为用户可读的创作状态，不显示 JSON、revision 或 hash
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Clapperboard, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
import {
  type WorldEntity,
} from "@/lib/recut-worlds-client";
import {
  attrsCompleteness,
  contentEntries,
  mediaAssetUrl,
  mediaAttrs,
} from "./world-detail-settings";

export function SettingCard({
  apiBase,
  entity,
  onCreateVideo,
  onEdit,
  onView,
}: {
  apiBase: string;
  entity: WorldEntity;
  onCreateVideo?: () => void;
  onEdit?: () => void;
  onView?: (entity: WorldEntity) => void;
}) {
  const { t } = useI18n();
  const entries = contentEntries(entity).slice(0, 3);
  const media = mediaAttrs(entity);
  const thumbnails = media.slice(0, 4);
  const completeness = attrsCompleteness(entity);
  const complete = completeness.total > 0 && completeness.filled === completeness.total;

  return (
    <Card
      className={`flex min-h-56 cursor-pointer flex-col overflow-hidden p-0 transition-shadow hover:shadow-[var(--shadow-overlay)]`}
      onClick={() => onView?.(entity)}
    >
      {media.length ? (
        <div
          className="flex h-24 shrink-0 items-stretch gap-0.5 overflow-hidden border-b bg-muted"
          onClick={(event) => {
            event.stopPropagation();
            onView?.(entity);
          }}
        >
          {thumbnails.map((attr) => (
            <img
              alt={attr.value.name || attr.label}
              className="h-full min-w-0 flex-1 object-cover"
              key={attr.key}
              src={mediaAssetUrl(apiBase, attr.value.assetId)}
            />
          ))}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold">{entity.name}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {entity.intro || t("worlds.entity.summary.empty")}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${complete ? "bg-primary/10 text-primary" : "bg-warning/15 text-warning"}`}
        >
          {complete ? t("worlds.entity.completed") : t("worlds.entity.incomplete")}
        </span>
      </div>
      {entries.length ? (
        <dl className="mt-4 space-y-2">
          {entries.map((entry) => (
            <div key={entry.key}>
              <dt className="text-[11px] font-medium text-muted-foreground">
                {entry.label}
              </dt>
              <dd className="mt-0.5 line-clamp-2 text-xs leading-5">{entry.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          {t("worlds.entity.completion.hint")}
        </p>
      )}
      <div className="mt-auto flex items-center gap-2 pt-4">
        {onCreateVideo && (
          <Button className="h-8" onClick={(event) => { event.stopPropagation(); onCreateVideo(); }} type="button">
            <Clapperboard className="size-3" />{t("worlds.entity.video")}
          </Button>
        )}
        {onEdit && (
          <Button className="h-8" onClick={(event) => { event.stopPropagation(); onEdit(); }} type="button" variant="outline">
            <Pencil className="size-3" />{t("worlds.entity.edit")}
          </Button>
        )}
      </div>
      </div>
    </Card>
  );
}

// 设定详情对话框：只读查看 detail 正文、全部 attrs 与媒体网格；编辑走 attrs 版 SettingDialog。
export function EntityDetailDialog({
  apiBase,
  entity,
  onClose,
  onEdit,
}: {
  apiBase: string;
  entity: WorldEntity;
  onClose: () => void;
  onEdit?: (entity: WorldEntity) => void;
}) {
  const { t } = useI18n();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const entries = contentEntries(entity);
  const media = mediaAttrs(entity);
  return (
    <div aria-modal="true" className="fixed inset-0 z-[60] grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog" aria-labelledby="entity-detail-title">
      <section className="flex max-h-[min(760px,calc(100vh-3rem))] w-full max-w-2xl flex-col overflow-hidden rounded-md border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="mt-1 truncate text-lg font-semibold" id="entity-detail-title">{entity.name}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{entity.intro || t("worlds.entity.summary.empty")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onEdit && (
              <Button className="h-8" onClick={() => onEdit(entity)} type="button" variant="outline">
                <Pencil className="size-3" />{t("worlds.entity.edit")}
              </Button>
            )}
            <button aria-label={t("worlds.entity.detail.close.aria")} className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={onClose} type="button">
              <X className="size-4" />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {entity.detail?.trim() ? (
            <p className="whitespace-pre-wrap text-sm leading-6">{entity.detail}</p>
          ) : null}
          {entries.length ? (
            <dl className="mt-4 space-y-3">
              {entries.map((entry) => (
                <div key={entry.key}>
                  <dt className="text-[11px] font-medium text-muted-foreground">{entry.label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-sm leading-6">{entry.value}</dd>
                </div>
              ))}
            </dl>
          ) : !entity.detail?.trim() ? (
            <p className="text-xs text-muted-foreground">{t("worlds.entity.completion.hint")}</p>
          ) : null}
          <div className="mt-5 border-t pt-4">
            <p className="text-sm font-semibold">{t("worlds.entity.media.title")}</p>
            {media.length ? (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {media.map((attr) => {
                  const source = mediaAssetUrl(apiBase, attr.value.assetId);
                  const isImage = attr.value.kind !== "audio" && attr.value.kind !== "video";
                  return (
                    <div className="overflow-hidden rounded-sm border" key={attr.key}>
                      <div className={isImage ? "cursor-zoom-in" : undefined} onClick={isImage ? () => setLightbox(source) : undefined}>
                        <MediaPreview kind={attr.value.kind ?? ""} source={source} />
                      </div>
                      <p className="truncate p-2 text-[11px] text-muted-foreground">{attr.value.name || attr.label}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">{interpolate(t("worlds.entity.media.empty"), { title: entity.name })}</p>
            )}
          </div>
        </div>
      </section>
      {lightbox && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/80 p-8 backdrop-blur" onMouseDown={(e) => { e.stopPropagation(); setLightbox(null); }}>
          <button aria-label={t("worlds.entity.detail.close.aria")} className="absolute right-4 top-4 grid size-8 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20" onClick={(e) => { e.stopPropagation(); setLightbox(null); }} type="button"><X className="size-4" /></button>
          <img alt="" className="max-h-[90vh] max-w-[90vw] object-contain" src={lightbox} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

export function EmptySetting({ onCreate, title }: { title: string; onCreate?: () => void }) {
  const { t } = useI18n();
  return (
    <Card className="w-full p-6">
      <div className="flex min-h-28 flex-col items-center justify-center text-center">
        <p className="text-sm font-medium">{interpolate(t("worlds.entity.empty.title"), { title })}</p>
        {onCreate && (
          <Button className="mt-4" onClick={onCreate} type="button">
            <Plus className="size-3.5" />{t("worlds.create.newEntity")}
          </Button>
        )}
      </div>
    </Card>
  );
}

function MediaPreview({ kind, source }: { kind: string; source: string }) {
  const { t } = useI18n();
  if (kind === "video") return <video className="h-36 w-full bg-black object-cover" controls muted preload="metadata" src={source} />;
  if (kind === "audio") return (
    <div className="flex h-36 flex-col justify-between bg-muted p-3">
      <p className="text-xs text-muted-foreground">{t("worlds.entity.modality.audio")}</p>
      <audio className="w-full" controls preload="metadata" src={source} />
    </div>
  );
  if (source) return <img alt="" className="h-36 w-full object-cover" src={source} />;
  return <div className="flex h-36 items-end bg-muted p-3 text-xs text-muted-foreground">{t("worlds.entity.preview.fallback")}</div>;
}
