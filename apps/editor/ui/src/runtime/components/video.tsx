import { useEffect, useLayoutEffect } from "react";
import { useThree } from "@react-three/fiber";
import type { ComponentRenderContext } from "../types";
import { useVideoTexture } from "../texture";
import { Plane } from "./plane";

/**
 * [INPUT]: 依赖 runtime 视频纹理、R3F 帧失效器与世界局部时间。
 * [OUTPUT]: 对外提供 VideoObject；登记目标视频帧、在浏览器解出后上传纹理并重绘。
 * [POS]: runtime/components 的视频平面；与 ImageObject 共用 Plane，额外处理异步 seek。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export function VideoObject({ world, object, params, localTime }: ComponentRenderContext) {
	const { texture, video, frameVersion, surface } = useVideoTexture(object.url);
	const invalidate = useThree((state) => state.invalidate);
	const sourceTime = (object.trimStart ?? 0) + localTime;

	// SnapshotPass 的 effect 会在本次 commit 后等待媒体；layout 阶段先登记目标时间，
	// 避免它错误地把刚挂载的视频当成“不需要等待”。
	useLayoutEffect(() => {
		surface?.requestFrame(sourceTime);
	}, [sourceTime, surface]);

	useEffect(() => {
		if (!video || !texture) return;
		if (!video.paused) video.pause();
		surface?.requestFrame(sourceTime);
		if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;

		if (Math.abs(video.currentTime - sourceTime) > 1e-3) {
			video.currentTime = sourceTime;
			return;
		}

		// seeked / loadeddata 才会推进 frameVersion。不能在设置 currentTime 的同一刻
		// 上传纹理：那一刻浏览器常尚未解出目标帧，WebGL 会把黑帧永久留在画布上。
		if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
		texture.needsUpdate = true;
		invalidate();
	}, [frameVersion, invalidate, sourceTime, surface, texture, video]);

	return <Plane world={world} object={object} params={params} map={texture} />;
}
