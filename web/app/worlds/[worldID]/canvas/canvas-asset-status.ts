/*
 * [INPUT]: 依赖 zustand、@/app/media/media-types（normalizeAsset/Asset）
 * [OUTPUT]: 对外提供 CanvasAssetState（proposed/generating/ready/failed）、useCanvasAssetStatusStore、
 * canvasAssetStateOf（元素 props 声明的 status 与真实素材状态的合成）、canvasAssetOf（读取已回查的资产）、
 * ensureCanvasAssetStatus（把一个 assetId 纳入轮询：未完成则每 2.5s 回查 /v1/media/assets，直到 completed/failed 或超时）、
 * stopCanvasAssetStatus（清理全部在途轮询，画布卸载时调用）
 * [POS]: worlds/[worldID]/canvas 的媒体状态层：AI 先落 assetId（提案或生成中）时，画布据此渲染等待/待确认态，
 * 并在素材状态变化后自动切换；不持久化、不产 revision
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import { normalizeAsset, type Asset } from "@/app/media/media-types";

// 元素可显式声明的等待态（AI 先落 assetId 时写 props.assetStatus="generating"）；
// 真实素材状态到达后以素材为准（ready 覆盖声明，避免永远停在等待态）。
// proposed = 已落提案、等用户确认（不花钱）；确认后才进入 generating。
export type CanvasAssetState = "proposed" | "generating" | "ready" | "failed";

const POLL_INTERVAL_MS = 2500;
// 约 10 分钟后仍无终态则标记失败（避免无限轮询不存在/卡死的 asset）。
// proposed 是等待用户动作的稳定态，不占用该预算。
const MAX_ATTEMPTS = 240;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Set<string>();
const attempts = new Map<string, number>();

export const useCanvasAssetStatusStore = create<{
  statuses: Record<string, CanvasAssetState>;
  assets: Record<string, Asset>;
}>(() => ({ statuses: {}, assets: {} }));

function mark(assetId: string, state: CanvasAssetState) {
  if (useCanvasAssetStatusStore.getState().statuses[assetId] === state) return;
  useCanvasAssetStatusStore.setState((prev) => ({ statuses: { ...prev.statuses, [assetId]: state } }));
}

function remember(assetId: string, asset: Asset) {
  // 轮询会在 proposed 等待期持续回查；只有实质变化才更新，避免每轮都触发画布重建。
  const current = useCanvasAssetStatusStore.getState().assets[assetId];
  if (current && current.status === asset.status && current.updatedAt === asset.updatedAt && current.error === asset.error) return;
  useCanvasAssetStatusStore.setState((prev) => ({ assets: { ...prev.assets, [assetId]: asset } }));
}

// 元素 props 声明与真实素材状态的合成：真实状态优先；素材未回查时按声明判断等待态。
export function canvasAssetStateOf(assetId: string, declared?: unknown): CanvasAssetState {
  if (!assetId) return "ready";
  const tracked = useCanvasAssetStatusStore.getState().statuses[assetId];
  if (tracked) return tracked;
  const declaredStatus = String(declared ?? "");
  return declaredStatus === "proposed" || declaredStatus === "generating" || declaredStatus === "failed" ? declaredStatus : "ready";
}

// 读取已回查缓存的资产（提案视图/确认流程据此读 metadata，不依赖元素 props）。
export function canvasAssetOf(assetId: string): Asset | null {
  if (!assetId) return null;
  return useCanvasAssetStatusStore.getState().assets[assetId] ?? null;
}

function schedule(apiBase: string, assetId: string) {
  if (timers.has(assetId)) return;
  const timer = setTimeout(() => {
    timers.delete(assetId);
    ensureCanvasAssetStatus(apiBase, assetId);
  }, POLL_INTERVAL_MS);
  timers.set(assetId, timer);
}

// 回查一次素材状态；未到终态则继续排队轮询（ready/failed 后停止）。
export function ensureCanvasAssetStatus(apiBase: string, assetId: string) {
  if (!apiBase || !assetId) return;
  const current = useCanvasAssetStatusStore.getState().statuses[assetId];
  if (current === "ready" || current === "failed") return;
  // 已排下一轮查询（timers）或正在请求（inflight）时不再重复；宿主每次 dataVersion 变化都会调本函数
  if (timers.has(assetId) || inflight.has(assetId)) return;
  inflight.add(assetId);
  void (async () => {
    let next: CanvasAssetState = "generating";
    try {
      const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(assetId)}`, { cache: "no-store" });
      if (response.ok) {
        const asset = normalizeAsset((await response.json()) as Asset);
        remember(assetId, asset);
        if (asset.status === "completed") next = "ready";
        else if (asset.status === "failed") next = "failed";
        else if (asset.status === "proposed") next = "proposed";
      }
    } catch {
      // 网络抖动：保持 generating，下一轮重试
    } finally {
      inflight.delete(assetId);
    }
    if (next === "proposed") {
      // 提案等用户确认，不计入失败超时预算；继续慢轮询，确认后自动切换。
      mark(assetId, next);
      schedule(apiBase, assetId);
      return;
    }
    const count = (attempts.get(assetId) ?? 0) + 1;
    attempts.set(assetId, count);
    if (next === "generating" && count >= MAX_ATTEMPTS) next = "failed";
    mark(assetId, next);
    if (next === "generating") schedule(apiBase, assetId);
  })();
}

// refreshCanvasAsset 强制立即回查一次（确认/改提案后调用），绕过 inflight/终态短路。
export function refreshCanvasAsset(apiBase: string, assetId: string) {
  if (!apiBase || !assetId) return;
  attempts.delete(assetId);
  useCanvasAssetStatusStore.setState((prev) => {
    const statuses = { ...prev.statuses };
    delete statuses[assetId];
    return { statuses };
  });
  ensureCanvasAssetStatus(apiBase, assetId);
}

export function stopCanvasAssetStatus() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  inflight.clear();
  attempts.clear();
}
