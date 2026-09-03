/**
 * [INPUT]: 依赖特效注册表、预览渲染服务、编辑器时间线与统一资源卡片比例。
 * [OUTPUT]: 对外提供 EffectsView，展示可拖入时间线的特效资源卡片。
 * [POS]: effects/components 的资源入口；与媒体、文本和组件共用 16:9 卡片结构。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useRef, useCallback } from "react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import {
	DraggableItem,
	RESOURCE_CARD_ASPECT_RATIO,
} from "@/components/editor/panels/assets/draggable-item";
import { effectsRegistry, getEffectName, EFFECT_TARGET_ELEMENT_TYPES } from "@/effects";
import { effectPreviewService } from "@/services/renderer/effect-preview";
import { useEditor } from "@/editor/use-editor";
import { buildEffectElement } from "@/timeline/element-utils";
import type { EffectDefinition } from "@/effects/types";
import { t, useRecutLocale } from "@/i18n";

export function EffectsView() {
	const effects = effectsRegistry.getAll();
	const locale = useRecutLocale();

	return (
		<PanelView title={t(locale, "prop.effects.title")}>
			<EffectsGrid effects={effects} />
		</PanelView>
	);
}

function EffectsGrid({ effects }: { effects: EffectDefinition[] }) {
	return (
		<div
			className="grid gap-2"
			style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 7rem), 1fr))" }}
		>
			{effects.map((effect) => (
				<EffectItem key={effect.type} effect={effect} />
			))}
		</div>
	);
}

function EffectPreviewCanvas({ effectType }: { effectType: string }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const render = () => {
			if (canvasRef.current) {
				effectPreviewService.renderPreview({
					effectType,
					params: {},
					targetCanvas: canvasRef.current,
				});
			}
		};

		render();
		return effectPreviewService.onPreviewImageReady({ callback: render });
	}, [effectType]);

	return <canvas ref={canvasRef} className="size-full" />;
}

function EffectItem({ effect }: { effect: EffectDefinition }) {
	const editor = useEditor();
	const locale = useRecutLocale();
	const name = getEffectName({ definition: effect, locale });

	const handleAddToTimeline = useCallback(() => {
		const currentTime = editor.playback.getCurrentTime();
		const element = buildEffectElement({
			effectType: effect.type,
			startTime: currentTime,
		});

		editor.timeline.insertElement({
			placement: { mode: "auto", trackType: "effect" },
			element,
		});
	}, [editor, effect.type]);

	const preview = <EffectPreviewCanvas effectType={effect.type} />;

	return (
		<DraggableItem
			name={name}
			preview={preview}
			dragData={{
				id: effect.type,
				name,
				type: "effect",
				effectType: effect.type,
				targetElementTypes: EFFECT_TARGET_ELEMENT_TYPES,
			}}
			onAddToTimeline={handleAddToTimeline}
			aspectRatio={RESOURCE_CARD_ASPECT_RATIO}
			isRounded
			variant="card"
			containerClassName="w-full"
		/>
	);
}
