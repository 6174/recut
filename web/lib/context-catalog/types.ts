/*
 * [INPUT]: 依赖协议层 RefProtocol、Agent 面板的 Work Surface/Focus 与 MessageContext、素材事件 Asset、工作台/Worlds 目录类型
 * [OUTPUT]: 对外提供统一上下文目录的完整类型：ContextGroupID / ContextOption / ContextPreview / ContextSearchContext / ContextRuntime 与唯一注册表项 ContextSource（协议组 + 目录组）
 * [POS]: web/lib/context-catalog 的类型基座；协议组字段归属 rich-context-composer-protocol RFC §5.1，目录组字段归属 unified-context-mention-panel RFC §10
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { ReactNode } from "react";
import type { MessageContext, WorkFocusContext, WorkSurfaceContext } from "@/components/agent-panel-types";
import type { MediaEventAsset } from "@/components/use-media-asset-events";
import type { WorldDetail, WorldEntity, WorldEntitySummary, WorldSummary } from "@/lib/recut-worlds-client";
import type { WorkspaceApp, WorkspaceInstallation, WorkspaceProject } from "@/lib/workspace-store";
import type { RefAttrRecord, RefProtocol } from "@/lib/rich-composer/protocol/types";

export type { RefAttrRecord };

export type ContextGroupID = "current" | "world" | "workspace" | "media" | "skill" | "tool";

export type ContextBadge = {
  key: string;
  label?: string;
  tone?: "default" | "primary" | "muted" | "warning";
};

export type ContextOption = {
  /** 稳定唯一键 `${sourceType}:${identity}`；用于选择态、去重、最近使用 */
  key: string;
  /** XML 标签名 = 后端 context.type */
  sourceType: string;
  group: ContextGroupID;
  /** 二级过滤值：图片/视频/人物/场景… */
  subKind?: string;
  title: string;
  subtitle?: string;
  thumbnailUrl?: string;
  badges?: ContextBadge[];
  disabled?: boolean;
  disabledReasonKey?: string;
  /** 原始记录，供 preview/toContext 使用；不参与序列化 */
  data: unknown;
  /** 宿主 contexts 旁路项（由 source.search 预计算，等价于 toContext(attrs)）；attach 型可缺省 */
  context?: MessageContext;
  score: number;
  pinned?: boolean;
  selected?: boolean;
};

export type ContextPreview = {
  title: string;
  subtitle?: string;
  media?: { kind: "image" | "video" | "audio"; url: string; posterUrl?: string };
  body?: string;
  facts: { key: string; label: string; value: ReactNode }[];
  badges?: ContextBadge[];
  open?: { labelKey: string; href?: string; onClick?: () => void };
};

export type ContextFilter = { key: string; labelKey: string };

export type ContextSearchScope = {
  worldId?: string;
  projectId?: string;
  mediaScope?: "project" | "library";
};

export type ContextSearchContext = {
  apiBase: string;
  query: string;
  group: ContextGroupID | "all";
  subKind?: string;
  scope?: ContextSearchScope;
  runtime: ContextRuntime;
  allowedRefTypes?: string[];
  signal: AbortSignal;
  limit: number;
};

// Skill / MCP 工具的前端投影（与设置页共享 /v1/skills、/v1/mcp/tools 快照）。
export type SkillLink = { id: string; appId: string; name: string; description: string; source: string; version?: string };
export type MCPTool = { name: string; description: string; inputSchema?: Record<string, unknown>; appId?: string; appName?: string };

export type ContextRuntime = {
  apiBase: string;
  projectID: string | null;
  workSurface: WorkSurfaceContext | null;
  workFocus: WorkFocusContext | null;
  mediaAssets: MediaEventAsset[];
  worlds: WorldSummary[];
  entitiesFor: (worldId: string) => WorldEntitySummary[];
  worldDetailFor: (worldId: string) => WorldDetail | undefined;
  entityFor: (worldId: string, entityId: string) => WorldEntity | undefined;
  projects: WorkspaceProject[];
  apps: WorkspaceApp[];
  installations: WorkspaceInstallation[];
  skills: SkillLink[];
  mcpTools: MCPTool[];
  recentKeys: string[];
  /** Entity 服务端模糊搜索（scope 激活且本地不足时补充） */
  loadEntities?: (worldId: string, query: string) => Promise<WorldEntitySummary[]>;
};

// 唯一注册表 ContextSource：协议组（type/attrs/identity/icon/label/toContext/navigate/inlineInsertable）
// + 目录组（group/titleKey/insertMode/filters/scope/search/preview/rank）。
export type ContextSource = RefProtocol & {
  group: ContextGroupID;
  titleKey: string;
  insertMode: "inline" | "attach";
  inlineInsertable: boolean;
  filters?: (runtime: ContextRuntime) => ContextFilter[];
  scope?: "world" | "project" | null;
  search: (ctx: ContextSearchContext) => Promise<ContextOption[]>;
  preview: (option: ContextOption, ctx: ContextSearchContext) => Promise<ContextPreview> | ContextPreview;
  rank?: (option: ContextOption, query: string) => number;
  icon: (attrs: RefAttrRecord, ctx: { apiBase: string }) => ReactNode;
  label: (attrs: RefAttrRecord) => string;
  toContext?: (attrs: RefAttrRecord) => MessageContext | null;
  navigate?: (attrs: RefAttrRecord, ctx: { apiBase: string }) => void;
};

export function isInlineInsertable(source: ContextSource): boolean {
  return source.inlineInsertable && source.insertMode === "inline";
}
