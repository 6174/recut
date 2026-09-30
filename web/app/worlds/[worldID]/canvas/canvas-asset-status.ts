/*
 * [INPUT]: 依赖 zustand、@/app/media/media-types（normalizeAsset/Asset）
 * [OUTPUT]: 对外提供 CanvasAssetState（proposed/generating/ready/failed）、useCanvasAssetStatusStore、
 * canvasAssetStateOf（元素 props 声明的 status 与真实素材状态的合成）、canvasAssetOf（读取已回查的资产）、
 * ensureCanvasAssetStatus（把一个 assetId 纳入轮询：未完成则每 2.5s 回查 /v1/media/assets，直到 completed/failed 或超时；
 * 单次请求带硬超时 + 陈旧在途自愈，保证整条轮询链不会因一次悬挂请求永久断掉）、
 * ingestCanvasAsset（媒体实时通道推来的权威资产：写入缓存并折算状态，终态不被乱序帧回退）、
 * refreshCanvasAsset（确认/改提案后强制立即回查，真正绕过节流与终态短路）、
 * rearmCanvasAssetStatus（页面重新可见/获得焦点时重新武装未终态的轮询，链路丢失时自愈）、
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
// 单次回查的硬超时。没有它，一个永不 settle 的请求会永久占住在途集合，轮询链再也接不上——
// 画布节点会一直停在 props 声明的「生成中」（assetStatus="generating"）直到整页刷新。
const REQUEST_TIMEOUT_MS = 8000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
// assetId → 本次在途请求的令牌（发起时间）。超过 REQUEST_TIMEOUT_MS 视为陈旧（请求悬挂/被环境吞掉），
// 允许重新发起，而不是让该 assetId 从此不再被回查。
const inflight = new Map<string, number>();
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
  // 轮询会在生成/提案等待期持续回查；只有实质变化才更新，避免每轮都触发画布重建。
  // 判等不能用 updatedAt：provider 轮询会周期性 touch 该行的 updated_at（见
  // service/media/jobs_skymind.go 的 polling 诊断写入），而 status/error/metadata 未变时
  // 画布投影完全相同。用 metadata 判等既能屏蔽这类纯时间戳抖动，又能让提案提示词/参数的
  // 真实变化继续触发重建（canvasAssetOf 会读 metadata 映射提案态）。
  const current = useCanvasAssetStatusStore.getState().assets[assetId];
  if (
    current &&
    current.status === asset.status &&
    current.error === asset.error &&
    JSON.stringify(current.metadata) === JSON.stringify(asset.metadata)
  ) return;
  useCanvasAssetStatusStore.setState((prev) => ({ assets: { ...prev.assets, [assetId]: asset } }));
}

// 素材状态 → 画布状态（真实素材状态是唯一真相）。
function canvasStateOfAsset(asset: Asset): CanvasAssetState {
  if (asset.status === "completed") return "ready";
  if (asset.status === "failed") return "failed";
  if (asset.status === "proposed") return "proposed";
  return "generating";
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

// 在途请求是否仍然有效（陈旧的视为已结束，允许重新发起）。
function isInflight(assetId: string): boolean {
  const token = inflight.get(assetId);
  if (token === undefined) return false;
  if (Date.now() - token > REQUEST_TIMEOUT_MS + 2000) {
    inflight.delete(assetId);
    return false;
  }
  return true;
}

// 回查一次素材状态；未到终态则继续排队轮询（ready/failed 后停止）。
async function queryCanvasAsset(apiBase: string, assetId: string): Promise<void> {
  const token = Date.now();
  inflight.set(assetId, token);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let next: CanvasAssetState = "generating";
  try {
    const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(assetId)}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.ok) {
      const asset = normalizeAsset((await response.json()) as Asset);
      remember(assetId, asset);
      next = canvasStateOfAsset(asset);
    }
  } catch {
    // 网络抖动/超时：保持 generating，下一轮重试
  } finally {
    clearTimeout(timeout);
    // 只清理自己这一轮的在途标记（可能已被后续轮次覆盖）
    if (inflight.get(assetId) === token) inflight.delete(assetId);
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
}

// 回查一次素材状态；未到终态则继续排队轮询（ready/failed 后停止）。
export function ensureCanvasAssetStatus(apiBase: string, assetId: string) {
  if (!apiBase || !assetId) return;
  const current = useCanvasAssetStatusStore.getState().statuses[assetId];
  if (current === "ready" || current === "failed") return;
  // 已排下一轮查询（timers）或正在请求（inflight）时不再重复；宿主每次 dataVersion 变化都会调本函数
  if (timers.has(assetId) || isInflight(assetId)) return;
  void queryCanvasAsset(apiBase, assetId);
}

// 媒体实时通道（media channel）推来的权威资产：写入缓存并折算状态。
// 生成完成不再只依赖 2.5s 轮询链——通道事件即时到达；终态后不接受旧帧回退（乱序/重放）。
export function ingestCanvasAsset(apiBase: string, value: unknown): void {
  const asset = normalizeAsset((value ?? {}) as Partial<Asset> & { id?: string });
  if (!asset.id) return;
  const current = useCanvasAssetStatusStore.getState().statuses[asset.id];
  if (current === "ready" || current === "failed") return;
  remember(asset.id, asset);
  const next = canvasStateOfAsset(asset);
  mark(asset.id, next);
  if (next !== "ready" && next !== "failed") ensureCanvasAssetStatus(apiBase, asset.id);
}

// refreshCanvasAsset 强制立即回查一次（确认/改提案后调用）：清掉在途/定时与终态短路，
// 否则刚确认的节点会因为状态被删除而退回 props 声明的「生成中」，只能等下一次轮询碰运气。
export function refreshCanvasAsset(apiBase: string, assetId: string) {
  if (!apiBase || !assetId) return;
  attempts.delete(assetId);
  inflight.delete(assetId);
  const timer = timers.get(assetId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(assetId);
  }
  useCanvasAssetStatusStore.setState((prev) => {
    const statuses = { ...prev.statuses };
    delete statuses[assetId];
    return { statuses };
  });
  ensureCanvasAssetStatus(apiBase, assetId);
}

// 页面重新可见/获得焦点时重新武装未终态的轮询：陈旧在途、被清理或丢掉链路的 assetId 自愈。
export function rearmCanvasAssetStatus(apiBase: string, assetIds: Iterable<string>) {
  if (!apiBase) return;
  const statuses = useCanvasAssetStatusStore.getState().statuses;
  for (const assetId of assetIds) {
    if (!assetId) continue;
    if (statuses[assetId] === "ready" || statuses[assetId] === "failed") continue;
    if (timers.has(assetId) || isInflight(assetId)) continue;
    ensureCanvasAssetStatus(apiBase, assetId);
  }
}

export function stopCanvasAssetStatus() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  inflight.clear();
  attempts.clear();
}
