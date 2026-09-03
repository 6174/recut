import type { TProject } from "@/project/types";
import type { MediaAsset } from "@/media/types";
import type { TimelineElement } from "@/timeline";
import { mediaTime } from "@/wasm";

const SECONDS_5 = 600000; // 5s @ 120000 ticks/s
const SECONDS_8 = 960000;

function baseParams(): Record<string, number | string | boolean> {
	return {
		"transform.positionX": 0,
		"transform.positionY": 0,
		"transform.scaleX": 1,
		"transform.scaleY": 1,
		"transform.rotate": 0,
		opacity: 1,
		blendMode: "normal",
	};
}

export function buildDemoProject(assets: MediaAsset[]): TProject {
	const now = new Date();
	const mainTrackId = "demo-main-track";
	const sceneId = "demo-scene";

	const imageElement: TimelineElement = {
		id: "demo-el-image",
		name: "Demo Image",
		type: "image",
		mediaId: "demo-image-1",
		startTime: mediaTime({ ticks: 0 }),
		duration: mediaTime({ ticks: SECONDS_8 }),
		trimStart: mediaTime({ ticks: 0 }),
		trimEnd: mediaTime({ ticks: SECONDS_8 }),
		params: {
			...baseParams(),
			// 缩小并移左上，留出空白区域（供命中/取消选择测试）。
			"transform.scaleX": 0.45,
			"transform.scaleY": 0.45,
			"transform.positionX": -500,
			"transform.positionY": -300,
		},
	};

	const videoElement: TimelineElement = {
		id: "demo-el-video",
		name: "Demo Video",
		type: "video",
		mediaId: "demo-video-1",
		startTime: mediaTime({ ticks: 0 }),
		duration: mediaTime({ ticks: SECONDS_5 }),
		trimStart: mediaTime({ ticks: 0 }),
		trimEnd: mediaTime({ ticks: SECONDS_5 }),
		params: {
			...baseParams(),
			"transform.scaleX": 0.5,
			"transform.scaleY": 0.5,
			"transform.positionX": 600,
			"transform.positionY": -300,
		},
	};

	const textElement: TimelineElement = {
		id: "demo-el-text",
		name: "Demo Text",
		type: "text",
		startTime: mediaTime({ ticks: 0 }),
		duration: mediaTime({ ticks: SECONDS_8 }),
		trimStart: mediaTime({ ticks: 0 }),
		trimEnd: mediaTime({ ticks: SECONDS_8 }),
		params: {
			...baseParams(),
			content: "Recut Demo",
			fontSize: 15,
			fontFamily: "Arial, sans-serif",
			color: "#FFFFFF",
			textAlign: "center",
			"transform.positionY": -250,
			"background.enabled": true,
			"background.color": "#00000099",
			"background.cornerRadius": 24,
			"background.paddingX": 32,
			"background.paddingY": 24,
		},
	};

	// 3D 组件：验证选择框 = 渲染几何 bbox（D5/D6）。
	const glowBoxElement: TimelineElement = {
		id: "demo-el-glow",
		name: "Demo Glow Box",
		type: "component",
		componentId: "glow-box",
		startTime: mediaTime({ ticks: 0 }),
		duration: mediaTime({ ticks: SECONDS_8 }),
		trimStart: mediaTime({ ticks: 0 }),
		trimEnd: mediaTime({ ticks: SECONDS_8 }),
		params: {
			...baseParams(),
			size: 240,
			color: "#ff6b6b",
			rotationSpeed: 0,
			intensity: 1.6,
			"transform.positionX": 480,
			"transform.positionY": 260,
		},
	};

	// 3D Shape（box）：验证左右/上下拖动跟手。
	const shapeElement: TimelineElement = {
		id: "demo-el-shape",
		name: "Demo Shape",
		type: "component",
		componentId: "shape",
		startTime: mediaTime({ ticks: 0 }),
		duration: mediaTime({ ticks: SECONDS_8 }),
		trimStart: mediaTime({ ticks: 0 }),
		trimEnd: mediaTime({ ticks: SECONDS_8 }),
		params: {
			...baseParams(),
			shape: "box",
			color: "#4ecdc4",
			size: 200,
			"transform.positionX": -480,
			"transform.positionY": 260,
		},
	};

	// Spline Scene：验证左右拖动跟手（用户报告左右跳变）。
	const splineElement: TimelineElement = {
		id: "demo-el-spline",
		name: "Demo Spline",
		type: "component",
		componentId: "spline-scene",
		startTime: mediaTime({ ticks: 0 }),
		duration: mediaTime({ ticks: SECONDS_8 }),
		trimStart: mediaTime({ ticks: 0 }),
		trimEnd: mediaTime({ ticks: SECONDS_8 }),
		params: {
			...baseParams(),
			scale: 110,
			speed: 0,
			"transform.positionX": 0,
			"transform.positionY": 0,
		},
	};

	const project: TProject = {
		metadata: {
			id: "demo-project",
			name: "Demo Project",
			thumbnail: null,
			duration: mediaTime({ ticks: SECONDS_8 }),
			createdAt: now,
			updatedAt: now,
		},
		scenes: [
			{
				id: sceneId,
				name: "Main scene",
				isMain: true,
				tracks: {
					overlay: [
						{
							id: "demo-video-track",
							name: "Overlay",
							type: "video",
							elements: [videoElement],
							muted: false,
							hidden: false,
						},
						{
							id: "demo-text-track",
							name: "Text",
							type: "text",
							elements: [textElement],
							hidden: false,
						},
						{
							id: "demo-graphic-track",
							name: "Graphic",
							type: "graphic",
							elements: [glowBoxElement, shapeElement],
							hidden: false,
						},
					],
					main: {
						id: mainTrackId,
						name: "Main",
						type: "video",
						elements: [imageElement],
						muted: false,
						hidden: false,
					},
					audio: [],
				},
				bookmarks: [],
				createdAt: now,
				updatedAt: now,
			},
		],
		currentSceneId: sceneId,
		settings: {
			fps: { numerator: 30, denominator: 1 },
			canvasSize: { width: 1920, height: 1080 },
			background: { type: "color", color: "#141414" },
		},
		version: 1,
	};

	return project;
}
