/*
 * [INPUT]: 依赖 pomelo-tiles（TileController/geometry/types）、canvas2d-rasterizer、vello-rasterizer、
 *           op-bridge、self-tests
 * [OUTPUT]: 对外提供 mountTileDemo(canvas)：自包含瓦片渲染演示/验证宿主——生成卡片+箭头+接缝探针场景
 *           （每个 chunk 同时带 Canvas2D 绘制与 vello op 字节流），自动选择 vello(WebGPU) 或 Canvas2D 光栅器，
 *           接管 pan/zoom/拖拽，暴露 window 调试句柄（供 Playwright 驱动）。
 * [POS]: pomelo-vello 的 dev/e2e 验证宿主；不接后端、不依赖 pomelo 编辑器。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Canvas2DRasterizer } from "./canvas2d-rasterizer";
import { VelloGpuRasterizer } from "./vello-rasterizer";
import { encodeOps, type Rgba, type VelloOp } from "./op-bridge";
import { runSelfTests, type SelfTestResult } from "./self-tests";
import { TileController } from "../pomelo-core/pomelo-tiles/controller";
import type { RenderChunk, TileRasterizer, Viewport } from "../pomelo-core/pomelo-tiles/types";

const PALETTE = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4"];
const CARD_W = 220;
const CARD_H = 120;
const GAP_X = 70;
const GAP_Y = 70;
const COLS = 6;
const ROWS = 8;
const PROBE = { x: 0, y: 3200, width: 1400, height: 700 };
const TEXT_PROBE = { x: 0, y: 4200, width: 1400, height: 400 };
const FONT_ID = 1;
const IMAGE_ID = 2;
const CJK_FONT_ID = 3;
const CJK_PROBE = { x: 0, y: 5300, width: 1400, height: 400 };
const SHADOW_PROBE = { x: 0, y: 5700, width: 512, height: 320 };
const IMAGE_PROBE = { x: 0, y: 4700, width: 400, height: 400 };

interface DemoCard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  title: string;
}

interface ChunkPayload {
  canvas: (ctx: CanvasRenderingContext2D) => void;
  velloOps: Uint8Array;
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
  imageProbe(): { x: number; y: number; width: number; height: number };
  settle(maxFrames?: number): number;
  resetTelemetry(): void;
  isRasterizer(name: string): boolean;
  rasterizerName(): string;
  covered(): boolean;
  settleCovered(maxFrames?: number): number;
  fontRegistered(): boolean;
  cjkRegistered(): boolean;
  cjkProbe(): { x: number; y: number; width: number; height: number };
  shadowProbe(): { x: number; y: number; width: number; height: number };
  imageRegistered(): boolean;
  pause(): void;
  resume(): void;
  debugImageTest(): void;
  debugTileTest(): void;
  debugPairTest(): void;
  debugRegisteredImageTest(): void;
  renderChunkOps(id: string, level: number, minX: number, minY: number): void;
  presentCached(panX: number, panY: number, zoom: number): number;
  presentTileByKey(key: string, panX: number, panY: number, zoom: number): boolean;
  rasterStats(): { name: string; lastOpsLength?: number; lastChunkCount?: number; maxOpsLength?: number; nonEmptyTiles?: number; totalTiles?: number };
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

function hexToRgba(hex: string, alpha = 255): Rgba {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return [r, g, b, alpha];
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
      const accent = hexToRgba(card.color);
      const velloOps = encodeOps([
        { kind: "roundRect", x, y, width: CARD_W, height: CARD_H, radius: 14, fill: [20, 21, 26, 255], stroke: [0, 0, 0, 0], strokeWidth: 0 },
        // 表头与缩略图裁剪到圆角内（否则直角 fill 会盖住圆角）
        { kind: "pushClipRoundRect", x, y, width: CARD_W, height: CARD_H, radius: 14 },
        { kind: "rectFill", x, y, width: CARD_W, height: 42, fill: [accent[0], accent[1], accent[2], 46] },
        { kind: "popClip" },
        { kind: "pushClipRoundRect", x: x + CARD_W - 72, y: y + 56, width: 56, height: 52, radius: 8 },
        { kind: "image", imageId: IMAGE_ID, x: x + CARD_W - 72, y: y + 56, width: 56, height: 52 },
        { kind: "popClip" },
        { kind: "roundRect", x: x + 1, y: y + 1, width: CARD_W - 2, height: CARD_H - 2, radius: 14, fill: [0, 0, 0, 0], stroke: accent, strokeWidth: 2 },
        { kind: "text", fontId: FONT_ID, x: x + 16, y: y + 12, size: 16, maxWidth: CARD_W - 32, align: "left", fill: [229, 231, 235, 255], text: card.title },
        { kind: "text", fontId: FONT_ID, x: x + 16, y: y + 62, size: 12, maxWidth: CARD_W - 32, align: "left", fill: [156, 163, 175, 255], text: "world canvas tile" },
      ]);
      chunks.push({
        id: card.id,
        nodeIds: [card.id],
        bounds: { minX: x, minY: y, maxX: x + CARD_W, maxY: y + CARD_H },
        estimatedCost: CARD_W + CARD_H,
        payload: {
          canvas: (ctx) => {
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
          velloOps,
        } satisfies ChunkPayload,
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
    const angle = Math.atan2(by - cyp, bx - cxp);
    const triangle: VelloOp = {
      kind: "triangleFill",
      points: [
        [bx, by],
        [bx - 10 * Math.cos(angle - 0.4), by - 10 * Math.sin(angle - 0.4)],
        [bx - 10 * Math.cos(angle + 0.4), by - 10 * Math.sin(angle + 0.4)],
      ],
      fill: [139, 147, 167, 255],
    };
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
      payload: {
        canvas: (ctx) => {
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.quadraticCurveTo(cxp, cyp, bx, by);
          ctx.strokeStyle = "#8b93a7";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(triangle.points[0][0], triangle.points[0][1]);
          ctx.lineTo(triangle.points[1][0], triangle.points[1][1]);
          ctx.lineTo(triangle.points[2][0], triangle.points[2][1]);
          ctx.closePath();
          ctx.fillStyle = "#8b93a7";
          ctx.fill();
        },
        velloOps: encodeOps([
          { kind: "quadStroke", p0: [ax, ay], cp: [cxp, cyp], p1: [bx, by], stroke: [139, 147, 167, 255], strokeWidth: 2 },
          triangle,
        ]),
      } satisfies ChunkPayload,
    });
  }

  chunks.push({
    id: "seam-probe",
    nodeIds: ["seam-probe"],
    bounds: { minX: PROBE.x, minY: PROBE.y, maxX: PROBE.x + PROBE.width, maxY: PROBE.y + PROBE.height },
    estimatedCost: PROBE.width + PROBE.height,
    payload: {
      canvas: (ctx) => {
        ctx.fillStyle = "#22c55e";
        ctx.fillRect(PROBE.x, PROBE.y, PROBE.width, PROBE.height);
      },
      velloOps: encodeOps([{ kind: "rectFill", x: PROBE.x, y: PROBE.y, width: PROBE.width, height: PROBE.height, fill: [34, 197, 94, 255] }]),
    } satisfies ChunkPayload,
  });

  chunks.push({
    id: "text-probe",
    nodeIds: ["text-probe"],
    bounds: { minX: TEXT_PROBE.x, minY: TEXT_PROBE.y, maxX: TEXT_PROBE.x + TEXT_PROBE.width, maxY: TEXT_PROBE.y + TEXT_PROBE.height },
    estimatedCost: TEXT_PROBE.width + TEXT_PROBE.height,
    payload: {
      canvas: (ctx) => {
        ctx.fillStyle = "#0a0c12";
        ctx.fillRect(TEXT_PROBE.x, TEXT_PROBE.y, TEXT_PROBE.width, TEXT_PROBE.height);
        ctx.fillStyle = "#ffffff";
        ctx.font = "600 160px ui-sans-serif, system-ui, sans-serif";
        ctx.textBaseline = "top";
        ctx.fillText("VOICE 2026", TEXT_PROBE.x + 40, TEXT_PROBE.y + 60);
      },
      velloOps: encodeOps([
        { kind: "rectFill", x: TEXT_PROBE.x, y: TEXT_PROBE.y, width: TEXT_PROBE.width, height: TEXT_PROBE.height, fill: [10, 12, 18, 255] },
        { kind: "text", fontId: FONT_ID, x: TEXT_PROBE.x + 40, y: TEXT_PROBE.y + 60, size: 160, fill: [255, 255, 255, 255], text: "VOICE 2026" },
      ]),
    } satisfies ChunkPayload,
  });

  chunks.push({
    id: "image-probe",
    nodeIds: ["image-probe"],
    bounds: { minX: IMAGE_PROBE.x, minY: IMAGE_PROBE.y, maxX: IMAGE_PROBE.x + IMAGE_PROBE.width, maxY: IMAGE_PROBE.y + IMAGE_PROBE.height },
    estimatedCost: IMAGE_PROBE.width + IMAGE_PROBE.height,
    payload: {
      canvas: (ctx) => {
        ctx.fillStyle = "#ff8000";
        ctx.fillRect(IMAGE_PROBE.x, IMAGE_PROBE.y, IMAGE_PROBE.width, IMAGE_PROBE.height);
      },
      velloOps: encodeOps([
        { kind: "rectFill", x: IMAGE_PROBE.x, y: IMAGE_PROBE.y, width: IMAGE_PROBE.width, height: IMAGE_PROBE.height, fill: [20, 20, 20, 255] },
        { kind: "image", imageId: IMAGE_ID, x: IMAGE_PROBE.x + 20, y: IMAGE_PROBE.y + 20, width: 360, height: 360 },
      ]),
    } satisfies ChunkPayload,
  });

  chunks.push({
    id: "cjk-probe",
    nodeIds: ["cjk-probe"],
    bounds: { minX: CJK_PROBE.x, minY: CJK_PROBE.y, maxX: CJK_PROBE.x + CJK_PROBE.width, maxY: CJK_PROBE.y + CJK_PROBE.height },
    estimatedCost: CJK_PROBE.width + CJK_PROBE.height,
    payload: {
      canvas: (ctx) => {
        ctx.fillStyle = "#0a0c12";
        ctx.fillRect(CJK_PROBE.x, CJK_PROBE.y, CJK_PROBE.width, CJK_PROBE.height);
        ctx.fillStyle = "#ffffff";
        ctx.font = "140px sans-serif";
        ctx.textBaseline = "top";
        ctx.fillText("世界画布 中文测试 语音创作", CJK_PROBE.x + 40, CJK_PROBE.y + 60);
      },
      velloOps: encodeOps([
        { kind: "rectFill", x: CJK_PROBE.x, y: CJK_PROBE.y, width: CJK_PROBE.width, height: CJK_PROBE.height, fill: [10, 12, 18, 255] },
        // 主字体用拉丁 Space Grotesk（无 CJK），经 fallback(1→3) 用 Noto CJK 子集绘制
        { kind: "text", fontId: FONT_ID, x: CJK_PROBE.x + 40, y: CJK_PROBE.y + 60, size: 140, fill: [255, 255, 255, 255], text: "世界画布 中文测试 语音创作" },
      ]),
    } satisfies ChunkPayload,
  });

  // atomic chunk：blur 阴影跨越瓦片边界，必须整块渲染再贴（否则边界被裁出接缝）
  chunks.push({
    id: "shadow-probe",
    nodeIds: ["shadow-probe"],
    bounds: { minX: SHADOW_PROBE.x, minY: SHADOW_PROBE.y, maxX: SHADOW_PROBE.x + SHADOW_PROBE.width, maxY: SHADOW_PROBE.y + SHADOW_PROBE.height },
    atomic: true,
    atomicPadding: 90,
    estimatedCost: 600,
    payload: {
      canvas: (ctx) => {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowBlur = 60;
        ctx.shadowOffsetY = 20;
        roundRect(ctx, 150, 5760, 260, 180, 24);
        ctx.fillStyle = "#f8fafc";
        ctx.fill();
        ctx.restore();
      },
      velloOps: encodeOps([
        { kind: "blurRect", x: 150, y: 5760, width: 260, height: 180, radius: 24, stdDev: 30, fill: [0, 0, 0, 200] },
        { kind: "roundRect", x: 150, y: 5760, width: 260, height: 180, radius: 24, fill: [248, 250, 252, 255], stroke: [0, 0, 0, 0], strokeWidth: 0 },
      ]),
    } satisfies ChunkPayload,
  });

  return { chunks, cards, arrows };
}

export async function mountTileDemo(canvas: HTMLCanvasElement): Promise<TileDemo> {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width || canvas.clientWidth || 800));
  const height = Math.max(240, Math.round(rect.height || canvas.clientHeight || 600));

  const forced = new URLSearchParams(window.location.search).get("rasterizer");
  let rasterizer: TileRasterizer<unknown, unknown> | null = null;
  if (forced !== "canvas") {
    try {
      if (await VelloGpuRasterizer.isAvailable()) {
        rasterizer = (await VelloGpuRasterizer.create(canvas, dpr)) as unknown as TileRasterizer<unknown, unknown>;
      }
    } catch (error) {
      console.warn("[vello-tiles] vello rasterizer unavailable, falling back to Canvas2D", error);
      rasterizer = null;
    }
  }
  if (!rasterizer) rasterizer = new Canvas2DRasterizer(canvas, "#0b0f19", dpr) as unknown as TileRasterizer<unknown, unknown>;
  rasterizer.resize(width, height, dpr);

  let fontRegistered = false;
  if (rasterizer.name === "vello") {
    try {
      const response = await fetch("/vello-wasm/space-grotesk.ttf");
      const bytes = new Uint8Array(await response.arrayBuffer());
      (rasterizer as unknown as VelloGpuRasterizer).registerFont(FONT_ID, bytes);
      fontRegistered = true;
    } catch (error) {
      console.warn("[vello-tiles] font load failed", error);
    }
  }

  let cjkRegistered = false;
  if (rasterizer.name === "vello" && fontRegistered) {
    try {
      const response = await fetch("/vello-wasm/noto-cjk-subset.otf");
      const bytes = new Uint8Array(await response.arrayBuffer());
      (rasterizer as unknown as VelloGpuRasterizer).registerFont(CJK_FONT_ID, bytes);
      (rasterizer as unknown as VelloGpuRasterizer).setFontFallback(FONT_ID, CJK_FONT_ID);
      cjkRegistered = true;
    } catch (error) {
      console.warn("[vello-tiles] cjk font load failed", error);
    }
  }

  let imageRegistered = false;
  if (rasterizer.name === "vello") {
    const size = 16;
    const rgba = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      rgba[i * 4] = 255;
      rgba[i * 4 + 1] = 128;
      rgba[i * 4 + 2] = 0;
      rgba[i * 4 + 3] = 255;
    }
    (rasterizer as unknown as VelloGpuRasterizer).registerImage(IMAGE_ID, size, size, rgba);
    imageRegistered = true;
  }

  const scene = buildScene();
  const direct = new URLSearchParams(window.location.search).get("direct") !== "0";
  const controller = new TileController<unknown, unknown>({
    pageId: "demo-page",
    rasterizer,
    maxCacheBytes: 64 * 1024 * 1024,
    budgetMs: 5,
    maxJobsPerFrame: 32,
    direct,
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
    const maxX = COLS * (CARD_W + GAP_X) - GAP_X;
    const maxY = ROWS * (CARD_H + GAP_Y) - GAP_Y;
    const zoom = Math.max(0.15, Math.min(1.2, Math.min((width - 80) / maxX, (height - 80) / maxY)));
    viewport = { ...viewport, zoom, panX: (width - maxX * zoom) / 2, panY: (height - maxY * zoom) / 2 };
    dirty = true;
  };
  fit();

  const renderOnce = () => {
    controller.renderFrame({ viewport, contentGeneration, navigationGeneration, navigationActive });
    dirty = false;
  };

  const loop = () => {
    if (destroyed) return;
    const covered = controller.telemetry.snapshot().lastTrace?.covered ?? false;
    if (!paused && (navigationActive || dirty || controller.scheduler.pending() > 0 || !covered)) renderOnce();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

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

  const settle = (maxFrames = 30): number => {
    for (let frame = 0; frame < maxFrames; frame++) {
      controller.renderFrame({ viewport, contentGeneration, navigationGeneration, navigationActive: false });
      if (controller.scheduler.pending() === 0 && !dirty) {
        const before = controller.telemetry.snapshot().tilesRenderedTotal;
        controller.renderFrame({ viewport, contentGeneration, navigationGeneration, navigationActive: false });
        if (controller.telemetry.snapshot().tilesRenderedTotal === before && controller.scheduler.pending() === 0) {
          return frame + 2;
        }
      }
    }
    return maxFrames;
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
      // WebGPU 画布无法用 2d 读取，统一经离屏 2d drawImage 取样
      const scratch = document.createElement("canvas");
      scratch.width = Math.max(1, canvas.width);
      scratch.height = Math.max(1, canvas.height);
      const ctx = scratch.getContext("2d");
      if (!ctx) return [0, 0, 0, 0];
      try {
        ctx.drawImage(canvas, 0, 0);
      } catch {
        return [0, 0, 0, 0];
      }
      const data = ctx.getImageData(Math.round(cssX * dpr), Math.round(cssY * dpr), 1, 1).data;
      return [data[0], data[1], data[2], data[3]];
    },
    sampleWorld: (worldX, worldY) => debug.samplePixel(worldX * viewport.zoom + viewport.panX, worldY * viewport.zoom + viewport.panY),
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
    imageProbe: () => ({ ...IMAGE_PROBE }),
    settle,
    resetTelemetry: () => controller.telemetry.reset(),
    isRasterizer: (name) => rasterizer.name === name,
    rasterizerName: () => rasterizer.name,
    covered: () => controller.telemetry.snapshot().lastTrace?.covered ?? false,
    settleCovered: (maxFrames = 90) => {
      for (let frame = 0; frame < maxFrames; frame++) {
        controller.renderFrame({ viewport, contentGeneration, navigationGeneration, navigationActive: false });
        const covered = controller.telemetry.snapshot().lastTrace?.covered ?? false;
        if (covered && controller.scheduler.pending() === 0) return frame + 1;
      }
      return maxFrames;
    },
    fontRegistered: () => fontRegistered,
    cjkRegistered: () => cjkRegistered,
    cjkProbe: () => ({ ...CJK_PROBE }),
    shadowProbe: () => ({ ...SHADOW_PROBE }),
    imageRegistered: () => imageRegistered,
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      dirty = true;
    },
    pointer: () => ({ ...pointerStats }),
    debugImageTest: () => {
      if (rasterizer.name === "vello") (rasterizer as unknown as VelloGpuRasterizer).debugImageTest();
    },
    debugTileTest: () => {
      if (rasterizer.name === "vello") (rasterizer as unknown as VelloGpuRasterizer).debugTileTest();
    },
    debugPairTest: () => {
      if (rasterizer.name === "vello") (rasterizer as unknown as VelloGpuRasterizer).debugPairTest();
    },
    debugRegisteredImageTest: () => {
      if (rasterizer.name === "vello") (rasterizer as unknown as VelloGpuRasterizer).debugRegisteredImageTest();
    },
    renderChunkOps: (id, level, minX, minY) => {
      if (rasterizer.name !== "vello") return;
      const chunk = scene.chunks.find((item) => item.id === id);
      const ops = (chunk?.payload as ChunkPayload | undefined)?.velloOps;
      if (ops) (rasterizer as unknown as VelloGpuRasterizer).debugRenderOps(ops, level, minX, minY);
    },
    presentTileByKey: (key, panX, panY, zoom) => {
      if (rasterizer.name !== "vello") return false;
      const tile = controller.cache.values().find((item) => `${item.key.pageId}:${item.key.level}:${item.key.x}:${item.key.y}` === key);
      if (!tile) return false;
      (rasterizer as unknown as VelloGpuRasterizer).presentHandles([tile.handle as number], { panX, panY, zoom, width, height, dpr });
      return true;
    },
    rasterStats: () => {
      const stats = (rasterizer as unknown as VelloGpuRasterizer).stats;
      return typeof stats === "function" ? (rasterizer as unknown as VelloGpuRasterizer).stats() : { name: rasterizer.name };
    },
    presentCached: (panX, panY, zoom) => {
      if (rasterizer.name !== "vello") return 0;
      const handles = controller.cache.values().map((tile) => tile.handle as number);
      (rasterizer as unknown as VelloGpuRasterizer).presentHandles(handles, { panX, panY, zoom, width, height, dpr });
      return handles.length;
    },
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
