/*
 * [INPUT]: 依赖 canvas-store 类型（仅类型）
 * [OUTPUT]: 对外提供 canvasErrorFeedback：B.4 错误映射集中函数——服务端码/网络失败 → 用户语言
 * toast 文案（含 [重试] 动作）； ENTITY_NOT_FOUND/404 → 「已刷新」提示
 * [POS]: worlds/[worldID]/canvas 的错误反馈层（T10；各写动作 catch 统一走 applyCanvasError）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useWorldCanvasStore } from "./canvas-store";

// 服务端错误码 → 用户语言（B.4 映射表）
export function canvasErrorMessage(cause: unknown): string {
  const code = (cause as { code?: string } | null)?.code;
  const status = (cause as { status?: number } | null)?.status;
  if (code === "WORLD_REVISION_CONFLICT") return "设定已被其他窗口更新，已加载最新版本，请重试";
  if (code === "ENTITY_NOT_FOUND" || code === "WORLD_NOT_FOUND" || status === 404) return "这个设定已不存在，已刷新";
  if (code === "ASSET_NOT_READY") return "素材处理中，稍后可重试挂接";
  if (cause instanceof TypeError || (cause instanceof Error && /fetch|network/i.test(cause.message))) return "网络异常，改动未保存";
  return cause instanceof Error ? `操作失败：${cause.message}` : "操作失败";
}

// 统一错误出口：映射 toast（网络失败带 [重试]）；实体 404 额外自动刷新
export function applyCanvasError(cause: unknown) {
  const store = useWorldCanvasStore.getState();
  const text = canvasErrorMessage(cause);
  const isNetwork = text.startsWith("网络异常");
  const isGone = text.startsWith("这个设定已不存在");
  if (isGone) {
    store.toast(text, "error");
    void store.load(true);
    store.select(null);
    return;
  }
  if (isNetwork) {
    store.toast(text, "error", {
      label: "重试",
      run: () => void store.load(true),
    });
    return;
  }
  store.toast(text, "error");
}
