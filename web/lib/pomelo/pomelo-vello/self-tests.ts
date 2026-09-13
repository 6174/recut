/*
 * [INPUT]: 依赖 pomelo-tiles（controller/scheduler/cache/planner/geometry）
 * [OUTPUT]: 对外提供 runSelfTests()：在浏览器/Node 内对瓦片算法做断言，返回结果数组。
 *           用 FakeRasterizer 剥离渲染后端，验证调度/缓存/规划/失效/稳态等纯逻辑。
 * [POS]: pomelo-vello 的自检层，供 dev 页暴露给 e2e。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { TileController } from "../pomelo-core/pomelo-tiles/controller";
import { tileKeysForWorldBounds, tileLevel, tileWorldSize } from "../pomelo-core/pomelo-tiles/geometry";
import { planTiles } from "../pomelo-core/pomelo-tiles/planner";
import { TileScheduler } from "../pomelo-core/pomelo-tiles/scheduler";
import { TileImageCache } from "../pomelo-core/pomelo-tiles/tile-cache";
import type {
  RenderedTile,
  TileKey,
  TileRasterizer,
  Viewport,
} from "../pomelo-core/pomelo-tiles/types";

export interface SelfTestResult {
  name: string;
  pass: boolean;
  detail?: string;
}

interface FakeTarget {
  key: TileKey;
}

class FakeRasterizer implements TileRasterizer<FakeTarget, number> {
  readonly name = "fake";
  renders = 0;
  private nextHandle = 1;

  beginTile(key: TileKey): FakeTarget {
    return { key };
  }

  drawChunk(): void {
    // no-op
  }

  endTile(target: FakeTarget): RenderedTile<number> {
    this.renders++;
    return {
      key: target.key,
      handle: this.nextHandle++,
      chunkCount: 1,
      estimatedCost: 1,
      renderMs: 0.1,
      bytes: 4096,
    };
  }

  disposeTile(): void {}
  present(): void {}
  resize(): void {}
  beginFrame(): void {}
  endFrame(): void {}
  destroy(): void {}
}

function makeTile(key: TileKey, bytes = 4096): RenderedTile<number> {
  return { key, handle: Math.random(), chunkCount: 1, estimatedCost: 1, renderMs: 0.1, bytes };
}

const VP: Viewport = { panX: 0, panY: 0, zoom: 1, width: 1600, height: 900, dpr: 1 };

function settle(controller: TileController<FakeTarget, number>, viewport: Viewport, generation: number, maxFrames = 12): number {
  for (let frame = 0; frame < maxFrames; frame++) {
    const result = controller.renderFrame({
      viewport,
      contentGeneration: generation,
      navigationGeneration: generation,
      navigationActive: false,
    });
    if (result.rendered === 0 && !result.pending) return frame + 1;
  }
  return maxFrames;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function runSelfTests(): SelfTestResult[] {
  const results: SelfTestResult[] = [];
  const check = (name: string, fn: () => string | void) => {
    try {
      const detail = fn() || undefined;
      results.push({ name, pass: true, detail });
    } catch (error) {
      results.push({ name, pass: false, detail: String(error) });
    }
  };

  check("geometry: LOD 量化与瓦片世界尺寸", () => {
    assert(Math.abs(tileLevel(1) - 1) < 1e-9, `tileLevel(1)=${tileLevel(1)}`);
    assert(Math.abs(tileLevel(0.75) - 0.75) < 1e-9, `tileLevel(0.75)=${tileLevel(0.75)}`);
    assert(Math.abs(tileLevel(0.6) - 0.625) < 1e-9, `tileLevel(0.6)=${tileLevel(0.6)}`);
    assert(tileLevel(0.1) < 0.25 && tileLevel(0.1) > 0, `tileLevel(0.1)=${tileLevel(0.1)}`);
    for (const level of [0.25, 0.5, 1, 2, 4]) {
      assert(Math.abs(tileWorldSize(level) * level - 256) < 1e-9, `worldSize*level != 256 @${level}`);
    }
    return "5 个层级尺寸不变量通过";
  });

  check("geometry: 可见瓦片枚举边界", () => {
    const one = tileKeysForWorldBounds("p", 1, { minX: 0, minY: 0, maxX: 256, maxY: 256 });
    assert(one.length === 1, `256x256 应 1 个瓦片，实得 ${one.length}`);
    const four = tileKeysForWorldBounds("p", 1, { minX: 0, minY: 0, maxX: 257, maxY: 257 });
    assert(four.length === 4, `257x257 应 4 个瓦片，实得 ${four.length}`);
    return "边界枚举正确";
  });

  check("scheduler: 帧上限与剩余任务", () => {
    const scheduler = new TileScheduler({ budgetMs: 1000, maximumJobsPerFrame: 2, now: () => 0 });
    scheduler.setGeneration(0, 0);
    const job = (x: number, priority: "visible" | "mandatory" | "overscan") => ({
      key: { pageId: "p", level: 1, x, y: 0 },
      navigationGeneration: 0,
      contentGeneration: 0,
      priority,
      fallbackAvailable: true,
      estimatedCost: 1,
    });
    scheduler.enqueue([job(0, "visible"), job(1, "visible"), job(2, "visible")]);
    const metrics = scheduler.runFrame(() => ({ renderMs: 0.1, overBudget: false }));
    assert(metrics.interruptibleCompleted === 2, `应执行 2 个，实得 ${metrics.interruptibleCompleted}`);
    assert(metrics.remaining === 1, `应剩 1 个，实得 ${metrics.remaining}`);
    return "帧上限生效";
  });

  check("scheduler: 双代作废 stale 任务", () => {
    const scheduler = new TileScheduler({ budgetMs: 1000, maxJobsPerFrame: 10, now: () => 0 });
    scheduler.setGeneration(0, 0);
    scheduler.enqueue([
      { key: { pageId: "p", level: 1, x: 0, y: 0 }, navigationGeneration: 0, contentGeneration: 0, priority: "visible", fallbackAvailable: true, estimatedCost: 1 },
    ]);
    const discarded = scheduler.setGeneration(1, 0);
    assert(discarded === 1, `应作废 1 个，实得 ${discarded}`);
    assert(scheduler.pending() === 0, "作废后队列应为空");
    return "代推进作废生效";
  });

  check("scheduler: 优先级排序（mandatory 先于 overscan）", () => {
    const scheduler = new TileScheduler({ budgetMs: 1000, maxJobsPerFrame: 10, now: () => 0 });
    scheduler.setGeneration(0, 0);
    const order: string[] = [];
    scheduler.enqueue([
      { key: { pageId: "p", level: 1, x: 0, y: 0 }, navigationGeneration: 0, contentGeneration: 0, priority: "overscan", fallbackAvailable: true, estimatedCost: 1 },
      { key: { pageId: "p", level: 1, x: 1, y: 0 }, navigationGeneration: 0, contentGeneration: 0, priority: "mandatory", fallbackAvailable: false, estimatedCost: 1 },
    ]);
    scheduler.runFrame((job) => {
      order.push(job.priority);
      return { renderMs: 0.1, overBudget: false };
    });
    assert(order[0] === "mandatory", `首个应为 mandatory，实得 ${order[0]}`);
    return "优先级排序正确";
  });

  check("tile-cache: 字节 LRU 淘汰", () => {
    const disposed: number[] = [];
    const cache = new TileImageCache<number>(2500, (handle) => disposed.push(handle));
    const key = (x: number): TileKey => ({ pageId: "p", level: 1, x, y: 0 });
    cache.install(makeTile(key(0), 1000), 0);
    cache.install(makeTile(key(1), 1000), 0);
    cache.install(makeTile(key(2), 1000), 0);
    assert(cache.size() === 2, `2500 字节上限应留 2 个，实得 ${cache.size()}`);
    assert(disposed.length === 1, `应释放 1 个句柄，实得 ${disposed.length}`);
    return "LRU 按字节淘汰";
  });

  check("tile-cache: bounds 失效只删相交", () => {
    const cache = new TileImageCache<number>(1 << 20);
    const hit: TileKey = { pageId: "p", level: 1, x: 0, y: 0 };
    const miss: TileKey = { pageId: "p", level: 1, x: 1, y: 0 };
    cache.install(makeTile(hit), 0);
    cache.install(makeTile(miss), 0);
    const removed = cache.invalidateBounds("p", { minX: 0, minY: 0, maxX: 10, maxY: 10 }, 5);
    assert(removed === 1, `应删 1 个，实得 ${removed}`);
    assert(cache.getIfPresent(hit) === null, "相交瓦片应被删除");
    assert(cache.getIfPresent(miss) !== null, "不相交瓦片应保留");
    assert(cache.getIfPresent(miss)!.contentGeneration === 5, "保留瓦片应推进到新代");
    return "bounds 精确失效";
  });

  check("planner: 缺失瓦片为 mandatory / 有 fallback 为 visible", () => {
    const cache = new TileImageCache<number>(1 << 20);
    const opts = {
      pageId: "p",
      level: 1,
      viewport: { minX: 0, minY: 0, maxX: 256, maxY: 256 },
      overscanTiles: 0,
      navigationGeneration: 0,
      contentGeneration: 0,
      estimateCost: () => 1,
    };
    const hard = planTiles(cache, opts);
    assert(hard.jobs.length === 1 && hard.jobs[0].priority === "mandatory", "无 fallback 应为 mandatory");
    const soft = planTiles(cache, { ...opts, globalFallbackAvailable: true });
    assert(soft.jobs.length === 1 && soft.jobs[0].priority === "visible", "有 fallback 应为 visible");
    return "优先级判定正确";
  });

  check("planner: fresh 瓦片不产生可见任务，overscan 仅在可见就绪后规划", () => {
    const cache = new TileImageCache<number>(1 << 20);
    cache.install(makeTile({ pageId: "p", level: 1, x: 0, y: 0 }), 0);
    const plan = planTiles(cache, {
      pageId: "p",
      level: 1,
      viewport: { minX: 0, minY: 0, maxX: 256, maxY: 256 },
      overscanTiles: 1,
      navigationGeneration: 0,
      contentGeneration: 0,
      estimateCost: () => 1,
    });
    assert(plan.jobs.every((job) => job.priority === "overscan"), "可见 fresh 时应只规划 overscan");
    assert(plan.jobs.length === 8, `overscan 应 8 个，实得 ${plan.jobs.length}`);
    return "overscan 规划正确";
  });

  check("controller: 首帧渲染 + 稳态不再光栅", () => {
    const rasterizer = new FakeRasterizer();
    const controller = new TileController<FakeTarget, number>({ pageId: "p", rasterizer, budgetMs: 1000, maxJobsPerFrame: 1000 });
    controller.addChunk({ id: "c1", nodeIds: ["c1"], bounds: { minX: 100, minY: 100, maxX: 300, maxY: 220 }, estimatedCost: 1, payload: null });
    const first = controller.renderFrame({ viewport: VP, contentGeneration: 0, navigationGeneration: 0, navigationActive: false });
    assert(first.rendered > 0, "首帧应有光栅");
    settle(controller, VP, 0);
    rasterizer.renders = 0;
    const steady = controller.renderFrame({ viewport: VP, contentGeneration: 0, navigationGeneration: 0, navigationActive: false });
    assert(steady.rendered === 0, `稳态不应再光栅，实得 ${steady.rendered}`);
    return `首帧 ${first.rendered} 瓦片后进入稳态`;
  });

  check("controller: 移动 chunk 只重渲相交瓦片", () => {
    const rasterizer = new FakeRasterizer();
    const controller = new TileController<FakeTarget, number>({ pageId: "p", rasterizer, budgetMs: 1000, maxJobsPerFrame: 1000 });
    controller.addChunk({ id: "c1", nodeIds: ["c1"], bounds: { minX: 100, minY: 100, maxX: 300, maxY: 220 }, estimatedCost: 1, payload: null });
    settle(controller, VP, 0);
    rasterizer.renders = 0;
    controller.moveChunk("c1", 260, 0);
    const result = controller.renderFrame({ viewport: VP, contentGeneration: 1, navigationGeneration: 0, navigationActive: false });
    assert(result.rendered > 0, "移动后应有光栅");
    assert(result.rendered <= 8, `移动只应重渲少量瓦片，实得 ${result.rendered}`);
    return `移动一卡重渲 ${result.rendered} 个瓦片`;
  });

  check("controller: 平移（同内容）不重光栅", () => {
    const rasterizer = new FakeRasterizer();
    const controller = new TileController<FakeTarget, number>({ pageId: "p", rasterizer, budgetMs: 1000, maxJobsPerFrame: 1000 });
    controller.addChunk({ id: "c1", nodeIds: ["c1"], bounds: { minX: 100, minY: 100, maxX: 300, maxY: 220 }, estimatedCost: 1, payload: null });
    settle(controller, VP, 0);
    rasterizer.renders = 0;
    const panned: Viewport = { ...VP, panX: -20, panY: -10 };
    const result = controller.renderFrame({ viewport: panned, contentGeneration: 0, navigationGeneration: 0, navigationActive: false });
    assert(result.rendered === 0, `overscan 内平移不应光栅，实得 ${result.rendered}`);
    return "平移命中缓存，0 光栅";
  });

  check("controller: 导航期 defer 不执行 tile job", () => {
    const rasterizer = new FakeRasterizer();
    const controller = new TileController<FakeTarget, number>({ pageId: "p", rasterizer, budgetMs: 1000, maxJobsPerFrame: 1000 });
    controller.addChunk({ id: "c1", nodeIds: ["c1"], bounds: { minX: 100, minY: 100, maxX: 300, maxY: 220 }, estimatedCost: 1, payload: null });
    const result = controller.renderFrame({ viewport: VP, contentGeneration: 0, navigationGeneration: 1, navigationActive: true });
    assert(result.rendered === 0, `导航期不应光栅，实得 ${result.rendered}`);
    assert(result.metrics.skippedWithFallback >= 0, "指标可用");
    return "导航期 defer 生效";
  });

  return results;
}
