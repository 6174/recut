import * as THREE from "three";
import { buildTransformFromParams, type Transform } from "@/rendering";

/**
 * [INPUT]: WorldScene 注册的 Object3D 及时间线 transform
 * [OUTPUT]: 渲染节点注册、作者内容边界与刷新订阅
 * [POS]: runtime 的交互几何真相源；组件选择框优先由 ContentBounds + timeline transform 直接求值
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

/**
 * 节点对象注册表：WorldScene 渲染时把每个节点的"元素变换组"（wrapper）登记进来，
 * 供选择框 / 命中测试读取交互 footprint（D5/D6）。组件作者声明 ContentBounds 时，
 * 它是唯一的局部 footprint；选择框只叠加时间线 transform，绝不从 R3F mesh 再猜一次。
 */

const registry = new Map<string, THREE.Object3D>();
const contentBoundsRegistry = new Map<string, RegisteredContentBounds>();
const listeners = new Set<() => void>();

/** ContentBounds 仍是 DOM 左上角坐标；baseSize 让 registry 无需读取 Three 局部矩阵。 */
export interface RegisteredContentBounds {
	x: number;
	y: number;
	width: number;
	height: number;
	baseWidth: number;
	baseHeight: number;
}

function areRegisteredContentBoundsEqual(
	a: RegisteredContentBounds | undefined,
	b: RegisteredContentBounds | null,
): boolean {
	if (!a || !b) return a === b;
	return (
		Math.abs(a.x - b.x) < 0.01 &&
		Math.abs(a.y - b.y) < 0.01 &&
		Math.abs(a.width - b.width) < 0.01 &&
		Math.abs(a.height - b.height) < 0.01 &&
		Math.abs(a.baseWidth - b.baseWidth) < 0.01 &&
		Math.abs(a.baseHeight - b.baseHeight) < 0.01
	);
}

function notify(): void {
	for (const listener of listeners) listener();
}

export function registerNodeObject(
	elementId: string,
	object: THREE.Object3D | null,
): void {
	if (object) {
		registry.set(elementId, object);
	} else {
		registry.delete(elementId);
	}
	notify();
}

/**
 * HTML/React 组件把稳定 ContentBounds 注册为权威交互 footprint。
 * 这是与画布 transform 相乘前的设计坐标，不能由透明纹理、mesh bbox 或当前播放帧重算。
 */
export function registerNodeContentBounds(
	elementId: string,
	bounds: RegisteredContentBounds | null,
): void {
	const current = contentBoundsRegistry.get(elementId);
	if (areRegisteredContentBoundsEqual(current, bounds)) return;
	if (bounds) {
		contentBoundsRegistry.set(elementId, bounds);
	} else {
		contentBoundsRegistry.delete(elementId);
	}
	notify();
}

export function subscribeNodeRegistry(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getRenderedNodeObject(elementId: string): THREE.Object3D | null {
	return registry.get(elementId) ?? null;
}

export interface RenderedNodeBounds {
	cx: number;
	cy: number;
	width: number;
	height: number;
	rotation: number;
}

function getTransformedContentBounds({
	contentBounds,
	canvasWidth,
	canvasHeight,
	transform,
}: {
	contentBounds: RegisteredContentBounds;
	canvasWidth: number;
	canvasHeight: number;
	transform: Transform;
}): RenderedNodeBounds | null {
	const { x, y, width, height, baseWidth, baseHeight } = contentBounds;
	if (
		!Number.isFinite(x) ||
		!Number.isFinite(y) ||
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		!Number.isFinite(baseWidth) ||
		!Number.isFinite(baseHeight) ||
		width <= 0 ||
		height <= 0 ||
		baseWidth <= 0 ||
		baseHeight <= 0
	) {
		return null;
	}
	// ContentBounds 原点是 DOM 左上角；Three 局部坐标原点在内容区中心且 y 向上。
	const localCenterX = x + width / 2 - baseWidth / 2;
	const localCenterY = baseHeight / 2 - (y + height / 2);
	const angle = (transform.rotate * Math.PI) / 180;
	const scaledX = localCenterX * transform.scaleX;
	const scaledY = localCenterY * transform.scaleY;

	return {
		cx:
			canvasWidth / 2 +
			transform.position.x +
			scaledX * Math.cos(angle) +
			scaledY * Math.sin(angle),
		cy:
			canvasHeight / 2 +
			transform.position.y +
			scaledX * Math.sin(angle) -
			scaledY * Math.cos(angle),
		width: Math.max(Math.abs(width * transform.scaleX), 1),
		height: Math.max(Math.abs(height * transform.scaleY), 1),
		rotation: transform.rotate,
	};
}

function boxCorners(box: THREE.Box3): THREE.Vector3[] {
	return [
		new THREE.Vector3(box.min.x, box.min.y, box.min.z),
		new THREE.Vector3(box.max.x, box.min.y, box.min.z),
		new THREE.Vector3(box.min.x, box.max.y, box.min.z),
		new THREE.Vector3(box.max.x, box.max.y, box.min.z),
		new THREE.Vector3(box.min.x, box.min.y, box.max.z),
		new THREE.Vector3(box.max.x, box.min.y, box.max.z),
		new THREE.Vector3(box.min.x, box.max.y, box.max.z),
		new THREE.Vector3(box.max.x, box.max.y, box.max.z),
	];
}

function getLocalContentBounds({
	content,
	wrapper,
}: {
	content: THREE.Object3D;
	wrapper: THREE.Object3D;
}): THREE.Box3 | null {
	const wrapperInverse = wrapper.matrixWorld.clone().invert();
	const localBox = new THREE.Box3().makeEmpty();
	const point = new THREE.Vector3();

	content.traverse((node) => {
		// HTML/React 已以 ContentBounds 直接注册交互边界；此纹理 plane 绝不能重新
		// 参与 geometry fallback，否则承载面 padding 会污染选择框。
		if ((node as THREE.Object3D).userData.recutIgnoreNodeBounds) return;
		const geometry = (node as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
		if (!geometry) return;
		geometry.computeBoundingBox();
		if (!geometry.boundingBox) return;
		const localToWrapper = wrapperInverse.clone().multiply(node.matrixWorld);
		for (const corner of boxCorners(geometry.boundingBox)) {
			localBox.expandByPoint(point.copy(corner).applyMatrix4(localToWrapper));
		}
	});

	return localBox.isEmpty() ? null : localBox;
}

/**
 * 选择框 bounds：组件作者已注册 ContentBounds 时只用 ContentBounds + 数据 transform。
 * 其他节点继续使用渲染几何 fallback。两条路径均不读取拖拽中的 wrapper 变换，避免循环。
 */
export function getRenderedNodeBounds({
	elementId,
	canvasWidth,
	canvasHeight,
	transform,
}: {
	elementId: string;
	canvasWidth: number;
	canvasHeight: number;
	transform: Transform;
}): RenderedNodeBounds | null {
	const registeredContentBounds = contentBoundsRegistry.get(elementId);
	if (registeredContentBounds) {
		return getTransformedContentBounds({
			contentBounds: registeredContentBounds,
			canvasWidth,
			canvasHeight,
			transform,
		});
	}
	const wrapper = registry.get(elementId);
	if (!wrapper) {
		return null;
	}
	wrapper.updateWorldMatrix(true, true);
	const content = wrapper.children[0] ?? wrapper;
	const localBox = getLocalContentBounds({ content, wrapper });
	if (!localBox) {
		return null;
	}

	const footprintW = localBox.max.x - localBox.min.x;
	const footprintH = localBox.max.y - localBox.min.y;
	if (footprintW <= 1e-6 || footprintH <= 1e-6) {
		return null;
	}
	const localCenterX = (localBox.min.x + localBox.max.x) / 2;
	const localCenterY = (localBox.min.y + localBox.max.y) / 2;
	const angle = (transform.rotate * Math.PI) / 180;
	const scaledX = localCenterX * transform.scaleX;
	const scaledY = localCenterY * transform.scaleY;

	return {
		cx:
			canvasWidth / 2 +
			transform.position.x +
			scaledX * Math.cos(angle) +
			scaledY * Math.sin(angle),
		cy:
			canvasHeight / 2 +
			transform.position.y +
			scaledX * Math.sin(angle) -
			scaledY * Math.cos(angle),
		width: Math.max(Math.abs(footprintW * transform.scaleX), 1),
		height: Math.max(Math.abs(footprintH * transform.scaleY), 1),
		rotation: transform.rotate,
	};
}

export function clearNodeRegistry(): void {
	registry.clear();
	contentBoundsRegistry.clear();
	notify();
}
