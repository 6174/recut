/*
 * [INPUT]: 依赖 pomelo-core（PomeloPlugin / PomeloEditor）、pomelo-vello/overlay-dom（DomOverlay/cssColor）、
 * arrow-geometry（blockRect：与渲染/命中/连线共享的节点有效矩形解析）
 * [OUTPUT]: 对外提供 AlignmentGuidePlugin 与纯函数 computeAlignmentSnap：
 * - computeAlignmentSnap：open-pencil scene-graph/snap.ts 的对齐算法移植（无旋转、输入为矩形）——
 *   对被拖选区与其余节点做左/中/右、上/中/下成对比较，取每轴最近吸附量并生成跨两矩形的对齐提示线；
 * - AlignmentGuidePlugin：拖拽位移/缩放会话期间计算吸附修正（世界坐标 dx/dy）并在渲染器无关的 DomOverlay
 *   （屏幕空间 SVG）绘制对齐提示线（缩放传入零尺寸活动角矩形即可复用同一成对比较）；transform 变化自动重绘；
 *   enabled=false 直接旁路。
 * [POS]: lib/pomelo/world-canvas 的对齐提示插件（由 CanvasBindsPlugin 在拖拽位移/缩放时调用，不自行监听指针）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloEditor } from "../../pomelo-core/pomelo-editor";
import { PomeloPlugin } from "../../pomelo-core/pomelo-plugin";
import { DomOverlay, cssColor } from "../../pomelo-vello/overlay-dom";
import { blockRect } from "../arrow-geometry";

export type GuideRect = { x: number; y: number; width: number; height: number };

export type AlignmentGuide = {
  axis: "x" | "y";
  position: number;
  from: number;
  to: number;
};

export type AlignmentSnapResult = {
  dx: number;
  dy: number;
  guides: AlignmentGuide[];
};

// 吸附阈值：屏幕像素（除以 zoom 得到世界单位），与 open-pencil SNAP_THRESHOLD_SCREEN_PX 一致
export const SNAP_THRESHOLD_SCREEN_PX = 5;
const GUIDE_COLOR = 0xff3b8d;
const EPSILON = 1e-6;

// 同轴同位置的提示线合并（多条目标对齐到同一条线时，取并集区间画一条）
function dedupeGuides(guides: AlignmentGuide[]): AlignmentGuide[] {
  const merged = new Map<string, AlignmentGuide>();
  for (const guide of guides) {
    const key = `${guide.axis}:${guide.position}`;
    const current = merged.get(key);
    if (!current) merged.set(key, { ...guide });
    else {
      current.from = Math.min(current.from, guide.from);
      current.to = Math.max(current.to, guide.to);
    }
  }
  return [...merged.values()];
}

// open-pencil computeSnap 的矩形版：x 轴 left/left、left/right、right/left、right/right、center/center；
// y 轴同理；threshold 为世界单位。返回每轴最近吸附量 + 对应提示线（区间跨被拖矩形与目标矩形）。
export function computeAlignmentSnap(moving: GuideRect, targets: GuideRect[], threshold: number): AlignmentSnapResult {
  const m = {
    left: moving.x,
    right: moving.x + moving.width,
    centerX: moving.x + moving.width / 2,
    top: moving.y,
    bottom: moving.y + moving.height,
    centerY: moving.y + moving.height / 2,
  };

  let bestDx = Infinity;
  let bestDy = Infinity;
  const guides: AlignmentGuide[] = [];

  for (const target of targets) {
    const t = {
      left: target.x,
      right: target.x + target.width,
      centerX: target.x + target.width / 2,
      top: target.y,
      bottom: target.y + target.height,
      centerY: target.y + target.height / 2,
    };

    const xPairs: Array<[number, number]> = [
      [m.left, t.left],
      [m.left, t.right],
      [m.right, t.left],
      [m.right, t.right],
      [m.centerX, t.centerX],
    ];
    for (const [mVal, tVal] of xPairs) {
      const delta = tVal - mVal;
      const distance = Math.abs(delta);
      if (distance >= threshold) continue;
      if (distance < Math.abs(bestDx) - EPSILON) {
        bestDx = delta;
        for (let i = guides.length - 1; i >= 0; i--) if (guides[i].axis === "x") guides.splice(i, 1);
      }
      if (Math.abs(distance - Math.abs(bestDx)) <= EPSILON) {
        guides.push({ axis: "x", position: tVal, from: Math.min(m.top, t.top), to: Math.max(m.bottom, t.bottom) });
      }
    }

    const yPairs: Array<[number, number]> = [
      [m.top, t.top],
      [m.top, t.bottom],
      [m.bottom, t.top],
      [m.bottom, t.bottom],
      [m.centerY, t.centerY],
    ];
    for (const [mVal, tVal] of yPairs) {
      const delta = tVal - mVal;
      const distance = Math.abs(delta);
      if (distance >= threshold) continue;
      if (distance < Math.abs(bestDy) - EPSILON) {
        bestDy = delta;
        for (let i = guides.length - 1; i >= 0; i--) if (guides[i].axis === "y") guides.splice(i, 1);
      }
      if (Math.abs(distance - Math.abs(bestDy)) <= EPSILON) {
        guides.push({ axis: "y", position: tVal, from: Math.min(m.left, t.left), to: Math.max(m.right, t.right) });
      }
    }
  }

  return {
    dx: Math.abs(bestDx) <= threshold ? bestDx : 0,
    dy: Math.abs(bestDy) <= threshold ? bestDy : 0,
    guides: dedupeGuides(guides),
  };
}

export class AlignmentGuidePlugin extends PomeloPlugin {
  Name = "AlignmentGuidePlugin";
  // 对齐提示总开关（如工具栏「对齐」开关或 modifier 临时关闭时置 false）
  enabled = true;
  // 吸附阈值（屏幕像素）
  thresholdScreenPx = SNAP_THRESHOLD_SCREEN_PX;
  #overlay: DomOverlay | null = null;
  #guides: AlignmentGuide[] = [];
  #cleanup?: () => void;

  onEditorDidMount(editor: PomeloEditor) {
    const overlay = new DomOverlay(editor.getContainerDom());
    this.#overlay = overlay;
    // 缩放/平移后提示线仍须落在正确屏幕位置
    const unsubTransform = editor.renderAdapter.onTransformEvent.on(() => this.paint());
    this.#cleanup = () => {
      unsubTransform.dispose();
      overlay.destroy();
      this.#overlay = null;
      this.#guides = [];
    };
  }

  // 拖拽位移/缩放时调用：movingIds = 参与位移的 block id；movingRect = 世界包围盒（已含本次位移；
  // 缩放时传被拖角的零尺寸矩形）；axes 限制参与吸附/绘制提示的轴（锁比例缩放只有主轴能对齐）。
  // 返回世界坐标修正量（调用方加到原始 dx/dy 上），并更新提示线。
  snap(movingIds: Set<string>, movingRect: GuideRect, axes: ReadonlyArray<"x" | "y"> = ["x", "y"]): { dx: number; dy: number } {
    if (!this.enabled) {
      this.clear();
      return { dx: 0, dy: 0 };
    }
    const threshold = this.thresholdScreenPx / Math.max(this.editor.renderAdapter.transform.scale, EPSILON);
    const result = computeAlignmentSnap(movingRect, this.targetRects(movingIds), threshold);
    const useX = axes.includes("x");
    const useY = axes.includes("y");
    this.#guides = result.guides.filter((guide) => (guide.axis === "x" ? useX : useY));
    this.paint();
    return { dx: useX ? result.dx : 0, dy: useY ? result.dy : 0 };
  }

  // 结束拖拽 / 无吸附时清空提示线
  clear(): void {
    if (this.#guides.length === 0) return;
    this.#guides = [];
    this.paint();
  }

  // 参与对齐的其他节点矩形（排除被拖集合、根节点与无几何块）
  targetRects(movingIds: Set<string>): GuideRect[] {
    const rects: GuideRect[] = [];
    for (const record of this.editor.state.getAllBlocks((item) => !item.isRoot)) {
      if (movingIds.has(record.id)) continue;
      const rect = blockRect(record);
      if (rect.width > 0 && rect.height > 0) rects.push(rect);
    }
    return rects;
  }

  // 屏幕空间绘制对齐提示线（世界区间 → 屏幕），线宽/端点半径不随 zoom 变化
  paint(): void {
    const overlay = this.#overlay;
    if (!overlay) return;
    const t = this.editor.renderAdapter.transform;
    const screen = this.editor.renderAdapter.getScreenSize();
    overlay.setSize(screen.width, screen.height);
    overlay.clearAll();
    if (this.#guides.length === 0) return;
    for (const guide of this.#guides) {
      if (guide.axis === "x") {
        const x = guide.position * t.scale + t.x;
        const y1 = guide.from * t.scale + t.y;
        const y2 = guide.to * t.scale + t.y;
        overlay.line(x, y1, x, y2, { stroke: cssColor(GUIDE_COLOR, 0.9), strokeWidth: 1 });
        overlay.circle(x, y1, 2, { fill: cssColor(GUIDE_COLOR) });
        overlay.circle(x, y2, 2, { fill: cssColor(GUIDE_COLOR) });
      } else {
        const y = guide.position * t.scale + t.y;
        const x1 = guide.from * t.scale + t.x;
        const x2 = guide.to * t.scale + t.x;
        overlay.line(x1, y, x2, y, { stroke: cssColor(GUIDE_COLOR, 0.9), strokeWidth: 1 });
        overlay.circle(x1, y, 2, { fill: cssColor(GUIDE_COLOR) });
        overlay.circle(x2, y, 2, { fill: cssColor(GUIDE_COLOR) });
      }
    }
  }

  onEditorWillUnmount() {
    this.#cleanup?.();
    this.#cleanup = undefined;
  }

  dispose() {
    this.#cleanup?.();
  }
}
