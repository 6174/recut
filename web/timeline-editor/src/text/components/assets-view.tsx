/**
 * [INPUT]: 依赖文本样式预设目录、组合型文本组件、内置组件封面缓存、统一资源卡片与时间线插入能力。
 * [OUTPUT]: 对外提供 TextView；以二级分类网格提供文本样式预设与组合型文本组件。
 * [POS]: text/components 的资源入口；左侧分类 rail 对齐特效/组件面板，卡片点击或拖拽落轨。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
	DraggableItem,
	RESOURCE_CARD_ASPECT_RATIO,
} from "@timeline/components/editor/panels/assets/draggable-item";
import { useEditor } from "@timeline/editor/use-editor";
import { DEFAULTS } from "@timeline/timeline/defaults";
import {
	buildComponentElement,
	buildTextElement,
} from "@timeline/timeline/element-utils";
import type { MediaTime } from "@timeline/wasm";
import { t, useRecutLocale } from "@timeline/i18n";
import {
	TEXT_PRESETS,
	getTextPresetPreviewStyle,
	getTextPresetPreviewText,
	type TextPresetDef,
} from "@timeline/text/presets";
import { TEXT_GROUPS, type TextGroupId } from "@timeline/text/groups";
import { TEXT_COMPONENTS } from "@timeline/runtime/components/text-library";
import { anim, FrameTimeContext, getComponentName } from "@timeline/runtime";
import type {
	ComponentDefinition,
	ComponentRenderContext,
	World,
	WorldObject,
} from "@timeline/runtime/types";

type ActiveGroup = "all" | TextGroupId;

const TEXT_CARD_GRID: CSSProperties = {
	gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 7rem), 1fr))",
};

export function TextView() {
	const editor = useEditor();
	const locale = useRecutLocale();
	const [activeGroup, setActiveGroup] = useState<ActiveGroup>("all");

	const availableGroups = useMemo<ActiveGroup[]>(() => {
		const present = new Set<TextGroupId>();
		for (const preset of TEXT_PRESETS) present.add(preset.group);
		for (const component of TEXT_COMPONENTS) {
			if (component.textGroup) present.add(component.textGroup);
		}
		return ["all", ...TEXT_GROUPS.filter((group) => present.has(group.id)).map((group) => group.id)];
	}, []);

	const presets = useMemo(
		() => TEXT_PRESETS.filter((preset) => activeGroup === "all" || preset.group === activeGroup),
		[activeGroup],
	);
	const components = useMemo(
		() =>
			TEXT_COMPONENTS.filter(
				(component) => activeGroup === "all" || component.textGroup === activeGroup,
			),
		[activeGroup],
	);

	const handleAddPreset =
		(preset: TextPresetDef) =>
		({ currentTime }: { currentTime: MediaTime }) => {
			const element = buildTextElement({
				raw: {
					name: t(locale, preset.nameKey),
					params: {
						...DEFAULTS.text.element.params,
						...preset.params,
						content: preset.content,
					},
				},
				startTime: currentTime,
			});
			editor.timeline.insertElement({ element, placement: { mode: "auto" } });
		};

	const handleAddComponent =
		(componentId: string) =>
		({ currentTime }: { currentTime: MediaTime }) => {
			const element = buildComponentElement({ componentId, startTime: currentTime });
			editor.timeline.insertElement({ element, placement: { mode: "auto" } });
		};

	return (
		<div className="flex h-full min-h-0">
			<div className="flex w-16 shrink-0 flex-col gap-1 overflow-y-auto border-r p-1.5">
				{availableGroups.map((groupId) => {
					const labelKey =
						groupId === "all"
							? "textLib.group.all"
							: TEXT_GROUPS.find((group) => group.id === groupId)!.labelKey;
					return (
						<button
							key={groupId}
							type="button"
							onClick={() => setActiveGroup(groupId)}
							className={`rounded-md px-1 py-2 text-center text-[11px] transition ${
								activeGroup === groupId
									? "bg-white/10 font-medium text-white"
									: "text-white/50 hover:bg-white/5 hover:text-white/80"
							}`}
						>
							{t(locale, labelKey)}
						</button>
					);
				})}
			</div>
			<div className="min-w-0 flex-1 overflow-y-auto">
				<div className="grid gap-2 p-2" style={TEXT_CARD_GRID}>
					{presets.map((preset) => (
						<TextPresetCard
							key={preset.id}
							preset={preset}
							label={t(locale, preset.nameKey)}
							onAddToTimeline={handleAddPreset(preset)}
						/>
					))}
					{components.map((component) => (
						<TextComponentCard
							key={component.id}
							component={component}
							label={getComponentName({ definition: component, locale })}
							onAddToTimeline={handleAddComponent(component.id)}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

function TextPresetCard({
	preset,
	label,
	onAddToTimeline,
}: {
	preset: TextPresetDef;
	label: string;
	onAddToTimeline: ({ currentTime }: { currentTime: MediaTime }) => void;
}) {
	const previewStyle = getTextPresetPreviewStyle({ preset });
	const previewText = getTextPresetPreviewText({ preset });

	return (
		<DraggableItem
			name={label}
			preview={
				<div className="flex size-full items-center justify-center overflow-hidden bg-muted/30 p-1.5">
					<span
						className="max-w-full text-center text-[11px] leading-tight whitespace-pre-line"
						style={previewStyle}
					>
						{previewText}
					</span>
				</div>
			}
			dragData={{
				id: preset.id,
				type: "text",
				name: label,
				content: preset.content,
				params: preset.params,
			}}
			aspectRatio={RESOURCE_CARD_ASPECT_RATIO}
			onAddToTimeline={onAddToTimeline}
		/>
	);
}

function TextComponentCard({
	component,
	label,
	onAddToTimeline,
}: {
	component: ComponentDefinition;
	label: string;
	onAddToTimeline: ({ currentTime }: { currentTime: MediaTime }) => void;
}) {
	return (
		<DraggableItem
			name={label}
			isDraggable={false}
			preview={<TextComponentThumb component={component} label={label} />}
			dragData={{
				id: component.id,
				name: label,
				type: "graphic",
				definitionId: component.id,
				params: {},
			}}
			aspectRatio={RESOURCE_CARD_ASPECT_RATIO}
			onAddToTimeline={onAddToTimeline}
		/>
	);
}

/**
 * 文本组件缩略：直接渲染组件自身的 render（默认参数、t=0），按卡片尺寸等比缩放。
 * 不依赖离屏封面捕获——base size 常大于封面 harness 的 640×360 世界，PNG 会被裁切。
 */
function TextComponentThumb({
	component,
	label,
}: {
	component: ComponentDefinition;
	label: string;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ width: 0, height: 0 });

	useLayoutEffect(() => {
		const element = containerRef.current;
		if (!element) return;
		const update = () =>
			setSize({ width: element.clientWidth, height: element.clientHeight });
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const params = useMemo(
		() =>
			Object.fromEntries(
				component.inputs.map((input) => [input.key, input.default]),
			) as Record<string, string | number | boolean>,
		[component],
	);
	const base = component.getBaseSize?.({ params }) ?? { width: 640, height: 360 };
	const scale =
		size.width > 0 && size.height > 0
			? Math.min(size.width / base.width, size.height / base.height)
			: 0;

	const world: World = {
		id: `text-thumb-${component.id}`,
		width: base.width,
		height: base.height,
		fps: 30,
		duration: 6,
		environment: { background: "transparent" },
		objects: [],
	};
	const object: WorldObject = {
		id: "text-thumb",
		kind: "component",
		componentId: component.id,
		name: label,
		startTime: 0,
		duration: 6,
		params,
		transform: {
			position: { x: 0, y: 0, z: 0 },
			scaleX: 1,
			scaleY: 1,
			rotationZ: 0,
		},
		renderOrder: 0,
	};
	// 组件自带入/出场动画：缩略图取一个入场已结束的 settled 时刻，避免停在初始隐藏态。
	const settleTime = 1.2;
	const ctx: ComponentRenderContext = {
		world,
		object,
		params,
		time: settleTime,
		localTime: settleTime,
		progress: settleTime / 6,
		anim,
	};
	const Render = component.render;

	return (
		<div
			ref={containerRef}
			className="relative size-full overflow-hidden bg-[#101014]"
		>
			{scale > 0 ? (
				<div
					className="pointer-events-none absolute top-1/2 left-1/2 select-none"
					style={{
						width: base.width,
						height: base.height,
						transform: `translate(-50%, -50%) scale(${scale})`,
						transformOrigin: "center",
					}}
				>
					<FrameTimeContext.Provider value={ctx}>
						<Render {...ctx} />
					</FrameTimeContext.Provider>
				</div>
			) : null}
		</div>
	);
}
