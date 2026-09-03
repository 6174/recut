import { test, expect } from "@playwright/test";
import { openDemo, settle, testGet } from "./helpers";

/**
 * 接缝复现：把 demo 视频（0~5s，源 2s）在 1.0s 处分割，
 * 逐帧扫过接缝，视频区域每一帧都应有内容（无空白帧）。
 */
test("视频分割接缝：逐帧播放无空白帧", async ({ page }) => {
	await openDemo(page);

	const before = await testGet(page, "getElementTimes", "demo-el-video");
	expect(before).not.toBeNull();

	const rightId = await testGet(page, "splitElementAt", "demo-el-video", 1.0);
	expect(rightId).not.toBeNull();

	const left = await testGet(page, "getElementTimes", "demo-el-video");
	const right = await testGet(page, "getElementTimes", rightId);
	console.log("left:", JSON.stringify(left), "right:", JSON.stringify(right));
	// 数据层必须严丝合缝
	expect(left.startTime + left.duration).toBe(right.startTime);

	// 白盒：左半播到一半时标记 video 节点，过接缝后必须是同一个（池化复用，
	// 否则新 video 从 0 冷 seek，高清素材必闪黑）
	await testGet(page, "setTime", 0.5);
	await settle(page);
	expect(await testGet(page, "markVideoNode")).not.toBeNull();
	await testGet(page, "setTime", 1.1);
	await settle(page);
	expect(await testGet(page, "hasMarkedVideoNode")).toBe(true);

	// 全画布亮像素数在接缝前后应保持稳定；空白帧会断崖下跌。不猜坐标。
	const counts: { t: number; count: number }[] = [];
	// 逐帧扫过接缝（30fps → 步长 1/30s）
	for (let f = 26; f <= 34; f += 1) {
		const t = f / 30;
		await testGet(page, "setTime", t);
		await settle(page);
		await settle(page);
		const sample = await testGet(page, "getCanvasSample", 96, 54);
		let count = 0;
		for (let i = 0; i < sample.data.length; i += 3) {
			const luma =
				sample.data[i] * 0.299 +
				sample.data[i + 1] * 0.587 +
				sample.data[i + 2] * 0.114;
			if (luma > 120) count += 1;
		}
		counts.push({ t: Math.round(t * 1000) / 1000, count });
	}
	console.log("bright counts:", JSON.stringify(counts));

	// 接缝帧（t=1.0）与邻帧的亮像素数差异应在 30% 以内
	const junction = counts.find((c) => c.t === 1)!;
	const neighbors = counts.filter((c) => c.t !== 1);
	const maxNeighbor = Math.max(...neighbors.map((c) => c.count));
	const minNeighbor = Math.min(...neighbors.map((c) => c.count));
	console.log("junction:", junction.count, "neighbor range:", minNeighbor, maxNeighbor);
	expect(junction.count).toBeGreaterThan(minNeighbor * 0.7);
});

/**
 * 真实 gap 复现：A[0,1) + 空 gap[1,1.5) + B[1.5,2.5)，同素材。
 * 期望：gap 内各帧稳定一致（背景），B 首帧是 B 的内容（不是 A 的旧帧残留，也不是黑帧）。
 */
test("真实 gap：gap 内稳定，B 首帧无旧帧残留", async ({ page }) => {
	await openDemo(page);

	const rightId = await testGet(page, "splitElementAt", "demo-el-video", 1.0);
	expect(rightId).not.toBeNull();
	// 右半右移 0.5s，造出真实 gap
	expect(await testGet(page, "nudgeElement", rightId, 60000)).toBe(true);
	const tA = await testGet(page, "getElementTimes", "demo-el-video");
	const tB = await testGet(page, "getElementTimes", rightId);
	console.log("A:", JSON.stringify(tA), "B:", JSON.stringify(tB));
	expect(tB.startTime - (tA.startTime + tA.duration)).toBe(60000);

	async function sample(t: number): Promise<number[]> {
		await testGet(page, "setTime", t);
		await testGet(page, "advanceFrame");
		const s = await testGet(page, "getCanvasSample", 96, 54);
		return s.data;
	}
	const dist = (a: number[], b: number[]) => {
		let d = 0;
		for (let i = 0; i < a.length; i += 1) d += Math.abs(a[i] - b[i]);
		return d / (a.length / 3);
	};

	const fA = await sample(0.9); // A 末尾
	const g1 = await sample(1.1); // gap 内
	const g2 = await sample(1.3); // gap 内
	const fB = await sample(1.5); // B 首帧（只给 2 rAF 预算）
	const fB2 = await sample(1.567); // B 第二帧
	console.log(
		"gap stable:",
		dist(g1, g2),
		"A-vs-gap:",
		dist(fA, g1),
		"B1-vs-gap:",
		dist(fB, g1),
		"B1-vs-A:",
		dist(fB, fA),
		"B2-vs-gap:",
		dist(fB2, g1),
	);

	// gap 内两帧应远比“内容 vs gap”更相似（其他动画层本身随时间走，允许小漂移）
	expect(dist(g1, g2)).toBeLessThan(dist(fA, g1) * 0.5);
	// A 与 gap 差异显著（视频区有内容 vs 背景）
	expect(dist(fA, g1)).toBeGreaterThan(3);
	// B 首帧必须有视频内容：与 gap 差异显著…
	expect(dist(fB, g1)).toBeGreaterThan(3);
	// …且不能是 A 末帧的残留（位置不同源时间不同，球位置不同）
	expect(dist(fB, fA)).toBeGreaterThan(1.5);
});

/**
 * 不同源紧贴：右半换到新 blob URL（同字节、冷解码器），模拟拖在一起的两段不同素材。
 * 播到 A 末尾时，即将上场的 B 应已被预热（独立解码器就位并 seek 到 B 入点），
 * 而不是等 B 挂载后才冷启动——否则高清素材首帧必闪背景。
 */
test("不同源紧贴：B 在上场前完成预热", async ({ page }) => {
	await openDemo(page);

	const rightId = await testGet(page, "splitElementAt", "demo-el-video", 1.0);
	expect(rightId).not.toBeNull();
	expect(await testGet(page, "cloneMediaAsset", "demo-video-1", "demo-video-2")).toBe(true);
	expect(await testGet(page, "setElementMediaId", rightId, "demo-video-2")).toBe(true);
	const urlB = await testGet(page, "reurlMediaAsset", "demo-video-2");
	expect(urlB).not.toBeNull();

	// 播到 A 末尾（B 尚未上场），给预热留时间
	await testGet(page, "setTime", 0.9);
	await settle(page);
	await settle(page);

	const videos = await testGet(page, "getVideoElements");
	console.log("videos near junction:", JSON.stringify(videos));
	// A 的解码器 + 预热中的 B 解码器（不同 src）
	const forB = videos.filter((v) => v.src === urlB);
	expect(forB.length).toBe(1);
	// B 的解码器已开始往入点（源 1.0s）seek：currentTime 已离开 0，
	// readyState 至少 HAVE_METADATA（demo webm 关键帧稀疏，落点不必精确）
	expect(forB[0].currentTime).toBeGreaterThan(0.1);
	expect(forB[0].readyState).toBeGreaterThanOrEqual(1);
});
test("双视频相接：接缝首帧不应空白", async ({ page }) => {
	await openDemo(page);
	page.on("console", (msg) => {
		if (msg.type() === "error") console.log("PAGE ERROR:", msg.text());
	});

	// 起始画面确认视频 A 正常渲染
	await testGet(page, "setTime", 0.5);
	await settle(page);
	const base = await testGet(page, "getCanvasSample", 96, 54);

	expect(await testGet(page, "cloneMediaAsset", "demo-video-1", "demo-video-2")).toBe(true);
	// 分割 demo 视频，右半换成克隆素材（同文件、不同 assetId → 不同解码器实例，
	// 接缝处 B 是冷启动，模拟拖动拼在一起的两段不同素材）
	const rightId = await testGet(page, "splitElementAt", "demo-el-video", 1.0);
	expect(rightId).not.toBeNull();
	expect(await testGet(page, "setElementMediaId", rightId, "demo-video-2")).toBe(true);
	const tA = await testGet(page, "getElementTimes", "demo-el-video");
	const tB = await testGet(page, "getElementTimes", rightId);
	console.log("A:", JSON.stringify(tA), "B:", JSON.stringify(tB));
	expect(tA.startTime + tA.duration).toBe(tB.startTime);

	// 先播到 A 末尾（解码器 A 热着，B 还是冷的），再逐帧 Inquiry 跨过接缝，
	// 每帧只等 2 rAF（≈ 32ms，贴近 30fps 实时预算）
	await testGet(page, "setTime", 0.9);
	await settle(page);
	const counts: { t: number; count: number }[] = [];
	for (const f of [28, 29, 30, 31, 32]) {
		const t = f / 30;
		await testGet(page, "setTime", t);
		await testGet(page, "advanceFrame");
		const sample = await testGet(page, "getCanvasSample", 96, 54);
		let count = 0;
		for (let i = 0; i < sample.data.length; i += 3) {
			const luma =
				sample.data[i] * 0.299 +
				sample.data[i + 1] * 0.587 +
				sample.data[i + 2] * 0.114;
			if (luma > 120) count += 1;
		}
		counts.push({ t: Math.round(t * 1000) / 1000, count });
	}
	console.log("bright counts:", JSON.stringify(counts));

	const junction = counts.find((c) => c.t === 1)!;
	const neighbors = counts.filter((c) => c.t !== 1);
	const minNeighbor = Math.min(...neighbors.map((c) => c.count));
	console.log("junction:", junction.count, "min neighbor:", minNeighbor);
	expect(junction.count).toBeGreaterThan(minNeighbor * 0.7);
});
