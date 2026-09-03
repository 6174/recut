"use client";

/**
 * 首帧封面自动同步（等就绪 + 稳定窗口 + 编辑去抖 + 节流 + hash 跳过）。
 *
 * 首帧抓取复用编辑器预览的常驻 renderer 输出（renderFirstFrameDataUrl），
 * 与用户看到的内容一致；html/react 组件需浏览器开启 CanvasDrawElement
 * （见 apps/editor/README.md 的渲染前提），未开启时封面显式跳过不推黑帧。
 *
 * 时机策略：
 * 1. 等加载：`project.getIsLoading() === false`（项目 + 素材元数据就绪）。
 * 2. 稳定窗口：加载完成后等待 SETTLE_MS（默认 5s），然后只抓取一次首帧推送。
 * 3. 编辑去抖：仅已提交的场景变化后空闲 EDIT_IDLE_DELAY_MS 才重新进入就绪流程。
 * 4. 节流：两次实际推送至少间隔 THROTTLE_MS。
 * 5. hash 跳过：帧与上次推送相同则不重复写入。
 * 6. 手动封面优先：用户用封面帧/素材选过封面（cover.get 的 mode != auto）后，
 *    自动首帧同步整体停止，cover.update 也由后台返回 skipped，绝不覆盖用户选择。
 * 封面走 cover.update（文件封面，不产生 media Asset），可频繁刷新不污染素材库。
 */
import { useEffect, useRef } from "react";
import { EditorCore } from "@/core";
import { recut } from "@/recut/sdk";
import { isDemoMode } from "@/demo/demo-store";

const EDIT_IDLE_DELAY_MS = 3 * 60_000;
const THROTTLE_MS = 3 * 60_000;
const SETTLE_MS = 5000;
const LOAD_RETRY_MS = 800;
const COVER_MIME_TYPE = "image/png";
const initializedProjectIds = new Set<string>();

/**
 * [INPUT]: 项目/时间线变更、编辑器首帧渲染与 Recut cover.update 能力
 * [OUTPUT]: 去抖、节流后的项目封面同步；用户手动选过封面（cover.get mode != auto）后整体停止
 * [POS]: recut 的后台封面同步器；静止时绝不重复创建离屏 WebGL renderer
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

/** 轻量 PNG data URL hash：首帧是否真的变化（确定性渲染下同帧 hash 稳定）。 */
function dataUrlHash(dataUrl: string): string {
	let hash = 5381;
	for (let i = 0; i < dataUrl.length; i++) {
		hash = (hash * 33) ^ dataUrl.charCodeAt(i);
	}
	return (hash >>> 0).toString(36);
}

export function useRecutCoverSync({ projectId }: { projectId: string }) {
	const lastPushAtRef = useRef(0);
	const lastHashRef = useRef<string | null>(null);
	const pendingRef = useRef(false);

	useEffect(() => {
		if (isDemoMode()) return;
		const editor = EditorCore.getInstance();
		let debounceTimer: ReturnType<typeof setTimeout> | null = null;
		let settleTimer: ReturnType<typeof setTimeout> | null = null;
		let disposed = false;

		const clearTimers = () => {
			if (debounceTimer) clearTimeout(debounceTimer);
			if (settleTimer) clearTimeout(settleTimer);
			debounceTimer = null;
			settleTimer = null;
		};

		const pushCover = async () => {
			if (pendingRef.current || disposed) return;
			const now = Date.now();
			if (now - lastPushAtRef.current < THROTTLE_MS) return;
			// 手动封面优先：用户选过帧/素材后停止自动首帧同步，避免覆盖用户选择。
			try {
				const pref = await recut.background.call("cover.get", {});
				if (pref && pref.mode && pref.mode !== "auto") return;
			} catch {
				// 读取失败不阻断：仍按上次已知模式推进。
			}
			// 封面是低优先级旁路：只要用户正在播放、拖拽或保留选择，就不参与。
			// 不重试、不抢帧，下一次真实编辑后的后台窗口才会再尝试。
			if (
				editor.playback.getIsPlaying() ||
				editor.timeline.isPreviewActive() ||
				editor.selection.getSelectedElements().length > 0
			) {
				return;
			}

			pendingRef.current = true;
			try {
				const dataUrl = await editor.project.renderFirstFrameDataUrl();
				if (!dataUrl) return;

				const hash = dataUrlHash(dataUrl);
				if (hash === lastHashRef.current) return;

				lastHashRef.current = hash;
				lastPushAtRef.current = Date.now();
				const fileBase64 = dataUrl.split(",")[1] ?? "";
				await recut.background.call("cover.update", {
					fileBase64,
					mimeType: COVER_MIME_TYPE,
				});
			} catch (error) {
				console.warn("[recut-cover] cover.update failed:", error);
			} finally {
				pendingRef.current = false;
			}
		};

		// 等加载完成（项目 + 素材元数据 + 字体），再进入稳定窗口。
		const waitLoaded = () => {
			if (disposed) return;
			if (editor.project.getIsLoading() || editor.media.isLoadingMedia()) {
				settleTimer = setTimeout(waitLoaded, LOAD_RETRY_MS);
				return;
			}
			settleAndPush();
		};

		// 稳定窗口只等待，不反复离屏渲染。此前每 800ms 创建一个 WebGL renderer
		// 来比较 hash，会在用户无操作时耗尽浏览器 context 配额。
		const settleAndPush = () => {
			if (disposed) return;
			if (settleTimer) clearTimeout(settleTimer);
			settleTimer = setTimeout(() => {
				settleTimer = null;
				void pushCover();
			}, SETTLE_MS);
		};

		// 编辑变化：空闲去抖后再进入"等加载 → 稳定 → 推送"。
		const scheduleAfterCommittedEdit = () => {
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(waitLoaded, EDIT_IDLE_DELAY_MS);
		};

		// scenes 只在 DocumentData 被提交时通知；timeline 还会通知拖拽瞬时层与
		// 取消操作，订阅它会让纯预览动作错误地排入后台封面任务。
		const unsubscribeScene = editor.scenes.subscribe(scheduleAfterCommittedEdit);

		// 每个项目在当前应用会话只做一次首次同步；Provider 重挂不会重复抢占 GPU。
		if (!initializedProjectIds.has(projectId)) {
			initializedProjectIds.add(projectId);
			waitLoaded();
		}

		return () => {
			disposed = true;
			clearTimers();
			unsubscribeScene();
		};
	}, [projectId]);
}
