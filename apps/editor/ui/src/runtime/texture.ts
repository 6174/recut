/**
 * [INPUT]: 依赖 React 生命周期、React Three Fiber 失效器与 Three 纹理能力。
 * [OUTPUT]: 对外提供媒体目标帧就绪门、视频/图片和 Canvas 纹理 Hook。
 * [POS]: runtime 的纹理同步层；快照与导出在读取 WebGL 前等待图片加载、视频 seek 与纹理更新。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { World } from "./types";

interface FrameReadySurface {
	waitForFrame(timeoutMs: number): Promise<boolean>;
}

const MEDIA_READY_TIMEOUT_MS = 5_000;

/** 当前世界树的外部视觉媒体；快照与导出只能在它们就绪后读像素。 */
export const activeMediaSurfaces = new Set<FrameReadySurface>();

function nextAnimationFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForCondition({
	check,
	timeoutMs,
}: {
	check: () => boolean;
	timeoutMs: number;
}): Promise<boolean> {
	const deadline = performance.now() + timeoutMs;
	while (performance.now() < deadline) {
		if (check()) return true;
		await nextAnimationFrame();
	}
	return check();
}

class ImageFrameSurface implements FrameReadySurface {
	private failed = false;

	constructor(private readonly image: HTMLImageElement) {}

	markFailed(): void {
		this.failed = true;
	}

	waitForFrame(timeoutMs: number): Promise<boolean> {
		return waitForCondition({
			timeoutMs,
			check: () =>
				!this.failed && this.image.complete && this.image.naturalWidth > 0,
		});
	}
}

/**
 * `<video>` 元素池（按 URL）：时间线接缝处旧片段卸载、新片段（新元素 id）挂载
 * 是同一提交内的事。若每次挂载都新建 video 元素，新元素从 currentTime=0 开始
 * 冷 seek，高清素材每过一次接缝就闪黑数帧。池化后复用解码位置已在目标附近的
 * 元素，接缝即连续前进，无需冷 seek。
 */
interface PooledVideo {
	video: HTMLVideoElement;
	refCount: number;
	destroyTimer: ReturnType<typeof setTimeout> | null;
}

const videoPool = new Map<string, PooledVideo>();
/** 引用归零后保留这么久再销毁：覆盖“卸载→挂载”不同步的窗口。 */
const POOLED_VIDEO_IDLE_TTL_MS = 10_000;
/** 池上限：超出时淘汰最久未用的空闲项，避免长会话堆积解码器。 */
const POOLED_VIDEO_MAX_IDLE = 8;

function acquirePooledVideo(url: string): { video: HTMLVideoElement; pooled: boolean } {
	// 优先领走已预热的解码器（已提前 seek 到入点附近）。
	const warmed = warmedVideos.get(url);
	if (warmed) {
		warmedVideos.delete(url);
		clearTimeout(warmed.timer);
		videoPool.set(url, { video: warmed.video, refCount: 1, destroyTimer: null });
		return { video: warmed.video, pooled: true };
	}
	const existing = videoPool.get(url);
	// 只复用空闲项：若该 URL 当前正被其他已挂载组件使用（快照/画中画），
	// 共享会让双方反复抢 currentTime 导致 seek 死循环；此时回退到独立元素。
	if (existing && existing.refCount === 0) {
		if (existing.destroyTimer) {
			clearTimeout(existing.destroyTimer);
			existing.destroyTimer = null;
		}
		existing.refCount += 1;
		return { video: existing.video, pooled: true };
	}
	if (existing) {
		return { video: createDetachedVideo(), pooled: false };
	}
	const video = createDetachedVideo();
	videoPool.set(url, { video, refCount: 1, destroyTimer: null });
	return { video, pooled: true };
}

function createDetachedVideo(): HTMLVideoElement {
	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.preload = "auto";
	// 挂到隐藏 DOM：detached 视频解码不可靠。
	video.style.cssText = "position:absolute;left:-99999px;top:0;width:1px;height:1px;";
	document.body.appendChild(video);
	video.pause();
	return video;
}

function releasePooledVideo(url: string, pooled: boolean, video: HTMLVideoElement): void {
	// 非池化（独立）元素：沿用老行为，直接销毁。
	if (!pooled) {
		destroyVideoElement(video);
		return;
	}
	const entry = videoPool.get(url);
	if (!entry) {
		destroyVideoElement(video);
		return;
	}
	entry.refCount = Math.max(0, entry.refCount - 1);
	if (entry.refCount > 0 || entry.destroyTimer) return;
	entry.destroyTimer = setTimeout(() => {
		const current = videoPool.get(url);
		if (!current || current.refCount > 0) return;
		videoPool.delete(url);
		destroyVideoElement(current.video);
	}, POOLED_VIDEO_IDLE_TTL_MS);
	// 池上限：淘汰其他空闲项。
	let idle = [...videoPool.entries()].filter(([, e]) => e.refCount === 0);
	while (idle.length > POOLED_VIDEO_MAX_IDLE) {
		const oldest = idle.shift();
		if (!oldest || oldest[0] === url) break;
		const [, entryToEvict] = oldest;
		videoPool.delete(oldest[0]);
		if (entryToEvict.destroyTimer) clearTimeout(entryToEvict.destroyTimer);
		destroyVideoElement(entryToEvict.video);
		idle = [...videoPool.entries()].filter(([, e]) => e.refCount === 0);
	}
}

function destroyVideoElement(video: HTMLVideoElement): void {
	video.pause();
	video.removeAttribute("src");
	video.load();
	video.parentElement?.removeChild(video);
}

/**
 * 即将上场的媒体预热：B 挂载时解码器若是冷的，首帧必闪背景（高清素材数帧）。
 * 预览循环每帧调用，对 1s 内即将开始的 video/image 提前建好解码器并 seek 到入点；
 * B 上场时 acquire 直接领走已就位的元素，首帧即正确内容。
 */
const PREWARM_AHEAD_SEC = 1.0;
const WARM_TTL_MS = 15_000;

const warmedVideos = new Map<
	string,
	{ video: HTMLVideoElement; timer: ReturnType<typeof setTimeout> }
>();
const warmedImages = new Map<
	string,
	{ img: HTMLImageElement; timer: ReturnType<typeof setTimeout> }
>();

function clampSeekTarget(video: HTMLVideoElement, targetSec: number): number {
	if (!Number.isFinite(video.duration) || video.duration <= 0) {
		return Math.max(0, targetSec);
	}
	return Math.min(Math.max(0, targetSec), Math.max(0, video.duration - 0.001));
}

export function prewarmWorldMedia(world: World, timeSec: number): void {
	if (typeof document === "undefined") return;
	for (const object of world.objects) {
		const startsIn = object.startTime - timeSec;
		if (!(startsIn > 0 && startsIn <= PREWARM_AHEAD_SEC)) continue;
		if (object.kind === "video" && object.url) {
			prewarmVideo(object.url, object.trimStart ?? 0);
		} else if (object.kind === "image" && object.url) {
			prewarmImage(object.url);
		}
	}
}

function prewarmVideo(url: string, entrySec: number): void {
	const pooled = videoPool.get(url);
	if (pooled) {
		// 空闲池项提前推到入点附近；活跃项解码器已热，无需处理。
		if (pooled.refCount === 0) {
			const video = pooled.video;
			if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
				const target = clampSeekTarget(video, entrySec);
				if (Math.abs(video.currentTime - target) > 0.002) {
					try {
						video.currentTime = target;
					} catch {
						// 忽略：seek 失败时上场走正常冷启动路径。
					}
				}
			}
		}
		return;
	}
	if (warmedVideos.has(url)) return;
	const video = createDetachedVideo();
	video.addEventListener(
		"loadedmetadata",
		() => {
			try {
				video.currentTime = clampSeekTarget(video, entrySec);
			} catch {
				// 忽略：同上。
			}
		},
		{ once: true },
	);
	video.src = url;
	video.load();
	const timer = setTimeout(() => {
		warmedVideos.delete(url);
		destroyVideoElement(video);
	}, WARM_TTL_MS);
	warmedVideos.set(url, { video, timer });
}

function prewarmImage(url: string): void {
	if (warmedImages.has(url)) return;
	const img = new Image();
	img.crossOrigin = "anonymous";
	const timer = setTimeout(() => {
		warmedImages.delete(url);
	}, WARM_TTL_MS);
	img.src = url;
	warmedImages.set(url, { img, timer });
}

/** 领走已预热的图片（解码完成才有效，调用方自行判断）。 */
function adoptWarmedImage(
	url: string,
): { img: HTMLImageElement; timer: ReturnType<typeof setTimeout> } | null {
	const warmed = warmedImages.get(url);
	if (!warmed) return null;
	if (warmed.img.complete && warmed.img.naturalWidth > 0) {
		warmedImages.delete(url);
		clearTimeout(warmed.timer);
		return warmed;
	}
	return null;
}

class VideoFrameSurface implements FrameReadySurface {
	private failed = false;
	private targetTime: number | null = null;
	private texture: THREE.VideoTexture | null = null;

	constructor(private readonly video: HTMLVideoElement) {}

	setTexture(texture: THREE.VideoTexture): void {
		this.texture = texture;
	}

	requestFrame(time: number): void {
		this.targetTime = Math.max(0, time);
		this.seek();
	}

	markFailed(): void {
		this.failed = true;
	}

	notifyMediaEvent(): void {
		this.seek();
	}

	private currentTarget(): number | null {
		if (this.targetTime === null || !Number.isFinite(this.video.duration)) {
			return this.targetTime;
		}
		return Math.min(this.targetTime, Math.max(0, this.video.duration - 0.001));
	}

	private isReady(): boolean {
		const target = this.currentTarget();
		return (
			target !== null &&
			!this.failed &&
			this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
			Math.abs(this.video.currentTime - target) <= 0.002
		);
	}

	private seek(): void {
		const target = this.currentTarget();
		if (target === null || this.failed) return;
		if (this.video.readyState < HTMLMediaElement.HAVE_METADATA) return;
		if (Math.abs(this.video.currentTime - target) > 0.002) {
			this.video.currentTime = target;
			return;
		}
		if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
			if (this.texture) this.texture.needsUpdate = true;
		}
	}

	async waitForFrame(timeoutMs: number): Promise<boolean> {
		const ready = await waitForCondition({
			timeoutMs,
			check: () => {
				this.seek();
				return this.isReady();
			},
		});
		if (ready && this.texture) this.texture.needsUpdate = true;
		return ready;
	}
}

/**
 * 等待本次 React 提交中出现的所有外部视觉媒体到达它们的目标画面。
 * 超时是错误而不是允许旧纹理悄悄进入 preview/export：视觉证据不能由黑帧或前一帧构成。
 */
export async function waitForVisualMediaFrames(
	timeoutMs = MEDIA_READY_TIMEOUT_MS,
): Promise<void> {
	const surfaces = [...activeMediaSurfaces];
	const ready = await Promise.all(
		surfaces.map((surface) => surface.waitForFrame(timeoutMs)),
	);
	if (ready.every(Boolean)) return;
	throw new Error("Visual media did not reach its requested frame before render timeout");
}

/**
 * 视频纹理：视频元素由时间驱动（暂停 + 逐帧定位），不 autoplay。
 * 返回 frameVersion：每次浏览器解出可用帧时递增，使调用方只在真实帧到达后上传纹理。
 */
export function useVideoTexture(url?: string): {
	texture: THREE.VideoTexture | null;
	video: HTMLVideoElement | null;
	frameVersion: number;
	surface: VideoFrameSurface | null;
} {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const surfaceRef = useRef<VideoFrameSurface | null>(null);
	const [texture, setTexture] = useState<THREE.VideoTexture | null>(null);
	const [frameVersion, setFrameVersion] = useState(0);

	useEffect(() => {
		if (!url) {
			setTexture(null);
			return;
		}
		if (!videoRef.current) {
			// 同一 URL 复用池里的空闲 video：接缝处解码位置已在目标附近，无冷 seek。
			// 复用时绝不重置 src（那会把 currentTime 打回 0）；新元素才需要加载。
			const acquired = acquirePooledVideo(url);
			videoRef.current = acquired.video;
			videoRef.current.dataset.recutPooled = acquired.pooled ? "1" : "0";
			if (!videoRef.current.currentSrc) {
				videoRef.current.src = url;
				videoRef.current.load();
			}
		}
		const video = videoRef.current;
		const surface = new VideoFrameSurface(video);
		surfaceRef.current = surface;
		activeMediaSurfaces.add(surface);
		const markFrameAvailable = () => {
			surface.notifyMediaEvent();
			setFrameVersion((version) => version + 1);
		};
		const markFailed = () => surface.markFailed();
		video.addEventListener("loadeddata", markFrameAvailable);
		video.addEventListener("canplay", markFrameAvailable);
		video.addEventListener("seeked", markFrameAvailable);
		video.addEventListener("error", markFailed);
		video.pause();

		const texture = new THREE.VideoTexture(video);
		// 浏览器解码的视频帧已经是 sRGB。若误当作 linear，renderer 输出时会再编码
		// 一次，导致中间调抬升、整个画面像蒙了一层灰白。
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.minFilter = THREE.LinearFilter;
		texture.magFilter = THREE.LinearFilter;
		surface.setTexture(texture);
		setTexture(texture);
		return () => {
			video.removeEventListener("loadeddata", markFrameAvailable);
			video.removeEventListener("canplay", markFrameAvailable);
			video.removeEventListener("seeked", markFrameAvailable);
			video.removeEventListener("error", markFailed);
			activeMediaSurfaces.delete(surface);
			if (surfaceRef.current === surface) surfaceRef.current = null;
			texture.dispose();
			// 池化元素归还池子（引用归零后延迟销毁），独立元素直接销毁。
			const pooled = video.dataset.recutPooled === "1";
			delete video.dataset.recutPooled;
			releasePooledVideo(url, pooled, video);
			videoRef.current = null;
		};
	}, [url]);

	return { texture, video: videoRef.current, frameVersion, surface: surfaceRef.current };
}

export function useImageTexture(url?: string): THREE.Texture | null {
	const [texture, setTexture] = useState<THREE.Texture | null>(null);

	useEffect(() => {
		if (!url) {
			setTexture(null);
			return;
		}
		let disposed = false;
		// 预热命中：图片已解码，直接建纹理，无需再等 onload。
		const adopted = adoptWarmedImage(url);
		if (adopted) {
			const surface = new ImageFrameSurface(adopted.img);
			activeMediaSurfaces.add(surface);
			const texture = new THREE.Texture(adopted.img);
			// DOM Image 与视频帧同属显示色域；统一在采样时解码到 renderer 工作空间。
			texture.colorSpace = THREE.SRGBColorSpace;
			texture.needsUpdate = true;
			setTexture(texture);
			return () => {
				activeMediaSurfaces.delete(surface);
				texture.dispose();
			};
		}
		const image = new Image();
		const surface = new ImageFrameSurface(image);
		activeMediaSurfaces.add(surface);
		image.crossOrigin = "anonymous";
		image.onload = () => {
			if (disposed) return;
			const texture = new THREE.Texture(image);
			// DOM Image 与视频帧同属显示色域；统一在采样时解码到 renderer 工作空间。
			texture.colorSpace = THREE.SRGBColorSpace;
			texture.needsUpdate = true;
			setTexture(texture);
		};
		image.onerror = () => surface.markFailed();
		image.src = url;
		return () => {
			disposed = true;
			activeMediaSurfaces.delete(surface);
		};
	}, [url]);

	return texture;
}

/** 持久 CanvasTexture：每次渲染重绘（用于文字等程序化内容）。 */
export function useCanvasTexture(
	draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
	width: number,
	height: number,
	contentKey: string,
): THREE.CanvasTexture {
	const textureRef = useRef<THREE.CanvasTexture | null>(null);
	const textureKeyRef = useRef("");
	if (!textureRef.current || textureKeyRef.current !== contentKey) {
		textureRef.current?.dispose();
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const texture = new THREE.CanvasTexture(canvas);
		// 2D canvas 的绘制结果使用 sRGB；标记正确色域避免文字/图形与媒体色调不一致。
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.minFilter = THREE.LinearFilter;
		texture.magFilter = THREE.LinearFilter;
		texture.flipY = true;
		textureRef.current = texture;
		textureKeyRef.current = contentKey;
	}
	const texture = textureRef.current;
	useEffect(() => () => texture.dispose(), [texture]);
	const canvas = texture.image as HTMLCanvasElement;
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
	const context = canvas.getContext("2d");
	if (context) {
		// 绘制和 geometry 在同一 React 提交中准备好，不能把它延后到 effect。
		// 否则新尺寸会先采样旧纹理，背景开关便会拉伸文字并留下色块。
		context.clearRect(0, 0, width, height);
		draw(context, width, height);
		texture.needsUpdate = true;
	}
	return texture;
}
