/*
 * [INPUT]: 无渲染器依赖（纯几何），输入为节点有效矩形（arrow-geometry 的 blockRect 产出）
 * [OUTPUT]: 对外提供多选对齐/分布/网格排布/树形排布的单一实现：
 *           ArrangeMode / ARRANGE_LABELS（工具栏菜单与撤销标签共用文案）/
 *           ARRANGE_GAP（网格/树形同级间距）/ TREE_LAYER_GAP（树形层级间距）/ arrangeMinCount（模式所需最小选中数）/
 *           computeArrange(rects, mode) —— 返回与输入同序的目标左上角（尺寸不变），不满足阈值返回 null。
 *           left/center-x/right/top/center-y/bottom 沿选中并集包围盒对齐；
 *           distribute-x/distribute-y 首尾不动、其余等间隙（重叠时允许负间隙）；
 *           grid 按顶边邻近聚类成行（行内按 x 排序），行内顶对齐 + 等水平间隙、行间等垂直间隙，
 *           锚定并集左上角 —— 即「网格排布」（Figma Tidy up 的行结构 + 等间隙）。
 *           computeTreeLayout(nodes, edges, direction) —— 依据选中节点间的关系边建森林，
 *           纵向（从上到下，同级从左到右）/ 横向（从左到右，同级从上到下）Reingold–Tilford 式排布。
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
  | "grid"
  | "tree-down"
  | "tree-right";

// 树形排布节点：矩形 + 稳定语义 id（供边引用）；同样零渲染依赖，纯几何可单测。
export type ArrangeNode = ArrangeRect & { id: string };
// 树形排布的边：from 为父、to 为子（方向即视觉层级方向）。
export type ArrangeEdge = { from: string; to: string };
export type TreeDirection = "vertical" | "horizontal";

// 网格排布 / 树形排布同行·同级的间隙（世界坐标）：与 GridPlugin 的点阵步长（26）同量级，
// 整齐排列后落在网格上；此处不 import 插件常量，保持本模块零依赖（纯几何，可单测）。
export const ARRANGE_GAP = 26;

// 树形排布的**层级间距**（主轴：纵向树的上下层、横向树的左右层）：比同级间隙大几倍，
// 把层与层拉开，否则上下层卡片紧贴、关系走向看不清。
export const TREE_LAYER_GAP = ARRANGE_GAP * 6;

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
  "tree-down": "树形排布（从上到下）",
  "tree-right": "树形排布（从左到右）",
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

// 行容差：顶边相差不超过「中位高度 × 0.6」视为同一行（至少 ARRANGE_GAP）。
// 用数据推导而非固定值，适配大小卡混排；顶边邻近而非中心，才能让高卡片只占自己那一行。
function rowTolerance(rects: ArrangeRect[]): number {
  if (rects.length === 0) return ARRANGE_GAP;
  const heights = rects.map((rect) => rect.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] ?? 0;
  return Math.max(ARRANGE_GAP, median * 0.6);
}

// 按顶边邻近聚类成行（同一排视为一行）；按 y 排序保证上→下，行内再按 x 排序保证左→右。
// 旧实现按「中心点落进已成形行的纵向包围盒」判定：一行里只要有一张高卡片，行的包围盒就被撑大，
// 把下面几行整体吞进同一行（网格塌成一条横排）。改用顶边邻近后，高卡片不再吞并后续行。
function groupIntoRows(rects: ArrangeRect[]): number[][] {
  const order = rects
    .map((_, index) => index)
    .sort((a, b) => rects[a].y - rects[b].y || rects[a].x - rects[b].x);
  const tolerance = rowTolerance(rects);
  const rows: number[][] = [];
  let rowTop = Number.NEGATIVE_INFINITY;
  for (const index of order) {
    const rect = rects[index];
    const row = rows[rows.length - 1];
    // order 已按 y 升序，rect.y >= rowTop 恒成立，无需取绝对值
    if (row && rect.y - rowTop <= tolerance) {
      row.push(index);
      continue;
    }
    rows.push([index]);
    rowTop = rect.y;
  }
  for (const row of rows) row.sort((a, b) => rects[a].x - rects[b].x);
  return rows;
}

/**
 * 分组容器内的「网格布局」：把节点按**输入顺序**（调用方负责排序，如按名称）
 * 行优先铺排，列数缺省 ceil(sqrt(n))，行内/行间等间隙，整组锚定并集包围盒左上角。
 * 返回与输入 nodes 同序的左上角坐标；节点数 < 1 返回 null。
 * 与 computeArrange 的 "grid" 不同：后者保留用户当前行结构，本函数从零重排——用于一键布局。
 */
export function computeGridLayout(
  nodes: ArrangeNode[],
  opts: { columns?: number; gap?: number } = {},
): ArrangePoint[] | null {
  if (nodes.length === 0) return null;
  const gap = opts.gap ?? ARRANGE_GAP;
  const columns = Math.max(1, Math.floor(opts.columns ?? Math.ceil(Math.sqrt(nodes.length))));
  const bounds = boundsOf(nodes);
  const targets: ArrangePoint[] = nodes.map((node) => ({ x: Math.round(node.x), y: Math.round(node.y) }));
  // 每列宽度 = 该列最宽节点；每行高度 = 该行最高节点（列/行尺寸由内容决定，避免大卡错位）
  const columnWidth = new Array<number>(columns).fill(0);
  const rowHeight = new Array<number>(Math.ceil(nodes.length / columns)).fill(0);
  nodes.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidth[column] = Math.max(columnWidth[column], node.width);
    rowHeight[row] = Math.max(rowHeight[row], node.height);
  });
  let y = bounds.y;
  for (let row = 0; row < rowHeight.length; row++) {
    let x = bounds.x;
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      if (index >= nodes.length) break;
      targets[index] = { x: Math.round(x), y: Math.round(y) };
      x += columnWidth[column] + gap;
    }
    y += rowHeight[row] + gap;
  }
  return targets;
}

/**
 * 计算多选对齐/分布/网格排布的目标左上角（世界坐标，取整）。
 * 返回数组与输入 rects 同序；选中数不足（见 arrangeMinCount）时返回 null，调用方据此跳过。
 */
export function computeArrange(rects: ArrangeRect[], mode: ArrangeMode): ArrangePoint[] | null {
  // 树形排布需要关系边，不走本函数（由 computeTreeLayout 负责）；此处返回 null 表示「本函数不处理」
  if (mode === "tree-down" || mode === "tree-right") return null;
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

/**
 * 树形排布（依据选中节点间的关系边建森林，再 Reingold–Tilford 式落位）：
 *   纵向 vertical：根在上、子层向下，同级从左到右；
 *   横向 horizontal：根在左、子层向右，同级从上到下。
 * 边 from → to 即父 → 子；入度为 0 的为根，剩余（成环）按位置顺序补根，保证每个节点都落位；
 * 无任何边时退化为「单行/单列」（各节点互为根）。返回与输入 nodes 同序的左上角坐标。
 * 独立于 computeArrange：位置只由边决定，不看现有摆放，故能真正「成树」。
 */
export function computeTreeLayout(
  nodes: ArrangeNode[],
  edges: ArrangeEdge[],
  direction: TreeDirection = "vertical",
  crossCompare?: (a: ArrangeNode, b: ArrangeNode) => number,
): ArrangePoint[] | null {
  if (nodes.length < 2) return null;
  const n = nodes.length;
  const indexOf = new Map(nodes.map((node, index) => [node.id, index]));

  // 邻接与入度（忽略自环/悬空端点）
  const out: number[][] = nodes.map(() => []);
  const indegree = new Array<number>(n).fill(0);
  for (const edge of edges) {
    const from = indexOf.get(edge.from);
    const to = indexOf.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    out[from].push(to);
    indegree[to] += 1;
  }

  // 交叉轴顺序：纵向树同级从左到右（按 x），横向树同级从上到下（按 y）
  const crossKey = (index: number) => (direction === "vertical" ? nodes[index].x : nodes[index].y);
  const crossSort = (a: number, b: number) => (crossCompare ? crossCompare(nodes[a], nodes[b]) : crossKey(a) - crossKey(b));
  const order = nodes.map((_, index) => index).sort(crossSort);

  // 建森林：BFS 认子，已认领的不再被第二父认领（环与多父都安全）
  const children: number[][] = nodes.map(() => []);
  const parent = new Array<number>(n).fill(-1);
  const assigned = new Array<boolean>(n).fill(false);
  const rootAt = (start: number) => {
    if (assigned[start]) return;
    assigned[start] = true;
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift() as number;
      for (const next of out[current]) {
        if (assigned[next]) continue;
        assigned[next] = true;
        parent[next] = current;
        children[current].push(next);
        queue.push(next);
      }
    }
  };
  for (const index of order) if (indegree[index] === 0) rootAt(index);
  for (const index of order) rootAt(index); // 环：按位置顺序补根
  for (const list of children) list.sort(crossSort);

  // 主轴尺寸/交叉轴尺寸（横向树把两轴对调）
  const crossSize = (index: number) => (direction === "vertical" ? nodes[index].width : nodes[index].height);
  const mainSize = (index: number) => (direction === "vertical" ? nodes[index].height : nodes[index].width);

  // 深度（从各根 BFS）
  const roots = order.filter((index) => parent[index] === -1);
  const depth = new Array<number>(n).fill(0);
  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.shift() as number;
    for (const next of children[current]) {
      depth[next] = depth[current] + 1;
      queue.push(next);
    }
  }

  // 子树交叉轴宽度 = max(自身, 子级并排)；主轴每层高度取该层最大
  const widthMemo = new Array<number>(n).fill(-1);
  const subtreeWidth = (index: number): number => {
    if (widthMemo[index] >= 0) return widthMemo[index];
    let total = 0;
    children[index].forEach((child, childIndex) => {
      if (childIndex > 0) total += ARRANGE_GAP;
      total += subtreeWidth(child);
    });
    const value = Math.max(crossSize(index), total);
    widthMemo[index] = value;
    return value;
  };
  const levelMain: number[] = [];
  for (let index = 0; index < n; index++) {
    const level = depth[index];
    levelMain[level] = Math.max(levelMain[level] ?? 0, mainSize(index));
  }
  const mainAt: number[] = [];
  let acc = 0;
  for (let level = 0; level < levelMain.length; level++) {
    mainAt[level] = acc;
    acc += (levelMain[level] ?? 0) + TREE_LAYER_GAP;
  }

  const targets: ArrangePoint[] = nodes.map((node) => ({ x: Math.round(node.x), y: Math.round(node.y) }));
  const setPoint = (index: number, cross: number, main: number) => {
    targets[index] =
      direction === "vertical"
        ? { x: Math.round(cross), y: Math.round(main) }
        : { x: Math.round(main), y: Math.round(cross) };
  };
  const place = (index: number, crossOrigin: number) => {
    const width = subtreeWidth(index);
    setPoint(index, crossOrigin + (width - crossSize(index)) / 2, mainAt[depth[index]]);
    const kids = children[index];
    if (kids.length === 0) return;
    let span = 0;
    kids.forEach((child, childIndex) => {
      if (childIndex > 0) span += ARRANGE_GAP;
      span += subtreeWidth(child);
    });
    let cursor = crossOrigin + (width - span) / 2;
    for (const child of kids) {
      place(child, cursor);
      cursor += subtreeWidth(child) + ARRANGE_GAP;
    }
  };
  let rootCursor = 0;
  for (const root of roots) {
    place(root, rootCursor);
    rootCursor += subtreeWidth(root) + ARRANGE_GAP * 2; // 森林各树之间留更大间隔
  }

  // 锚定并集包围盒左上角（与其它排布一致：整组不被挪出原区域）
  const bounds = boundsOf(nodes);
  let minX = Infinity;
  let minY = Infinity;
  for (const target of targets) {
    minX = Math.min(minX, target.x);
    minY = Math.min(minY, target.y);
  }
  const shiftX = Math.round(bounds.x - minX);
  const shiftY = Math.round(bounds.y - minY);
  return targets.map((target) => ({ x: target.x + shiftX, y: target.y + shiftY }));
}
