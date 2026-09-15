/*
 * [INPUT]: 依赖 guided/types、guided/entity-actions、guided/media-actions
 * [OUTPUT]: 对外提供 actionsFor（按 subject/typeId/purpose 过滤）、rankActions（按类别序 + priority 排序）、
 *   isActionEnabled（requires 门禁）与 draftIdFor（稳定草稿 id）
 * [POS]: web/lib/world-entity/guided 的注册表内核；无 React/无 I/O，可单测（RFC §6.3）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { ENTITY_ACTIONS } from "./entity-actions";
import { MEDIA_ACTIONS } from "./media-actions";
import { primaryTag } from "./refs";
import type { GuidedActionCategory, GuidedAiAction, GuidedPromptContext } from "./types";

export const ALL_GUIDED_ACTIONS: GuidedAiAction[] = [...ENTITY_ACTIONS, ...MEDIA_ACTIONS];

// 类别展示顺序：先给「生成/整合」，再给「理解/整理/检查」
const CATEGORY_ORDER: GuidedActionCategory[] = [
  "sheet",
  "derive",
  "plan",
  "structure",
  "text",
  "qc",
  "transform",
  "sound",
  "research",
];

function matches(action: GuidedAiAction, ctx: GuidedPromptContext): boolean {
  if (action.subject !== ctx.subject.kind) return false;
  if (ctx.subject.kind === "entity") {
    if (action.excludeTypeIds?.includes(ctx.subject.entity.typeId)) return false;
    if (!action.typeIds) return true;
    return action.typeIds.includes(ctx.subject.entity.typeId);
  }
  // media：applies 缺省 = 全部 purpose；给定 purposes 时按推断 id 过滤
  if (!action.purposes) {
    return !action.modalities || action.modalities.includes(ctx.subject.modality);
  }
  return (
    action.purposes.includes(ctx.subject.inferred.id) &&
    (!action.modalities || action.modalities.includes(ctx.subject.modality))
  );
}

export function actionsFor(ctx: GuidedPromptContext, actions: GuidedAiAction[] = ALL_GUIDED_ACTIONS): GuidedAiAction[] {
  return actions.filter((action) => matches(action, ctx));
}

function categoryRank(action: GuidedAiAction): number {
  const index = CATEGORY_ORDER.indexOf(action.category);
  return index < 0 ? CATEGORY_ORDER.length : index;
}

// 动态主推：按「缺什么」临时加权，让推荐顺序随主体状态变化（不写死在动作数据里）。
// 规则保持可解释：无参考图→先做卡/缺图；有图缺文本→先补文本/结构；有图→加一致性检查。
function dynamicBoost(action: GuidedAiAction, ctx: GuidedPromptContext): number {
  if (ctx.subject.kind === "entity") {
    const entity = ctx.subject.entity;
    const hasMedia = ctx.subject.mediaRefs.length > 0;
    const hasText = Boolean(
      entity.intro ||
        entity.detail ||
        entity.attrs?.some((attr) => attr.type !== "media" && attr.value != null && String(attr.value).trim() !== ""),
    );
    if (!hasMedia && action.category === "sheet") return 15;
    if (!hasMedia && action.id === "generic.missingRef") return 15;
    if (hasMedia && !hasText && (action.category === "text" || action.category === "structure")) return 8;
    if (hasMedia && action.category === "qc") return 5;
    return 0;
  }
  const media = ctx.subject;
  if (media.inferred.id === "unknown" && action.id.startsWith("media.card.")) return 6;
  if (media.owningEntity && action.id === "media.siblings") return 5;
  return 0;
}

export function rankActions(ctx: GuidedPromptContext, actions: GuidedAiAction[]): GuidedAiAction[] {
  const score = (action: GuidedAiAction) => (action.priority?.(ctx) ?? 0) + dynamicBoost(action, ctx);
  return [...actions].sort((a, b) => {
    const pa = score(a);
    const pb = score(b);
    if (pa !== pb) return pb - pa;
    const ca = categoryRank(a);
    const cb = categoryRank(b);
    if (ca !== cb) return ca - cb;
    return a.id.localeCompare(b.id);
  });
}

export function isActionEnabled(action: GuidedAiAction, ctx: GuidedPromptContext): { ok: boolean; reason?: string } {
  return action.requires?.(ctx) ?? { ok: true };
}

export function draftIdFor(action: GuidedAiAction, ctx: GuidedPromptContext): string {
  const subject = ctx.subject;
  const id = subject.kind === "entity" ? subject.entity.id : subject.assetId ?? `media-${subject.inferred.id}`;
  return `guided-${action.id}-${id}`;
}

// 预填文本：动作正文 + 主体引用标记（XML chip，与 @ 面板一致）。正文若已内联该标记则不重复。
export function buildActionText(action: GuidedAiAction, ctx: GuidedPromptContext): string {
  const body = action.build(ctx);
  const tag = primaryTag(ctx);
  if (!tag || body.includes(tag)) return body;
  return `${body}\n\n引用：${tag}`;
}

// 供 UI 显示「已识别为：…」的解释行（RFC §6.1）
export function purposeExplanation(ctx: GuidedPromptContext): string | null {
  if (ctx.subject.kind !== "media") return null;
  const { inferred } = ctx.subject;
  if (inferred.id === "unknown") return "未识别属性用途（可给属性改个更具体的名字）";
  return `已识别为：${inferred.id}${inferred.role ? ` · ${inferred.role}` : ""}${inferred.matched ? `（命中「${inferred.matched}」）` : ""}`;
}
