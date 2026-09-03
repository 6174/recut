import type { ComponentRenderContext } from "../types";
import { num, str } from "../utils";

/**
 * Glow Box：真 3D 内置组件。证明组件内可完整使用 geometry / material / 点光源，
 * 并按 localTime 做确定性动画（无随机源，Preview / Export 一致）。元素 Shader Motion
 * 由 runtime/shader-effects 公共 Host 承载，此组件不拥有任何动画特效实现。
 * 元素级 transform（位移 z / 缩放 / 平面旋转）施加在 group 上，自转动画保留在 mesh。
 */
export function GlowBox({ object, params, localTime }: ComponentRenderContext) {
	const size = num(params.size, 220);
	const color = str(params.color, "#00d4ff");
	const speed = num(params.rotationSpeed, 1);
	const intensity = num(params.intensity, 1.4);

	// 元素 transform 由 wrapper 施加；此处只渲染"内容"（自转动画 + 点光源）。
	const rotationX = 0.55 + localTime * speed * 0.7;
	const rotationY = -0.65 + localTime * speed;
	const pulse = 1 + Math.sin(localTime * 2.5) * 0.15;

	return (
		<group>
			<mesh rotation={[rotationX, rotationY, 0]} scale={pulse}>
				<boxGeometry args={[size, size, size]} />
				<meshStandardMaterial
					color={color}
					emissive={color}
					emissiveIntensity={intensity}
					metalness={0.4}
					roughness={0.2}
				/>
			</mesh>
			<pointLight
				position={[size * 1.2, size * 1.2, size * 3]}
				intensity={intensity * 3}
				distance={size * 8}
				color={color}
			/>
		</group>
	);
}
