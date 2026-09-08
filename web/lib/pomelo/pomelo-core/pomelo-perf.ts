/*
 * [INPUT]: 无依赖（浏览器性能 API + 可选 PerformanceObserver）
 * [OUTPUT]: 对外提供 pomeloPerf：editor 底座统一的渲染性能记录器——
 * - time(name, fn)/mark+measure：关键路径耗时（renderer.render / adapter.render / block.render:<type> /
 *   transact / overlay.draw / text.refresh 等）
 * - 事件计数（block.update 扫描/重渲染数、纹理加载等）
 * - 帧率看门狗：rAF 间隔采样，>32ms 记为 frame.gap（掉帧/卡顿），并统计 longtask
 * - 环形缓冲（默认 600 条）+ 按名字聚合（count/total/avg/p95/max）
 * - window.__pomeloPerf 暴露 report()/summary()/dump()（e2e 与控制台直接读取），reset()/setEnabled()
 * [POS]: lib/pomelo/pomelo-core 的性能统计层（renderer/adapter/block/plugins 埋点共用，零渲染副作用）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export type PerfEvent = { t: number; name: string; ms?: number; meta?: Record<string, unknown> };

export type PerfStat = { count: number; total: number; avg: number; p50: number; p95: number; max: number };

const SAMPLES_PER_NAME = 120;
const RING_SIZE = 600;

class PerfRecorder {
  private enabled = true;
  private ring: PerfEvent[] = [];
  private marks = new Map<string, number>();
  private samples = new Map<string, number[]>();
  private frameGapRunning = false;
  private longTaskObserver: PerformanceObserver | null = null;

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) this.startFrameWatchdog();
  }

  reset() {
    this.ring = [];
    this.marks.clear();
    this.samples.clear();
  }

  event(name: string, meta?: Record<string, unknown>) {
    this.push({ t: performance.now(), name, meta });
  }

  mark(name: string) {
    this.marks.set(name, performance.now());
  }

  // 结束一个 mark 并记录耗时（mark 不存在时忽略）
  measure(name: string, markName = name) {
    const start = this.marks.get(markName);
    if (start === undefined) return;
    this.marks.delete(markName);
    this.record(name, performance.now() - start);
  }

  record(name: string, ms: number, meta?: Record<string, unknown>) {
    if (!this.enabled) return;
    const list = this.samples.get(name) ?? [];
    list.push(ms);
    if (list.length > SAMPLES_PER_NAME) list.shift();
    this.samples.set(name, list);
    this.push({ t: performance.now(), name, ms, meta });
  }

  // 同步耗时包裹：const cards = pomeloPerf.time("block.render:entity-card", () => ...)
  time<T>(name: string, fn: () => T, meta?: Record<string, unknown>): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.record(name, performance.now() - start, meta);
    }
  }

  private push(event: PerfEvent) {
    this.ring.push(event);
    if (this.ring.length > RING_SIZE) this.ring.splice(0, this.ring.length - RING_SIZE);
  }

  // 帧率看门狗：rAF 间隔 >32ms（低于 ~30fps）记为 frame.gap 事件；
  // 另记 frame.drift（>10ms 且 ≤32ms）用于诊断 120Hz 显示器上错过 vsync 的「半掉帧」节拍
  startFrameWatchdog() {
    if (this.frameGapRunning || typeof window === "undefined") return;
    this.frameGapRunning = true;
    let last = performance.now();
    const tick = (now: number) => {
      const gap = now - last;
      last = now;
      if (this.enabled && gap > 32) this.record("frame.gap", gap);
      // 120Hz 下正常 vsync 间隔 ~8.3ms；>10ms 说明该帧错过了当前 vsync（渲染太慢或被其它工作推迟）
      else if (this.enabled && gap > 10) this.record("frame.drift", gap);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    if (typeof PerformanceObserver !== "undefined" && !this.longTaskObserver) {
      try {
        this.longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) this.record("longtask", entry.duration, { start: entry.startTime });
        });
        this.longTaskObserver.observe({ entryTypes: ["longtask"] });
      } catch {
        // longtask 不可用时静默跳过
      }
    }
  }

  private percentile(list: number[], p: number): number {
    if (!list.length) return 0;
    const sorted = [...list].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  }

  stat(name: string): PerfStat | null {
    const list = this.samples.get(name);
    if (!list?.length) return null;
    const total = list.reduce((sum, value) => sum + value, 0);
    return {
      count: list.length,
      total: Math.round(total * 10) / 10,
      avg: Math.round((total / list.length) * 10) / 10,
      p50: Math.round(this.percentile(list, 0.5) * 10) / 10,
      p95: Math.round(this.percentile(list, 0.95) * 10) / 10,
      max: Math.round(list[list.length - 1] * 10) / 10,
    };
  }

  summary(): Record<string, PerfStat> {
    const out: Record<string, PerfStat> = {};
    for (const name of [...this.samples.keys()].sort()) {
      const stat = this.stat(name);
      if (stat) out[name] = stat;
    }
    return out;
  }

  // 最近原始事件（环形缓冲），供逐条回放/导出 JSON
  dump(): PerfEvent[] {
    return [...this.ring];
  }

  report(): string {
    const summary = this.summary();
    const rows = Object.entries(summary).map(([name, stat]) => `${name.padEnd(28)} count=${String(stat.count).padStart(5)} avg=${String(stat.avg).padStart(7)}ms p95=${String(stat.p95).padStart(7)}ms max=${String(stat.max).padStart(7)}ms`);
    return ["== pomelo perf ==", ...rows].join("\n");
  }
}

export const pomeloPerf = new PerfRecorder();

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__pomeloPerf = pomeloPerf;
  pomeloPerf.startFrameWatchdog();
}
