/*
 * [INPUT]: 依赖 context-catalog/types、sources/media（kindIcon/mediaSource）与 agent-panel-types 的媒体旁路载荷
 * [OUTPUT]: 对外提供 referenceSource：生成提示词里的统一 `<reference id kind role label />` 标签；协议-only，
 *   参与解析/序列化/chip 渲染与 hover 预览，但不进入 @ 面板目录（search 恒空、不可内联插入）
 * [POS]: web/lib/context-catalog/sources 的生成参考协议来源；消费 generation-reference-protocol RFC §3 的统一标签，
 *   让 AI 写入的 <reference> 与 @ 面板写入的 <media> 同构渲染，提交期再由服务端改写为编号别名
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { mediaContextPayload } from "@/components/agent-panel-types";
import type { MediaEventAsset } from "@/components/use-media-asset-events";
import type { ContextSource } from "../types";
import { kindIcon, mediaSource } from "./media";

export const referenceSource: ContextSource = {
  type: "reference",
  attrs: ["id", "kind", "role", "label"],
  identity: (attrs) => attrs.id ?? null,
  group: "media",
  titleKey: "agent.context.source.reference",
  insertMode: "inline",
  // 生成提示词由 Agent 写入，不由 @ 面板插入；这里只负责解析、渲染与提交绑定。
  inlineInsertable: false,
  scope: null,
  icon: (attrs) => kindIcon(attrs.kind as MediaEventAsset["kind"], "size-3.5"),
  label: (attrs) => String(attrs.label ?? attrs.id ?? "参考"),
  toContext: (attrs) => (attrs.id ? mediaContextPayload(attrs.id) : null),
  search: async () => [],
  preview: (option, ctx) => mediaSource.preview(option, ctx),
};
