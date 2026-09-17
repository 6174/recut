import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { PostEffectPlane } from "./shared/post-effect";
import { getShaderTextureImplementation } from "../../shader-effects/registry";

const BEND = getShaderTextureImplementation("bend")!;


/** 页面卷曲：沿水平轴折叠内容纹理，折角随 bend 强度翘起。
 * 卷曲量 = 峰值 × |sin(π·progress)|：对齐 remotion-kit 预览的循环折叠（无硬切），
 * 时间线上每个片段做一次卷起→摊平；峰值由 bend 参数控制。
 */
export function BendEffect({ world, params, progress }: ComponentRenderContext) {
	const bend = num(params.bend, 1.0) * Math.abs(Math.sin(progress * Math.PI));
	return (
		<PostEffectPlane
			world={world}
			fragmentShader={BEND.fragmentShader!}
			vertexShader={BEND.vertexShader}
			geometrySegments={[32, 32]}
			buildUniforms={(texture) => ({
				uMap: new THREE.Uniform(texture),
				uBend: new THREE.Uniform(bend),
			})}
			updateUniforms={(u, texture) => {
				u.uMap.value = texture;
				u.uBend.value = bend;
			}}
		/>
	);
}
