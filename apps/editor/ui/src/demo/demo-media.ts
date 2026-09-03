import type { MediaAsset } from "@/media/types";

function canvasToFile(canvas: HTMLCanvasElement, name: string, mimeType: string): Promise<File> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (!blob) {
					reject(new Error(`toBlob failed for ${name}`));
					return;
				}
				resolve(new File([blob], name, { type: mimeType }));
			},
			mimeType,
			0.92,
		);
	});
}

/** 生成一张离线可用的 demo 图片（渐变 + 标签）。 */
export async function generateDemoImage(): Promise<MediaAsset> {
	const canvas = document.createElement("canvas");
	canvas.width = 1280;
	canvas.height = 720;
	const ctx = canvas.getContext("2d")!;
	const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
	gradient.addColorStop(0, "#ff6b6b");
	gradient.addColorStop(0.5, "#4ecdc4");
	gradient.addColorStop(1, "#45b7d1");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = "rgba(0,0,0,0.55)";
	ctx.fillRect(0, canvas.height - 90, canvas.width, 90);
	ctx.fillStyle = "#fff";
	ctx.font = "600 44px system-ui, sans-serif";
	ctx.fillText("Recut Demo Image", 32, canvas.height - 32);

	const file = await canvasToFile(canvas, "demo-image.jpg", "image/jpeg");
	const url = URL.createObjectURL(file);
	return {
		id: "demo-image-1",
		type: "image",
		name: "Demo Image",
		file,
		url,
		width: canvas.width,
		height: canvas.height,
	};
}

/** 生成一段离线可用的 demo 视频（canvas 录制，2s，移动色块）。 */
export async function generateDemoVideo(): Promise<MediaAsset> {
	const width = 640;
	const height = 360;
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d")!;
	const stream = canvas.captureStream(30);
	const recorder = new MediaRecorder(stream, { mimeType: "video/webm", videoBitsPerSecond: 4_000_000 });
	const chunks: Blob[] = [];
	recorder.ondataavailable = (e) => {
		if (e.data.size > 0) chunks.push(e.data);
	};
	const done = new Promise<void>((resolve) => {
		recorder.onstop = () => resolve();
	});

	const durationFrames = 60;
	recorder.start(100);
	const start = performance.now();
	for (let f = 0; f < durationFrames; f++) {
		const t = f / durationFrames;
		ctx.fillStyle = "#0b0b1e";
		ctx.fillRect(0, 0, width, height);
		ctx.fillStyle = `hsl(${t * 360}, 80%, 55%)`;
		const x = width * 0.5 + Math.cos(t * Math.PI * 2) * (width * 0.3);
		const y = height * 0.5 + Math.sin(t * Math.PI * 2) * (height * 0.3);
		ctx.beginPath();
		ctx.arc(x, y, 46, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = "#fff";
		ctx.font = "600 30px system-ui, sans-serif";
		ctx.fillText("Recut Demo Video", 18, 34);
		await new Promise((r) => requestAnimationFrame(r));
	}
	await new Promise((r) => setTimeout(r, 120));
	recorder.stop();
	await done;

	const blob = new Blob(chunks, { type: "video/webm" });
	const file = new File([blob], "demo-video.webm", { type: "video/webm" });
	const url = URL.createObjectURL(file);
	return {
		id: "demo-video-1",
		type: "video",
		name: "Demo Video",
		file,
		url,
		width,
		height,
	};
}
