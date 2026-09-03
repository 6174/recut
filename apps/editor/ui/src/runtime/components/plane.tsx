import * as THREE from "three";
import type { ParamValues } from "@/params";
import type { World, WorldObject } from "../types";
import { num } from "../utils";

/** 编辑器变换 → three 世界坐标（y 翻转：编辑器 y 向下为正）。 */
export function worldPosition(t: {
	position: { x: number; y: number; z: number };
}): [number, number, number] {
	return [t.position.x, -t.position.y, t.position.z];
}

export function worldRotationZ(rotationDegrees: number): number {
	return (-rotationDegrees * Math.PI) / 180;
}

/** 源尺寸 → 画布内 contain-fit 的 plane 尺寸。 */
export function containFitSize({
	sourceWidth,
	sourceHeight,
	world,
}: {
	sourceWidth?: number;
	sourceHeight?: number;
	world: World;
}): { width: number; height: number } {
	if (!sourceWidth || !sourceHeight) {
		return { width: world.width, height: world.height };
	}
	const scale = Math.min(world.width / sourceWidth, world.height / sourceHeight);
	return { width: sourceWidth * scale, height: sourceHeight * scale };
}

interface PlaneProps {
	world: World;
	object: WorldObject;
	params: ParamValues;
	map: THREE.Texture | null;
	/** true：contain-fit；false：整幅画布（文字等全画布纹理）。 */
	fit?: boolean;
}

/** 2D 平面对象：z=0，renderOrder 定序，不写深度。元素 transform 由 wrapper 施加。 */
export function Plane({ world, object, params, map, fit = true }: PlaneProps) {
	const opacity = num(params.opacity, 1);
	const size = fit
		? containFitSize({
				sourceWidth: object.sourceWidth,
				sourceHeight: object.sourceHeight,
				world,
			})
		: { width: world.width, height: world.height };

	return (
		<mesh renderOrder={object.renderOrder}>
			<planeGeometry args={[size.width, size.height]} />
			<meshBasicMaterial
				map={map ?? undefined}
				transparent
				opacity={opacity}
				depthWrite={false}
				side={THREE.DoubleSide}
			/>
		</mesh>
	);
}
