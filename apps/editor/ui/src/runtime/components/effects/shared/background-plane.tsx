import * as THREE from "three";
import type { World } from "../../../types";
import { useMaterialUniforms } from "./uniforms";
import { PASSTHROUGH_VERTEX } from "../../../shader-effects/shared/glsl";

type UniformMap = Record<string, THREE.IUniform>;

/**
 * 背景内容平面：程序化生成的全屏背景层（group: "bg" 的组件）。
 * 与 AmbientEffectPlane（覆盖特效，renderOrder 1_000_000 永远最上层）相反：
 * renderOrder 取时间线轨道序，且必须是不透明材质——three 的 transparent 队列
 * 永远画在不透明队列之后（与 renderOrder 无关），transparent 的背景会盖住
 * 所有先画的 3D 不透明物体。不透明 + renderOrder 最小 = 真正垫底。
 * shader 输出 alpha=1。
 */
export function BackgroundEffectPlane({
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
	updateUniforms: (u: UniformMap) => void;
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
				transparent={false}
				premultipliedAlpha
				depthTest={false}
				depthWrite={false}
			/>
		</mesh>
	);
}
