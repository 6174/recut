import EventEmitter from "eventemitter3";

import {
	Output,
	Mp4OutputFormat,
	WebMOutputFormat,
	BufferTarget,
	CanvasSource,
	AudioBufferSource,
	QUALITY_LOW,
	QUALITY_MEDIUM,
	QUALITY_HIGH,
	QUALITY_VERY_HIGH,
} from "mediabunny";
import type { FrameRate } from "opencut-wasm";
import { mediaTimeToSeconds } from "opencut-wasm";
import { TICKS_PER_SECOND, type MediaTime } from "@/wasm";
import { frameRateToFloat } from "@/fps/utils";
import type { World } from "@/runtime/types";
import type { ExportFormat, ExportQuality } from "@/export";
import { WorldRenderer } from "@/runtime";

type ExportParams = {
	width: number;
	height: number;
	fps: FrameRate;
	format: ExportFormat;
	quality: ExportQuality;
	shouldIncludeAudio?: boolean;
	audioBuffer?: AudioBuffer;
};

const qualityMap = {
	low: QUALITY_LOW,
	medium: QUALITY_MEDIUM,
	high: QUALITY_HIGH,
	very_high: QUALITY_VERY_HIGH,
};

export type SceneExporterEvents = {
	/** progress: 0..1；frameTimeMs：最近一帧渲染耗时（毫秒），用于导出性能观测。 */
	progress: [progress: number, frameTimeMs?: number];
	complete: [buffer: ArrayBuffer];
	error: [error: Error];
	cancelled: [];
};

export class SceneExporter extends EventEmitter<SceneExporterEvents> {
	private renderer: WorldRenderer;
	private format: ExportFormat;
	private quality: ExportQuality;
	private shouldIncludeAudio: boolean;
	private audioBuffer?: AudioBuffer;

	private isCancelled = false;

	constructor({
		width,
		height,
		fps,
		format,
		quality,
		shouldIncludeAudio,
		audioBuffer,
	}: ExportParams) {
		super();
		this.renderer = new WorldRenderer({
			width,
			height,
			fps,
		});

		this.format = format;
		this.quality = quality;
		this.shouldIncludeAudio = shouldIncludeAudio ?? false;
		this.audioBuffer = audioBuffer;
	}

	cancel(): void {
		this.isCancelled = true;
	}

	async export({ world }: { world: World }): Promise<ArrayBuffer | null> {
		const fps = this.renderer.fps;
		const fpsFloat = frameRateToFloat(fps);
		const ticksPerFrame = Math.round(
			(TICKS_PER_SECOND * fps.denominator) / fps.numerator,
		);
		// world.duration 是秒；按 fps 换算总帧数。
		const frameCount = Math.floor(world.duration * fpsFloat);

		const outputFormat =
			this.format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat();

		const output = new Output({
			format: outputFormat,
			target: new BufferTarget(),
		});

		const videoSource = new CanvasSource(this.renderer.getOutputCanvas(), {
			codec: this.format === "webm" ? "vp9" : "avc",
			bitrate: qualityMap[this.quality],
		});

		output.addVideoTrack(videoSource, { frameRate: fpsFloat });

		let audioSource: AudioBufferSource | null = null;
		if (this.shouldIncludeAudio && this.audioBuffer) {
			let audioCodec: "aac" | "opus" = this.format === "webm" ? "opus" : "aac";

			if (audioCodec === "aac" && typeof AudioEncoder !== "undefined") {
				const { supported } = await AudioEncoder.isConfigSupported({
					codec: "mp4a.40.2",
					sampleRate: this.audioBuffer.sampleRate,
					numberOfChannels: this.audioBuffer.numberOfChannels,
					bitrate: 192000,
				});
				if (!supported) audioCodec = "opus";
			}

			audioSource = new AudioBufferSource({
				codec: audioCodec,
				bitrate: qualityMap[this.quality],
			});
			output.addAudioTrack(audioSource);
		}

		await output.start();

		if (audioSource && this.audioBuffer) {
			await audioSource.add(this.audioBuffer);
			audioSource.close();
		}

		for (let i = 0; i < frameCount; i++) {
			if (this.isCancelled) {
				await output.cancel();
				this.emit("cancelled");
				return null;
			}

			const timeTicks = i * ticksPerFrame;
			const timeSeconds = mediaTimeToSeconds({ time: timeTicks as MediaTime });
			const renderStart = performance.now();
			await this.renderer.render({ world, time: timeSeconds });
			// 测试探针（window.__recutExportProbe 开启时）：记录导出读帧时刻画布
			// 顶部区域亮度序列，用于诊断「导出缺图层」类回归（如 effect.grid）。
			const probe = (globalThis as any).__recutExportProbe;
			if (probe) {
				const source = this.renderer.getCanvas();
				const scratch =
					(probe.canvas as HTMLCanvasElement | null) ??
					document.createElement("canvas");
				probe.canvas = scratch;
				scratch.width = source.width;
				scratch.height = source.height;
				const ctx = scratch.getContext("2d", { willReadFrequently: true });
				if (ctx) {
					ctx.drawImage(source, 0, 0);
					const read = ctx.getImageData(
						0,
						Math.round(source.height * 0.05),
						source.width,
						Math.round(source.height * 0.15),
					).data;
					let sum = 0;
					for (let p = 0; p < read.length; p += 4 * 37) {
						sum += read[p] + read[p + 1] + read[p + 2];
					}
					probe.push(Math.round((sum / (read.length / (4 * 37)) / 3) * 100) / 100);
					// 顶部区域最大亮度（网格线峰值）。
					let vmax = 0;
					for (let p = 0; p < read.length; p += 4) {
						const l = read[p] + read[p + 1] + read[p + 2];
						if (l > vmax) vmax = l;
					}
					(probe.max as number[]).push(vmax);
					// 同一时刻用 mediabunny 同款 VideoFrame 读法再测一次。
					const vf = new VideoFrame(source, { timestamp: 0 });
					const vctx = scratch.getContext("2d");
					vctx.clearRect(0, 0, scratch.width, scratch.height);
					vctx.drawImage(vf, 0, 0);
					vf.close();
					const vread = vctx.getImageData(
						0,
						Math.round(source.height * 0.05),
						source.width,
						Math.round(source.height * 0.15),
					).data;
					let vsum = 0;
					for (let p = 0; p < vread.length; p += 4 * 37) {
						vsum += vread[p] + vread[p + 1] + vread[p + 2];
					}
					probe.push(Math.round((vsum / (vread.length / (4 * 37)) / 3) * 100) / 100);
				} else {
					probe.push(-1);
				}
			}
			const frameTimeMs = performance.now() - renderStart;
			await videoSource.add(timeSeconds, 1 / fpsFloat);

			this.emit("progress", i / frameCount, frameTimeMs);
		}

		if (this.isCancelled) {
			await output.cancel();
			this.emit("cancelled");
			return null;
		}

		videoSource.close();
		await output.finalize();
		this.emit("progress", 1);

		const buffer = output.target.buffer;
		if (!buffer) {
			this.emit("error", new Error("Failed to export video"));
			return null;
		}

		this.emit("complete", buffer);
		return buffer;
	}
}
