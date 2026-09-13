/*
 * [INPUT]: 依赖 canvas-store（editor/panMode/linkMode/readOnly/selection 与 setPanMode/setLinkMode/
 * addFreeElement 动作）、pomelo 插件（ViewportPlugin 的 zoomAt/centerContent、GridPlugin）与 lucide-react
 * [OUTPUT]: 对外提供 CanvasToolbarItems：世界画布工具组（合并进全局 Header 的 WorldCanvasTopBar 行内，
 * 无浮动容器）——选择/抓手模式、大纲开关（T14）、连线工具、历史菜单（T12：最近变更逐条撤销 /
 * 版本快照回滚）、独立插入（图片/音频/视频/文本 + 扩展占位）、undo/redo、
 * 缩放菜单（放大/缩小/50%/100%/200%/适应项目/适应所选内容/对齐到网格开关）与帮助面板；
 * 抓手模式的全画布平移 overlay 由 canvas-pomelo.tsx 宿主渲染（panMode 读自 canvas-store）
 * [POS]: worlds/[worldID]/canvas 的工具组；由 canvas-top-bar.tsx 渲染进页面最顶 Header
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useState } from "react";
import {
  CircleHelp,
  Grid3x3,
  Hand,
  History as HistoryIcon,
  ListTree,
  MousePointer2,
  Plus,
  Redo2,
  Spline,
  Undo2,
} from "lucide-react";
import { PomeloRendererAdapter } from "@/lib/pomelo/pomelo-core/pomelo-renderer";
import { GridPlugin } from "@/lib/pomelo/world-canvas/plugins/grid-plugin";
import { centerContent, zoomAt } from "@/lib/pomelo/world-canvas/plugins/viewport-plugin";
import { useWorldDemoStore } from "@/lib/pomelo/world-canvas/demo-store";
import { entityCardRect } from "@/lib/pomelo/world-canvas/blocks/entity-card-metrics";
import { WORLD_ELEMENT_ID, useWorldCanvasStore, type AttrMedia } from "./canvas-store";
import { createRecutWorldsClient, type WorldRevisionSummary } from "@/lib/recut-worlds-client";

const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;

type MenuName = "zoom" | "help" | "history" | null;

export function CanvasToolbarItems() {
  const editor = useWorldCanvasStore((state) => state.editor);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const linkMode = useWorldCanvasStore((state) => state.linkMode);
  const setLinkMode = useWorldCanvasStore((state) => state.setLinkMode);
  const panMode = useWorldCanvasStore((state) => state.panMode);
  const setPanMode = useWorldCanvasStore((state) => state.setPanMode);
  const setCreating = useWorldCanvasStore((state) => state.setCreating);
  const creating = useWorldCanvasStore((state) => state.creating);
  const zoom = useWorldDemoStore((state) => state.transform.scale);
  const [menu, setMenu] = useState<MenuName>(null);
  const [gridOn, setGridOn] = useState(true);

  // 以画布中心为锚点缩放到指定比例（clamp 与 ViewportPlugin 一致）
  const zoomTo = (scale: number) => {
    if (!editor) return;
    const adapter = editor.renderAdapter as PomeloRendererAdapter;
    const view = adapter.getView();
    if (!view) return;
    const rect = view.getBoundingClientRect();
    const next = zoomAt({ ...adapter.transform }, { x: rect.width / 2, y: rect.height / 2 }, scale);
    adapter.setTransform(next.x, next.y, next.scale);
    useWorldDemoStore.getState().setTransform(next);
  };

  const zoomBy = (factor: number) => zoomTo((useWorldDemoStore.getState().transform.scale || 1) * factor);

  // 缩放以适应所选内容：无选中则不动
  const fitSelection = () => {
    if (!editor) return;
    const adapter = editor.renderAdapter as PomeloRendererAdapter;
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
    const view = adapter.getView();
    if (!view) return;
    const viewRect = view.getBoundingClientRect();
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min((viewRect.width - 160) / rect.width, (viewRect.height - 160) / rect.height, 1)));
    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    adapter.setTransform(viewRect.width / 2 - center.x * scale, viewRect.height / 2 - center.y * scale, scale);
    useWorldDemoStore.getState().setTransform({ x: adapter.transform.x, y: adapter.transform.y, scale });
  };

  // 视口中心的世界坐标：独立插入元素的落点
  const centerWorldPos = () => {
    if (!editor) return { x: 420, y: 300 };
    const adapter = editor.renderAdapter as PomeloRendererAdapter;
    const view = adapter.getView();
    if (!view) return { x: 420, y: 300 };
    const rect = view.getBoundingClientRect();
    const t = adapter.transform;
    return { x: (rect.width / 2 - t.x) / t.scale, y: (rect.height / 2 - t.y) / t.scale };
  };

  const toggleGrid = () => {
    if (!editor) return;
    const plugin = editor.pluginRegistry.get("GridPlugin") as GridPlugin | undefined;
    if (!plugin) return;
    plugin.enabled = !gridOn;
    plugin.draw(editor.renderAdapter);
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
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
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
      <OutlineToggle />
      <ToolButton active={linkMode} disabled={readOnly} label="连线：点击起点实体，再点击目标实体" onClick={() => setLinkMode(!linkMode)}>
        <Spline className="size-4" />
      </ToolButton>
      <Divider />
      {/* ＋ 创建菜单（D12/B.7）：最显眼按钮；锚点 = 按钮正下方 */}
      <ToolButton
        active={creating}
        disabled={readOnly}
        label="新建：设定 / 便签 / 文本（双击空白按最近类型快捷创建）"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setCreating(true, { screenX: rect.left, screenY: rect.bottom + 8 });
        }}
      >
        <Plus className="size-4" />
      </ToolButton>
      <div className="relative">
        <ToolButton active={menu === "history"} disabled={readOnly} label="历史：最近变更（逐条撤销）/ 版本快照（回滚）" onClick={() => setMenu(menu === "history" ? null : "history")}>
          <HistoryIcon className="size-4" />
        </ToolButton>
        {menu === "history" && <HistoryMenu onClose={() => setMenu(null)} />}
      </div>
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
              <li>• 单击卡/元素/线：选中（右侧面板）</li>
              <li>• 双击实体卡：进入内部；双击便签/文本：就地编辑</li>
              <li>• 双击空白：按最近类型建卡（Alt = 创建菜单）</li>
              <li>• 悬停卡拖「＋」手柄：连到实体 = 建关系，落空 = 加属性</li>
              <li>• 连线工具：点起点 → 点终点，可连续多条，Esc 退出</li>
              <li>• 拖文件到卡：添加为该设定的媒体属性；拖到空白：独立素材</li>
              <li>• Del：删草稿/关系；实体走删除确认</li>
              <li>• ⌘Z 撤销布局（不含语义）；⌘[ 返回上一层</li>
              <li>• 新建设定先成为「草稿」，面板确认后转正</li>
            </ul>
          </div>
        )}
      </div>
      {menu && <div className="fixed inset-0 z-40" onPointerDown={() => setMenu(null)} />}
    </span>
  );
}

// 历史菜单（T12/B.14）：上半 = 最近变更（逐条撤销，最近 10 条）；下半 = 版本快照（最近 5 条，回滚为指针回移）
function HistoryMenu({ onClose }: { onClose: () => void }) {
  const changeLog = useWorldCanvasStore((state) => state.changeLog);
  const undoChange = useWorldCanvasStore((state) => state.undoChange);
  const revertToRevision = useWorldCanvasStore((state) => state.revertToRevision);
  const worldId = useWorldCanvasStore((state) => state.worldId);
  const currentRevisionId = useWorldCanvasStore((state) => state.revisionId);
  const [revisions, setRevisions] = useState<WorldRevisionSummary[] | null>(null);
  useEffect(() => {
    void createRecutWorldsClient(useWorldCanvasStore.getState().apiBase)
      .revisions.list({ worldId })
      .then(setRevisions)
      .catch(() => setRevisions([]));
  }, [worldId, currentRevisionId]);
  return (
    <div className="absolute left-0 top-full z-50 mt-2 w-80 rounded-xl border border-zinc-700 bg-zinc-900 p-2 text-sm shadow-2xl">
      <p className="px-1.5 py-1 text-[10px] font-medium text-zinc-400">最近变更</p>
      {changeLog.length === 0 && <p className="px-1.5 py-1 text-xs text-zinc-500">暂无语义操作记录</p>}
      <ul className="max-h-40 overflow-y-auto">
        {changeLog.map((item) => (
          <li className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700/60" key={item.id}>
            <span className="min-w-0 truncate">
              {item.label} <span className="text-zinc-500">{item.at}</span>
            </span>
            <button className="shrink-0 rounded border border-zinc-600 px-1.5 py-0.5 text-[10px] hover:bg-zinc-700" onClick={() => void undoChange(item.id)} type="button">
              撤销
            </button>
          </li>
        ))}
      </ul>
      <div className="my-1.5 h-px bg-zinc-700" />
      <p className="px-1.5 py-1 text-[10px] font-medium text-zinc-400">版本快照</p>
      {!revisions && <p className="px-1.5 py-1 text-xs text-zinc-500">加载中…</p>}
      <ul className="max-h-40 overflow-y-auto">
        {(revisions ?? []).slice(0, 5).map((item, index) => (
          <li className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700/60" key={item.id}>
            <span className="min-w-0 truncate">
              {item.reason}
              {index === 0 ? "（当前）" : ""} <span className="text-zinc-500">{item.createdAt.slice(5, 16).replace("T", " ")}</span>
            </span>
            {index > 0 && (
              <button
                className="shrink-0 rounded border border-zinc-600 px-1.5 py-0.5 text-[10px] hover:bg-zinc-700"
                onClick={() => {
                  if (!window.confirm("回滚到该版本？此后的改动将被丢弃（版本仍保留在历史中）。")) return;
                  void revertToRevision(item.id);
                  onClose();
                }}
                type="button"
              >
                回滚
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// 大纲/搜索侧栏开关（T14）
function OutlineToggle() {
  const open = useWorldCanvasStore((state) => state.outlineOpen);
  const setOutlineOpen = useWorldCanvasStore((state) => state.setOutlineOpen);
  return (
    <button
      aria-label="大纲与搜索"
      className={`grid size-7 place-items-center rounded-md transition-colors ${open ? "bg-zinc-100 text-zinc-900" : "text-zinc-300 hover:bg-zinc-700/60 hover:text-white"}`}
      onClick={() => setOutlineOpen(!open)}
      title="大纲与搜索"
      type="button"
    >
      <ListTree className="size-4" />
    </button>
  );
}
