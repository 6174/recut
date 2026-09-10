/*
 * [INPUT]: 依赖统一 Entity 模型（attrs）、媒体 API 与 world-detail-settings 的 attrs 投影助手
 * [OUTPUT]: 对外提供设定卡片（intro + 非 media 属性摘要 + media 属性缩略图 + attrs 完整度徽标）与空态；
 * 查看与编辑统一走 world-detail-settings 的右侧实体面板 EntitySettingsPanel（与画布共用 EntityEditor）
 * [POS]: worlds/[worldID] 的展示区；将 Entity attrs 投影为用户可读的创作状态，不显示 JSON、revision 或 hash
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Clapperboard, Pencil, Plus } from "lucide-react";
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
  onOpen,
}: {
  apiBase: string;
  entity: WorldEntity;
  onOpen?: (entity: WorldEntity) => void;
  onCreateVideo?: () => void;
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
      onClick={() => onOpen?.(entity)}
    >
      {media.length ? (
        <div
          className="flex h-24 shrink-0 items-stretch gap-0.5 overflow-hidden border-b bg-muted"
          onClick={(event) => {
            event.stopPropagation();
            onOpen?.(entity);
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
        {onOpen && (
          <Button className="h-8" onClick={(event) => { event.stopPropagation(); onOpen(entity); }} type="button" variant="outline">
            <Pencil className="size-3" />{t("worlds.entity.edit")}
          </Button>
        )}
      </div>
      </div>
    </Card>
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
