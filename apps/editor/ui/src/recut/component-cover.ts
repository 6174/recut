/**
 * [INPUT]: asset.list 返回的 active component 引用、component.resolve 返回的精确版本 bundle、component-harness 的 WebGL/HTML-in-Canvas 渲染与 component.verify、ai-components 测试 seam（无宿主跳过）。
 * [OUTPUT]: 对外提供组件素材库可见性验证，渲染稳定帧并将 PNG 作为组件素材封面回传。
 * [POS]: recut 组件素材库的 UI verifier；只有素材库显示时才执行 HTML-in-Canvas，不写入时间线。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { recut } from "./sdk";
import { getTestSeam } from "./ai-components";

type HarnessComponent = {
	componentId: string;
	name: string;
	surface: string;
	inputs: Array<{ key: string; default: unknown }>;
	/** AI 组件 bundle；平台内置组件（已注册）可省略。 */
	bundle?: string;
	bundleHash?: string;
};

type Harness = {
	supported(): { htmlInCanvas: boolean };
	setComponent(component: HarnessComponent): boolean;
	render(time: number, duration?: number): Promise<{ status: string; error?: string }>;
	getCanvas(): { width: number; height: number } | null;
	capturePng(): string | null;
};

const running = new Set<string>();
// 已确认无法渲染封面/渲染失败的版本：本轮会话内不再重试（坏数据或环境缺 CanvasDrawElement），
// 避免每次素材库挂载都对同一坏组件反复起 harness/请求。
const giveUp = new Set<string>();
const GIVE_UP_RESET_MS = 5 * 60_000;
const giveUpTimestamps = new Map<string, number>();

function shouldGiveUp(versionId: string): boolean {
	const last = giveUpTimestamps.get(versionId);
	if (last && Date.now() - last < GIVE_UP_RESET_MS) return true;
	giveUp.delete(versionId);
	giveUpTimestamps.delete(versionId);
	return false;
}

function markGiveUp(versionId: string) {
	giveUp.add(versionId);
	giveUpTimestamps.set(versionId, Date.now());
}

function waitForHarness(frame: HTMLIFrameElement): Promise<Harness> {
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + 12_000;
		const poll = () => {
			const harness = (frame.contentWindow as (Window & { __recutHarness?: Harness }) | null)?.__recutHarness;
			if (harness) return resolve(harness);
			if (Date.now() >= deadline) return reject(new Error("component harness timed out"));
			window.setTimeout(poll, 50);
		};
		poll();
	});
}

/** 解码 PNG dataURL 的小尺寸采样，判断是否仍是黑帧（R3F demand 尚未 paint）。 */
async function isBlankFrame(dataUrl: string): Promise<boolean> {
	try {
		const img = new Image();
		img.src = dataUrl;
		await img.decode();
		const canvas = document.createElement("canvas");
		canvas.width = 32;
		canvas.height = 18;
		const ctx = canvas.getContext("2d");
		if (!ctx) return true;
		ctx.drawImage(img, 0, 0, 32, 18);
		const data = ctx.getImageData(0, 0, 32, 18).data;
		for (let i = 0; i < data.length; i += 4) {
			// 有不透明且亮度 > 8 的像素即视为"已出图"。
			if (data[i + 3] > 16 && (data[i] + data[i + 1] + data[i + 2]) / 3 > 8) return false;
		}
		return true;
	} catch {
		return true;
	}
}

/**
 * 轮询等待 WebGL 帧真正绘制出来：WorldScene 是 frameloop="demand"，
 * harness.render 返回时 R3F 可能还没 paint，立即 capturePng 会拿到纯黑帧
 * （实测封面全部为黑）。有界轮询，最终兜底返回最新一帧。
 */
async function captureRenderedPng(harness: Harness, timeoutMs = 8000): Promise<string | null> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const png = harness.capturePng();
		if (png && !(await isBlankFrame(png))) return png;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	return harness.capturePng();
}

/**
 * 在隐藏 harness 中渲染一个组件（AI bundle 或平台内置 id）并轮询捕获透明封面 PNG。
 * 共享给 AI 组件（component.verify 写库）与平台内置组件（IndexedDB 缓存）。
 */
export async function captureComponentCover(
	options: HarnessComponent,
): Promise<{ dataUrl: string | null; width: number; height: number } | null> {
	const frame = document.createElement("iframe");
	// harness 与 App UI 同源同目录（/v1/apps/{appId}/ui/…），用相对 App 根路径解析，
	// 不能用绝对 "/component-harness.html"（会打到 service 根而 404）。
	// ?transparent=1：封面输出透明背景 PNG（组件视觉透出，不带深色底块）。
	const harnessURL = new URL("component-harness.html", document.baseURI);
	harnessURL.searchParams.set("transparent", "1");
	frame.src = harnessURL.toString();
	frame.setAttribute("aria-hidden", "true");
	// 必须保持在视口内且 opacity > 0：Chromium 对离屏/不可见（left:-9999px 或 opacity:0）
	// 的嵌套 iframe 不触发 requestAnimationFrame → harness.render 的 waitFrames 永久挂起。
	// iframe 还必须保留完整的 640×360 viewport。1px viewport 虽能出 R3F 帧，却会裁掉
	// HTML/React 的离屏 paint record，导致最后两类内置组件只能得到透明封面。
	// 极低 opacity 使真实尺寸的 iframe 不可见，且 captureElementImage 仍能读取完整内容。
	frame.style.cssText = "position:fixed;top:0;left:0;width:640px;height:360px;opacity:0.001;pointer-events:none;border:0;z-index:99999";
	document.body.appendChild(frame);
	try {
		const harness = await waitForHarness(frame);
		harness.setComponent(options);
		// 防御：渲染在极端环境也可能挂起（rAF 被上层节流），给 10s 上限，失败可重试。
		const rendered = await Promise.race([
			harness.render(0.45),
			new Promise<{ status: string; error?: string }>((resolve) =>
				setTimeout(() => resolve({ status: "timeout", error: "component harness render timed out" }), 10_000),
			),
		]);
		if (rendered.status !== "rendered") throw new Error(rendered.error || "component render failed");
		const size = harness.getCanvas();
		const dataUrl = harness.supported().htmlInCanvas ? await captureRenderedPng(harness) : null;
		return size ? { dataUrl, width: size.width, height: size.height } : null;
	} finally {
		frame.remove();
	}
}

/** 在组件素材库可见时渲染一个 settled frame，并按需补齐验证状态与封面。 */
export async function verifyComponentVersion(versionId: string): Promise<void> {
	if (!versionId || running.has(versionId) || shouldGiveUp(versionId)) return;
	running.add(versionId);
	try {
		const resolved = await recut.background.call("component.resolve", { versionId });
		const component = resolved?.components?.[0];
		if (!component || !["draft", "verified"].includes(component.status)) return;
		// 已有封面的 verified 版本无需再次启动隐藏 harness。
		if (component.status === "verified" && component.coverUrl) return;
		const captured = await captureComponentCover({
			componentId: component.componentId,
			name: component.name,
			surface: component.surface,
			inputs: component.inputs ?? [],
			bundle: component.bundle,
			bundleHash: component.bundleHash,
		});
		const dataUrl = captured?.dataUrl ?? null;
		const size = captured;
		await recut.background.call("component.verify", {
			versionId,
			report: {
				ok: true,
				checks: [
					{ name: "browser-render", pass: true },
					{ name: "html-in-canvas-cover", pass: Boolean(dataUrl) },
				],
				frames: [{ timeSec: 0.45, status: "settled" }],
				cover: dataUrl && size ? { fileBase64: dataUrl.split(",")[1], mimeType: "image/png", width: size.width, height: size.height } : null,
			},
		});
	} catch (error) {
		// Browser/bridge failures are environmental and remain retryable on the
		// next visit to the component library. 坏数据（bundle 不符合契约/渲染不了）本轮
		// 会话内放弃，避免每次挂载都反复起 harness/请求（与主循环解耦）。
		console.warn("[recut] component verification deferred", versionId, error);
		markGiveUp(versionId);
	} finally {
		running.delete(versionId);
	}
}

/** 组件素材库挂载时调用：只为当前可见列表中缺封面的版本执行一次 UI 验证。 */
export async function ensureVisibleComponentCovers(): Promise<void> {
	// 测试 seam（demo/Playwright）无宿主桥：封面验证依赖 component.resolve/verify 背景通道，直接跳过。
	if (getTestSeam()) return;
	try {
		const listed = await recut.background.call("asset.list", {});
		const versions = (listed?.assets ?? [])
			.filter((asset: { type?: string; status?: string; refVersionId?: string | null; coverUrl?: string | null }) =>
				asset.type === "component" && asset.status === "active" && asset.refVersionId && !asset.coverUrl,
			)
			.map((asset: { refVersionId?: string | null }) => asset.refVersionId)
			.filter((versionId): versionId is string => Boolean(versionId));
		await Promise.allSettled(versions.map((versionId) => verifyComponentVersion(versionId)));
	} catch (error) {
		console.warn("[recut] visible component cover verification failed", error);
	}
}
