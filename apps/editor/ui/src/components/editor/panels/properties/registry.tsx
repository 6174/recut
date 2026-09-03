/**
 * [INPUT]: 依赖时间线元素类型、当前语言、属性分组容器与各专项编辑 Tab。
 * [OUTPUT]: 对外提供 getPropertiesConfig，声明每种元素的属性分组与顺序。
 * [POS]: properties 的导航注册表，是属性面板从元素类型到表单分组的唯一映射。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { ReactNode } from "react";
import type {
	EffectElement,
	GraphicElement,
	ImageElement,
	MaskableElement,
	RetimableElement,
	TextElement,
	VisualElement,
	VideoElement,
	AudioElement,
	TimelineElement,
} from "@/timeline";
import type { MediaAsset } from "@/media/types";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	TextFontIcon,
	ArrowExpandIcon,
	RainDropIcon,
	MusicNote03Icon,
	MagicWand05Icon,
	DashboardSpeed02Icon,
	SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { ElementParamsTab } from "./components/element-params-tab";
import { TextStylePresets } from "./components/text-style-presets";
import { ComponentParamsTab } from "./components/component-params-tab";
import { MotionPresetsTab } from "./components/motion-presets-tab";
import { ClipEffectsTab, StandaloneEffectTab } from "@/effects/components/effects-tab";
import { MasksTab } from "@/masks/components/masks-tab";
import { SpeedTab } from "@/speed/components/speed-tab";
import { GraphicTab } from "@/graphics/components/graphic-tab";
import { OcShapesIcon } from "@/components/icons";
import { componentsRegistry } from "@/runtime";
import { t, type RecutLocale } from "@/i18n";

const TRANSFORM_PARAM_KEYS = [
	"transform.positionX",
	"transform.positionY",
	"transform.positionZ",
	"transform.scaleX",
	"transform.scaleY",
	"transform.rotate",
] as const;

const BLENDING_PARAM_KEYS = ["opacity", "blendMode"] as const;
const AUDIO_PARAM_KEYS = ["volume", "muted"] as const;
const TEXT_PARAM_KEYS = [
	"content",
	"fontFamily",
	"fontSize",
	"color",
	"textAlign",
	"fontWeight",
	"fontStyle",
	"textDecoration",
	"letterSpacing",
	"lineHeight",
	"background.enabled",
	"background.color",
	"background.cornerRadius",
	"background.paddingX",
	"background.paddingY",
	"background.offsetX",
	"background.offsetY",
	"stroke.enabled",
	"stroke.color",
	"stroke.width",
] as const;

export type TabContentProps = {
	trackId: string;
};

export type PropertiesTabDef = {
	id: string;
	label: string;
	icon: ReactNode;
	content: (props: TabContentProps) => ReactNode;
};

export type ElementPropertiesConfig = {
	defaultTab: string;
	tabs: PropertiesTabDef[];
};

function buildMotionPresetsTab({ element }: { element: VisualElement }): PropertiesTabDef {
	return {
		id: "motion-presets",
		label: "Animation",
		icon: null,
		content: ({ trackId }) => <MotionPresetsTab element={element} trackId={trackId} />,
	};
}

function buildTransformTab({
	element,
	locale,
}: {
	element: VisualElement;
	locale: RecutLocale;
}): PropertiesTabDef {
	return {
		id: "transform",
		label: t(locale, "prop.tab.transform"),
		icon: <HugeiconsIcon icon={ArrowExpandIcon} size={16} />,
		content: ({ trackId }) => (
			<ElementParamsTab
				element={element}
				trackId={trackId}
				paramKeys={TRANSFORM_PARAM_KEYS}
				sectionKey="transform"
				title={t(locale, "prop.tab.transform")}
			/>
		),
	};
}

function buildBlendingTab({
	element,
	locale,
}: {
	element: VisualElement;
	locale: RecutLocale;
}): PropertiesTabDef {
	return {
		id: "blending",
		label: t(locale, "prop.tab.blending"),
		icon: <HugeiconsIcon icon={RainDropIcon} size={16} />,
		content: ({ trackId }) => (
			<ElementParamsTab
				element={element}
				trackId={trackId}
				paramKeys={BLENDING_PARAM_KEYS}
				sectionKey="blending"
				title={t(locale, "prop.tab.blending")}
			/>
		),
	};
}

function buildAudioTab({
	element,
	locale,
}: {
	element: AudioElement | VideoElement;
	locale: RecutLocale;
}): PropertiesTabDef {
	return {
		id: "audio",
		label: t(locale, "prop.tab.audio"),
		icon: <HugeiconsIcon icon={MusicNote03Icon} size={16} />,
		content: ({ trackId }) => (
			<ElementParamsTab
				element={element}
				trackId={trackId}
				paramKeys={AUDIO_PARAM_KEYS}
				sectionKey="audio"
				title={t(locale, "prop.tab.audio")}
			/>
		),
	};
}

function buildSpeedTab({
	element,
	locale,
}: {
	element: RetimableElement;
	locale: RecutLocale;
}): PropertiesTabDef {
	return {
		id: "speed",
		label: t(locale, "prop.tab.speed"),
		icon: <HugeiconsIcon icon={DashboardSpeed02Icon} size={16} />,
		content: ({ trackId }) => <SpeedTab element={element} trackId={trackId} />,
	};
}

function buildMasksTab({
	element,
	locale,
}: {
	element: MaskableElement;
	locale: RecutLocale;
}): PropertiesTabDef {
	return {
		id: "masks",
		label: t(locale, "prop.tab.masks"),
		icon: <OcShapesIcon size={16} />,
		content: ({ trackId }) => <MasksTab element={element} trackId={trackId} />,
	};
}

function buildClipEffectsTab({
	element,
	locale,
}: {
	element: VisualElement;
	locale: RecutLocale;
}): PropertiesTabDef {
	return {
		id: "effects",
		label: t(locale, "prop.tab.effects"),
		icon: <HugeiconsIcon icon={MagicWand05Icon} size={16} />,
		content: ({ trackId }) => (
			<ClipEffectsTab element={element} trackId={trackId} />
		),
	};
}

function buildComponentParamsTab({
	element,
	locale,
}: {
	element: TimelineElement;
	locale: RecutLocale;
}): PropertiesTabDef {
	return {
		id: "params",
		label: t(locale, "prop.tab.params"),
		icon: <HugeiconsIcon icon={SlidersHorizontalIcon} size={16} />,
		content: ({ trackId }) => (
			<ComponentParamsTab element={element} trackId={trackId} />
		),
	};
}

function buildTextTab({
	element,
	locale,
}: {
	element: TextElement;
	locale: RecutLocale;
}): PropertiesTabDef {
	return {
		id: "text",
		label: t(locale, "prop.tab.text"),
		icon: <HugeiconsIcon icon={TextFontIcon} size={16} />,
		content: ({ trackId }) => (
			<>
				<TextStylePresets element={element} trackId={trackId} />
				<ElementParamsTab
					element={element}
					trackId={trackId}
					paramKeys={TEXT_PARAM_KEYS}
					sectionKey="text"
					title={t(locale, "prop.tab.text")}
				/>
			</>
		),
	};
}

function buildGraphicTab({
	element,
	locale,
}: {
	element: GraphicElement;
	locale: RecutLocale;
}): PropertiesTabDef {
	return {
		id: "graphic",
		label: t(locale, "prop.tab.graphic"),
		icon: <OcShapesIcon size={16} />,
		content: ({ trackId }) => <GraphicTab element={element} trackId={trackId} />,
	};
}

function buildStandaloneEffectTab({
	element,
	locale,
}: {
	element: EffectElement;
	locale: RecutLocale;
}): PropertiesTabDef {
	return {
		id: "effects",
		label: t(locale, "prop.tab.effects"),
		icon: <HugeiconsIcon icon={MagicWand05Icon} size={16} />,
		content: ({ trackId }) => (
			<StandaloneEffectTab element={element} trackId={trackId} />
		),
	};
}

function getTextConfig({
	element,
	locale,
}: {
	element: TextElement;
	locale: RecutLocale;
}): ElementPropertiesConfig {
	return {
		defaultTab: "text",
		tabs: [
			buildTextTab({ element, locale }),
			buildTransformTab({ element, locale }),
			buildBlendingTab({ element, locale }),
			buildMotionPresetsTab({ element }),
		],
	};
}

function getVideoConfig({
	element,
	mediaAsset,
	locale,
}: {
	element: VideoElement;
	mediaAsset: MediaAsset | undefined;
	locale: RecutLocale;
}): ElementPropertiesConfig {
	const showAudioTab = mediaAsset?.hasAudio !== false;
	return {
		defaultTab: "transform",
		tabs: [
			buildTransformTab({ element, locale }),
			buildMotionPresetsTab({ element }),
			...(showAudioTab ? [buildAudioTab({ element, locale })] : []),
			buildSpeedTab({ element, locale }),
			buildBlendingTab({ element, locale }),
			buildMasksTab({ element, locale }),
			buildClipEffectsTab({ element, locale }),
		],
	};
}

function getImageConfig({
	element,
	locale,
}: {
	element: ImageElement;
	locale: RecutLocale;
}): ElementPropertiesConfig {
	return {
		defaultTab: "transform",
		tabs: [
			buildTransformTab({ element, locale }),
			buildMotionPresetsTab({ element }),
			buildBlendingTab({ element, locale }),
			buildMasksTab({ element, locale }),
			buildClipEffectsTab({ element, locale }),
		],
	};
}

function getGraphicConfig({
	element,
	locale,
}: {
	element: GraphicElement;
	locale: RecutLocale;
}): ElementPropertiesConfig {
	return {
		defaultTab: "graphic",
		tabs: [
			buildGraphicTab({ element, locale }),
			buildTransformTab({ element, locale }),
			buildMotionPresetsTab({ element }),
			buildBlendingTab({ element, locale }),
			buildMasksTab({ element, locale }),
			buildClipEffectsTab({ element, locale }),
		],
	};
}

function getAudioConfig({
	element,
	locale,
}: {
	element: AudioElement;
	locale: RecutLocale;
}): ElementPropertiesConfig {
	return {
		defaultTab: "audio",
		tabs: [
			buildAudioTab({ element, locale }),
			buildSpeedTab({ element, locale }),
		],
	};
}

function getEffectConfig({
	element,
	locale,
}: {
	element: EffectElement;
	locale: RecutLocale;
}): ElementPropertiesConfig {
	return {
		defaultTab: "effects",
		tabs: [buildStandaloneEffectTab({ element, locale })],
	};
}

export function getPropertiesConfig({
	element,
	locale,
	mediaAssets,
}: {
	element: TimelineElement;
	locale: RecutLocale;
	mediaAssets: MediaAsset[];
}): ElementPropertiesConfig {
	switch (element.type) {
		case "text":
			return getTextConfig({ element, locale });
		case "video": {
			const mediaAsset = mediaAssets.find((a) => a.id === element.mediaId);
			return getVideoConfig({ element, locale, mediaAsset });
		}
		case "image":
			return getImageConfig({ element, locale });
		case "graphic":
			return getGraphicConfig({ element, locale });
		case "component": {
			const definition = componentsRegistry.has(element.componentId)
				? componentsRegistry.get(element.componentId)
				: null;
			const isEffect = definition?.category === "effect";
			// 全画布特效不可变换：只显示可关键帧的参数标签页（center/强度/颜色等）。
			if (isEffect) {
				return {
					defaultTab: "params",
					tabs: [buildComponentParamsTab({ element, locale }), buildMotionPresetsTab({ element })],
				};
			}
			return {
				defaultTab: "params",
				tabs: [
					buildComponentParamsTab({ element, locale }),
					buildTransformTab({ element, locale }),
					buildBlendingTab({ element, locale }),
					buildMotionPresetsTab({ element }),
				],
			};
		}
		case "audio":
			return getAudioConfig({ element, locale });
		case "effect":
			return getEffectConfig({ element, locale });
	}
}
