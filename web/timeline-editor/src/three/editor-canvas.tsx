import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ResolvedLayer } from "./render-model";
import { SceneCompositor, type SceneCompositorHandle } from "./compositor";
import { ComponentStage } from "./component-stage";

/** 强制设置正交相机投影（R3F 可能不主动 updateProjectionMatrix，导致层被默认 -1..1 视锥裁剪）。 */
function CameraSetup({ width, height }: { width: number; height: number }) {
	const camera = useThree((state) => state.camera) as THREE.OrthographicCamera;
	useEffect(() => {
		camera.left = 0;
		camera.right = width;
		camera.top = 0;
		camera.bottom = height;
		camera.near = -100;
		camera.far = 100;
		camera.position.set(width / 2, height / 2, 10);
		camera.lookAt(width / 2, height / 2, 0);
		camera.updateProjectionMatrix();
	}, [camera, width, height]);
	return null;
}

export interface EditorCanvasProps {
	layers: ResolvedLayer[];
	width: number;
	height: number;
	background: string | null;
	canvas?: HTMLCanvasElement;
	onComposited?: () => void;
	onError?: (error: unknown) => void;
}

/**
 * R3F 编辑器画布：frameloop="never"（由外部 rAF/导出循环驱动合成），
 * 场景图（图层 mesh）由 React 声明式派生，合成器在提交后运行。
 */
export function EditorCanvas({
	layers,
	width,
	height,
	background,
	canvas,
	onComposited,
	onError,
}: EditorCanvasProps) {
	const compositorRef = useRef<SceneCompositorHandle>(null);
	const componentGroups = useMemo(() => new Map<string, THREE.Group>(), []);

	return (
		<Canvas
				frameloop="never"
				dpr={1}
				orthographic
				camera={{
					left: 0,
					right: width,
					top: 0,
					bottom: height,
					near: -100,
					far: 100,
					position: [width / 2, height / 2, 10],
				}}
				gl={{
					canvas,
					antialias: false,
					alpha: false,
					preserveDrawingBuffer: true,
				}}
				onCreated={({ gl }) => {
					// R3F 的 setSize(updateStyle=true) 会把 canvas CSS 设为容器尺寸；
					// 这里强制 100%（host 固定不再 resize，R3F 不会覆盖），
					// 让预览把 canvas 铺满 mount div，与 overlay 对齐。
					gl.domElement.style.width = "100%";
					gl.domElement.style.height = "100%";
					gl.domElement.style.display = "block";
				}}
			>
				<CameraSetup width={width} height={height} />
				<SceneCompositor
					ref={compositorRef}
					layers={layers}
					width={width}
					height={height}
					background={background}
					componentGroups={componentGroups}
					onComposited={onComposited}
					onError={onError}
				/>
				<ComponentStage
					layers={layers}
					registry={componentGroups}
					width={width}
					height={height}
				/>
			</Canvas>
	);
}
