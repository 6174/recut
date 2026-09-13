/*
 * [INPUT]: 无外部依赖（使用 pomelo-perf 打点）
 * [OUTPUT]: 对外提供 PomeloTicker：编辑器级统一帧驱动器。
 * - add(fn, phase)：常驻帧回调，phase 保证一帧内顺序（input → update → overlay）；
 * - schedule(key, fn)：合帧调度，同 key 一帧至多执行一次（后写入覆盖，永远执行最新闭包）；
 * - cancel(key) / flushAll()：取消或立即补齐未上帧任务；
 * - 惰性驱动：有订阅者或有 schedule 时才开 rAF 循环，空闲自动停；destroy 随编辑器销毁。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { pomeloPerf } from "./pomelo-perf";
import type { IDisposable } from "./pomelo-common/disposable";

export type PomeloTickerPhase = "input" | "update" | "overlay";

type FrameCallback = { fn: (deltaMS: number) => void; phase: PomeloTickerPhase };

const PHASE_ORDER: PomeloTickerPhase[] = ["input", "update", "overlay"];

export class PomeloTicker {
  #callbacks: FrameCallback[] = [];
  // 合帧任务表：key -> 最新闭包；每帧统一跑完后清空
  #scheduled = new Map<string, () => void>();
  #rafId = 0;
  #lastTime = 0;
  #destroyed = false;
  /** 单调递增的帧序号（每次 #tick +1），供渲染层做「同帧只渲染一次」合并。 */
  frameId = 0;

  /**
   * 注册常驻帧回调；返回 disposer。同一 phase 内按注册顺序执行。
   */
  add(fn: (deltaMS: number) => void, phase: PomeloTickerPhase = "update"): IDisposable {
    if (this.#destroyed) return { dispose: () => undefined };
    const entry: FrameCallback = { fn, phase };
    this.#callbacks.push(entry);
    this.#ensureRunning();
    return {
      dispose: () => {
        const index = this.#callbacks.indexOf(entry);
        if (index >= 0) this.#callbacks.splice(index, 1);
        this.#maybeStop();
      },
    };
  }

  /**
   * 合帧调度：同一 key 一帧至多执行一次，重复 schedule 覆盖为最新闭包。
   * 用于「事件驱动写状态、帧驱动才渲染」的统一纪律。
   */
  schedule(key: string, fn: () => void) {
    if (this.#destroyed) return;
    this.#scheduled.set(key, fn);
    this.#ensureRunning();
  }

  cancel(key: string) {
    this.#scheduled.delete(key);
  }

  /**
   * 立即补齐所有未上帧任务（如 pointerup 前最后一次 move），不等待下一帧。
   */
  flushAll() {
    if (this.#scheduled.size === 0) return;
    const jobs = Array.from(this.#scheduled.values());
    this.#scheduled.clear();
    for (const job of jobs) job();
  }

  has(key: string) {
    return this.#scheduled.has(key);
  }

  #ensureRunning() {
    if (this.#destroyed || this.#rafId) return;
    this.#lastTime = performance.now();
    this.#rafId = requestAnimationFrame(this.#tick);
  }

  #maybeStop() {
    if (this.#rafId && this.#callbacks.length === 0 && this.#scheduled.size === 0) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = 0;
    }
  }

  #tick = (now: number) => {
    this.#rafId = 0;
    this.frameId++;
    const deltaMS = now - this.#lastTime;
    this.#lastTime = now;

    const frameStart = performance.now();
    for (const phase of PHASE_ORDER) {
      // input：拖拽等事件落状态的 transact；update：常规每帧任务；overlay：选区/手柄重绘
      for (const entry of this.#callbacks) {
        if (entry.phase === phase) entry.fn(deltaMS);
      }
      if (phase === "input" && this.#scheduled.size > 0) {
        const jobs = Array.from(this.#scheduled.values());
        this.#scheduled.clear();
        for (const job of jobs) job();
      }
    }
    pomeloPerf.record("ticker.frame", performance.now() - frameStart, { frames: this.#callbacks.length, scheduled: this.#scheduled.size });

    // 本帧可能又有新 schedule / dispose，按当前状态决定是否继续
    this.#maybeStop();
    if (this.#callbacks.length > 0 || this.#scheduled.size > 0) this.#ensureRunning();
  };

  destroy() {
    this.#destroyed = true;
    if (this.#rafId) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = 0;
    }
    this.#callbacks = [];
    this.#scheduled.clear();
  }
}
