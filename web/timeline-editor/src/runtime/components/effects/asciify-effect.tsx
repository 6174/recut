import { useRef } from "react";
import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { PostEffectPlane } from "./shared/post-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";
const RAMP = " .:-=+*#%@";
const GLYPH_SIZE = 10;

const buildGlyphAtlas = () => {
	const canvas = document.createElement("canvas");
	canvas.width = GLYPH_SIZE;
	canvas.height = GLYPH_SIZE * RAMP.length;
	const context = canvas.getContext("2d");
	if (context) {
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.fillStyle = "#ffffff";
		context.font = `${Math.floor(GLYPH_SIZE * 0.8)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
		context.textAlign = "center";
		context.textBaseline = "middle";
		RAMP.split("").forEach((glyph, index) => {
			context.fillText(glyph, GLYPH_SIZE / 2, index * GLYPH_SIZE + GLYPH_SIZE / 2);
		});
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	return texture;
};


/**
 * ASCII 字符化入场：字形马赛克解码表演，终态严格回到原纹理。
 * uProgress ≥ 0.82 时 shader 短路返回原纹理，progress 必须由元素生命周期驱动
 * （预览随时间循环重放，时间线单次 0→1）；静态参数（=1）会让特效完全不可见
 * （对齐 remotion-kit「ShotGraph 注入的单次效果进度」）。
 */
export function AsciifyEffect({ world, params, localTime, progress }: ComponentRenderContext) {
	const glyphs = useRef<THREE.CanvasTexture | null>(null);
	if (!glyphs.current) glyphs.current = buildGlyphAtlas();
	const cell = num(params.cell, 12);
	return (
		<PostEffectPlane
			world={world}
			fragmentShader={getShaderTexturePass("asciify")!}
			buildUniforms={(texture) => ({
				uMap: new THREE.Uniform(texture),
				uGlyphs: new THREE.Uniform(glyphs.current),
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uCell: new THREE.Uniform(cell),
				uGlyphCount: new THREE.Uniform(RAMP.length),
				uTime: new THREE.Uniform(localTime),
				uProgress: new THREE.Uniform(progress),
			})}
			updateUniforms={(u, texture) => {
				u.uMap.value = texture;
				u.uResolution.value.set(world.width, world.height);
				u.uCell.value = cell;
				u.uTime.value = localTime;
				u.uProgress.value = progress;
			}}
		/>
	);
}
