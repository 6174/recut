/*
 * [INPUT]: 依赖 canvas-store（editor/panMode/linkMode/readOnly/selection 与 setPanMode/setLinkMode/
 * addFreeElement 动作）、pomelo 插件（ViewportPlugin 的 zoomAt/centerContent、GridPlugin）与 lucide-react
 * [OUTPUT]: 对外提供 CanvasToolbarItems：世界画布工具组（合并进全局 Header 的 WorldCanvasTopBar 行内，
 * 无浮动容器）——选择/抓手模式、连线工具、独立插入（图片/音频/视频/文本 + 扩展占位）、undo/redo、
 * 缩放菜单（放大/缩小/50%/100%/200%/适应项目/适应所选内容/对齐到网格开关）与帮助面板；
 * 抓手模式的全画布平移 overlay 由 canvas-pomelo.tsx 宿主渲染（panMode 读自 canvas-store）
 * [POS]: worlds/[worldID]/canvas 的工具组；由 canvas-top-bar.tsx 渲染进页面最顶 Header
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useState } from "react";
import {
  CircleHelp,
  Film,
  Grid3x3,
  Hand,
  Image as ImageIcon,
  MousePointer2,
  Music,
  Puzzle,
  Redo2,
  Spline,
  Type,
  Undo2,
} from "lucide-react";
import { PixiRendererAdapter } from "@/lib/pomelo/pomelo-core/pomelo-pixi/pomelo-pixi-adapter";
import { GridPlugin } from "@/lib/pomelo/world-canvas/plugins/grid-plugin";
import { centerContent, zoomAt } from "@/lib/pomelo/world-canvas/plugins/viewport-plugin";
import { useWorldDemoStore } from "@/lib/pomelo/world-canvas/demo-store";
import { entityCardRect } from "@/lib/pomelo/world-canvas/blocks/entity-card-block";
import { WORLD_ELEMENT_ID, useWorldCanvasStore, type AttrMedia } from "./canvas-store";

const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;

type MenuName = "zoom" | "help" | null;

export function CanvasToolbarItems() {
  const editor = useWorldCanvasStore((state) => state.editor);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const linkMode = useWorldCanvasStore((state) => state.linkMode);
  const setLinkMode = useWorldCanvasStore((state) => state.setLinkMode);
  const panMode = useWorldCanvasStore((state) => state.panMode);
  const setPanMode = useWorldCanvasStore((state) => state.setPanMode);
  const addFreeElement = useWorldCanvasStore((state) => state.addFreeElement);
  const zoom = useWorldDemoStore((state) => state.transform.scale);
  const [menu, setMenu] = useState<MenuName>(null);
  const [gridOn, setGridOn] = useState(true);

  // 以画布中心为锚点缩放到指定比例（clamp 与 ViewportPlugin 一致）
  const zoomTo = (scale: number) => {
    if (!editor) return;
    const adapter = editor.renderAdapter as PixiRendererAdapter;
    const view = adapter.app.view as HTMLCanvasElement;
    const rect = view.getBoundingClientRect();
    const next = zoomAt({ ...adapter.transform }, { x: rect.width / 2, y: rect.height / 2 }, scale);
    adapter.setTransform(next.x, next.y, next.scale);
    useWorldDemoStore.getState().setTransform(next);
  };

  const zoomBy = (factor: number) => zoomTo((useWorldDemoStore.getState().transform.scale || 1) * factor);

  // 缩放以适应所选内容：无选中则不动
  const fitSelection = () => {
    if (!editor) return;
    const adapter = editor.renderAdapter as PixiRendererAdapter;
    const selection = useWorldCanvasStore.getState().selection;
    const blockId =
      selection?.type === "entity"
        ? `entity:${selection.entity.id}`
        : selection?.type === "world"
          ? WORLD_ELEMENT_ID
          : selection?.type === "canvas" && selection.element.kind !== "arrow"
            ? selection.element.id
            : null;
    const record = blockId ? editor.state.getBlockById(blockId) : null;
    if (!record) return;
    const rect =
      record.type === "entity-card"
        ? entityCardRect(record.attrs)
        : {
            x: Number(record.attrs.x) || 0,
            y: Number(record.attrs.y) || 0,
            width: Number(record.attrs.width) || 264,
            height: Number(record.attrs.height) || 200,
          };
    if (rect.width <= 0 || rect.height <= 0) return;
    const view = adapter.app.view as HTMLCanvasElement;
    const viewRect = view.getBoundingClientRect();
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min((viewRect.width - 160) / rect.width, (viewRect.height - 160) / rect.height, 1)));
    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    adapter.setTransform(viewRect.width / 2 - center.x * scale, viewRect.height / 2 - center.y * scale, scale);
    useWorldDemoStore.getState().setTransform({ x: adapter.transform.x, y: adapter.transform.y, scale });
  };

  // 视口中心的世界坐标：独立插入元素的落点
  const centerWorldPos = () => {
    if (!editor) return { x: 420, y: 300 };
    const adapter = editor.renderAdapter as PixiRendererAdapter;
    const view = adapter.app.view as HTMLCanvasElement;
    const rect = view.getBoundingClientRect();
    const t = adapter.transform;
    return { x: (rect.width / 2 - t.x) / t.scale, y: (rect.height / 2 - t.y) / t.scale };
  };

  const insert = (kind: "text" | AttrMedia) => {
    if (readOnly) return;
    setMenu(null);
    void addFreeElement(kind, centerWorldPos());
  };

  const toggleGrid = () => {
    if (!editor) return;
    const plugin = editor.pluginRegistry.get("GridPlugin") as GridPlugin | undefined;
    if (!plugin) return;
    plugin.enabled = !gridOn;
    plugin.draw(editor.renderAdapter as PixiRendererAdapter);
    setGridOn(!gridOn);
  };

  const ToolButton = ({
    active,
    disabled,
    label,
    onClick,
    children,
  }: {
    active?: boolean;
    disabled?: boolean;
    label: string;
    onClick?: () => void;
    children: React.ReactNode;
  }) => (
    <button
      aria-label={label}
      className={`grid size-7 place-items-center rounded-md transition-colors disabled:opacity-40 ${
        active ? "bg-zinc-100 text-zinc-900" : "text-zinc-300 hover:bg-zinc-700/60 hover:text-white"
      }`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );

  const Divider = () => <span className="mx-1 h-5 w-px bg-zinc-700" />;

  const hasSelection = useWorldCanvasStore((state) => !!state.selection);
  if (!editor) return null;

  return (
    <span className="flex shrink-0 items-center">
      <ToolButton active={!panMode && !linkMode} label="选择" onClick={() => (setPanMode(false), setLinkMode(false))}>
        <MousePointer2 className="size-4" />
      </ToolButton>
      <ToolButton active={panMode} label="抓手：拖拽平移画布（空格 + 拖拽随时可用）" onClick={() => (setPanMode(!panMode), setLinkMode(false), setMenu(null))}>
        <Hand className="size-4" />
      </ToolButton>
      <ToolButton active={linkMode} disabled={readOnly} label="连线：点击起点实体，再点击目标实体" onClick={() => setLinkMode(!linkMode)}>
        <Spline className="size-4" />
      </ToolButton>
      <Divider />
      <ToolButton disabled={readOnly} label="插入图片" onClick={() => insert("image")}>
        <ImageIcon className="size-4" />
      </ToolButton>
      <ToolButton disabled={readOnly} label="插入音频" onClick={() => insert("audio")}>
        <Music className="size-4" />
      </ToolButton>
      <ToolButton disabled={readOnly} label="插入视频" onClick={() => insert("video")}>
        <Film className="size-4" />
      </ToolButton>
      <ToolButton disabled={readOnly} label="插入文本" onClick={() => insert("text")}>
        <Type className="size-4" />
      </ToolButton>
      <ToolButton disabled label="扩展（即将推出）">
        <Puzzle className="size-4" />
      </ToolButton>
      <Divider />
      <ToolButton disabled={readOnly} label="撤销（仅内存投影，画布数据以服务器为准）" onClick={() => editor.state.undo()}>
        <Undo2 className="size-4" />
      </ToolButton>
      <ToolButton disabled={readOnly} label="重做" onClick={() => editor.state.redo()}>
        <Redo2 className="size-4" />
      </ToolButton>
      <Divider />
      <div className="relative">
        <button
          className="flex h-7 min-w-12 items-center justify-center rounded-md px-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700/60"
          onClick={() => setMenu(menu === "zoom" ? null : "zoom")}
          type="button"
        >
          {(zoom * 100).toFixed(0)}%
        </button>
        {menu === "zoom" && (
          <div className="absolute left-1/2 top-full z-50 mt-2 w-56 -translate-x-1/2 rounded-xl border border-zinc-700 bg-zinc-900 p-1 text-sm shadow-2xl">
            {[
              { label: "放大", hint: "⌘ +", action: () => zoomBy(1.2) },
              { label: "缩小", hint: "⌘ −", action: () => zoomBy(1 / 1.2) },
            ].map((item) => (
              <button
                key={item.label}
                className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-zinc-200 hover:bg-zinc-700/60"
                onClick={() => (item.action(), setMenu(null))}
                type="button"
              >
                {item.label}
                <span className="text-xs text-zinc-500">{item.hint}</span>
              </button>
            ))}
            {[50, 100, 200].map((percent) => (
              <button
                key={percent}
                className="block w-full rounded-lg px-3 py-1.5 text-left text-zinc-200 hover:bg-zinc-700/60"
                onClick={() => (zoomTo(percent / 100), setMenu(null))}
                type="button"
              >
                缩放至 {percent}%
              </button>
            ))}
            <div className="my-1 h-px bg-zinc-700" />
            <button
              className="block w-full rounded-lg px-3 py-1.5 text-left text-zinc-200 hover:bg-zinc-700/60"
              onClick={() => (centerContent(editor), setMenu(null))}
              type="button"
            >
              缩放以适应项目
            </button>
            <button
              className={`block w-full rounded-lg px-3 py-1.5 text-left hover:bg-zinc-700/60 ${hasSelection ? "text-zinc-200" : "text-zinc-500"}`}
              disabled={!hasSelection}
              onClick={() => (fitSelection(), setMenu(null))}
              type="button"
            >
              缩放以适应所选内容
            </button>
            <div className="my-1 h-px bg-zinc-700" />
            <button
              className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-zinc-200 hover:bg-zinc-700/60"
              onClick={toggleGrid}
              type="button"
            >
              对齐到网格
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${gridOn ? "bg-primary" : "bg-zinc-600"}`}>
                <span className={`absolute size-4 rounded-full bg-white transition-all ${gridOn ? "left-[1.125rem]" : "left-0.5"}`} />
              </span>
            </button>
          </div>
        )}
      </div>
      <Divider />
      <ToolButton active={gridOn} label={gridOn ? "隐藏网格" : "显示网格"} onClick={toggleGrid}>
        <Grid3x3 className="size-4" />
      </ToolButton>
      <div className="relative">
        <ToolButton active={menu === "help"} label="帮助与快捷键" onClick={() => setMenu(menu === "help" ? null : "help")}>
          <CircleHelp className="size-4" />
        </ToolButton>
        {menu === "help" && (
          <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-xs shadow-2xl">
            <p className="mb-2 text-sm font-semibold text-zinc-100">画布操作</p>
            <ul className="space-y-1.5 text-zinc-300">
              <li>• 滚轮平移；⌘/Ctrl + 滚轮缩放</li>
              <li>• 空格 / 中键拖拽平移；抓手工具免按键拖拽</li>
              <li>• hover 节点右缘「+」手柄拖出：连到实体 = 建关系，落空 = 加属性</li>
              <li>• 连线工具：点击起点实体，再点击目标实体</li>
              <li>• 双击实体卡进入其容器上下文</li>
              <li>• Delete / Backspace 删除选中的关系或草稿元素</li>
              <li>• 拖拽/缩放持久化到 world_canvas，不产出 revision</li>
            </ul>
          </div>
        )}
      </div>
      {menu && <div className="fixed inset-0 z-40" onPointerDown={() => setMenu(null)} />}
    </span>
  );
}
