import * as THREE from "three";
import type { World } from "../../../types";
import { useSceneTexture } from "./scene-texture";
import { useMaterialUniforms } from "./uniforms";
import { PASSTHROUGH_VERTEX } from "../../../shader-effects/shared/glsl";
import { EFFECT_RENDER_ORDER } from "./constants";

type UniformMap = Record<string, THREE.IUniform>;

/**
 * 全画布后处理平面：采样 SceneCapture 的 sRGB 场景纹理，逐帧更新 uniforms。
 * remotion-kit 的 post shader 按 sRGB 纹理假设编写，可原样使用（色域已在
 * SceneCapture 的 linear→sRGB 编码 pass 处理）。
 */
export function PostEffectPlane({
	world,
	fragmentShader,
	vertexShader = PASSTHROUGH_VERTEX,
	geometrySegments = [1, 1],
	buildUniforms,
	updateUniforms,
}: {
	world: World;
	fragmentShader: string;
	vertexShader?: string;
	/** [widthSegments, heightSegments]；顶点变形类特效（bend/cloth）需要细分。 */
	geometrySegments?: [number, number];
	buildUniforms: (texture: THREE.Texture) => UniformMap;
	updateUniforms: (uniforms: UniformMap, texture: THREE.Texture) => void;
}) {
	const texture = useSceneTexture();
	if (!texture) return null;

	const { material, uniforms } = useMaterialUniforms<THREE.ShaderMaterial>(
		() => buildUniforms(texture),
		(u) => updateUniforms(u, texture),
	);

	return (
		<mesh
			position={[0, 0, 0]}
			renderOrder={EFFECT_RENDER_ORDER}
			frustumCulled={false}
		>
			<planeGeometry args={[world.width, world.height, ...geometrySegments]} />
			<shaderMaterial
				ref={material}
				fragmentShader={fragmentShader}
				vertexShader={vertexShader}
				uniforms={uniforms}
				toneMapped={false}
				transparent
				depthTest={false}
				depthWrite={false}
			/>
		</mesh>
	);
}
