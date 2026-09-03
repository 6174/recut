import * as THREE from "three";
import { anim, componentsRegistry } from "@/runtime";
import { HtmlObject } from "@/runtime/components/html-object";
import type { World, WorldObject } from "@/runtime/types";
import type { ResolvedLayer } from "./render-model";

/** 组件图层 → R3F group 的注册表，供合成器把组件渲染进 layerRT。 */
export type ComponentGroupRegistry = Map<string, THREE.Group>;

function toWorldTransform(layer: ResolvedLayer): WorldObject["transform"] {
	return {
		position: {
			x: layer.transform.position.x,
			y: layer.transform.position.y,
			z: layer.transform.position.z,
		},
		scaleX: layer.transform.scaleX,
		scaleY: layer.transform.scaleY,
		rotationZ: layer.transform.rotate,
	};
}

/**
 * 组件舞台：在 R3F 主场景中挂载所有组件图层（组件即对象，完整 geometry/material/shader）。
 * 合成器逐层把它们渲染进 layerRT 后再走混合/特效管线。
 */
export function ComponentStage({
	layers,
	registry,
	width,
	height,
}: {
	layers: ResolvedLayer[];
	registry: ComponentGroupRegistry;
	width: number;
	height: number;
}) {
	const world: World = {
		id: "editor-stage",
		width,
		height,
		fps: 30,
		duration: 0,
		environment: { background: "#000000" },
		objects: [],
	};
	const componentLayers = layers.filter(
		(layer) =>
			layer.kind === "component" &&
			layer.component &&
			componentsRegistry.has(layer.component.componentId),
	);

	return (
		<>
			<ambientLight intensity={0.6} />
			<directionalLight position={[5, 5, 10]} intensity={1.2} />
			{componentLayers.map((layer) => {
				const component = layer.component;
				if (!component || !componentsRegistry.has(component.componentId)) {
					return null;
				}
				const definition = componentsRegistry.get(component.componentId);
				const Render = definition.render;
				const object: WorldObject = {
					id: layer.id,
					kind: "component",
					componentId: component.componentId,
					name: definition.name,
					startTime: 0,
					duration: 0,
					params: component.params,
					transform: toWorldTransform(layer),
					renderOrder: 0,
				};
				const progress = 0;
				const isHtmlSurface =
					definition.surface === "html" || definition.surface === "react";
				return (
					<group
						key={layer.id}
						ref={(group: THREE.Group | null) => {
							if (group) registry.set(layer.id, group);
							else registry.delete(layer.id);
						}}
					>
						{isHtmlSurface ? (
							<HtmlObject
								definition={definition}
								ctx={{
									world,
									object,
									params: component.params,
									time: component.localTime,
									localTime: component.localTime,
									progress,
									anim,
								}}
							/>
						) : (
							<Render
								world={world}
								object={object}
								params={component.params}
								time={component.localTime}
								localTime={component.localTime}
								progress={progress}
								anim={anim}
							/>
						)}
					</group>
				);
			})}
		</>
	);
}
