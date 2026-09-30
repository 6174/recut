/*
 * [INPUT]: 无渲染器依赖（纯几何），输入为节点有效矩形（arrow-geometry 的 blockRect 产出）
 * [OUTPUT]: 对外提供多选对齐/分布/网格排布的单一实现：
 *           ArrangeMode / ARRANGE_LABELS（工具栏菜单与撤销标签共用文案）/
 *           ARRANGE_GAP（网格排布间距）/ arrangeMinCount（模式所需最小选中数）/
 *           computeArrange(rects, mode) —— 返回与输入同序的目标左上角（尺寸不变），不满足阈值返回 null。
 *           left/center-x/right/top/center-y/bottom 沿选中并集包围盒对齐；
 *           distribute-x/distribute-y 首尾不动、其余等间隙（重叠时允许负间隙）；
 *           grid 按当前纵向重叠聚类成行（行内按 x 排序），行内顶对齐 + 等水平间隙、行间等垂直间隙，
 *           锚定并集左上角 —— 即「网格排布」（Figma Tidy up 的行结构 + 等间隙）。
 * [POS]: lib/pomelo/world-canvas 的对齐几何（canvas-toolbar 的多选「对齐」菜单经 canvas-store.arrangeSelection 消费）；
 *        与 plugins/alignment-guide-plugin 互补：插件是拖拽期的实时吸附提示，本模块是一次性落位，不做增量吸附。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export type ArrangeRect = { x: number; y: number; width: number; height: number };
export type ArrangePoint = { x: number; y: number };

export type ArrangeMode =
  | "left"
  | "center-x"
  | "right"
  | "top"
  | "center-y"
  | "bottom"
  | "distribute-x"
  | "distribute-y"
  | "grid";

// 网格排布的行内 / 行间间距（世界坐标）：与 GridPlugin 的点阵步长（26）同量级，
// 整齐排列后落在网格上；此处不 import 插件常量，保持本模块零依赖（纯几何，可单测）。
export const ARRANGE_GAP = 26;

// 文案单一真源：工具栏菜单项与 changeLog（撤销提示）共用，避免两处各写一份中文标签
export const ARRANGE_LABELS: Record<ArrangeMode, string> = {
  left: "左对齐",
  "center-x": "水平居中",
  right: "右对齐",
  top: "顶对齐",
  "center-y": "垂直居中",
  bottom: "底对齐",
  "distribute-x": "水平分布间距",
  "distribute-y": "垂直分布间距",
  grid: "网格排布",
};

/** 该模式需要的最小选中数：分布首尾不动，至少三项才有可调整的间隙；其余两项即可。 */
export function arrangeMinCount(mode: ArrangeMode): number {
  return mode === "distribute-x" || mode === "distribute-y" ? 3 : 2;
}

function boundsOf(rects: ArrangeRect[]): ArrangeRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// 按当前 y 的中心点落进已成形行的纵向区间来聚类成行（同一排视为一行）；
// 同一行内再按 x 排序，保证「从左到右」的视觉顺序被保留
function groupIntoRows(rects: ArrangeRect[]): number[][] {
  const order = rects
    .map((_, index) => index)
    .sort((a, b) => rects[a].y - rects[b].y || rects[a].x - rects[b].x);
  const rows: number[][] = [];
  for (const index of order) {
    const rect = rects[index];
    const row = rows[rows.length - 1];
    if (row) {
      const top = Math.min(...row.map((item) => rects[item].y));
      const bottom = Math.max(...row.map((item) => rects[item].y + rects[item].height));
      const center = rect.y + rect.height / 2;
      if (center >= top && center <= bottom) {
        row.push(index);
        continue;
      }
    }
    rows.push([index]);
  }
  for (const row of rows) row.sort((a, b) => rects[a].x - rects[b].x);
  return rows;
}

/**
 * 计算多选对齐/分布/网格排布的目标左上角（世界坐标，取整）。
 * 返回数组与输入 rects 同序；选中数不足（见 arrangeMinCount）时返回 null，调用方据此跳过。
 */
export function computeArrange(rects: ArrangeRect[], mode: ArrangeMode): ArrangePoint[] | null {
  if (rects.length < arrangeMinCount(mode)) return null;
  const bounds = boundsOf(rects);
  const targets: ArrangePoint[] = rects.map((rect) => ({ x: Math.round(rect.x), y: Math.round(rect.y) }));

  // 对齐：沿并集包围盒的对应边/中线落位，另一轴保持不变
  const alignX = (kind: (rect: ArrangeRect) => number) => {
    for (const [index, rect] of rects.entries()) {
      targets[index] = { x: Math.round(kind(rect)), y: targets[index].y };
    }
  };
  const alignY = (kind: (rect: ArrangeRect) => number) => {
    for (const [index, rect] of rects.entries()) {
      targets[index] = { x: targets[index].x, y: Math.round(kind(rect)) };
    }
  };

  switch (mode) {
    case "left":
      alignX(() => bounds.x);
      break;
    case "center-x":
      alignX((rect) => bounds.x + (bounds.width - rect.width) / 2);
      break;
    case "right":
      alignX((rect) => bounds.x + bounds.width - rect.width);
      break;
    case "top":
      alignY(() => bounds.y);
      break;
    case "center-y":
      alignY((rect) => bounds.y + (bounds.height - rect.height) / 2);
      break;
    case "bottom":
      alignY((rect) => bounds.y + bounds.height - rect.height);
      break;
    case "distribute-x":
    case "distribute-y": {
      const axis = mode === "distribute-x" ? "x" : "y";
      const size = mode === "distribute-x" ? "width" : "height";
      const order = rects
        .map((_, index) => index)
        .sort((a, b) => rects[a][axis] - rects[b][axis] || rects[a][size] - rects[b][size]);
      const first = rects[order[0]];
      const last = rects[order[order.length - 1]];
      const span = last[axis] + last[size] - first[axis];
      const occupied = order.reduce((sum, index) => sum + rects[index][size], 0);
      const gap = (span - occupied) / (order.length - 1);
      let cursor = first[axis];
      for (const index of order) {
        targets[index] =
          axis === "x"
            ? { x: Math.round(cursor), y: targets[index].y }
            : { x: targets[index].x, y: Math.round(cursor) };
        cursor += rects[index][size] + gap;
      }
      break;
    }
    case "grid": {
      // 行结构来自当前位置（用户已经排出的视觉分排），只把每行摊平对齐并统一间隙：
      // 行内顶对齐 + 等水平间隙，行间等垂直间隙，整组锚定并集左上角
      let y = bounds.y;
      for (const row of groupIntoRows(rects)) {
        const rowHeight = Math.max(...row.map((index) => rects[index].height));
        let x = bounds.x;
        for (const index of row) {
          targets[index] = { x: Math.round(x), y: Math.round(y) };
          x += rects[index].width + ARRANGE_GAP;
        }
        y += rowHeight + ARRANGE_GAP;
      }
      break;
    }
  }

  return targets;
}
