/**
 * [INPUT]: 依赖 EditorCore、时间线类型、素材面板 Store 与渲染节点查询能力。
 * [OUTPUT]: 对测试页面注入 window.__recutTest，暴露受控的编辑器、预览状态、材质 uniform、画布采样与素材面板断言入口（含 addComponentElement / addTextElement / deleteElement 元素插入删除），以及导出链路探针（getTracks / moveElementToTrack / renderExportProbe / runRealExport / runSceneExporterDirect）。
 * [POS]: test 模块的浏览器桥接层，被 Playwright E2E 用于验证交互到渲染的完整链路。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as THREE from "three";
import { EditorCore } from "@/core";
import {
	InsertElementCommand,
	MoveElementCommand,
} from "@/commands/timeline";
import {
	useAssetsPanelStore,
	type Tab,
} from "@/components/editor/panels/assets/assets-panel-store";
import { buildTransformFromParams } from "@/rendering";
import { isHtmlInCanvasSupported } from "@/three/dom-text-surface";
import {
	getRenderedNodeBounds,
	getRenderedNodeObject,
} from "@/runtime/node-registry";
import type { TimelineElement } from "@/timeline";
import { buildComponentElement, buildTextElement } from "@/timeline/element-utils";
import type { ParamValue } from "@/params";
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";

/**
 * Chromium 自测桥（?test=1 注入）：供 Playwright 断言"交互→数据→渲染→选择框"链路。
 */
export function installRecutTestBridge(): void {
	const editor = EditorCore.getInstance();

	function findElement(elementId: string): TimelineElement | null {
		const tracks = editor.timeline.getPreviewTracks();
		if (!tracks) return null;
		const tracksList = [
			tracks.main,
			...tracks.overlay,
			...tracks.audio,
		];
		for (const track of tracksList) {
			for (const el of track.elements) {
				if (el.id === elementId) return el;
			}
		}
		return null;
	}

	const canvas = () => {
		const el = document.querySelector<HTMLCanvasElement>("canvas[data-recut-canvas]");
		return el;
	};

	// 同步测试钩子：统计 project.loadProject 被外部 reload 的次数。
	let recutReloadCount = 0;
	{
		const proj = editor.project as unknown as {
			loadProject: (args: { id: string }) => Promise<void>;
		};
		if (proj && typeof proj.loadProject === "function") {
			const original = proj.loadProject.bind(editor.project);
			proj.loadProject = async (args: { id: string }) => {
				recutReloadCount += 1;
				return original(args);
			};
		}
	}

	(window as any).__recutTest = {
		getResolvedTransform(elementId: string) {
			const el = findElement(elementId);
			if (!el) return null;
			return buildTransformFromParams({ params: el.params });
		},
		getNodeBounds(elementId: string) {
			const el = findElement(elementId);
			if (!el) return null;
			const size = editor.project.getActive()?.settings.canvasSize;
			if (!size) return null;
			return getRenderedNodeBounds({
				elementId,
				canvasWidth: size.width,
				canvasHeight: size.height,
				transform: buildTransformFromParams({ params: el.params }),
			});
		},
		getObject3DBox(elementId: string) {
			const obj = getRenderedNodeObject(elementId);
			if (!obj) return null;
			obj.updateWorldMatrix(true, true);
			const box = new THREE.Box3().setFromObject(obj);
			return {
				minX: box.min.x,
				minY: box.min.y,
				maxX: box.max.x,
				maxY: box.max.y,
			};
		},
		getSelection() {
			return editor.selection.getSelectedElements();
		},
		getElementIds() {
			const tracks = editor.timeline.getPreviewTracks();
			if (!tracks) return [];
			return [tracks.main, ...tracks.overlay, ...tracks.audio].flatMap(
				(track) => track.elements.map((el) => el.id),
			);
		},
		setElementParam(elementId: string, key: string, value: number) {
			const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
			if (!tracks) return false;
			const tracksList = [
				tracks.main,
				...tracks.overlay,
				...tracks.audio,
			];
			for (const track of tracksList) {
				const el = track.elements.find((e) => e.id === elementId);
				if (el && "params" in el) {
					editor.timeline.updateElements({
						updates: [
							{
								trackId: track.id,
								elementId,
								patch: {
									params: { ...el.params, [key]: value },
								},
							},
						],
					});
					return true;
				}
			}
			return false;
		},
		setKeyframe(
			elementId: string,
			propertyPath: string,
			localSeconds: number,
			value: ParamValue,
		) {
			const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
			if (!tracks) return false;
			const tracksList = [
				tracks.main,
				...tracks.overlay,
				...tracks.audio,
			];
			for (const track of tracksList) {
				if (track.elements.some((el) => el.id === elementId)) {
					const trackId = track.id;
					editor.timeline.upsertKeyframes({
						keyframes: [
							{
								trackId,
								elementId,
								propertyPath,
								time: mediaTimeFromSeconds({ seconds: localSeconds }),
								value,
							},
						],
					});
					return true;
				}
			}
			return false;
		},
		getAnimations(elementId: string) {
			return findElement(elementId)?.animations ?? null;
		},
		getMotion(elementId: string) {
			const element = findElement(elementId);
			return element ? { motion: element.motion ?? null, textMotion: element.textMotion ?? null } : null;
		},
		getShaderUniforms(elementId: string) {
			const object = getRenderedNodeObject(elementId);
			if (!object) return null;
			const values: Record<string, number | string | boolean> = {};
			object.traverse((node) => {
				const material = (node as THREE.Mesh).material;
				const materials = Array.isArray(material) ? material : material ? [material] : [];
				for (const item of materials) {
					const uniforms = (item as THREE.ShaderMaterial).uniforms;
					const debugUniforms = (item as THREE.Material).userData?.recutMotionUniforms as Record<string, THREE.IUniform> | undefined;
					const source = { ...(uniforms ?? {}), ...(debugUniforms ?? {}) };
					for (const [name, uniform] of Object.entries(source)) {
						const value = uniform?.value;
						if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") values[name] = value;
					}
				}
			});
			return values;
		},
		getMaterialDebug(elementId: string) {
			const object = getRenderedNodeObject(elementId);
			if (!object) return null;
			let result: { hasMotionShader: boolean; fragmentLength: number; outputSnippet: string; includes: string[]; materialVersion?: number; compileHook?: string } | null = null;
			object.traverse((node) => {
				const material = (node as THREE.Mesh).material as THREE.Material | undefined;
				const shader = material?.userData?.recutMotionShader as { fragmentShader?: string } | undefined;
				const installed = material?.userData?.recutMotionUniforms;
				if (!result && installed) result = { hasMotionShader: true, fragmentLength: 0, outputSnippet: "", includes: [], materialVersion: material?.version };
				if (shader) {
					const source = shader.fragmentShader ?? "";
					result = { hasMotionShader: true, fragmentLength: source.length, outputSnippet: "", includes: source.match(/#include <[^>]+>/g)?.slice(-12) ?? [] };
				}
			});
			return result;
		},
		/** 读取当前 WebGL 画布的降采样 RGB，用于逐帧验证 shader 确实改变了画面。 */
		async getCanvasSample(gridWidth = 64, gridHeight = 36) {
			const source = canvas();
			if (!source) return null;
			const image = new Image();
			image.src = source.toDataURL("image/png");
			await image.decode();
			const snapshot = document.createElement("canvas");
			snapshot.width = source.width;
			snapshot.height = source.height;
			const context = snapshot.getContext("2d", { willReadFrequently: true });
			if (!context) return null;
			context.drawImage(image, 0, 0);
			const pixels = context.getImageData(0, 0, snapshot.width, snapshot.height).data;
			const sample: number[] = [];
			for (let gy = 0; gy < gridHeight; gy += 1) {
				for (let gx = 0; gx < gridWidth; gx += 1) {
					const x = Math.min(snapshot.width - 1, Math.floor(((gx + 0.5) * snapshot.width) / gridWidth));
					const y = Math.min(snapshot.height - 1, Math.floor(((gy + 0.5) * snapshot.height) / gridHeight));
					const offset = (y * snapshot.width + x) * 4;
					sample.push(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
				}
			}
			return { width: gridWidth, height: gridHeight, data: sample };
		},
		/** 测试钩子：切换项目背景色（与设置面板背景 tab 同源的 updateSettings 路径）。 */
		async setProjectBackground(color: string) {
			await editor.project.updateSettings({
				settings: { background: { type: "color", color } },
				pushHistory: false,
			});
			return true;
		},
		/** 测试钩子：采样画布矩形区域（canvas 像素坐标）的平均 RGB，用于混合模式等像素级断言。 */
		async getCanvasRegionMean(
			x: number,
			y: number,
			width: number,
			height: number,
			samples = 256,
		) {
			const source = canvas();
			if (!source) return null;
			const image = new Image();
			image.src = source.toDataURL("image/png");
			await image.decode();
			const snapshot = document.createElement("canvas");
			snapshot.width = source.width;
			snapshot.height = source.height;
			const context = snapshot.getContext("2d", { willReadFrequently: true });
			if (!context) return null;
			context.drawImage(image, 0, 0);
			const pixels = context.getImageData(0, 0, snapshot.width, snapshot.height).data;
			const left = Math.max(0, Math.min(snapshot.width - 1, Math.round(x)));
			const top = Math.max(0, Math.min(snapshot.height - 1, Math.round(y)));
			const right = Math.max(left, Math.min(snapshot.width, Math.round(x + width)));
			const bottom = Math.max(top, Math.min(snapshot.height, Math.round(y + height)));
			let r = 0;
			let g = 0;
			let b = 0;
			let count = 0;
			for (let s = 0; s < samples; s += 1) {
				const px = left + Math.floor(((s + 0.5) / samples) * (right - left));
				const py = top + Math.floor((s * 7919) % Math.max(1, bottom - top));
				const offset = (py * snapshot.width + px) * 4;
				r += pixels[offset];
				g += pixels[offset + 1];
				b += pixels[offset + 2];
				count += 1;
			}
			return { r: r / count, g: g / count, b: b / count, count };
		},
		/** 测试钩子：统计画布矩形区域内亮度大于阈值的像素数（canvas 像素坐标）。 */
		async getCanvasRegionBrightCount(
			x: number,
			y: number,
			width: number,
			height: number,
			lumaThreshold = 120,
		) {
			const source = canvas();
			if (!source) return null;
			const image = new Image();
			image.src = source.toDataURL("image/png");
			await image.decode();
			const snapshot = document.createElement("canvas");
			snapshot.width = source.width;
			snapshot.height = source.height;
			const context = snapshot.getContext("2d", { willReadFrequently: true });
			if (!context) return null;
			context.drawImage(image, 0, 0);
			const pixels = context.getImageData(0, 0, snapshot.width, snapshot.height).data;
			const left = Math.max(0, Math.min(snapshot.width - 1, Math.round(x)));
			const top = Math.max(0, Math.min(snapshot.height - 1, Math.round(y)));
			const right = Math.max(left, Math.min(snapshot.width, Math.round(x + width)));
			const bottom = Math.max(top, Math.min(snapshot.height, Math.round(y + height)));
			let count = 0;
			for (let py = top; py < bottom; py += 1) {
				for (let px = left; px < right; px += 2) {
					const offset = (py * snapshot.width + px) * 4;
					const luma =
						pixels[offset] * 0.299 +
						pixels[offset + 1] * 0.587 +
						pixels[offset + 2] * 0.114;
					if (luma > lumaThreshold) count += 1;
				}
			}
			return { count };
		},
		setTime(seconds: number) {
			editor.playback.seek({ time: mediaTimeFromSeconds({ seconds }) });
		},
		/** 测试钩子：渲染隔离帧快照（封面同链路），采样其 PNG 矩形区平均 RGB（canvas 像素坐标）。 */
		async renderFrameMean(
			timeSec: number,
			x: number,
			y: number,
			width: number,
			height: number,
			samples = 256,
		) {
			const dataUrl = await editor.project.renderFrameDataUrl({ time: timeSec });
			if (!dataUrl) return null;
			const image = new Image();
			image.src = dataUrl;
			await image.decode();
			const snapshot = document.createElement("canvas");
			snapshot.width = image.width;
			snapshot.height = image.height;
			const context = snapshot.getContext("2d", { willReadFrequently: true });
			if (!context) return null;
			context.drawImage(image, 0, 0);
			const pixels = context.getImageData(0, 0, snapshot.width, snapshot.height).data;
			const left = Math.max(0, Math.min(snapshot.width - 1, Math.round(x)));
			const top = Math.max(0, Math.min(snapshot.height - 1, Math.round(y)));
			const right = Math.max(left, Math.min(snapshot.width, Math.round(x + width)));
			const bottom = Math.max(top, Math.min(snapshot.height, Math.round(y + height)));
			let r = 0;
			let g = 0;
			let b = 0;
			let count = 0;
			for (let s = 0; s < samples; s += 1) {
				const px = left + Math.floor(((s + 0.5) / samples) * (right - left));
				const py = top + Math.floor((s * 7919) % Math.max(1, bottom - top));
				const offset = (py * snapshot.width + px) * 4;
				r += pixels[offset];
				g += pixels[offset + 1];
				b += pixels[offset + 2];
				count += 1;
			}
			return { r: r / count, g: g / count, b: b / count, count, width: image.width, height: image.height };
		},
		pausePlayback() {
			editor.playback.pause();
		},
		async advanceFrame() {
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			);
		},
		/**
		 * 导出路径探针：复刻 renderer-manager.exportVideo 的 buildWorld + 独立
		 * WorldRenderer 流程，渲染当前时间线在 timeSec 的一帧，返回画布 dataURL。
		 * 用于 e2e 断言「预览可见但导出缺内容」类回归（如 effect.grid）。
		 */
		getTracks() {
			const tracks = editor.scenes
				.getActiveSceneOrNull()
				?.tracks as unknown as {
				main: { id: string; elements: { id: string }[] };
				overlay: { id: string; elements: { id: string }[] }[];
			} | null;
			if (!tracks) return null;
			return [
				{ id: tracks.main.id, elements: tracks.main.elements.map((e) => e.id) },
				...tracks.overlay.map((t) => ({ id: t.id, elements: t.elements.map((e) => e.id) })),
			];
		},
		moveElementToTrack(elementId: string, targetTrackId: string) {
			const tracks = editor.scenes
				.getActiveSceneOrNull()
				?.tracks as unknown as {
				main: { id: string; elements: TimelineElement[] };
				overlay: { id: string; elements: TimelineElement[] }[];
			} | null;
			if (!tracks) return false;
			const all = [tracks.main, ...tracks.overlay];
			for (const track of all) {
				const el = track.elements.find((e) => e.id === elementId);
				if (!el) continue;
				const target = all.find((t) => t.id === targetTrackId);
				if (!target) return false;
				const command = new MoveElementCommand({
					moves: [
						{
							sourceTrackId: track.id,
							targetTrackId,
							elementId,
							newStartTime: el.startTime,
						},
					],
				});
				editor.command.execute({ command });
				return true;
			}
			return false;
		},
		async renderExportProbe(timeSec = 0, options?: { onlyIds?: string[]; frames?: number[] }) {
			const { buildWorld, WorldRenderer, componentsRegistry } = await import("@/runtime");
			const scene = editor.scenes.getActiveSceneOrNull();
			const project = editor.project.getActiveOrNull();
			if (!scene || !project) return null;
			const mediaAssets = editor.media.getAssets();
			const duration = editor.timeline.getTotalDuration();
			const fps = project.settings.fps;
			const world0 = buildWorld({
				scene,
				mediaAssets,
				canvasSize: project.settings.canvasSize,
				fps: fps.numerator / fps.denominator,
				duration: mediaTimeToSeconds({ time: duration }),
				background: project.settings.background,
			});
			const world = options?.onlyComponent
				? {
						...world0,
						objects: world0.objects.filter(
							(o) =>
								(o as { componentId?: string }).componentId === options.onlyComponent ||
								o.id === options.onlyComponent,
						),
					}
				: world0;
			const renderer = new WorldRenderer({
				width: world.width,
				height: world.height,
				fps,
			});
			const target = document.createElement("canvas");
			target.width = world.width;
			target.height = world.height;
			// 与 SceneExporter.export 同构的连续帧循环；frames 缺省 [timeSec×3]。
			const frameTimes =
				options?.frames ??
				[timeSec, timeSec, timeSec];
			const gridPerFrame: number[] = [];
			for (const frameTime of frameTimes) {
				await renderer.renderToCanvas({ world, time: frameTime, targetCanvas: target });
				// 顶部黑边采样：网格线亮度（与导出读帧同源画布）。
				const ctx = target.getContext("2d", { willReadFrequently: true });
				let brightness = -1;
				if (ctx) {
					const region = ctx.getImageData(
						0,
						Math.round(target.height * 0.05),
						target.width,
						Math.round(target.height * 0.15),
					).data;
					let sum = 0;
					for (let i = 0; i < region.length; i += 4 * 37) {
						sum += region[i] + region[i + 1] + region[i + 2];
					}
					brightness = sum / (region.length / (4 * 37)) / 3;
				}
				gridPerFrame.push(Math.round(brightness * 100) / 100);
			}
			const dataUrl = target.toDataURL("image/png");
			renderer.dispose();
			return {
				dataUrl,
				gridPerFrame,
				objects: world.objects.map((o) => ({
					kind: o.kind,
					componentId: (o as { componentId?: string }).componentId ?? null,
					renderOrder: o.renderOrder,
				})),
				gridState: componentsRegistry.getState("effect.grid")?.status ?? "missing",
			};
		},
		/** 直接驱动 SceneExporter（绕过 project.export），用于二分导出链路。 */
		async runSceneExporterDirect() {
			const { SceneExporter } = await import("@/services/renderer/scene-exporter");
			const { buildWorld } = await import("@/runtime");
			const scene = editor.scenes.getActiveSceneOrNull();
			const project = editor.project.getActiveOrNull();
			if (!scene || !project) return { ok: false, error: "no scene" };
			const mediaAssets = editor.media.getAssets();
			const duration = editor.timeline.getTotalDuration();
			const fps = project.settings.fps;
			const world = buildWorld({
				scene,
				mediaAssets,
				canvasSize: project.settings.canvasSize,
				fps: fps.numerator / fps.denominator,
				duration: mediaTimeToSeconds({ time: duration }),
				background: project.settings.background,
			});
			const exporter = new SceneExporter({
				width: world.width,
				height: world.height,
				fps,
				format: "mp4",
				quality: "high",
			});
			const buffer = await new Promise<ArrayBuffer | null>((resolve) => {
				exporter.on("complete", resolve);
				exporter.on("error", (e) => resolve(null));
				void exporter.export({ world });
			});
			if (!buffer) return { ok: false, error: "export failed" };
			const bytes = new Uint8Array(buffer);
			let binary = "";
			for (let i = 0; i < bytes.length; i += 0x8000)
				binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
			return { ok: true, mp4Base64: btoa(binary) };
		},
		/** 真实导出（editor.project.export，与 UI 导出按钮/export.encode 同路径），返回 mp4 base64。 */
		async runRealExport() {
			const probe: number[] = [];
			(probe as any).max = [] as number[];
			(globalThis as any).__recutExportProbe = probe;
			const editorInstance = editor;
			const result = await editorInstance.project.export({
				options: { format: "mp4", quality: "high", includeAudio: false },
			});
			(globalThis as any).__recutExportProbe = null;
			if (!result.success || !result.buffer) {
				return { ok: false, error: result.error ?? "no buffer", probe };
			}
			const bytes = new Uint8Array(result.buffer);
			let binary = "";
			const chunk = 0x8000;
			for (let i = 0; i < bytes.length; i += chunk) {
				binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
			}
			return {
				ok: true,
				mp4Base64: btoa(binary),
				probe,
				max: (probe as any).max as number[],
			};
		},
		/** canvas 像素 → 屏幕坐标（用于 page.mouse）。 */
		canvasToScreen(x: number, y: number) {
			const c = canvas();
			if (!c) return null;
			const rect = c.getBoundingClientRect();
			return {
				x: rect.left + x * (rect.width / c.width),
				y: rect.top + y * (rect.height / c.height),
			};
		},
		getCanvasSize() {
			const c = canvas();
			return c ? { width: c.width, height: c.height } : null;
		},
		getProjectVersion() {
			return editor.project.getActiveOrNull()?.version ?? null;
		},
		getProjectDocument() {
			return editor.project.getActiveOrNull();
		},
		getReloadCount() {
			return recutReloadCount;
		},
		getPlaybackTime() {
			return mediaTimeToSeconds({ time: editor.playback.getCurrentTime() });
		},
		getPreviewState() {
			return {
				active: editor.timeline.isPreviewActive(),
				isPlaying: editor.playback.getIsPlaying(),
				time: mediaTimeToSeconds({ time: editor.playback.getCurrentTime() }),
			};
		},
		getAssetsPanelTab() {
			return useAssetsPanelStore.getState().activeTab;
		},
		setAssetsPanelTab(tab: Tab) {
			useAssetsPanelStore.getState().setActiveTab(tab);
		},
		/** 测试钩子：按素材卡片 onAddToTimeline 同款路径插入组件元素（可传 params 覆盖默认值），返回元素 ID。 */
		addComponentElement(
			componentId: string,
			startTimeSeconds = 0,
			params?: Record<string, number | string | boolean>,
		) {
			const element = buildComponentElement({
				componentId,
				startTime: mediaTimeFromSeconds({ seconds: startTimeSeconds }),
				params,
			});
			const command = new InsertElementCommand({
				element,
				placement: { mode: "auto" },
			});
			editor.command.execute({ command });
			return command.getElementId();
		},
		/** 测试钩子：插入一个可控的大文本元素，便于验证后处理动画的真实画面变化。 */
		addTextElement(
			content = "GLITCH DEBUG",
			startTimeSeconds = 0,
			params?: Record<string, number | string | boolean>,
		) {
			const element = buildTextElement({
				raw: {
					name: "Glitch Debug Text",
					params: {
						content,
						fontSize: 180,
						color: "#ffffff",
						...params,
					},
				},
				startTime: mediaTimeFromSeconds({ seconds: startTimeSeconds }),
			});
			const command = new InsertElementCommand({ element, placement: { mode: "auto" } });
			editor.command.execute({ command });
			return command.getElementId();
		},
		selectElement(elementId: string) {
			const tracks = editor.timeline.getPreviewTracks();
			if (!tracks) return false;
			for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio]) {
				if (track.elements.some((element) => element.id === elementId)) {
					editor.selection.setSelectedElements({ elements: [{ trackId: track.id, elementId }] });
					return true;
				}
			}
			return false;
		},
		/** 测试钩子：删除元素（在 main/overlay/audio 轨道内查找）。 */
		deleteElement(elementId: string) {
			const tracks = editor.timeline.getPreviewTracks();
			if (!tracks) return false;
			for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio]) {
				if (track.elements.some((el) => el.id === elementId)) {
					editor.timeline.deleteElements({
						elements: [{ trackId: track.id, elementId }],
					});
					return true;
				}
			}
			return false;
		},
		/** 测试钩子：读取元素的起止（ticks，用于接缝断言）。 */
		getElementTimes(elementId: string) {
			const tracks = editor.timeline.getPreviewTracks();
			if (!tracks) return null;
			for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio]) {
				const el = track.elements.find((e) => e.id === elementId);
				if (el) {
					return {
						trackId: track.id,
						startTime: el.startTime,
						duration: el.duration,
					};
				}
			}
			return null;
		},
		/** 测试钩子：在指定秒数处分割元素，返回右半部分元素 id。 */
		splitElementAt(elementId: string, seconds: number) {
			const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
			if (!tracks) return null;
			for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio]) {
				if (track.elements.some((el) => el.id === elementId)) {
					const rights = editor.timeline.splitElements({
						elements: [{ trackId: track.id, elementId }],
						splitTime: mediaTimeFromSeconds({ seconds }),
					});
					return rights[0]?.elementId ?? null;
				}
			}
			return null;
		},
		/** 测试钩子：克隆一个媒体素材为新 id（同文件，不同解码器实例）。 */
		cloneMediaAsset(srcId: string, newId: string) {
			const assets = editor.media.getAssets();
			const src = assets.find((a) => a.id === srcId);
			if (!src) return false;
			editor.media.setAssets({ assets: [...assets, { ...src, id: newId, name: `${src.name} copy` }] });
			return true;
		},
		/** 测试钩子：更换元素的媒体素材。 */
		setElementMediaId(elementId: string, mediaId: string) {
			const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
			if (!tracks) return false;
			for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio]) {
				if (track.elements.some((el) => el.id === elementId)) {
					editor.timeline.updateElements({
						updates: [{ trackId: track.id, elementId, patch: { mediaId } as Partial<TimelineElement> }],
					});
					return true;
				}
			}
			return false;
		},
		nudgeElement(elementId: string, deltaTicks: number) {
			const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
			if (!tracks) return false;
			for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio]) {
				const el = track.elements.find((e) => e.id === elementId);
				if (!el) continue;
				const command = new MoveElementCommand({
					moves: [
						{
							sourceTrackId: track.id,
							targetTrackId: track.id,
							elementId,
							newStartTime: (el.startTime + deltaTicks) as typeof el.startTime,
						},
					],
				});
				editor.command.execute({ command });
				return true;
			}
			return false;
		},
		/** 测试钩子：给素材换一个新的 blob URL（同文件字节，新的解码器身份）。 */
		reurlMediaAsset(assetId: string) {
			const assets = editor.media.getAssets();
			const asset = assets.find((a) => (a as { id: string }).id === assetId) as
				| { file?: unknown }
				| undefined;
			const file = asset?.file;
			if (!(file instanceof File)) return null;
			const url = URL.createObjectURL(file);
			editor.media.setAssets({
				assets: assets.map((a) =>
					(a as { id: string }).id === assetId ? { ...a, url } : a,
				),
			});
			return url;
		},
		/** 测试钩子：列出隐藏 video 元素的 src/currentTime/readyState。 */
		getVideoElements() {
			return [...document.querySelectorAll("video")].map((v) => ({
				src: v.currentSrc || v.src,
				currentTime: v.currentTime,
				readyState: v.readyState,
			}));
		},
		/** 测试钩子：标记当前唯一的隐藏 video 节点，返回其 src。 */
		markVideoNode() {
			const videos = [...document.querySelectorAll("video")];
			if (videos.length !== 1) return null;
			videos[0].dataset.recutProbe = "junction";
			return videos[0].currentSrc || videos[0].src;
		},
		/** 测试钩子：之前标记的 video 节点是否仍在 DOM 中。 */
		hasMarkedVideoNode() {
			return document.querySelector('video[data-recut-probe="junction"]') != null;
		},
		/** 清空演示媒体素材（让素材库进入真实空态，验证 AI 组件素材的即时同步）。 */
		clearMediaAssets() {
			editor.media.setAssets({ assets: [] });
			return true;
		},
		htmlInCanvasSupported() {
			return isHtmlInCanvasSupported();
		},
		/** 测试钩子：按字体系统加载一个 family（等价于面板选中字体后的 loadFullFont）。 */
		async loadFont(family: string) {
			const { loadFullFont } = await import("@/fonts/google-fonts");
			await loadFullFont({ family });
			return true;
		},
		/** 测试钩子：列出已注册且加载完成的字体家族名。 */
		loadedFontFamilies() {
			return [...document.fonts]
				.filter((face) => face.status === "loaded")
				.map((face) => face.family.replace(/^"|"$/g, ""))
				.filter((family) => family.trim().length > 0);
		},
	};
}
