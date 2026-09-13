/*
 * [INPUT]: 依赖 react、lucide-react、components/world-entity/field-row（FullscreenTextEditor）、
 * canvas-store（inlineEdit/creatingAt 状态与 commit/cancel 动作、editor 句柄）、pomelo-core（PomeloRendererAdapter）
 * [OUTPUT]: 对外提供 CanvasInlineEditor：画布就地编辑器宿主——把 inlineEdit 的世界坐标 rect 换算为
 * 屏幕位置渲染 DOM 编辑器（entity-title 单行 Enter 提交；正文 blur / ⌘↵ 提交，Esc 取消）；
 * 正文编辑器高度服从元素 box（内滚动，不随内容自增长），并支持全屏放大编辑（复用 FieldRow 的
 * FullscreenTextEditor，与属性面板一致）；视口平移/缩放时跟随重排；
 * EDITOR_METRICS 与各 Block 的画布排版逐形态对齐（字号/行高/内边距/颜色）
 * [POS]: worlds/[worldID]/canvas 的就地编辑层（T4/T3 命名态共用）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Maximize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FullscreenTextEditor } from "@/components/world-entity/field-row";
import type { PomeloRendererAdapter } from "@/lib/pomelo/pomelo-core/pomelo-renderer";
import { useWorldCanvasStore } from "./canvas-store";

// 各编辑形态与画布渲染的排版对齐表（字号/行高/内边距/颜色均为世界单位，随视口缩放；
// 来源：NoteBlockV 11/16 + offset(10,10)（note-block-v.ts）、FreeElementBlockV text 13/20 无内边距、
// attr 文本 11/17 + offset(10,10)（free-element-block-v.ts）、EntityCardBlockV 标题 15 @PAD=14、attr 徽标 11）。
// 画布 Block 侧必须使用同一组数值（字号/行高/内边距），否则两种渲染模式会错位。
const EDITOR_METRICS = {
  "note-body": { fontSize: 11, lineHeight: 16, padX: 10, padTop: 10, color: "#9ca3af", semibold: false },
  "text-body": { fontSize: 13, lineHeight: 20, padX: 0, padTop: 0, color: "#d4d4d8", semibold: false },
  "attr-body": { fontSize: 11, lineHeight: 17, padX: 10, padTop: 10, color: "#f4f4f5", semibold: false },
  "entity-title": { fontSize: 15, lineHeight: 20, padX: 14, padTop: 0, color: "#f4f4f5", semibold: true },
  "attr-title": { fontSize: 11, lineHeight: 18, padX: 28, padTop: 8, color: "#8b93a7", semibold: false },
} as const;

// 全屏放大编辑的对话框标题（与面板 FieldRow 的 label 语义一致）
const EDITOR_LABELS: Record<InlineEdit["kind"], string> = {
  "entity-title": "标题",
  "attr-title": "属性名称",
  "note-body": "便签正文",
  "text-body": "文本",
  "attr-body": "正文",
};

export function CanvasInlineEditor() {
  const edit = useWorldCanvasStore((state) => state.inlineEdit);
  const editor = useWorldCanvasStore((state) => state.editor);
  const [tick, setTick] = useState(0);
  const [value, setValue] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const cancelledRef = useRef(false);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  // 视口变化时重算屏幕位置（transform 事件驱动重渲染）
  useEffect(() => {
    if (!edit || !editor) return;
    const adapter = editor.renderAdapter as PomeloRendererAdapter;
    const unsubscribe = adapter.onTransformEvent.on(() => setTick((n) => n + 1));
    return () => unsubscribe.dispose();
  }, [edit, editor]);

  // 打开时初始化草稿值并聚焦全选
  useEffect(() => {
    if (!edit) return;
    setValue(edit.value);
    setFullscreen(false);
    cancelledRef.current = false;
    const area = areaRef.current;
    if (area) {
      area.focus();
      area.select();
    }
  }, [edit]);

  if (!edit || !editor) return null;
  const t = (editor.renderAdapter as PomeloRendererAdapter).transform;
  void tick; // 视口变化仅驱动重渲染（重算屏幕位置）
  const s = t.scale;
  const fontScale = Math.max(0.55, s); // 极小缩放下不小于可读字号，但仍按比例收缩
  const m = EDITOR_METRICS[edit.kind] ?? EDITOR_METRICS["note-body"];
  const isTitle = edit.kind === "entity-title" || edit.kind === "attr-title";
  const screen = {
    x: edit.rect.x * s + t.x,
    y: edit.rect.y * s + t.y,
    width: Math.max(40, edit.rect.width * s),
    height: Math.max(24 * s, edit.rect.height * s),
  };

  const commit = () => {
    if (cancelledRef.current) return;
    void useWorldCanvasStore.getState().commitInlineEdit(value);
  };
  const cancel = () => {
    cancelledRef.current = true;
    useWorldCanvasStore.getState().cancelInlineEdit();
  };

  return (
    <div
      className="absolute z-30"
      style={{ left: screen.x, top: screen.y, width: screen.width, height: isTitle ? undefined : Math.max(28 * s, screen.height) }}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <textarea
        ref={areaRef}
        className={`block w-full resize-none border-0 bg-card/95 text-foreground shadow-lg outline outline-1 outline-primary/60 break-all ${m.semibold ? "font-semibold" : ""}`}
        style={{
          height: isTitle ? undefined : "100%",
          minHeight: screen.height,
          // 文本服从 box：编辑器高度锁定为元素几何（内滚动，不再随内容自增长）
          overflowY: isTitle ? "hidden" : "auto",
          color: m.color,
          fontFamily: 'system-ui, -apple-system, "PingFang SC", sans-serif',
          fontSize: `${m.fontSize * fontScale}px`,
          lineHeight: `${m.lineHeight * fontScale}px`,
          // 内边距与画布 Block 严格同值（world 单位 × 缩放）：text-body 的 0 不能再被 Math.max 抬到 2px，
          // 否则 DOM 文本相对画布整体偏移；outline 不占布局，故内容原点与元素原点一致。
          padding: `${m.padTop * fontScale}px ${m.padX * fontScale}px`,
        }}
        placeholder={edit.kind === "attr-title" ? "输入属性名称…" : undefined}
        value={value}
        onBlur={(event) => {
          // blur 分流（与 FieldRow 一致）：焦点落到本编辑器容器内的「放大」按钮时不提交；
          // 全屏编辑器打开期间忽略行内 textarea 的失焦。
          if (fullscreen) return;
          if (event.relatedTarget instanceof Node && event.currentTarget.parentElement?.contains(event.relatedTarget)) return;
          commit();
        }}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          } else if (event.key === "Enter" && (isTitle || event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            areaRef.current?.blur();
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      />
      {/* 全屏放大编辑：与属性面板 FieldRow 的「放大」同一入口/同一对话框 */}
      {!isTitle && (
        <button
          aria-label="放大编辑"
          className="absolute right-1 top-1 flex items-center gap-0.5 rounded bg-card/85 px-1 py-0.5 text-[10px] text-muted-foreground shadow outline outline-1 outline-primary/40 hover:text-foreground"
          onClick={() => setFullscreen(true)}
          title="放大编辑"
          type="button"
        >
          <Maximize2 className="size-3" />
        </button>
      )}
      {fullscreen && <FullscreenTextEditor label={EDITOR_LABELS[edit.kind]} draft={value} onDraft={setValue} onCommit={commit} onCancel={cancel} />}
    </div>
  );
}

type InlineEdit = NonNullable<ReturnType<typeof useWorldCanvasStore.getState>["inlineEdit"]>;
