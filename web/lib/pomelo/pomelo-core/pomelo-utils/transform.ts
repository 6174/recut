export interface Transform {
  x: number;
  y: number;
  scale: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 窗口坐标转换为画布坐标
 */
export function windowToCanvas(point: Point, transform: Transform, containerRect: DOMRect): Point {
  return {
    x: (point.x - containerRect.left - transform.x) / transform.scale,
    y: (point.y - containerRect.top - transform.y) / transform.scale
  };
}

export function stageToCanvas(point: Point, transform: Transform): Point {
  return {
    x: (point.x - transform.x) / transform.scale,
    y: (point.y - transform.y) / transform.scale
  };
}

/**
 * 画布坐标转换为窗口坐标
 */
export function canvasToWindow(point: Point, transform: Transform, containerRect: DOMRect): Point {
  return {
    x: point.x * transform.scale + transform.x + containerRect.left,
    y: point.y * transform.scale + transform.y + containerRect.top
  };
}

/**
 * 转换矩形从窗口坐标到画布坐标
 */
export function windowRectToCanvas(rect: Rect, transform: Transform, containerRect: DOMRect): Rect {
  const topLeft = windowToCanvas(
    { x: rect.x, y: rect.y },
    transform,
    containerRect
  );

  return {
    x: topLeft.x,
    y: topLeft.y,
    width: rect.width / transform.scale,
    height: rect.height / transform.scale
  };
}

/**
 * 转换矩形从画布坐标到窗口坐标
 */
export function canvasRectToWindow(rect: Rect, transform: Transform, containerRect: DOMRect): Rect {
  const topLeft = canvasToWindow(
    { x: rect.x, y: rect.y },
    transform,
    containerRect
  );

  return {
    x: topLeft.x,
    y: topLeft.y,
    width: rect.width * transform.scale,
    height: rect.height * transform.scale
  };
}