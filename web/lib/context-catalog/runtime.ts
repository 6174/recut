/*
 * [INPUT]: 依赖 useMediaAssetEvents、worlds-store、workspace-store、/v1/skills、/v1/mcp/tools 快照与 context-catalog 注册表
 * [OUTPUT]: 对外提供 useContextRuntime（把各 store 快照与 apiBase 归一为 ContextRuntime，懒加载技能/工具）与 useContextCatalog（fan-out + 排序 + 去重 + 最近使用）
 * [POS]: web/lib/context-catalog 的浏览器注入层（选择面 RFC §9/§14）；面板挂载即加载，不新增轮询
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkFocusContext, WorkSurfaceContext } from "@/components/agent-panel-types";
import { useMediaAssetEvents } from "@/components/use-media-asset-events";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { useWorldsStore } from "@/lib/worlds-store";
import { contextSources } from "./registry";
import { pushRecentKey, readRecentKeys } from "./recent";
import {
  dedupeOptions,
  fanOutSearch,
  markSelected,
  rankOptions,
  sourceLimit,
  type ContextSourceError,
} from "./search";
import type {
  ContextGroupID,
  ContextOption,
  ContextRuntime,
  ContextSearchContext,
  ContextSource,
  MCPTool,
  SkillLink,
} from "./types";

type CapabilityCache = { skills: SkillLink[]; mcpTools: MCPTool[] };
const capabilityCache = new Map<string, CapabilityCache>();

async function loadCapabilities(apiBase: string): Promise<CapabilityCache> {
  const cached = capabilityCache.get(apiBase);
  if (cached) return cached;
  const result: CapabilityCache = { skills: [], mcpTools: [] };
  await Promise.allSettled([
    (async () => {
      const response = await fetch(`${apiBase}/v1/skills`, { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as {
        global?: SkillLink[];
        apps?: Array<{ appId: string; skills: SkillLink[] }>;
      };
      result.skills = [
        ...(body.global ?? []),
        ...(body.apps ?? []).flatMap((group) => group.skills.map((skill) => ({ ...skill, appId: skill.appId || group.appId }))),
      ];
    })(),
    (async () => {
      const response = await fetch(`${apiBase}/v1/mcp/tools`, { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as {
        global?: MCPTool[];
        apps?: Array<{ appId: string; name: string; tools: MCPTool[] }>;
      };
      result.mcpTools = [
        ...(body.global ?? []),
        ...(body.apps ?? []).flatMap((group) =>
          group.tools.map((tool) => ({ ...tool, appId: group.appId, appName: group.name })),
        ),
      ];
    })(),
  ]);
  capabilityCache.set(apiBase, result);
  return result;
}

export function useContextRuntime(input: {
  apiBase: string;
  projectID: string | null;
  workSurface: WorkSurfaceContext | null;
  workFocus: WorkFocusContext | null;
}): ContextRuntime {
  const { apiBase, projectID, workFocus, workSurface } = input;
  const { assets } = useMediaAssetEvents();
  const worlds = useWorldsStore((state) => state.page);
  const worldsEndpoint = useWorldsStore((state) => state.endpoint);
  const detailsByID = useWorldsStore((state) => state.detailsByID);
  const entitiesByKey = useWorldsStore((state) => state.entitiesByKey);
  const entityByKey = useWorldsStore((state) => state.entityByKey);
  const loadWorldsPage = useWorldsStore((state) => state.loadPage);
  const loadEntities = useWorldsStore((state) => state.loadEntities);
  const projects = useWorkspaceStore((state) => state.projects);
  const apps = useWorkspaceStore((state) => state.apps);
  const installations = useWorkspaceStore((state) => state.installations);
  const loadWorkspace = useWorkspaceStore((state) => state.load);
  const [capabilities, setCapabilities] = useState<CapabilityCache>({ skills: [], mcpTools: [] });

  useEffect(() => {
    void loadWorldsPage(apiBase).catch(() => {});
    void loadWorkspace(apiBase).catch(() => {});
    let cancelled = false;
    void loadCapabilities(apiBase).then((value) => {
      if (!cancelled) setCapabilities(value);
    });
    return () => {
      cancelled = true;
    };
  }, [apiBase, loadWorkspace, loadWorldsPage]);

  return useMemo<ContextRuntime>(() => {
    const endpoint = worldsEndpoint ?? apiBase;
    return {
      apiBase,
      projectID,
      workSurface,
      workFocus,
      mediaAssets: assets,
      worlds,
      worldDetailFor: (worldId) => detailsByID[worldId],
      entityFor: (worldId, entityId) => entityByKey[`${worldId}:${entityId}`],
      entitiesFor: (worldId) => entitiesByKey[`${endpoint}:${worldId}:|||50`] ?? [],
      projects,
      apps,
      installations,
      skills: capabilities.skills,
      mcpTools: capabilities.mcpTools,
      recentKeys: readRecentKeys(projectID ?? "global"),
      loadEntities: (worldId, query) => loadEntities(apiBase, worldId, { text: query, limit: 12 }),
    };
  }, [
    apiBase,
    apps,
    assets,
    capabilities,
    detailsByID,
    entitiesByKey,
    entityByKey,
    installations,
    loadEntities,
    projectID,
    projects,
    worlds,
    worldsEndpoint,
    workFocus,
    workSurface,
  ]);
}

export type ContextCatalogSearchInput = {
  query: string;
  group: ContextGroupID | "all";
  subKind?: string;
  scope?: ContextSearchContext["scope"];
  allowedRefTypes?: string[];
  limit?: number;
  signal: AbortSignal;
};

export type ContextCatalogSearchResult = {
  options: ContextOption[];
  errors: ContextSourceError[];
};

export function useContextCatalog(input: {
  apiBase: string;
  projectID: string | null;
  workSurface: WorkSurfaceContext | null;
  workFocus: WorkFocusContext | null;
  selectedKeys?: ReadonlySet<string>;
  allowedRefTypes?: string[];
}) {
  const runtime = useContextRuntime(input);
  const recentKeyRef = useRef(0);
  const search = useCallback(
    async (params: ContextCatalogSearchInput): Promise<ContextCatalogSearchResult> => {
      const query = params.query.trim();
      const sources = params.allowedRefTypes?.length
        ? contextSources.filter((source) => params.allowedRefTypes!.includes(source.type))
        : contextSources;
      const ctx: ContextSearchContext = {
        apiBase: input.apiBase,
        query,
        group: params.group,
        subKind: params.subKind,
        scope: params.scope,
        runtime,
        allowedRefTypes: params.allowedRefTypes,
        signal: params.signal,
        limit: params.limit ?? 24,
      };
      const { options, errors } = await fanOutSearch(
        sources.filter((source) => params.group === "all" || source.group === params.group),
        ctx,
      );
      const scoped = options.filter((option) => !params.subKind || option.subKind === params.subKind);
      const ranked = rankOptions(dedupeOptions(scoped), query, runtime.recentKeys);
      return { options: markSelected(ranked, input.selectedKeys ?? new Set()), errors };
    },
    [input.apiBase, input.selectedKeys, runtime],
  );
  const record = useCallback(
    (option: ContextOption) => {
      pushRecentKey(input.projectID ?? "global", option.key);
      recentKeyRef.current += 1;
    },
    [input.projectID],
  );
  const sourceFor = useCallback(
    (type: string): ContextSource | undefined => contextSources.find((source) => source.type === type),
    [],
  );
  return { runtime, sources: contextSources, search, record, sourceFor, sourceLimit };
}
