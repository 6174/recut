/*
 * [INPUT]: 依赖统一 Workspace 壳、agent-panel-context、worlds-store 缓存、recut-worlds-client 与 World 详情展示/编辑分区
 * [OUTPUT]: 对外提供面向创作者的 World 设定页：结构化设定分类、独立非结构化资源库与从故事创建视频
 * [POS]: web/app/worlds/[worldID] 的产品编排层；将底层 Entity/Revision 转译为“创作设定/World 资源”，写入委托给领域表单
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import {
  ArrowLeft,
  Clapperboard,
  Globe2,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlatformMediaPicker } from "@/components/platform-media-picker";
import { useReportPageContext } from "@/lib/agent-panel-context";
import {
  createRecutWorldsClient,
  type EntityKind,
  type WorldDetail,
  type WorldEntity,
} from "@/lib/recut-worlds-client";
import { useServiceStore } from "@/lib/service-store";
import { useWorldsStore } from "@/lib/worlds-store";
import { useI18n, useLocaleStore, t as plainT } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
import {
  EmptySetting,
  SettingCard,
} from "./world-detail-panels";
import { settingSections, SettingDialog } from "./world-detail-settings";
import { Workspace } from "../../page";

export default function WorldDetailClient() {
  return (
    <Workspace appDetail={() => <WorldDetailContent />} contentTab="worlds" />
  );
}

function WorldDetailContent() {
  const { t } = useI18n();
  const apiBase = useServiceStore((state) => state.endpoint);
  const loadDetail = useWorldsStore((state) => state.loadDetail);
  const loadEntities = useWorldsStore((state) => state.loadEntities);
  const loadEntity = useWorldsStore((state) => state.loadEntity);
  const invalidate = useWorldsStore((state) => state.invalidate);
  const [worldID, setWorldID] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorldDetail | null>(null);
  const [error, setError] = useState("");
  const [entitiesByKind, setEntitiesByKind] = useState<
    Record<string, WorldEntity[]>
  >({});
  const [activeKind, setActiveKind] = useState<EntityKind | "resource">("character");
  const [editing, setEditing] = useState<WorldEntity | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");

  useReportPageContext(
    useMemo(
      () =>
        detail && worldID
          ? { title: detail.name, path: `/worlds/${worldID}` }
          : { title: "Worlds", path: "/worlds" },
      [detail, worldID],
    ),
  );
  useEffect(() => {
    const queryID = new URLSearchParams(window.location.search).get("id");
    const segments = window.location.pathname.split("/").filter(Boolean);
    setWorldID(
      window.location.pathname.startsWith("/worlds/")
        ? (segments[1] ?? queryID)
        : queryID,
    );
  }, []);
  useEffect(() => {
    if (!apiBase || !worldID) return;
    let active = true;
    void loadDetail(apiBase, worldID)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch(() => {
        if (active) setError(t("worlds.detail.load.failed"));
      });
    return () => {
      active = false;
    };
  }, [apiBase, loadDetail, worldID]);
  useEffect(() => {
    if (!apiBase || !worldID) return;
    let active = true;
    void loadWorldEntities(apiBase, worldID, loadEntities, loadEntity).then(
      (grouped) => {
        if (active) setEntitiesByKind(grouped);
      },
    );
    return () => {
      active = false;
    };
  }, [apiBase, loadEntities, loadEntity, worldID]);

  const activeEntities = useMemo(
    () => entitiesByKind[activeKind] ?? [],
    [activeKind, entitiesByKind],
  );
  if (!worldID)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("worlds.detail.noWorld")}
      </p>
    );
  if (error && !detail)
    return <p className="py-10 text-center text-sm text-warning">{error}</p>;
  if (!detail)
    return (
      <div className="space-y-4 py-6">
        <div className="h-8 w-64 animate-pulse rounded-sm bg-muted" />
        <div className="h-48 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  const worldId = worldID;
  const worldName = detail.name;
  const currentSection = settingSections(t).find(
    (section) => section.kind === activeKind,
  );

  async function reloadWorld() {
    invalidate(worldId);
    const [next, grouped] = await Promise.all([
      loadDetail(apiBase, worldId, true),
      loadWorldEntities(apiBase, worldId, loadEntities, loadEntity, true),
    ]);
    setDetail(next);
    setEntitiesByKind(grouped);
  }
  async function createVideoFromStory(storyID: string) {
    setNotice("");
    try {
      const apps = (await (
        await fetch(`${apiBase}/v1/apps`, { cache: "no-store" })
      ).json()) as Array<{ id: string }>;
      if (!apps.some((app) => app.id === "recut.remotion-studio"))
        throw new Error(t("worlds.detail.installStudio"));
      const response = await fetch(`${apiBase}/v1/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: interpolate(t("worlds.detail.videoProjectName"), { name: worldName }),
          appId: "recut.remotion-studio",
        }),
      });
      if (!response.ok) throw new Error(await projectErrorMessage(response));
      const project = (await response.json()) as { id: string };
      await createRecutWorldsClient(apiBase).project.put(project.id, {
        worldId,
        selection: { storyId: storyID, purpose: "video" },
      });
      window.location.assign(`/projects/${project.id}`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : t("worlds.detail.videoProject.failed"));
    }
  }

  return (
    <>
      <header className="relative mb-8">
        <Link
          aria-label={t("worlds.detail.back.aria")}
          className="absolute -left-12 top-2 grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          href="/worlds"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground">
            <Globe2 className="size-7" />
          </span>
          <div className="min-w-0 pt-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-3xl font-semibold tracking-tight">
                {detail.name}
              </h1>
              <Badge className="shrink-0 border-primary/20 bg-accent/60 text-accent-foreground">
                {t(`worlds.kind.${detail.type}`)}
              </Badge>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {detail.description || t("worlds.detail.fallbackDesc")}
            </p>
          </div>
        </div>
      </header>
      <nav
        aria-label={t("worlds.detail.tabs.aria")}
        className="mb-6 flex flex-wrap items-center gap-1.5"
      >
        {[...settingSections(t), { kind: "resource" as const, title: t("worlds.detail.resource.title"), description: t("worlds.detail.resource.desc"), action: t("worlds.detail.resource.action") }].map((section) => (
          <button
            aria-pressed={activeKind === section.kind}
            className={tabClass(activeKind === section.kind)}
            key={section.kind}
            onClick={() => {
              setActiveKind(section.kind);
            }}
            type="button"
          >
            {section.title}
          </button>
        ))}
      </nav>
      {activeKind === "resource" ? <WorldResourcesPanel apiBase={apiBase} expectedRevisionID={detail.revision.id} onChanged={() => void reloadWorld()} worldID={worldId} /> : <section className="flex flex-col items-start gap-5">
          <div className="flex w-full items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">{currentSection?.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {currentSection?.description}
              </p>
            </div>
            <Button onClick={() => setCreating(true)} type="button">
              <Plus className="size-3.5" />
              {currentSection?.action}
            </Button>
          </div>
          {activeEntities.length ? (
            <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4">
              {activeEntities.map((entity) => (
                <SettingCard
                  entity={entity}
                  key={entity.id}
                  onCreateVideo={
                    activeKind === "story"
                      ? () => void createVideoFromStory(entity.id)
                      : undefined
                  }
                  onEdit={() => setEditing(entity)}
                />
              ))}
            </div>
          ) : (
            <EmptySetting
              kind={activeKind}
              onCreate={() => setCreating(true)}
            />
          )}
      </section>}
      {activeKind !== "resource" && (creating || editing) && (
        <SettingDialog
          apiBase={apiBase}
          entity={editing}
          expectedRevisionID={detail.revision.id}
          kind={activeKind}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onEvidenceChanged={() => void reloadWorld()}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void reloadWorld();
          }}
          worldID={worldId}
        />
      )}
    </>
  );
}

function WorldResourcesPanel({ apiBase, expectedRevisionID, onChanged, worldID }: { apiBase: string; expectedRevisionID: string; onChanged: () => void; worldID: string }) {
  const { t } = useI18n();
  const [items, setItems] = useState<Array<{ id?: string; assetId: string; label?: string; modality: string }>>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<{ id: string; name: string } | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { void createRecutWorldsClient(apiBase).evidence.list({ worldId: worldID }).then((all) => setItems(all.filter((item) => !item.entityId))).catch(() => setError(t("worlds.detail.resource.load.failed"))); }, [apiBase, worldID]);
  return <section className="flex w-full flex-col items-start gap-5"><div className="flex w-full items-end justify-between gap-4"><div><h2 className="text-xl font-semibold">{t("worlds.detail.resource.title")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("worlds.detail.resource.fullDesc")}</p></div><Button onClick={() => setPickerOpen(true)} type="button">{t("worlds.detail.resource.action")}</Button></div>{error ? <div className="w-full rounded-md border border-warning/30 bg-warning/10 p-4 text-sm text-warning">{error}</div> : items.length ? <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4">{items.map((item) => <div className="rounded-md border p-4" key={item.id ?? item.assetId}><p className="text-sm font-medium">{item.label || t("worlds.detail.resource.unnamed")}</p><p className="mt-1 text-xs text-muted-foreground">{item.modality === "research" ? t("worlds.detail.resource.kind.document") : item.modality === "text" ? t("worlds.detail.resource.kind.text") : item.modality === "audio" ? t("worlds.detail.resource.kind.audio") : item.modality === "video" ? t("worlds.detail.resource.kind.video") : t("worlds.detail.resource.kind.image")}</p></div>)}</div> : <div className="w-full rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t("worlds.detail.resource.empty")}</div>}<PlatformMediaPicker apiBase={apiBase} onCancel={() => setPickerOpen(false)} onPick={(selection) => { const asset = Array.isArray(selection) ? selection[0] : selection; if (!asset) return; setSelectedAsset(asset); setDescription(""); setPickerOpen(false); }} request={pickerOpen ? { kinds: [] } : null} />{selectedAsset && <div aria-modal="true" className="fixed inset-0 z-[60] grid place-items-center bg-foreground/30 p-6" role="dialog"><form className="w-full max-w-lg rounded-md border bg-card p-5 shadow-2xl" onSubmit={(event) => { event.preventDefault(); void createRecutWorldsClient(apiBase).evidence.attach({ worldId: worldID, assetId: selectedAsset.id, purpose: "narrative", status: "supporting", label: description.trim() || selectedAsset.name, expectedRevisionId: expectedRevisionID }).then(() => { setSelectedAsset(null); onChanged(); }).catch(() => setError(t("worlds.detail.resource.save.failed"))); }}><h3 className="text-lg font-semibold">{t("worlds.detail.resource.attach.title")}</h3><p className="mt-1 text-sm text-muted-foreground">{selectedAsset.name}</p><label className="mt-5 block text-xs font-medium" htmlFor="world-resource-description">{t("worlds.detail.resource.attach.label")}<Input autoFocus className="mt-1" id="world-resource-description" onChange={(event) => setDescription(event.target.value)} placeholder={t("worlds.detail.resource.attach.placeholder")} value={description} /></label><div className="mt-5 flex justify-end gap-2"><Button onClick={() => setSelectedAsset(null)} type="button" variant="ghost">{t("worlds.detail.resource.attach.cancel")}</Button><Button type="submit">{t("worlds.detail.resource.attach.submit")}</Button></div></form></div>}</section>;
}

async function loadWorldEntities(
  apiBase: string,
  worldID: string,
  loadEntities: ReturnType<typeof useWorldsStore.getState>["loadEntities"],
  loadEntity: ReturnType<typeof useWorldsStore.getState>["loadEntity"],
  force = false,
) {
  const summaries = await loadEntities(apiBase, worldID, { limit: 100 }, force);
  const grouped: Record<string, WorldEntity[]> = {};
  const full = await Promise.all(
    summaries.map((summary) =>
      loadEntity(apiBase, worldID, summary.id, force).catch(() => null),
    ),
  );
  for (const entity of full)
    if (entity) (grouped[entity.kind] ??= []).push(entity);
  return grouped;
}

function tabClass(active: boolean) {
  return active
    ? "rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground"
    : "rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground";
}
async function projectErrorMessage(response: Response) {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? interpolate(plainT("workspace", useLocaleStore.getState().locale, "worlds.detail.videoProject.failed.status"), { status: response.status });
}
