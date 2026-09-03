"use client";

/**
 * [INPUT]: 依赖 Recut Host 的 app.rpc.request 事件、编辑器常驻 renderer 的 renderFrameDataUrl 能力
 *          与 recut.background.call 回包通道。
 * [OUTPUT]: 对外提供 useFrameRender：注册 frame.render / frame.contactSheet / export.encode
 *           的 UI 侧 handler（收到 App 的 ctx.project.callUI 请求即渲染或编码并经 rpc.reply
 *           回包），并以 10s 心跳上报存活性。契约见 docs/platform-comms-contract.md §7–§8。
 * [POS]: recut.editor 的 UI 侧 RPC 处理器；不渲染提示文本，不参与编辑逻辑。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useEffect } from "react";
import { recut } from "@/recut/sdk";
import { EditorCore } from "@/core";
import { isDemoMode } from "@/demo/demo-store";

const HEARTBEAT_MS = 10_000;
const isTest = () =>
	typeof window !== "undefined" &&
	new URLSearchParams(window.location.search).has("test");

/** 把 data URL 缩放到请求尺寸（缺省保持原尺寸），返回 { dataUrl, width, height }。 */
function scaleDataUrl(
	dataUrl: string,
	requested: { width?: number | null; height?: number | null; pixelRatio?: number | null },
): Promise<{ dataUrl: string; width: number; height: number }> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => {
			try {
				const pixelRatio =
					typeof requested.pixelRatio === "number" && requested.pixelRatio > 0
						? requested.pixelRatio
						: 1;
				const width = Math.round((requested.width || image.naturalWidth) * pixelRatio);
				const height = Math.round((requested.height || image.naturalHeight) * pixelRatio);
				if (
					width === image.naturalWidth &&
					height === image.naturalHeight
				) {
					resolve({
						dataUrl,
						width: image.naturalWidth,
						height: image.naturalHeight,
					});
					return;
				}
				const canvas = document.createElement("canvas");
				canvas.width = width;
				canvas.height = height;
				const context = canvas.getContext("2d");
				if (!context) {
					reject(new Error("frame.render: canvas 2d context unavailable"));
					return;
				}
				context.drawImage(image, 0, 0, width, height);
				resolve({ dataUrl: canvas.toDataURL("image/png"), width, height });
			} catch (error) {
				reject(error);
			}
		};
		image.onerror = () =>
			reject(new Error("frame.render: decoded frame image failed"));
		image.src = dataUrl;
	});
}

function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("frame.contactSheet: decoded frame image failed"));
		image.src = dataUrl;
	});
}

function throwIfAborted(signal: AbortSignal, operation: string): void {
	if (signal.aborted) throw new DOMException(`${operation}: cancelled`, "AbortError");
}

function assertTimelineVersion(
	editor: ReturnType<typeof EditorCore.getInstance>,
	payload: Record<string, unknown>,
	operation: string,
): number {
	const version = editor.project.getActiveOrNull()?.version ?? 0;
	const expected = payload.expectedVersion;
	if (typeof expected === "number" && expected !== version) {
		throw new Error(`${operation}: timeline version changed (expected ${expected}, got ${version})`);
	}
	return version;
}

export function useFrameRender({ projectId }: { projectId: string }) {
	useEffect(() => {
		if (isDemoMode() && !isTest()) return;
		const editor = EditorCore.getInstance();

		// 存活性心跳：挂载即上报，此后每 10s 一次。
		const beat = () => {
			void recut.background
				.call("frame.heartbeat", {})
				.catch((error) => console.warn("[recut-frame] heartbeat failed:", error));
		};
		beat();
		const heartbeatTimer = window.setInterval(beat, HEARTBEAT_MS);

		// frame.render handler：渲染 timeline 指定时刻的真实画面并回包。
		const unsub = recut.on("frame.render", async (payload, signal) => {
			throwIfAborted(signal, "frame.render");
			const expectedVersion = assertTimelineVersion(EditorCore.getInstance(), payload, "frame.render");
			const timeSec = Number(
				payload && typeof payload.timeSec === "number"
					? payload.timeSec
					: 0,
			);
			if (!editor.project.getActiveOrNull() || editor.project.getIsLoading()) {
				throw new Error("frame.render: project not ready");
			}
			const dataUrl = await editor.project.renderFrameDataUrl({ time: timeSec });
			throwIfAborted(signal, "frame.render");
			assertTimelineVersion(editor, payload, "frame.render");
			if (!dataUrl) throw new Error("frame.render: renderer produced no frame");
			const scaled = await scaleDataUrl(dataUrl, {
				width: payload.width,
				height: payload.height,
				pixelRatio: payload.pixelRatio,
			});
			return {
				fileBase64: scaled.dataUrl.split(",")[1] ?? "",
				width: scaled.width,
				height: scaled.height,
				version: expectedVersion,
				expectedVersion: expectedVersion,
			};
		});
		const unsubContactSheet = recut.on("frame.contactSheet", async (payload, signal) => {
			throwIfAborted(signal, "frame.contactSheet");
			const expectedVersion = assertTimelineVersion(EditorCore.getInstance(), payload, "frame.contactSheet");
			const times = Array.isArray(payload?.times) ? payload.times : [];
			if (times.length === 0 || times.length > 16) {
				throw new Error("frame.contactSheet: times must contain 1..16 values");
			}
			if (!editor.project.getActiveOrNull() || editor.project.getIsLoading()) {
				throw new Error("frame.contactSheet: project not ready");
			}
			const images: HTMLImageElement[] = [];
			for (const timeSec of times) {
				throwIfAborted(signal, "frame.contactSheet");
				assertTimelineVersion(editor, payload, "frame.contactSheet");
				const dataUrl = await editor.project.renderFrameDataUrl({ time: Number(timeSec) });
				if (!dataUrl) throw new Error("frame.contactSheet: renderer produced no frame");
				const scaled = await scaleDataUrl(dataUrl, { width: payload.width, height: payload.height, pixelRatio: payload.pixelRatio });
				images.push(await decodeImage(scaled.dataUrl));
			}
			throwIfAborted(signal, "frame.contactSheet");
			assertTimelineVersion(editor, payload, "frame.contactSheet");
			const cellWidth = images[0].naturalWidth;
			const cellHeight = images[0].naturalHeight;
			const columns = Math.ceil(Math.sqrt(images.length));
			const rows = Math.ceil(images.length / columns);
			const canvas = document.createElement("canvas");
			canvas.width = cellWidth * columns;
			canvas.height = cellHeight * rows;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("frame.contactSheet: canvas 2d context unavailable");
			context.fillStyle = "#111";
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.font = "600 20px sans-serif";
			context.textBaseline = "top";
			images.forEach((image, index) => {
				const x = (index % columns) * cellWidth;
				const y = Math.floor(index / columns) * cellHeight;
				context.drawImage(image, x, y, cellWidth, cellHeight);
				context.fillStyle = "rgba(0,0,0,.72)";
				context.fillRect(x + 8, y + 8, 110, 30);
				context.fillStyle = "#fff";
				context.fillText(`${Number(times[index]).toFixed(2)}s`, x + 16, y + 13);
			});
			return {
				fileBase64: canvas.toDataURL("image/png").split(",")[1] ?? "",
				width: canvas.width,
				height: canvas.height,
				version: expectedVersion,
				expectedVersion: expectedVersion,
			};
		});

		const unsubExport = recut.on("export.encode", async (payload, signal) => {
			throwIfAborted(signal, "export.encode");
			const expectedVersion = assertTimelineVersion(EditorCore.getInstance(), payload, "export.encode");
			if (!editor.project.getActiveOrNull() || editor.project.getIsLoading()) {
				throw new Error("export.encode: project not ready");
			}
			const cancelExport = () => editor.project.cancelExport();
			signal.addEventListener("abort", cancelExport, { once: true });
			try {
				const result = await editor.project.export({
					options: {
						format: "mp4",
						quality: "high",
						includeAudio: true,
						width: typeof payload.width === "number" ? payload.width : undefined,
						height: typeof payload.height === "number" ? payload.height : undefined,
						fps: typeof payload.fps === "number" ? payload.fps : undefined,
					},
				});
				throwIfAborted(signal, "export.encode");
				assertTimelineVersion(editor, payload, "export.encode");
				if (result.cancelled) throw new Error("export.encode: cancelled");
				if (!result.success || !result.buffer) {
					throw new Error(result.error || "export.encode: encoder produced no buffer");
				}
				const bytes = new Uint8Array(result.buffer);
				let binary = "";
				const chunk = 0x8000;
				for (let i = 0; i < bytes.length; i += chunk) {
					binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
				}
				return {
					fileBase64: btoa(binary),
					mimeType: "video/mp4",
					exportId: typeof payload.exportId === "string" ? payload.exportId : "",
					version: expectedVersion,
					expectedVersion: expectedVersion,
				};
			} finally {
				signal.removeEventListener("abort", cancelExport);
			}
		});

		return () => {
			window.clearInterval(heartbeatTimer);
			unsub();
			unsubContactSheet();
			unsubExport();
		};
	}, [projectId]);
}
