import * as THREE from "three";
import type { World } from "../../../types";
import { useMaterialUniforms } from "./uniforms";
import { PASSTHROUGH_VERTEX } from "../../../shader-effects/shared/glsl";

type UniformMap = Record<string, THREE.IUniform>;

/**
 * 全画布环境特效平面：程序化内容（雾/网格/粒子等），不消费场景纹理，
 * shader 自带透明 alpha。逐帧更新 uniforms（time 等）。
 * 背景/环境层（group: "bg"）与 wallpaper 一致按轨道序 renderOrder 参与排序：
 * 元素材质全部在透明队列内，renderOrder 小者先画 → 环境层垫底、元素浮于其上。
 */
export function AmbientEffectPlane({
	world,
	object,
	fragmentShader,
	buildUniforms,
	updateUniforms,
}: {
	world: World;
	object: { renderOrder: number };
	fragmentShader: string;
	buildUniforms: () => UniformMap;
	updateUniforms: (uniforms: UniformMap) => void;
}) {
	const { material, uniforms } = useMaterialUniforms<THREE.ShaderMaterial>(
		buildUniforms,
		updateUniforms,
	);

	return (
		<mesh
			position={[0, 0, 0]}
			renderOrder={object.renderOrder}
			frustumCulled={false}
		>
			<planeGeometry args={[world.width, world.height]} />
			<shaderMaterial
				ref={material}
				fragmentShader={fragmentShader}
				vertexShader={PASSTHROUGH_VERTEX}
				uniforms={uniforms}
				toneMapped={false}
				transparent
				premultipliedAlpha
				depthTest={false}
				depthWrite={false}
			/>
		</mesh>
	);
}
