/*
 * [INPUT]: 依赖各 context-catalog source 与 context-catalog/types
 * [OUTPUT]: 对外提供唯一注册表 contextSources（协议组 + 目录组）与按 type/group 的 lookup，以及纯协议子集 contextProtocolRegistry
 * [POS]: web/lib/context-catalog 的唯一注册表（协议 RFC §5.1 / 选择面 RFC §4）；输入内核与面板都从这里 import，新增来源只加一条 descriptor
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { RefProtocolRegistry } from "@/lib/rich-composer/protocol/types";
import { CONTEXT_GROUP_ORDER } from "./search";
import { mcpToolSource, skillSource } from "./sources/capability";
import { workFocusSource, workSurfaceSource } from "./sources/current";
import { entitiesSource } from "./sources/entities";
import { mediaSource } from "./sources/media";
import { appSource, projectSource } from "./sources/workspace";
import { worldsSource } from "./sources/worlds";
import type { ContextGroupID, ContextSource } from "./types";

export const contextSources: ContextSource[] = [
  workSurfaceSource,
  workFocusSource,
  worldsSource,
  entitiesSource,
  projectSource,
  appSource,
  mediaSource,
  skillSource,
  mcpToolSource,
];

export { CONTEXT_GROUP_ORDER };

export const contextGroupTitleKeys: Record<ContextGroupID, string> = {
  current: "agent.context.group.current",
  world: "agent.context.group.world",
  workspace: "agent.context.group.workspace",
  media: "agent.context.group.media",
  capability: "agent.context.group.capability",
};

const byType = new Map(contextSources.map((source) => [source.type, source]));

export function contextSourceForType(type: string): ContextSource | undefined {
  return byType.get(type);
}

// 纯协议子集：只暴露 type/attrs/identity/label，供 L0 序列化/解析/提取/只读展示使用（不触发 React 依赖）。
export function contextProtocolRegistry(): RefProtocolRegistry {
  return contextSources.map((source) => ({ type: source.type, attrs: source.attrs, identity: source.identity, label: source.label }));
}

export function contextSourcesForGroup(group: ContextGroupID): ContextSource[] {
  return contextSources.filter((source) => source.group === group);
}
