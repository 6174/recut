import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ThreeElements } from "@react-three/fiber";
import {
	Environment,
	Lightformer,
	MeshTransmissionMaterial,
} from "@react-three/drei";
import type { ComponentRenderContext } from "../types";
import { num } from "../utils";

/**
 * Spline-like 玻璃场景（移植自 remotion-skeleton spline-like demo）。
 * 验证组件系统能承载真实 3D：ExtrudeGeometry + MeshTransmissionMaterial + 环境光 + 动画。
 * 用 localTime 替代 Remotion 的 useCurrentFrame，由 Runtime 驱动，Preview/Export 一致。
 */

type SplineMaterial = {
	color: string;
	roughness: number;
	transmission: number;
	thickness: number;
	ior: number;
	chromaticAberration: number;
	anisotropy: number;
	samples: number;
	resolution: number;
	background?: string;
};

const GLASS: Omit<SplineMaterial, "background"> = {
	color: "#ffffff",
	roughness: 0.5,
	transmission: 0.95,
	thickness: 2,
	ior: 1.5,
	chromaticAberration: 1,
	anisotropy: 1,
	samples: 16,
	resolution: 256,
};

const BANDS = [
	{ color: "#823fff", position: [-1.12, -1.86, -0.52] as const, width: 2.78, height: 1.22 },
	{ color: "#ff718f", position: [-1.5, -0.66, -0.78] as const, width: 2.3, height: 1.06 },
	{ color: "#29c1a2", position: [-1.24, 1.22, -1.12] as const, width: 2.16, height: 1.22 },
	{ color: "#79c9ed", position: [1.46, 1.36, -1.38] as const, width: 2.78, height: 1.36 },
	{ color: "#ff9060", position: [1.36, -1.18, -0.94] as const, width: 2.72, height: 1.18 },
];

function roundedRectangle(width: number, height: number, radius: number) {
	const corner = Math.min(radius, width / 2, height / 2);
	const x = -width / 2;
	const y = -height / 2;
	const shape = new THREE.Shape();
	shape.moveTo(x + corner, y);
	shape.lineTo(x + width - corner, y);
	shape.quadraticCurveTo(x + width, y, x + width, y + corner);
	shape.lineTo(x + width, y + height - corner);
	shape.quadraticCurveTo(x + width, y + height, x + width - corner, y + height);
	shape.lineTo(x + corner, y + height);
	shape.quadraticCurveTo(x, y + height, x, y + height - corner);
	shape.lineTo(x, y + corner);
	shape.quadraticCurveTo(x, y, x + corner, y);
	return shape;
}

type MeshProps = Omit<ThreeElements["mesh"], "geometry" | "material">;

function Surface({
	geometry,
	material,
	meshProps,
}: {
	geometry: THREE.BufferGeometry;
	material: SplineMaterial;
	meshProps: MeshProps;
}) {
	const background = useMemo(
		() => (material.background ? new THREE.Color(material.background) : undefined),
		[material.background],
	);
	return (
		<mesh geometry={geometry} renderOrder={100} {...meshProps}>
			<MeshTransmissionMaterial
				anisotropy={material.anisotropy}
				attenuationColor="#ffffff"
				attenuationDistance={0.5}
				background={background}
				chromaticAberration={material.chromaticAberration}
				clearcoat={0.1}
				clearcoatRoughness={0.1}
				color={material.color}
				ior={material.ior}
				resolution={material.resolution}
				roughness={material.roughness}
				samples={material.samples}
				thickness={material.thickness}
				toneMapped={false}
				transmission={material.transmission}
			/>
		</mesh>
	);
}

function SplineShape({
	width,
	height,
	depth,
	radius,
	material,
	...meshProps
}: {
	width: number;
	height: number;
	depth: number;
	radius: number;
	material: SplineMaterial;
} & MeshProps) {
	const geometry = useMemo(() => {
		const bevel = Math.min(depth * 0.22, 0.032);
		return new THREE.ExtrudeGeometry(
			roundedRectangle(width, height, radius),
			{
				bevelEnabled: true,
				bevelSegments: 3,
				bevelSize: bevel,
				bevelThickness: bevel,
				curveSegments: 24,
				depth: Math.max(depth - bevel * 2, 0.001),
			},
		);
	}, [depth, height, radius, width]);
	useEffect(() => () => geometry.dispose(), [geometry]);
	return <Surface geometry={geometry} material={material} meshProps={meshProps} />;
}

function SplineTorus({
	majorRadius,
	tubeRadius,
	verticalScale = 1,
	organic = 0,
	material,
	...meshProps
}: {
	majorRadius: number;
	tubeRadius: number;
	verticalScale?: number;
	organic?: number;
	material: SplineMaterial;
} & MeshProps) {
	const geometry = useMemo(() => {
		const points = Array.from({ length: 18 }, (_, index) => {
			const angle = (index / 18) * Math.PI * 2;
			const bulge = 1 + Math.sin(angle * 2 - 0.45) * organic;
			return new THREE.Vector3(
				Math.cos(angle) * majorRadius * bulge,
				Math.sin(angle) * majorRadius * verticalScale,
				Math.cos(angle * 2 + 0.4) * organic * 0.15,
			);
		});
		return new THREE.TubeGeometry(
			new THREE.CatmullRomCurve3(points, true, "centripetal"),
			256,
			tubeRadius,
			64,
			true,
		);
	}, [majorRadius, organic, tubeRadius, verticalScale]);
	useEffect(() => () => geometry.dispose(), [geometry]);
	return <Surface geometry={geometry} material={material} meshProps={meshProps} />;
}

/** 世界相机下场景的缩放（世界单位 → 像素）。 */
const DEFAULT_SCALE = 110;
/** 模拟 remotion 相机 [6,-5,10] 的斜视角（face-on 相机的等效旋转）。 */
const CAMERA_ROT: [number, number, number] = [-0.405, -0.54, 0];

export function SplineScene({ world, object, params, localTime }: ComponentRenderContext) {
	const scale = num(params.scale, DEFAULT_SCALE);
	const speed = num(params.speed, 1);
	const frame = localTime * 30 * speed;
	const drift = (phase: number) => Math.sin((frame + phase) / 42) * 0.18;
	// 预览态降低透射/环境开销（否则拖动时逐帧全场景重渲染卡死主线程，不跟手）。
	const preview = world.isPreview === true;
	// 透射缓冲跟随世界背景：玻璃显示它身后/背景的颜色，而不是固定深色。
	const glass: SplineMaterial = {
		...GLASS,
		background: world.environment.background,
		...(preview ? { samples: 4, resolution: 128 } : {}),
	};
	// 元素 transform 由 wrapper 施加；此处只保留内容参数 scale 与斜视角。
	return (
		<group scale={[scale, scale, scale]}>
			<group rotation={CAMERA_ROT}>
				<ambientLight intensity={Math.PI} />
				<directionalLight intensity={0.6 * Math.PI} position={[0, 0, 10]} />
				<Environment resolution={preview ? 128 : 256}>
					<Lightformer
						intensity={4}
						position={[0, 4, 4]}
						rotation-x={Math.PI / 2}
						scale={[10, 10, 1]}
					/>
				</Environment>
				<group rotation={[-0.025, -0.055, -0.03]} scale={1.27}>
					{BANDS.map((band, index) => (
						<group key={band.color} position={[0, drift(index * 17), 0]}>
							<SplineShape
								depth={0.14}
								height={band.height}
								material={{ ...glass, color: band.color }}
								position={band.position}
								radius={Math.min(band.height * 0.45, 0.58)}
								rotation={[0, 0, -0.1]}
								width={band.width}
							/>
						</group>
					))}
					<group position={[0, drift(60), 0]}>
						<SplineTorus
							majorRadius={1.26}
							material={glass}
							organic={0.045}
							position={[-0.08, 0.02, 0.22]}
							rotation={[0.035, -0.045, -0.1]}
							tubeRadius={0.43}
							verticalScale={1.16}
						/>
					</group>
				</group>
			</group>
		</group>
	);
}
