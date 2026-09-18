/*
 * [INPUT]: 依赖 @tiptap/react、@tiptap/starter-kit、@tiptap/extension-placeholder、reference 扩展/触发器、useContextCatalog 与 ReferenceChip
 * [OUTPUT]: 对外提供 RichComposer（plain/referencing、composer/field/inline 三变体、受控 RichComposerValue，
 * maxRows 生效为编辑器内滚动——超出高度不再撑高宿主）+ useRichComposerValue；referencing 模式下把正文已有引用（value.refs）解析为 selectedKeys/selectedOptions 交给面板置顶「当前引用」分组
 * [POS]: web/components/rich-composer 的 L1 输入内核（协议 RFC §4）；referencing 模式下「新敲下 @」打开统一上下文面板（焦点留在编辑器，@ 后继续输入即过滤；光标移动到已有 @ 之后不弹），选择后插入 reference chip
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, ReactNodeViewRenderer, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkFocusContext, WorkSurfaceContext } from "@/components/agent-panel-types";
import { ContextMentionPopover } from "@/components/context-panel/context-mention-popover";
import { useContextCatalog } from "@/lib/context-catalog/runtime";
import { resolveContextOption } from "@/lib/context-catalog/resolve";
import type { ContextOption } from "@/lib/context-catalog/types";
import { contextProtocolRegistry } from "@/lib/context-catalog/registry";
import { extractRefsFromDoc, docToMarkdown } from "@/lib/rich-composer/protocol/serialize";
import { stringToDoc } from "@/lib/rich-composer/protocol/parse";
import { createReferenceExtension } from "@/lib/rich-composer/extensions/reference";
import { resolveReferenceTriggerState, didInsertTriggerChar } from "@/lib/rich-composer/extensions/reference-trigger";
import type { RichComposerValue } from "@/lib/rich-composer/value";
import { ReferenceChip } from "./reference-chip";
import { ContextCatalogProvider } from "./catalog-context";
import { ReferenceRegistryProvider } from "./registry-context";

export type RichComposerProps = {
  value: RichComposerValue;
  onChange: (value: RichComposerValue) => void;
  mode?: "plain" | "referencing";
  variant?: "composer" | "field" | "inline";
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  minRows?: number;
  maxRows?: number;
  apiBase?: string;
  projectID?: string | null;
  workSurface?: WorkSurfaceContext | null;
  workFocus?: WorkFocusContext | null;
  /** 宿主额外置顶到「当前引用」组的选项（如生成提案已引用的素材） */
  pinnedOptions?: ContextOption[];
  onSubmit?: () => void;
  onPasteFiles?: (files: File[]) => void;
  className?: string;
  "aria-label"?: string;
};

const VARIANT_PROSE: Record<NonNullable<RichComposerProps["variant"]>, string> = {
  composer: "min-h-12 max-h-[200px] overflow-y-auto py-0.5 text-xs leading-5",
  field: "min-h-[2.25rem] text-sm leading-6",
  inline: "min-h-[1.5rem]",
};

// Tiptap Placeholder 只写 data-placeholder + is-editor-empty，宿主需提供 ::before 内容样式。
const PLACEHOLDER_CLASSES = [
  "[&_.recut-rich-composer_p.is-editor-empty:first-child::before]:pointer-events-none",
  "[&_.recut-rich-composer_p.is-editor-empty:first-child::before]:float-left",
  "[&_.recut-rich-composer_p.is-editor-empty:first-child::before]:h-0",
  "[&_.recut-rich-composer_p.is-editor-empty:first-child::before]:text-muted-foreground",
  "[&_.recut-rich-composer_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
].join(" ");

// optionToAttrs 把目录选项映射为 reference 节点的 XML 属性（与 descriptor.attrs 白名单一致）。
function optionToAttrs(option: ContextOption): Record<string, unknown> | null {
  const payload = (option.context?.payload ?? {}) as Record<string, unknown>;
  switch (option.sourceType) {
    case "media":
      return { type: option.subKind ?? "image", assetid: payload.assetId, name: option.title };
    case "creation_world":
      return { worldid: payload.worldId, revisionid: payload.revisionId, name: option.title };
    case "world_attr":
      return { worldid: payload.worldId, attrkey: payload.attrKey, name: option.title };
    case "creation_entity":
      return { worldid: payload.worldId, entityid: payload.entityId, kind: option.subKind, name: option.title };
    case "entity_attr":
      return { worldid: payload.worldId, entityid: payload.entityId, attrkey: payload.attrKey, name: option.title };
    case "media_attr":
      return { assetid: payload.assetId, attrkey: payload.attrKey, name: option.title };
    case "creation_evidence":
      return { worldid: payload.worldId, evidenceid: payload.evidenceId, name: option.title };
    case "project":
      return { projectid: payload.projectId, name: option.title };
    case "app":
      return { appid: payload.appId, name: option.title };
    case "skill":
      return { appid: payload.appId, skillid: payload.skillId, name: option.title };
    case "mcp_tool":
      return { name: payload.toolName, appid: payload.appId };
    default:
      return null;
  }
}

export function RichComposer({
  value,
  onChange,
  mode = "plain",
  variant = "composer",
  placeholder,
  readOnly = false,
  disabled = false,
  autoFocus = false,
  minRows,
  maxRows,
  apiBase = "",
  projectID = null,
  workSurface = null,
  workFocus = null,
  pinnedOptions,
  onSubmit,
  onPasteFiles,
  className,
  "aria-label": ariaLabel,
}: RichComposerProps) {
  const registry = useMemo(() => contextProtocolRegistry(), []);
  const extension = useMemo(
    () => createReferenceExtension(registry, () => ReactNodeViewRenderer(ReferenceChip)),
    [registry],
  );
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const onPasteFilesRef = useRef(onPasteFiles);
  onPasteFilesRef.current = onPasteFiles;
  const lastTextRef = useRef(value.text);
  const disabledRef = useRef(disabled || readOnly);
  disabledRef.current = disabled || readOnly;
  const [panel, setPanel] = useState<{ range: { from: number; to: number }; text: string; coords: { top: number; left: number }; query: string } | null>(null);
  const panelRef = useRef<{ range: { from: number; to: number }; text: string; coords: { top: number; left: number }; query: string } | null>(null);
  const dismissRef = useRef<() => void>(() => {});

  const referencing = mode === "referencing";
  const { runtime, sourceFor } = useContextCatalog({ apiBase, projectID, workSurface, workFocus });
  // 当前正文里已引用的条目：面板据此置顶「当前引用」分组并标选，便于快速定位
  const selectedKeys = useMemo(() => new Set(value.refs.map((ref) => ref.key)), [value.refs]);
  const selectedOptions = useMemo(
    () => value.refs.map((ref) => resolveContextOption(ref.type, ref.attrs, runtime)).filter((option): option is ContextOption => Boolean(option)),
    [value.refs, runtime],
  );

  // syncPanel: 维护 @ 触发状态。
  // - 打开：只在「本次输入真的敲下 @」时打开；光标移动到已有 @ 之后（selection）绝不打开。
  // - 跟随：面板打开时，range/query/coords 始终以编辑器为准实时刷新，锚点跟着光标走。
  // - 关闭：触发失效（删掉 @ / 光标移出 / 框选）时只收起，不碰正文。
  // 焦点始终留在编辑器：查询由编辑器输入驱动，面板不抢焦点。
  const syncPanel = useCallback((instance: Editor, source: "input" | "selection", insertedTrigger: boolean) => {
    if (!referencing) return;
    const state = resolveReferenceTriggerState(instance);
    const current = panelRef.current;
    if (current) {
      if (!state.active || !state.range) {
        dismissRef.current();
        return;
      }
      const next = {
        range: { from: state.range.from, to: state.range.to },
        text: instance.state.doc.textBetween(state.range.from, state.range.to),
        coords: state.coords ?? current.coords,
        query: state.query,
      };
      const unchanged =
        next.range.from === current.range.from &&
        next.range.to === current.range.to &&
        next.query === current.query &&
        next.coords.top === current.coords.top &&
        next.coords.left === current.coords.left;
      if (unchanged) return;
      panelRef.current = next;
      setPanel(next);
      return;
    }
    if (source !== "input" || !insertedTrigger) return;
    if (!state.active || !state.range) return;
    const next = {
      range: { from: state.range.from, to: state.range.to },
      text: instance.state.doc.textBetween(state.range.from, state.range.to),
      coords: state.coords ?? { top: 0, left: 0 },
      query: state.query,
    };
    panelRef.current = next;
    setPanel(next);
  }, [referencing]);

  const extensions = useMemo(() => {
    const base = [
      StarterKit.configure({
        blockquote: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
      }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ];
    return referencing ? [...base, extension] : base;
  }, [extension, placeholder, referencing]);

  // maxRows：编辑态限高（按 leading-6 = 1.5rem/行），超出部分在编辑器内滚动，避免长文本把宿主面板撑成全高
  const editorStyle = maxRows ? `max-height:${maxRows * 1.5}rem;overflow-y:auto` : undefined;

  const editor = useEditor({
    extensions,
    content: stringToDoc(value.text, registry) as JSONContent,
    editable: !disabled && !readOnly,
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        class: `recut-rich-composer w-full resize-none bg-transparent outline-none ${VARIANT_PROSE[variant]}${className ? ` ${className}` : ""}`,
        ...(editorStyle ? { style: editorStyle } : {}),
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
      },
      handleKeyDown(_view, event) {
        if (disabledRef.current) return true;
        if (event.key === "Enter" && !event.shiftKey) {
          if (!onSubmitRef.current) return false;
          event.preventDefault();
          onSubmitRef.current();
          return true;
        }
        return false;
      },
      handlePaste(_view, event) {
        const files = [...(event.clipboardData?.files ?? [])].filter((file) => /^(image|video|audio)\//.test(file.type));
        if (files.length && onPasteFilesRef.current) {
          event.preventDefault();
          onPasteFilesRef.current(files);
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor: next, transaction }) {
      const doc = next.getJSON();
      const text = docToMarkdown(doc, registry);
      lastTextRef.current = text;
      onChangeRef.current({ text, refs: extractRefsFromDoc(doc, registry), doc, isEmpty: text.length === 0 });
      syncPanel(next, "input", didInsertTriggerChar(transaction));
    },
    onSelectionUpdate({ editor: next }) {
      syncPanel(next, "selection", false);
    },
  });

  // 外部 value 变化：仅当不是本组件刚发出的文本时回填。
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = docToMarkdown(editor.getJSON(), registry);
    if (value.text === current) {
      lastTextRef.current = value.text;
      return;
    }
    if (lastTextRef.current === value.text) return;
    // 不能在 React 生命周期内同步 setContent：Tiptap 会在此调用 flushSync，
    // 触发 "flushSync was called from inside a lifecycle method"。放到微任务里执行。
    queueMicrotask(() => {
      if (editor.isDestroyed || lastTextRef.current === value.text) return;
      editor.commands.setContent(stringToDoc(value.text, registry) as JSONContent, { emitUpdate: false });
      lastTextRef.current = value.text;
    });
  }, [editor, registry, value.text]);

  const closePanel = useCallback(() => {
    const target = panelRef.current;
    panelRef.current = null;
    setPanel(null);
    if (editor && target) {
      const size = editor.state.doc.content.size;
      const from = Math.min(target.range.from, size);
      const to = Math.min(target.range.to, size);
      // 仅在触发文本未被改动时清理（编辑失效路径走 dismissPanel，不碰正文）
      if (from < to && editor.state.doc.textBetween(from, to) === target.text) {
        editor.chain().deleteRange({ from, to }).run();
      }
      editor.commands.focus();
    }
  }, [editor]);

  // dismissPanel：触发失效（用户继续输入/删除 @）或外部点击导致关闭时只收起，不修改正文。
  const dismissPanel = useCallback(() => {
    panelRef.current = null;
    setPanel(null);
  }, []);
  dismissRef.current = dismissPanel;

  const insertReference = useCallback(
    (option: ContextOption) => {
      const target = panelRef.current;
      if (!editor || !target) return;
      const attrs = optionToAttrs(option);
      if (!attrs) return;
      const size = editor.state.doc.content.size;
      const from = Math.min(target.range.from, size);
      const to = Math.min(target.range.to, size);
      editor
        .chain()
        .focus()
        .insertContentAt({ from, to }, [
          { type: "reference", attrs: { refType: option.sourceType, ...attrs } },
          { type: "text", text: " " },
        ])
        .run();
      panelRef.current = null;
      setPanel(null);
    },
    [editor],
  );

  return (
    <ReferenceRegistryProvider value={registry}>
      <ContextCatalogProvider value={{ runtime, apiBase, sourceFor }}>
        <div className={`relative w-full ${PLACEHOLDER_CLASSES}`}>
          <EditorContent editor={editor} />
        </div>
        {referencing && (
          <ContextMentionPopover
            anchorRect={panel?.coords ?? null}
            apiBase={apiBase}
            autoFocusSearch={false}
            initialQuery={panel?.query}
            onCancel={closePanel}
            onDismiss={dismissPanel}
            onPick={(option) => insertReference(option)}
            onQuery={(value) => {
              const current = panelRef.current;
              if (!current) return;
              const next = { ...current, query: value };
              panelRef.current = next;
              setPanel(next);
            }}
            open={Boolean(panel)}
            pinnedOptions={pinnedOptions}
            projectID={projectID}
            query={panel?.query}
            selectedKeys={selectedKeys}
            selectedOptions={selectedOptions}
            workFocus={workFocus}
            workSurface={workSurface}
          />
        )}
      </ContextCatalogProvider>
    </ReferenceRegistryProvider>
  );
}

export function useRichComposerValue(initial = "") {
  const [value, setValue] = useState<RichComposerValue>(() => ({ text: initial, refs: [], isEmpty: initial.length === 0 }));
  return { value, setValue };
}
