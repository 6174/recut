/**
 * [INPUT]: 已验证的组件效果 pass。
 * [OUTPUT]: 可被全局 Effect、Element Capture 和 Motion preset 复用的 EffectDefinition。
 * [POS]: shader-effects 的迁移边界；只描述语义参数与实现，不承载 React 生命周期。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as THREE from "three";
import {
	ARTICLE_HIGHLIGHT_FRAGMENT_SHADER,
	ASCIIFY_FRAGMENT_SHADER,
	BEND_FRAGMENT_SHADER,
	BEND_VERTEX_SHADER,
	BLAZE_FRAGMENT_SHADER,
	BUBBLE_FRAGMENT_SHADER,
	CLOTH_FRAGMENT_SHADER,
	CLOTH_VERTEX_SHADER,
	CLOUDS_FRAGMENT_SHADER,
	DECRYPT_REVEAL_FRAGMENT_SHADER,
	DROPLETS_FRAGMENT_SHADER,
	FROST_FRAGMENT_SHADER,
	GLASS_FRAGMENT_SHADER,
	GLYPH_RAIN_FRAGMENT_SHADER,
	GRID_FRAGMENT_SHADER,
	LASER_FRAGMENT_SHADER,
	LIQUID_FRAGMENT_SHADER,
	MAGNIFY_FRAGMENT_SHADER,
	PARTICLE_REVEAL_FRAGMENT_SHADER,
	PARTICLE_SCROLL_FRAGMENT_SHADER,
	RETRO_DITHER_FRAGMENT_SHADER,
	STORE_PEEL_FRAGMENT_SHADER,
	TEXT_FOCUS_FRAGMENT_SHADER,
	VINTAGE_FRAGMENT_SHADER,
} from "../passes";
import type { ShaderEffectDefinition, ShaderEffectId } from "../types";

type LegacySpec = {
	id: Exclude<ShaderEffectId, "glitch" | "ripple" | "displacement" | "crt" | "vhs">;
	parameters: readonly string[];
	fragmentShader: string;
	vertexShader?: string;
};

function legacy(spec: LegacySpec): ShaderEffectDefinition {
	return {
		id: spec.id,
		parameters: spec.parameters,
		create: () => ({
			id: spec.id,
			uniforms: Object.fromEntries(spec.parameters.map((name) => [name, new THREE.Uniform(0)])),
		}),
		implementations: [{
			kind: "texture",
			priority: 100,
			supports: (context) => context.hasSourceTexture,
			fragmentShader: spec.fragmentShader,
			vertexShader: spec.vertexShader,
		}],
	};
}

export const LEGACY_SHADER_EFFECTS: readonly ShaderEffectDefinition[] = [
	legacy({ id: "article-highlight", parameters: ["intensity", "progress"], fragmentShader: ARTICLE_HIGHLIGHT_FRAGMENT_SHADER }),
	legacy({ id: "asciify", parameters: ["progress", "time"], fragmentShader: ASCIIFY_FRAGMENT_SHADER }),
	legacy({ id: "bend", parameters: ["bend"], fragmentShader: BEND_FRAGMENT_SHADER, vertexShader: BEND_VERTEX_SHADER }),
	legacy({ id: "blaze", parameters: ["time", "opacity"], fragmentShader: BLAZE_FRAGMENT_SHADER }),
	legacy({ id: "bubble", parameters: ["time", "intensity"], fragmentShader: BUBBLE_FRAGMENT_SHADER }),
	legacy({ id: "cloth", parameters: ["time", "amplitude", "speed"], fragmentShader: CLOTH_FRAGMENT_SHADER, vertexShader: CLOTH_VERTEX_SHADER }),
	legacy({ id: "clouds", parameters: ["time", "opacity"], fragmentShader: CLOUDS_FRAGMENT_SHADER }),
	legacy({ id: "decrypt-reveal", parameters: ["time", "progress"], fragmentShader: DECRYPT_REVEAL_FRAGMENT_SHADER }),
	legacy({ id: "droplets", parameters: ["time", "intensity", "speed"], fragmentShader: DROPLETS_FRAGMENT_SHADER }),
	legacy({ id: "frost", parameters: ["time", "intensity"], fragmentShader: FROST_FRAGMENT_SHADER }),
	legacy({ id: "glass", parameters: ["zoom", "reflect"], fragmentShader: GLASS_FRAGMENT_SHADER }),
	legacy({ id: "glyph-rain", parameters: ["time", "opacity", "intensity"], fragmentShader: GLYPH_RAIN_FRAGMENT_SHADER }),
	legacy({ id: "grid", parameters: ["time", "opacity", "speed"], fragmentShader: GRID_FRAGMENT_SHADER }),
	legacy({ id: "laser", parameters: ["time", "opacity", "intensity"], fragmentShader: LASER_FRAGMENT_SHADER }),
	legacy({ id: "liquid", parameters: ["time", "opacity"], fragmentShader: LIQUID_FRAGMENT_SHADER }),
	legacy({ id: "magnify", parameters: ["zoom", "hud", "aberration"], fragmentShader: MAGNIFY_FRAGMENT_SHADER }),
	legacy({ id: "particle-reveal", parameters: ["time", "progress", "intensity"], fragmentShader: PARTICLE_REVEAL_FRAGMENT_SHADER }),
	legacy({ id: "particle-scroll", parameters: ["time", "opacity"], fragmentShader: PARTICLE_SCROLL_FRAGMENT_SHADER }),
	legacy({ id: "retro-dither", parameters: ["time", "levels", "grid"], fragmentShader: RETRO_DITHER_FRAGMENT_SHADER }),
	legacy({ id: "store-peel", parameters: ["progress"], fragmentShader: STORE_PEEL_FRAGMENT_SHADER }),
	legacy({ id: "text-focus", parameters: ["progress", "intensity"], fragmentShader: TEXT_FOCUS_FRAGMENT_SHADER }),
	legacy({ id: "vintage", parameters: ["time", "grain", "warmth", "fade"], fragmentShader: VINTAGE_FRAGMENT_SHADER }),
];
