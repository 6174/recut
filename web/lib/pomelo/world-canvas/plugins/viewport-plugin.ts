/*
 * [INPUT]: 依赖 pomelo-core（PomeloPlugin / PomeloEditor / PomeloRendererAdapter）
 * [OUTPUT]: 对外提供 ViewportPlugin：wheel 平移、ctrl/⌘+wheel 以指针为锚点缩放、空格拖拽与中键拖拽平移；
 * transform 经 adapter.setTransform 写入渲染器并镜像到 demo-store；附 zoomAt/centerContent/centerOnBlock 辅助
 * （centerOnBlock = 把某个 block 的渲染矩形居中到视口，供大纲/预览点节点聚焦）
 * [POS]: lib/pomelo/world-canvas 的视口插件（pomelo plugin 机制的第一个控制层扩展示例）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloEditor } from "../../pomelo-core/pomelo-editor";
import type { PomeloRendererAdapter } from "../../pomelo-core/pomelo-renderer";
import { PomeloPlugin } from "../../pomelo-core/pomelo-plugin";
import { blockRect } from "../arrow-geometry";
import { entityCardRect } from "../blocks/entity-card-metrics";
import { useWorldDemoStore, type Transform } from "../demo-store";

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 10;

export function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

// 以屏幕坐标（相对 canvas）为锚点缩放：保持锚点下的世界坐标不动（tldraw viewport 同款公式）
export function zoomAt(transform: Transform, screen: { x: number; y: number }, nextScale: number): Transform {
  const scale = clampScale(nextScale);
  const worldX = (screen.x - transform.x) / transform.scale;
  const worldY = (screen.y - transform.y) / transform.scale;
  return { scale, x: screen.x - worldX * scale, y: screen.y - worldY * scale };
}

export function panBy(transform: Transform, dx: number, dy: number): Transform {
  return { ...transform, x: transform.x + dx, y: transform.y + dy };
}

export class ViewportPlugin extends PomeloPlugin {
  Name = "ViewportPlugin";
  #spaceDown = false;
  #cleanup?: () => void;

  onEditorDidMount(editor: PomeloEditor) {
    const adapter = editor.renderAdapter as PomeloRendererAdapter;
    const view = adapter.getView() ?? undefined;
    if (!view) throw new Error("[viewport] view missing");
    const disposables: Array<() => void> = [];

    const apply = (transform: Transform) => {
      adapter.setTransform(transform.x, transform.y, transform.scale);
      useWorldDemoStore.getState().setTransform(transform);
    };
    const current = (): Transform => ({ ...adapter.transform });

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = view.getBoundingClientRect();
      const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 0.002);
        apply(zoomAt(current(), screen, current().scale * factor));
      } else {
        apply(panBy(current(), -event.deltaX, -event.deltaY));
      }
    };
    view.addEventListener("wheel", onWheel, { passive: false });
    disposables.push(() => view.removeEventListener("wheel", onWheel));

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.code === "Space" && !this.#spaceDown) {
        this.#spaceDown = true;
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") this.#spaceDown = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    disposables.push(() => window.removeEventListener("keydown", onKeyDown));
    disposables.push(() => window.removeEventListener("keyup", onKeyUp));

    // 空格/中键拖拽平移
    let panning: { pointerId: number; lastX: number; lastY: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 1 || (event.button === 0 && this.#spaceDown)) {
        panning = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
        view.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!panning || event.pointerId !== panning.pointerId) return;
      apply(panBy(current(), event.clientX - panning.lastX, event.clientY - panning.lastY));
      panning.lastX = event.clientX;
      panning.lastY = event.clientY;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (panning && event.pointerId === panning.pointerId) {
        panning = null;
        view.releasePointerCapture?.(event.pointerId);
      }
    };
    view.addEventListener("pointerdown", onPointerDown);
    view.addEventListener("pointermove", onPointerMove);
    view.addEventListener("pointerup", onPointerUp);
    view.addEventListener("pointercancel", onPointerUp);
    disposables.push(() => view.removeEventListener("pointerdown", onPointerDown));
    disposables.push(() => view.removeEventListener("pointermove", onPointerMove));
    disposables.push(() => view.removeEventListener("pointerup", onPointerUp));
    disposables.push(() => view.removeEventListener("pointercancel", onPointerUp));

    this.#cleanup = () => disposables.forEach((dispose) => dispose());
  }

  onEditorWillUnmount() {
    this.#cleanup?.();
    this.#cleanup = undefined;
  }

  dispose() {
    this.#cleanup?.();
  }
}

// 初始视口：把内容包围盒居中到画布
export function centerContent(editor: PomeloEditor) {
  const adapter = editor.renderAdapter as PomeloRendererAdapter;
  const state = editor.state;
  const blocks = state.getAllBlocks((record) => !record.isRoot && record.type !== "relation-arrow");
  const view = adapter.getView();
  if (!view) return;
  const viewRect = view.getBoundingClientRect();
  // 空层（如刚进入、尚无元素的子世界）：不能沿用上一层的 transform（会落在别处且缩放很小），
  // 重置为「世界原点居中、1:1」，让后续新建/落卡出现在视野中央。
  if (!blocks.length) {
    adapter.setTransform(viewRect.width / 2, viewRect.height / 2, 1);
    useWorldDemoStore.getState().setTransform({ x: adapter.transform.x, y: adapter.transform.y, scale: 1 });
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const record of blocks) {
    // 用渲染有效矩形（实体卡/音频块经 resolver 用固有尺寸，与所见一致），而非存储 attrs，
    // 否则实体卡按默认高度算包围盒，fit 后仍会有卡片被裁掉。
    const rect = blockRect(record);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  const rect = viewRect;
  const scale = clampScale(Math.min((rect.width / (maxX - minX + 160)) as number, (rect.height / (maxY - minY + 160)) as number, 1));
  const contentCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  adapter.setTransform(rect.width / 2 - contentCenter.x * scale, rect.height / 2 - contentCenter.y * scale, scale);
  useWorldDemoStore.getState().setTransform({ x: adapter.transform.x, y: adapter.transform.y, scale });
}

// 工具栏缩放按钮：以画布中心为锚点
export function zoomByCenter(editor: PomeloEditor, factor: number) {
  const adapter = editor.renderAdapter as PomeloRendererAdapter;
  const view = adapter.getView();
  if (!view) return;
  const rect = view.getBoundingClientRect();
  const transform = { ...adapter.transform };
  const next = zoomAt(transform, { x: rect.width / 2, y: rect.height / 2 }, transform.scale * factor);
  adapter.setTransform(next.x, next.y, next.scale);
  useWorldDemoStore.getState().setTransform(next);
}

// 聚焦某个 block：保持当前缩放，把它的渲染矩形中心移到视口中心。
// 矩形取渲染真源（实体卡高度由内容派生，见 entityCardRect），否则居中会偏。
// mirrorDemoStore=false 用于官网预览画布（无 demo-store 消费方）。
export function centerOnBlock(editor: PomeloEditor, blockId: string, opts: { mirrorDemoStore?: boolean } = {}): boolean {
  const adapter = editor.renderAdapter as PomeloRendererAdapter;
  const record = editor.state.getBlockById(blockId);
  const view = adapter.getView();
  if (!record || !view) return false;
  const rect =
    record.type === "entity-card"
      ? entityCardRect(record.attrs as Record<string, unknown>)
      : {
          x: Number(record.attrs.x) || 0,
          y: Number(record.attrs.y) || 0,
          width: Number(record.attrs.width) || 0,
          height: Number(record.attrs.height) || 0,
        };
  if (rect.width <= 0 || rect.height <= 0) return false;
  const viewRect = view.getBoundingClientRect();
  if (viewRect.width < 2 || viewRect.height < 2) return false;
  const scale = clampScale(adapter.transform.scale);
  const next: Transform = {
    x: viewRect.width / 2 - (rect.x + rect.width / 2) * scale,
    y: viewRect.height / 2 - (rect.y + rect.height / 2) * scale,
    scale,
  };
  adapter.setTransform(next.x, next.y, next.scale);
  if (opts.mirrorDemoStore !== false) useWorldDemoStore.getState().setTransform(next);
  return true;
}
