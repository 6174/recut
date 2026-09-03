import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { EFFECT_RENDER_ORDER } from "./shared/constants";
import { useSceneTexture } from "./shared/scene-texture";
import { useMaterialUniforms } from "./shared/uniforms";
import { getShaderTexturePass } from "../../shader-effects/registry";
import { PASSTHROUGH_VERTEX } from "../../shader-effects/shared/glsl";

/**
 * 放大镜特效：全画布后处理平面，圆形透镜放大 + 像素 HUD + 色差 + 雾气。
 * 透镜中心由可关键帧的 centerX/centerY（UV [0,1]）参数驱动。
 */
export function MagnifyEffect({ world, params }: ComponentRenderContext) {
	const texture = useSceneTexture();
	if (!texture) return null;
	const centerX = num(params.centerX, 0.5);
	const centerY = num(params.centerY, 0.5);
	const zoom = num(params.zoom, 1.7);
	const radius = num(params.radius, 140);
	const hud = num(params.hud, 0.8);
	const aberration = num(params.aberration, 0.8);
	const haze = num(params.haze, 0.2);

	const { material, uniforms } = useMaterialUniforms<THREE.ShaderMaterial>(
		() => ({
			uMap: new THREE.Uniform(texture),
			uResolution: new THREE.Uniform(
				new THREE.Vector2(world.width, world.height),
			),
			uCenter: new THREE.Uniform(
				new THREE.Vector2(centerX * world.width, centerY * world.height),
			),
			uRadius: new THREE.Uniform(radius),
			uZoom: new THREE.Uniform(zoom),
			uColor: new THREE.Uniform(new THREE.Color(0.8, 0.8, 0.8)),
			uHud: new THREE.Uniform(hud),
			uAberration: new THREE.Uniform(aberration),
			uHaze: new THREE.Uniform(haze),
		}),
		(u) => {
			u.uMap.value = texture;
			u.uResolution.value.set(world.width, world.height);
			u.uCenter.value.set(centerX * world.width, centerY * world.height);
			u.uRadius.value = radius;
			u.uZoom.value = zoom;
			u.uHud.value = hud;
			u.uAberration.value = aberration;
			u.uHaze.value = haze;
		},
	);

	return (
		<mesh
			position={[0, 0, 0]}
			renderOrder={EFFECT_RENDER_ORDER}
			frustumCulled={false}
		>
			<planeGeometry args={[world.width, world.height]} />
			<shaderMaterial
				ref={material}
				fragmentShader={getShaderTexturePass("magnify")!}
				vertexShader={PASSTHROUGH_VERTEX}
				uniforms={uniforms}
				toneMapped={false}
				transparent
				depthTest={false}
				depthWrite={false}
			/>
		</mesh>
	);
}
