/*
 * [INPUT]: 依赖 worlds-store 的平台 World 目录缓存、recut-worlds-client 的类型与世界类型目录、WorldCard 与工作台 i18n 字典
 * [OUTPUT]: 对外提供社区 Worlds 分区：PGC/平台世界（origin=platform）的搜索/类型筛选与卡片网格及加载/失败/空态，并导出 usePlatformWorlds 供首页预览复用
 * [POS]: web/components/community 的 Worlds 分区；只消费平台目录，用户自己的世界留在 Projects 混排，绝不在此出现
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Globe2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CustomSelect } from "@/components/ui/select-field";
import { WorldCard } from "@/components/world-card";
import {
  worldOrigin,
  worldTypes,
  type WorldKind,
} from "@/lib/recut-worlds-client";
import { useServiceStore } from "@/lib/service-store";
import { useWorldsStore } from "@/lib/worlds-store";
import { useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";

type WorldsStoreState = "loading" | "ready" | "failed";

export function usePlatformWorlds() {
  const apiBase = useServiceStore((state) => state.endpoint);
  const page = useWorldsStore((state) => state.page);
  const state = useWorldsStore((state) => state.pageState) as WorldsStoreState;
  const error = useWorldsStore((state) => state.pageError);
  const loadPage = useWorldsStore((state) => state.loadPage);
  useEffect(() => {
    if (apiBase) void loadPage(apiBase, { limit: 50 });
  }, [apiBase, loadPage]);
  // 平台世界是内容不是账户资产：按目录 order 稳定排序，不随 updated_at 漂移。
  const worlds = useMemo(
    () =>
      page
        .filter((world) => worldOrigin(world) === "platform")
        .sort(
          (a, b) =>
            (a.originMeta?.catalogOrder ?? 0) -
            (b.originMeta?.catalogOrder ?? 0),
        ),
    [page],
  );
  return { apiBase, worlds, state, error, loadPage };
}

export function PlatformWorldsSection() {
  const { t } = useI18n();
  const { apiBase, worlds, state, error, loadPage } = usePlatformWorlds();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WorldKind | "">("");
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return worlds.filter(
      (world) =>
        (!filter || world.type === filter) &&
        (!normalized ||
          `${world.name} ${world.description}`
            .toLowerCase()
            .includes(normalized)),
    );
  }, [worlds, filter, query]);
  return (
    <>
      <div className="mb-7 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("community.section.worlds.title")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("community.section.worlds.desc")}
          </p>
        </div>
        <Badge>
          {state === "loading"
            ? t("community.worlds.loading")
            : state === "failed"
              ? t("community.worlds.failed")
              : interpolate(t("community.worlds.count"), { count: worlds.length })}
        </Badge>
      </div>
      <div className="mb-5 flex items-end gap-3">
        <label className="relative block flex-1">
          <span className="sr-only">{t("worlds.list.search.aria")}</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 bg-background pl-8 text-xs"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("community.worlds.search.placeholder")}
            type="search"
            value={query}
          />
        </label>
        <div className="w-36">
          <CustomSelect
            id="community-world-type-filter"
            label={t("worlds.list.filter")}
            onChange={(value) => setFilter(value as WorldKind | "")}
            options={[
              { label: t("community.worlds.filter.all"), value: "" },
              ...worldTypes().map((kind) => ({
                label: t(`worlds.kind.${kind}`),
                value: kind,
              })),
            ]}
            value={filter}
          />
        </div>
      </div>
      {state === "loading" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              className="h-56 animate-pulse rounded-lg border bg-card"
              key={index}
            />
          ))}
        </div>
      ) : state === "failed" ? (
        <Card>
          <div className="flex min-h-36 flex-col items-center justify-center gap-3 p-6 text-center">
            <Globe2 className="size-6 text-warning" />
            <p className="text-sm font-medium">
              {t("community.worlds.error.title")}
            </p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button
              onClick={() => void loadPage(apiBase, { limit: 50 }, true)}
              type="button"
              variant="outline"
            >
              {t("community.worlds.retry")}
            </Button>
          </div>
        </Card>
      ) : visible.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
          {visible.map((world) => (
            <WorldCard apiBase={apiBase} key={world.id} world={world} />
          ))}
        </div>
      ) : (
        <Card>
          <div className="flex min-h-36 flex-col items-center justify-center gap-3 p-6 text-center">
            <Globe2 className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">
              {t("community.worlds.empty.title")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("community.worlds.empty.desc")}
            </p>
          </div>
        </Card>
      )}
    </>
  );
}
