/*
 * [INPUT]: 依赖 @tiptap/core 的 Editor/JSONContent 与 protocol 序列化
 * [OUTPUT]: 对外提供 ReferenceTriggerState 类型与 resolveReferenceTriggerState / replaceTriggerWithReference（搬运 brainloop mention-trigger）
 * [POS]: web/lib/rich-composer/extensions 的 @ 触发辅助层；被 RichComposer 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Editor } from "@tiptap/core";

export type ReferenceTriggerState = {
  active: boolean;
  query: string;
  range: { from: number; to: number } | null;
  coords: { top: number; left: number } | null;
};

const DEFAULT_WINDOW = 120;

export function resolveReferenceTriggerState(editor: Editor, triggerChar = "@"): ReferenceTriggerState {
  const { state, view } = editor;
  const { from, to, empty } = state.selection;
  if (!empty) return inactiveState();

  const start = Math.max(1, from - DEFAULT_WINDOW);
  const context = state.doc.textBetween(start, from, "\n", "\n");
  const escaped = escapeRegex(triggerChar);
  // 不要求 @ 前是空白：中文输入后可直接 @（CJK 场景更自然）。
  const match = context.match(new RegExp(`${escaped}([^\\s${escaped}]*)$`));
  if (!match) return inactiveState();

  const query = match[1] ?? "";
  const triggerIndex = context.length - query.length - 1;
  const absoluteFrom = start + triggerIndex;
  return { active: true, query, range: { from: absoluteFrom, to }, coords: resolveMenuCoords(view, from) };
}

export function replaceTriggerWithReference(
  editor: Editor,
  state: ReferenceTriggerState,
  nodeType: string,
  attrs: Record<string, unknown>,
): boolean {
  if (!state.active || !state.range) return false;
  return editor
    .chain()
    .focus()
    .insertContentAt(state.range, [{ type: nodeType, attrs }, { type: "text", text: " " }])
    .run();
}

export function inactiveState(): ReferenceTriggerState {
  return { active: false, query: "", range: null, coords: null };
}

function resolveMenuCoords(view: Editor["view"], pos: number): { top: number; left: number } {
  const domSelectionCoords = readDomSelectionCoords(view);
  if (domSelectionCoords) return domSelectionCoords;
  try {
    const coords = view.coordsAtPos(pos);
    return { top: coords.bottom + 6, left: coords.left };
  } catch {
    const rect = view.dom.getBoundingClientRect();
    return { top: rect.bottom - 8, left: rect.left + 12 };
  }
}

function readDomSelectionCoords(view: Editor["view"]): { top: number; left: number } | null {
  if (typeof window === "undefined") return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const root = view.dom;
  const anchorNode = range.startContainer;
  if (!root.contains(anchorNode)) return null;
  const rects = range.getClientRects();
  const rect = rects.item(rects.length - 1) ?? range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  return { top: rect.bottom + 6, left: rect.left };
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
