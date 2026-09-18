/**
 * [INPUT]: 依赖 i18n 的 I18nKey。
 * [OUTPUT]: 素材状态的唯一语义映射：服务端 lifecycle → 编辑器展示状态 → 面板文案 / 预览框状态。
 * [POS]: 素材状态的语义边界；媒体管理器、素材面板、预览框共用，避免把计划态/生成态误当「加载中」。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { I18nKey } from "@timeline/i18n";

/**
 * 服务端素材生命周期（唯一真相，来自 Asset Service）。
 * - proposed  content-first 计划态：有 content/attributes，无字节、无 job
 * - queued    已确认，任务排队等待执行
 * - running   正在生成
 * - completed 已完成，有字节
 * - failed    生成失败
 * - deleted   已删除墓碑，不展示
 */
export type ServerAssetStatus =
	| "proposed"
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "deleted";

/**
 * 编辑器展示状态 = 服务端 lifecycle + 一个本地过渡态 `loading`。
 * `loading` 只表示「服务端 completed、本地字节尚未缓存」的下载过渡，
 * 绝不复用给 proposed/queued/running——那会误导用户以为在加载，实际是计划/生成中。
 */
export type EditorAssetStatus = ServerAssetStatus | "loading";

/**
 * 服务端状态 → 编辑器展示状态。
 * @param hasLocalBytes 本地是否已有可渲染字节（OPFS 缓存/上传文件）。
 */
export function editorStatusFromServer(
	status: string | undefined,
	hasLocalBytes: boolean,
): EditorAssetStatus {
	switch (status) {
		case "proposed":
		case "queued":
		case "running":
		case "failed":
		case "deleted":
			return status;
		case "completed":
			return hasLocalBytes ? "completed" : "loading";
		default:
			// 旧数据/未知状态：按本地字节有无归类，绝不臆造成生成态。
			return hasLocalBytes ? "completed" : "loading";
	}
}

/** 非完成态的角标/占位文案 key；完成态返回 null（正常展示内容，不加角标）。 */
export function assetStatusLabelKey(status?: EditorAssetStatus): I18nKey | null {
	switch (status) {
		case "proposed":
			return "assets.status.proposed";
		case "queued":
			return "assets.status.queued";
		case "running":
			return "assets.status.running";
		case "loading":
			return "assets.status.loading";
		case "failed":
			return "assets.status.failed";
		default:
			return null;
	}
}
