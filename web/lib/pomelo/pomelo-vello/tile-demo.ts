/*
 * [INPUT]: 依赖 pomelo-tiles（TileController/geometry/types）、canvas2d-rasterizer、self-tests
 * [OUTPUT]: 对外提供 mountTileDemo(canvas)：一个自包含的瓦片渲染演示/验证宿主——
 *           生成卡片+箭头+接缝探针场景，接管 pan/zoom/拖拽，暴露 window 调试句柄（供 Playwright 驱动）。
 * [POS]: pomelo-vello 的 dev/e2e 验证宿主；不接后端、不依赖 pomelo 编辑器，只验证瓦片算法与合成。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Canvas2DRasterizer } from "./canvas2d-rasterizer";
import { runSelfTests, type SelfTestResult } from "./self-tests";
import { TileController } from "../pomelo-core/pomelo-tiles/controller";
import type { RenderChunk, Viewport } from "../pomelo-core/pomelo-tiles/types";

const PALETTE = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4"];
const CARD_W = 220;
const CARD_H = 120;
const GAP_X = 70;
const GAP_Y = 70;
const COLS = 6;
const ROWS = 8;
const PROBE = { x: 0, y: 3200, width: 1400, height: 700 };

interface DemoCard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  title: string;
}

export interface VelloTilesDebug {
  selfTest(): SelfTestResult[];
  state(): unknown;
  telemetry(): unknown;
  setViewport(partial: Partial<Viewport>): void;
  getViewport(): Viewport;
  resetViewport(): void;
  fit(): void;
  samplePixel(cssX: number, cssY: number): [number, number, number, number];
  sampleWorld(worldX: number, worldY: number): [number, number, number, number];
  cards(): DemoCard[];
  sceneCounts(): { chunks: number; cards: number; arrows: number };
  moveCard(id: string, dx: number, dy: number): void;
  probe(): { x: number; y: number; width: number; height: number };
  settle(maxFrames?: number): number;
  resetTelemetry(): void;
  isRasterizer(name: string): boolean;
  pause(): void;
  resume(): void;
  pointer(): {
    downs: number;
    hits: number;
    dragStarts: number;
    pans: number;
    moves: number;
    lastDx: number;
    lastDy: number;
    lastNextX: number;
    lastDragId: string;
  };
}

export interface TileDemo {
  debug: VelloTilesDebug;
  destroy(): void;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function buildScene(): { chunks: RenderChunk[]; cards: DemoCard[]; arrows: number } {
  const chunks: RenderChunk[] = [];
  const cards: DemoCard[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const index = row * COLS + col;
      const x = col * (CARD_W + GAP_X);
      const y = row * (CARD_H + GAP_Y);
      const card: DemoCard = {
        id: `card-${index}`,
        x,
        y,
        width: CARD_W,
        height: CARD_H,
        color: PALETTE[index % PALETTE.length],
        title: `Entity ${index + 1}`,
      };
      cards.push(card);
      chunks.push({
        id: card.id,
        nodeIds: [card.id],
        bounds: { minX: x, minY: y, maxX: x + CARD_W, maxY: y + CARD_H },
        estimatedCost: CARD_W + CARD_H,
        payload: (ctx: CanvasRenderingContext2D) => {
          roundRect(ctx, x, y, CARD_W, CARD_H, 14);
          ctx.fillStyle = "#14151a";
          ctx.fill();
          ctx.save();
          ctx.clip();
          ctx.globalAlpha = 0.18;
          ctx.fillStyle = card.color;
          ctx.fillRect(x, y, CARD_W, 42);
          ctx.restore();
          ctx.lineWidth = 2;
          ctx.strokeStyle = card.color;
          ctx.globalAlpha = 0.85;
          roundRect(ctx, x + 1, y + 1, CARD_W - 2, CARD_H - 2, 14);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#e5e7eb";
          ctx.font = "600 16px ui-sans-serif, system-ui, sans-serif";
          ctx.textBaseline = "top";
          ctx.fillText(card.title, x + 16, y + 14);
          ctx.fillStyle = "#9ca3af";
          ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText("world canvas tile", x + 16, y + 66);
        },
      });
    }
  }

  let arrows = 0;
  for (let index = 0; index + 1 < cards.length; index += 3) {
    const a = cards[index];
    const b = cards[index + 1];
    const ax = a.x + a.width;
    const ay = a.y + a.height / 2;
    const bx = b.x;
    const by = b.y + b.height / 2;
    const cxp = (ax + bx) / 2;
    const cyp = (ay + by) / 2 - 40;
    arrows++;
    chunks.push({
      id: `arrow-${index}`,
      nodeIds: [`arrow-${index}`],
      bounds: {
        minX: Math.min(ax, bx, cxp) - 20,
        minY: Math.min(ay, by, cyp) - 20,
        maxX: Math.max(ax, bx, cxp) + 20,
        maxY: Math.max(ay, by, cyp) + 20,
      },
      estimatedCost: 160,
      payload: (ctx: CanvasRenderingContext2D) => {
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(cxp, cyp, bx, by);
        ctx.strokeStyle = "#8b93a7";
        ctx.lineWidth = 2;
        ctx.stroke();
        const angle = Math.atan2(by - cyp, bx - cxp);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - 10 * Math.cos(angle - 0.4), by - 10 * Math.sin(angle - 0.4));
        ctx.lineTo(bx - 10 * Math.cos(angle + 0.4), by - 10 * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fillStyle = "#8b93a7";
        ctx.fill();
      },
    });
  }

  // 接缝探针：一块纯色矩形跨越多个瓦片边界，供像素级无缝验证
  chunks.push({
    id: "seam-probe",
    nodeIds: ["seam-probe"],
    bounds: { minX: PROBE.x, minY: PROBE.y, maxX: PROBE.x + PROBE.width, maxY: PROBE.y + PROBE.height },
    estimatedCost: PROBE.width + PROBE.height,
    payload: (ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(PROBE.x, PROBE.y, PROBE.width, PROBE.height);
    },
  });

  return { chunks, cards, arrows };
}

export function mountTileDemo(canvas: HTMLCanvasElement): TileDemo {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width || canvas.clientWidth || 800));
  const height = Math.max(240, Math.round(rect.height || canvas.clientHeight || 600));

  const scene = buildScene();
  const rasterizer = new Canvas2DRasterizer(canvas, "#0b0f19", dpr);
  rasterizer.resize(width, height, dpr);

  const controller = new TileController({
    pageId: "demo-page",
    rasterizer,
    maxCacheBytes: 64 * 1024 * 1024,
    budgetMs: 5,
    maxJobsPerFrame: 32,
  });
  for (const chunk of scene.chunks) controller.addChunk(chunk);

  let viewport: Viewport = { panX: 0, panY: 0, zoom: 0.7, width, height, dpr };
  let contentGeneration = 0;
  let navigationGeneration = 0;
  let navigationActive = false;
  let navTimer = 0;
  let dirty = true;
  let destroyed = false;
  let paused = false;

  const clampZoom = (zoom: number) => Math.max(0.1, Math.min(6, zoom));

  const fit = () => {
    const minX = 0;
    const minY = 0;
    const maxX = COLS * (CARD_W + GAP_X) - GAP_X;
    const maxY = ROWS * (CARD_H + GAP_Y) - GAP_Y;
    const zoom = Math.max(0.15, Math.min(1.2, Math.min((width - 80) / (maxX - minX), (height - 80) / (maxY - minY))));
    viewport = { ...viewport, zoom, panX: (width - (maxX - minX) * zoom) / 2 - minX * zoom, panY: (height - (maxY - minY) * zoom) / 2 - minY * zoom };
    dirty = true;
  };
  fit();

  const renderOnce = () => {
    controller.renderFrame({ viewport, contentGeneration, navigationGeneration, navigationActive });
    dirty = false;
  };

  const loop = () => {
    if (destroyed) return;
    if (!paused && (navigationActive || dirty || controller.scheduler.pending() > 0)) renderOnce();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // ---- 交互 ----
  const toWorld = (event: PointerEvent | WheelEvent): { x: number; y: number } => {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left - viewport.panX) / viewport.zoom,
      y: (event.clientY - bounds.top - viewport.panY) / viewport.zoom,
    };
  };

  const hitCard = (world: { x: number; y: number }): DemoCard | null => {
    for (let i = scene.cards.length - 1; i >= 0; i--) {
      const card = scene.cards[i];
      if (world.x >= card.x && world.x <= card.x + card.width && world.y >= card.y && world.y <= card.y + card.height) {
        return card;
      }
    }
    return null;
  };

  let drag: { card: DemoCard; offsetX: number; offsetY: number } | null = null;
  let panning: { lastX: number; lastY: number } | null = null;
  const pointerStats = { downs: 0, hits: 0, dragStarts: 0, pans: 0, moves: 0, lastDx: 0, lastDy: 0, lastNextX: 0, lastDragId: "" };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    pointerStats.downs++;
    canvas.setPointerCapture(event.pointerId);
    const world = toWorld(event);
    const card = hitCard(world);
    if (card) {
      pointerStats.hits++;
      pointerStats.dragStarts++;
      drag = { card, offsetX: world.x - card.x, offsetY: world.y - card.y };
    } else {
      pointerStats.pans++;
      panning = { lastX: event.clientX, lastY: event.clientY };
      navigationActive = true;
      navigationGeneration++;
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (drag || panning) pointerStats.moves++;
    if (drag) {
      const world = toWorld(event);
      const nextX = world.x - drag.offsetX;
      const nextY = world.y - drag.offsetY;
      const dx = nextX - drag.card.x;
      const dy = nextY - drag.card.y;
      pointerStats.lastDx = dx;
      pointerStats.lastDy = dy;
      pointerStats.lastNextX = nextX;
      pointerStats.lastDragId = drag.card.id;
      if (dx === 0 && dy === 0) return;
      controller.moveChunk(drag.card.id, dx, dy);
      drag.card.x = nextX;
      drag.card.y = nextY;
      contentGeneration++;
      dirty = true;
      return;
    }
    if (panning) {
      viewport = { ...viewport, panX: viewport.panX + (event.clientX - panning.lastX), panY: viewport.panY + (event.clientY - panning.lastY) };
      panning = { lastX: event.clientX, lastY: event.clientY };
      dirty = true;
    }
  };

  const endPointer = (event: PointerEvent) => {
    if (drag) {
      drag = null;
      contentGeneration++;
      dirty = true;
    }
    if (panning) {
      panning = null;
      navigationActive = false;
      navigationGeneration++;
      dirty = true;
    }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const bounds = canvas.getBoundingClientRect();
    const cx = event.clientX - bounds.left;
    const cy = event.clientY - bounds.top;
    const worldX = (cx - viewport.panX) / viewport.zoom;
    const worldY = (cy - viewport.panY) / viewport.zoom;
    const nextZoom = clampZoom(viewport.zoom * Math.pow(1.0015, -event.deltaY));
    viewport = { ...viewport, zoom: nextZoom, panX: cx - worldX * nextZoom, panY: cy - worldY * nextZoom };
    navigationActive = true;
    if (navTimer) window.clearTimeout(navTimer);
    navTimer = window.setTimeout(() => {
      navigationActive = false;
      navigationGeneration++;
      dirty = true;
    }, 180);
    dirty = true;
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  // ---- 调试句柄 ----
  const settle = (maxFrames = 30): number => {
    for (let frame = 0; frame < maxFrames; frame++) {
      controller.renderFrame({ viewport, contentGeneration, navigationGeneration, navigationActive: false });
      if (controller.scheduler.pending() === 0 && !dirty) {
        // 再跑一帧确认无新增
        const before = controller.telemetry.snapshot().tilesRenderedTotal;
        controller.renderFrame({ viewport, contentGeneration, navigationGeneration, navigationActive: false });
        if (controller.telemetry.snapshot().tilesRenderedTotal === before && controller.scheduler.pending() === 0) {
          return frame + 2;
        }
      }
    }
    return maxFrames;
  };

  const sampleWorld = (worldX: number, worldY: number): [number, number, number, number] => {
    const cssX = worldX * viewport.zoom + viewport.panX;
    const cssY = worldY * viewport.zoom + viewport.panY;
    return debug.samplePixel(cssX, cssY);
  };

  const debug: VelloTilesDebug = {
    selfTest: () => runSelfTests(),
    state: () => controller.debugState(),
    telemetry: () => controller.telemetry.snapshot(),
    setViewport: (partial) => {
      viewport = { ...viewport, ...partial };
      dirty = true;
    },
    getViewport: () => ({ ...viewport }),
    resetViewport: () => fit(),
    fit: () => fit(),
    samplePixel: (cssX, cssY) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return [0, 0, 0, 0];
      const data = ctx.getImageData(Math.round(cssX * dpr), Math.round(cssY * dpr), 1, 1).data;
      return [data[0], data[1], data[2], data[3]];
    },
    sampleWorld,
    cards: () => scene.cards.map((card) => ({ ...card })),
    sceneCounts: () => ({ chunks: controller.index.size(), cards: scene.cards.length, arrows: scene.arrows }),
    moveCard: (id, dx, dy) => {
      const card = scene.cards.find((item) => item.id === id);
      if (!card) return;
      controller.moveChunk(id, dx, dy);
      card.x += dx;
      card.y += dy;
      contentGeneration++;
      dirty = true;
    },
    probe: () => ({ ...PROBE }),
    settle,
    resetTelemetry: () => controller.telemetry.reset(),
    isRasterizer: (name) => rasterizer.name === name,
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      dirty = true;
    },
    pointer: () => ({ ...pointerStats }),
  };

  return {
    debug,
    destroy: () => {
      destroyed = true;
      if (navTimer) window.clearTimeout(navTimer);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endPointer);
      canvas.removeEventListener("pointercancel", endPointer);
      canvas.removeEventListener("wheel", onWheel);
      controller.invalidateStructure();
      rasterizer.destroy();
    },
  };
}
