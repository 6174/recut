/*
 * [INPUT]: 依赖 @tiptap/core 的 Editor/JSONContent、@tiptap/pm/model 的 Slice、@tiptap/pm/state 的 Transaction 与 protocol 序列化
 * [OUTPUT]: 对外提供 ReferenceTriggerState 类型与 resolveReferenceTriggerState / replaceTriggerWithReference / didInsertTriggerChar（搬运 brainloop mention-trigger）
 * [POS]: web/lib/rich-composer/extensions 的 @ 触发辅助层；被 RichComposer 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Editor } from "@tiptap/core";
import type { Slice } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

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

// didInsertTriggerChar：本次事务是否真的插入了触发字符（@）。
// 只用于「打开」时机判断——避免光标移动到已有 @ 之后也弹出面板。
export function didInsertTriggerChar(transaction: Transaction, triggerChar = "@"): boolean {
  if (!transaction.docChanged) return false;
  let found = false;
  transaction.steps.forEach((step) => {
    const slice = (step as unknown as { slice?: Slice }).slice;
    if (!slice) return;
    slice.content.descendants((node) => {
      if (node.isText && node.text?.includes(triggerChar)) found = true;
      return !found;
    });
  });
  return found;
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
  // 优先用 ProseMirror 自己的坐标换算：它按文档模型测量，不受原生 selection 延迟/失焦影响。
  try {
    const coords = view.coordsAtPos(pos);
    if (coords && (coords.left || coords.top || coords.bottom)) {
      return { top: coords.bottom, left: coords.left };
    }
  } catch {
    // 落到原生 selection / 容器兜底
  }
  const domSelectionCoords = readDomSelectionCoords(view);
  if (domSelectionCoords) return domSelectionCoords;
  const rect = view.dom.getBoundingClientRect();
  return { top: rect.bottom, left: rect.left + 12 };
}

function readDomSelectionCoords(view: Editor["view"]): { top: number; left: number } | null {
  if (typeof window === "undefined") return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  // 只信折叠光标；非折叠（框选）会拿到整段 rect，导致面板飘到别处。
  if (!range.collapsed) return null;
  const root = view.dom;
  const anchorNode = range.startContainer;
  if (!root.contains(anchorNode)) return null;
  const rects = range.getClientRects();
  const rect = rects.item(rects.length - 1) ?? range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  return { top: rect.bottom, left: rect.left };
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
