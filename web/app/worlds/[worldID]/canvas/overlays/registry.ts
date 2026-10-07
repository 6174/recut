/*
 * [INPUT]: 依赖 overlays/types（NodeOverlayContract 类型）
 * [OUTPUT]: 对外提供 registerNodeOverlay（注册，返回注销函数）、nodeOverlaysFor（按 ctx 过滤 + 按 kind 分组 + 排序）、
 *          resetNodeOverlays（测试用清空）
 * [POS]: worlds/[worldID]/canvas/overlays 的注册表内核；无 React/无 I/O，可单测（RFC 2026-10-07 §3.1）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { NodeOverlayContext, NodeOverlayKind, NodeOverlayPlugin } from "./types";

const plugins = new Map<string, NodeOverlayPlugin>();

export function registerNodeOverlay(plugin: NodeOverlayPlugin): () => void {
  plugins.set(plugin.id, plugin);
  return () => {
    plugins.delete(plugin.id);
  };
}

export function nodeOverlaysFor(ctx: NodeOverlayContext): Record<NodeOverlayKind, NodeOverlayPlugin[]> {
  const result: Record<NodeOverlayKind, NodeOverlayPlugin[]> = { toolbar: [], composer: [] };
  for (const plugin of plugins.values()) {
    let matched = false;
    try {
      matched = plugin.match(ctx);
    } catch {
      matched = false;
    }
    if (matched) result[plugin.kind].push(plugin);
  }
  for (const kind of ["toolbar", "composer"] as NodeOverlayKind[]) {
    result[kind].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }
  return result;
}

// 测试隔离：清空已注册插件（生产代码不要调用）。
export function resetNodeOverlays(): void {
  plugins.clear();
}
