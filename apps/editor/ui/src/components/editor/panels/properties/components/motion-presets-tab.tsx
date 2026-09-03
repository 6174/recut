/**
 * [INPUT]: TimelineElement、预设 catalog 与 TimelineManager.updateElements。
 * [OUTPUT]: MotionPresetsTab；为元素和文本提供 Enter/Exit/Loop 分组、active 状态与瞬时播放预览。
 * [POS]: properties 面板的预设动画控制层；不展开关键帧，所有变更仍走统一 command history。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Section, SectionContent, SectionHeader, SectionTitle } from "@/components/section";
import { useEditor } from "@/editor/use-editor";
import type { TimelineElement } from "@/timeline";
import { cn } from "@/utils/ui";
import { addMediaTime, mediaTimeFromSeconds, mediaTimeToSeconds, type MediaTime } from "@/wasm";
import {
	MOTION_PRESETS,
	applyMotionPreset,
	componentsRegistry,
	removeMotionPreset,
	type MotionSlot,
	type TextMotionBinding,
} from "@/runtime";

const SLOTS: readonly MotionSlot[] = ["enter", "exit", "loop"];
const SLOT_LABELS: Record<MotionSlot, string> = { enter: "Enter", exit: "Exit", loop: "Loop" };
const PREVIEW_TONES: Array<[RegExp, string]> = [
	[/shader|glitch|ripple/i, "from-fuchsia-500/70 via-indigo-500/60 to-slate-950"],
	[/slide|float|sway/i, "from-sky-400/70 via-cyan-500/40 to-slate-950"],
	[/scale|bounce|rotate/i, "from-emerald-400/70 via-teal-500/40 to-slate-950"],
	[/text/i, "from-amber-300/70 via-orange-500/40 to-slate-950"],
];

function previewTone(presetId: string): string {
	return PREVIEW_TONES.find(([pattern]) => pattern.test(presetId))?.[1] ?? "from-slate-400/60 via-slate-600/40 to-slate-950";
}

function supportsShaderMotion(element: TimelineElement): boolean {
	if (element.type === "text" || element.type === "image" || element.type === "video") return true;
	if (element.type !== "component") return false;
	const state = componentsRegistry.getState(element.componentId);
	return state?.status === "loaded" && (state.definition.surface === "html" || state.definition.surface === "react");
}

export function MotionPresetsTab({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const editor = useEditor();
	const [previewingPresetId, setPreviewingPresetId] = useState<string | null>(null);
	const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const restoreRef = useRef<{ time: MediaTime; wasPlaying: boolean } | null>(null);
	const isText = element.type === "text";
	const presets = MOTION_PRESETS.filter((preset) => {
		const categoryMatches = isText ? (preset.category === "text" || preset.category === "element") : preset.category === "element";
		if (!categoryMatches || !preset.targets.includes(element.type)) return false;
		if (preset.channels.some((channel) => channel.target === "shader") && !supportsShaderMotion(element)) return false;
		return !preset.componentIds || (element.type === "component" && preset.componentIds.includes(element.componentId));
	});
	const stopPreview = useCallback(() => {
		if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
		previewTimerRef.current = null;
		editor.playback.pause();
		editor.timeline.discardPreview();
		const restore = restoreRef.current;
		restoreRef.current = null;
		if (restore) {
			editor.playback.seek({ time: restore.time });
			if (restore.wasPlaying) editor.playback.play();
		}
		setPreviewingPresetId(null);
	}, [editor]);
	useEffect(() => () => stopPreview(), [stopPreview]);

	const apply = (slot: MotionSlot, presetId: string, presetVersion: string) => {
		stopPreview();
		const preset = MOTION_PRESETS.find((item) => item.id === presetId && item.version === presetVersion);
		if (!preset) return;
		if (isText && preset.category === "text") {
			const textMotion: TextMotionBinding = {
				presetId,
				presetVersion,
				slot,
				segment: { mode: preset.textMode ?? "grapheme", staggerSec: 0.06 },
			};
			editor.timeline.updateElements({ updates: [{ trackId, elementId: element.id, patch: { textMotion } }] });
			return;
		}
		const next = applyMotionPreset({ element, slot, binding: { presetId, presetVersion } });
		editor.timeline.updateElements({ updates: [{ trackId, elementId: element.id, patch: { motion: next.motion } }] });
	};
	const clear = (slot: MotionSlot) => {
		stopPreview();
		const activeTextPreset = element.textMotion?.presetId && MOTION_PRESETS.find((item) => item.id === element.textMotion?.presetId)?.category === "text";
		if (isText && activeTextPreset) {
			editor.timeline.updateElements({ updates: [{ trackId, elementId: element.id, patch: { textMotion: undefined } }] });
			return;
		}
		const next = removeMotionPreset({ element, slot });
		editor.timeline.updateElements({ updates: [{ trackId, elementId: element.id, patch: { motion: next.motion } }] });
	};
	const previewMotion = (slot: MotionSlot, presetId: string, presetVersion: string) => {
		stopPreview();
		const preset = MOTION_PRESETS.find((item) => item.id === presetId && item.version === presetVersion);
		if (!preset) return;
		const binding = { presetId, presetVersion };
		const previewPatch = isText && preset.category === "text"
			? { textMotion: { ...binding, slot, segment: { mode: preset.textMode ?? "grapheme", staggerSec: 0.06 } } }
			: { motion: applyMotionPreset({ element, slot, binding }).motion };
		const originalTime = editor.playback.getCurrentTime();
		const wasPlaying = editor.playback.getIsPlaying();
		const durationSec = Math.max(0.2, preset.defaultDurationSec);
		const elementDurationSec = mediaTimeToSeconds({ time: element.duration });
		const previewOffsetSec = slot === "exit" ? Math.max(0, elementDurationSec - durationSec) : 0;
		const previewTime = addMediaTime({ a: element.startTime, b: mediaTimeFromSeconds({ seconds: previewOffsetSec }) });
		restoreRef.current = { time: originalTime, wasPlaying };
		editor.timeline.previewElements({ updates: [{ trackId, elementId: element.id, updates: previewPatch }] });
		editor.playback.pause();
		editor.playback.seek({ time: previewTime });
		editor.playback.play();
		setPreviewingPresetId(presetId);
		if (slot === "loop") {
			// Loop 的周期由 MotionProgram 在逐帧 seek 时取模，预览生命周期则由
			// 元素可见区间决定：元素还在画面里，动画就持续播放；不按 preset
			// 周期重置 playhead，否则用户看到的只是前几秒的假循环。
			previewTimerRef.current = setTimeout(
				stopPreview,
				(Math.max(0.2, elementDurationSec) + 0.15) * 1000,
			);
		} else {
			previewTimerRef.current = setTimeout(stopPreview, (durationSec + 0.15) * 1000);
		}
	};
	const selectAndPreview = (slot: MotionSlot, presetId: string, presetVersion: string) => {
		apply(slot, presetId, presetVersion);
		previewMotion(slot, presetId, presetVersion);
	};
	const isActive = (slot: MotionSlot, presetId: string, presetVersion: string) => {
		const preset = MOTION_PRESETS.find((item) => item.id === presetId && item.version === presetVersion);
		if (isText && preset?.category === "text") return (element.textMotion?.slot ?? "enter") === slot && element.textMotion?.presetId === presetId && element.textMotion.presetVersion === presetVersion;
		const binding = element.motion?.[slot];
		return binding?.presetId === presetId && binding.presetVersion === presetVersion && binding.enabled !== false;
	};

	return (
		<div>
			{SLOTS.map((slot) => {
				const slotPresets = presets.filter((preset) => preset.slots.includes(slot));
				if (!slotPresets.length) return null;
				return (
					<div key={slot} data-motion-group={slot}>
						<Section collapsible defaultOpen sectionKey={`motion:${element.id}:${slot}`} className="border-t first:border-t-0">
							<SectionHeader>
								<SectionTitle>{SLOT_LABELS[slot]}</SectionTitle>
							</SectionHeader>
							<SectionContent className="px-3 pb-3 pt-2">
								<div className="grid grid-cols-2 gap-2">
									<Button type="button" size="sm" variant="outline" className="h-auto min-h-24 flex-col items-stretch justify-start gap-1 rounded-lg border-border bg-background p-1.5 text-left hover:bg-accent/40" onClick={() => clear(slot)} data-motion-preset="none">
										<span className="flex h-14 items-center justify-center rounded-md bg-muted text-xl text-muted-foreground">∅</span>
										<span className="px-1 text-xs font-medium">None</span>
									</Button>
									{slotPresets.map((preset) => (
										<Button key={preset.id} type="button" size="sm" variant="outline" className={cn("h-auto min-h-24 flex-col items-stretch justify-start gap-1 rounded-lg border-border bg-background p-1.5 text-left hover:bg-accent/40", isActive(slot, preset.id, preset.version) && "border-emerald-500")} onClick={() => selectAndPreview(slot, preset.id, preset.version)} data-motion-option={preset.id} data-motion-preset={preset.id} data-motion-active={isActive(slot, preset.id, preset.version) ? "true" : "false"} aria-pressed={isActive(slot, preset.id, preset.version)}>
											<span className={cn("relative flex h-14 items-end overflow-hidden rounded-md bg-gradient-to-br px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-white/80", previewTone(preset.id))}>
												<span className="absolute inset-0 opacity-50 [background-image:linear-gradient(135deg,transparent_35%,rgba(255,255,255,.32)_36%,transparent_48%,transparent_62%,rgba(255,255,255,.18)_63%,transparent_74%)]" />
												<span className="relative">{previewingPresetId === preset.id ? "Playing…" : isActive(slot, preset.id, preset.version) ? "Active" : "Preview"}</span>
											</span>
											<span className="truncate px-1 text-xs font-medium">{preset.name}</span>
										</Button>
									))}
								</div>
							</SectionContent>
						</Section>
					</div>
				);
			})}
			</div>
	);
}
