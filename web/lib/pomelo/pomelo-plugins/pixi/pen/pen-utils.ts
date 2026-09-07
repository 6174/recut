import { PomeloBlockRecord, Rect } from "../../../pomelo-core";
import { PenPoint } from "./pen.type";

/**
 * 生成平滑的贝塞尔曲线控制点
 */
export function generateSmoothPath(points: PenPoint[]) {
  if (points.length < 2) return [];

  const result: {
    type: 'moveTo' | 'quadraticCurveTo';
    points: PenPoint[];
  }[] = [];

  // 起始点
  result.push({
    type: 'moveTo',
    points: [points[0]]
  });

  // 中间点的贝塞尔曲线
  for (let i = 1; i < points.length - 2; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2;
    const yc = (points[i].y + points[i + 1].y) / 2;
    result.push({
      type: 'quadraticCurveTo',
      points: [
        points[i],
        { x: xc, y: yc }
      ]
    });
  }

  // 处理最后两个点
  if (points.length > 2) {
    result.push({
      type: 'quadraticCurveTo',
      points: [
        points[points.length - 2],
        points[points.length - 1]
      ]
    });
  }

  return result;
}

/**
 * 将平滑路径转换为 SVG path 字符串
 */
export function smoothPathToSVG(points: PenPoint[]): string {
  const pathCommands = generateSmoothPath(points);
  return pathCommands.map(command => {
    if (command.type === 'moveTo') {
      return `M ${command.points[0].x} ${command.points[0].y}`;
    } else {
      return `Q ${command.points[0].x} ${command.points[0].y}, ${command.points[1].x} ${command.points[1].y}`;
    }
  }).join(' ');
}

export function calculatePathBounds(points: PenPoint[]) {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;

  points.forEach(point => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

export function isPathIntersectWithBlock(
  eraserPoints: PenPoint[],
  block: PomeloBlockRecord
): boolean {
  const blockPaths = block.attrs.paths || [];
  const blockX = block.attrs.x || 0;
  const blockY = block.attrs.y || 0;

  // 简单的包围盒检测
  const eraserBounds = calculatePathBounds(eraserPoints);
  const blockBounds = {
    x: blockX,
    y: blockY,
    width: block.attrs.width,
    height: block.attrs.height
  };

  // 如果包围盒不相交，路径一定不相交
  if (!isRectIntersect(eraserBounds, blockBounds)) {
    return false;
  }

  // 进一步检查路径段是否相交
  return blockPaths.some(path =>
    isPathsIntersect(
      eraserPoints,
      path.points.map(p => ({ x: p.x + blockX, y: p.y + blockY }))
    )
  );
}

function isRectIntersect(r1: Rect, r2: Rect): boolean {
  return !(
    r1.x + r1.width < r2.x ||
    r2.x + r2.width < r1.x ||
    r1.y + r1.height < r2.y ||
    r2.y + r2.height < r1.y
  );
}

function isPathsIntersect(path1: PenPoint[], path2: PenPoint[]): boolean {
  // 简化版的路径相交检测
  // 可以根据需要实现更精确的检测算法
  for (let i = 1; i < path1.length; i++) {
    for (let j = 1; j < path2.length; j++) {
      // 判断两条线段是否相交
      // 使用向量叉积判断两条线段是否相交
      // 如果两条线段相交，那么线段1的两个端点在线段2的两侧，线段2的两个端点在线段1的两侧
      const p1 = path1[i - 1], p2 = path1[i];
      const p3 = path2[j - 1], p4 = path2[j];
      
      const d1 = (p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x);
      const d2 = (p4.x - p3.x) * (p2.y - p3.y) - (p4.y - p3.y) * (p2.x - p3.x);
      const d3 = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
      const d4 = (p2.x - p1.x) * (p4.y - p1.y) - (p2.y - p1.y) * (p4.x - p1.x);
      
      if (d1 * d2 <= 0 && d3 * d4 <= 0) {
        return true;
      }
    }
  }
  return false;
}