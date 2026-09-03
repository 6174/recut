/**
 * [INPUT]: 元素 MotionProgram、Three group 子树、统一 EffectDefinition registry。
 * [OUTPUT]: ElementShaderHost；把支持 source texture 的 Effect pass 安装到元素纹理材质。
 * [POS]: 元素 Effect 的唯一渲染承载层；不支持 source texture 的材质保持原样。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useCallback, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MotionTargetRegistry, selectMotionProgram } from "../motion-runtime";
import { useMotionProgram } from "../timeline";
import { PASSTHROUGH_VERTEX } from "../shader-effects/shared/glsl";
import {
	createShaderEffectAdapter,
	createShaderEffectInstances,
	getShaderEffect,
	resolveShaderEffectImplementation,
} from "./registry";
import type { ShaderEffectImplementation, ShaderEffectInstance } from "./types";

type TextureBinding = {
	mesh: THREE.Mesh;
	original: THREE.Material;
	replacement: THREE.ShaderMaterial;
	instance: ShaderEffectInstance;
	implementation: ShaderEffectImplementation;
	sourceTexture: THREE.Texture;
};

function mappedTexture(material: THREE.Material): THREE.Texture | null {
	// ElementCapture 当前的 canonical 输入是 Plane/Text/Image/Video 的 2D
	// MeshBasicMaterial。Transmission、Environment、Lightformer 等场景材质即使
	// 暴露 map/envMap，也不属于元素纹理，不能被替换成 sampler2D pass。
	if ((material as THREE.MeshBasicMaterial).isMeshBasicMaterial !== true) return null;
	const map = (material as THREE.MeshBasicMaterial).map;
	if (!(map instanceof THREE.Texture)) return null;
	if ((map as THREE.CubeTexture).isCubeTexture === true) return null;
	return map;
}

function installTextureEffect(
	mesh: THREE.Mesh,
	material: THREE.Material,
	instance: ShaderEffectInstance,
	implementation: ShaderEffectImplementation,
): TextureBinding | null {
	const texture = mappedTexture(material);
	if (!texture || !implementation.fragmentShader || !implementation.createTextureUniforms) return null;
	const geometry = mesh.geometry;
	geometry.computeBoundingBox();
	const size = geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, 1);
	const aspect = size.y ? size.x / size.y : 1;
	const uniforms = implementation.createTextureUniforms({ instance, texture, aspect });
	const source = material as THREE.MeshBasicMaterial;
	const replacement = new THREE.ShaderMaterial({
		name: `RecutEffect:${instance.id}`,
		vertexShader: implementation.vertexShader ?? PASSTHROUGH_VERTEX,
		fragmentShader: implementation.fragmentShader,
		uniforms,
		transparent: source.transparent,
		depthTest: source.depthTest,
		depthWrite: source.depthWrite,
		side: source.side,
		blending: source.blending,
		toneMapped: false,
	});
	replacement.opacity = source.opacity;
	replacement.userData.recutMotionUniforms = Object.fromEntries(
		Object.entries(instance.uniforms).map(([name, uniform]) => [`${instance.id}.${name}`, uniform]),
	);
	replacement.userData.recutMotionShader = replacement;
	mesh.material = replacement;
	return { mesh, original: material, replacement, instance, implementation, sourceTexture: texture };
}

export function ElementShaderHost({ groupRef, program }: { groupRef: RefObject<THREE.Group | null>; program: NonNullable<ReturnType<typeof selectMotionProgram>> | undefined }) {
	const effectKey = useMemo(
		() => [...new Set((program?.tracks ?? []).flatMap((track) => track.path.match(/^effects\.([\w-]+)\./)?.[1] ?? []))].sort().join("|"),
		[program],
	);
	const instances = useMemo(() => createShaderEffectInstances(effectKey ? effectKey.split("|") : []), [effectKey]);
	const createRegistry = useCallback(() => {
		const registry = new MotionTargetRegistry();
		registry.register(createShaderEffectAdapter(instances));
		return registry;
	}, [instances]);
	const invalidate = useThree((state) => state.invalidate);
	useMotionProgram(program, createRegistry);
	const textureBindings = useRef(new Map<THREE.Mesh, TextureBinding>());
	const sync = useCallback(() => {
		const group = groupRef.current;
		if (!group) return;
		const seenMeshes = new Set<THREE.Mesh>();
		group.traverse((node) => {
			const mesh = node as THREE.Mesh;
			if (!(mesh instanceof THREE.Mesh)) return;
			seenMeshes.add(mesh);
			const material = Array.isArray(mesh.material) ? null : mesh.material;
			if (!material) return;
			const existing = textureBindings.current.get(mesh);
			if (existing) {
				const texture = mappedTexture(existing.original) ?? mappedTexture(material);
				if (mesh.material !== existing.replacement) mesh.material = existing.replacement;
				if (texture && texture !== existing.sourceTexture) {
					existing.sourceTexture = texture;
					existing.replacement.uniforms.uMap.value = texture;
				}
				return;
			}
			const textureEntry = instances.flatMap((instance) => {
				const definition = getShaderEffect(instance.id);
				const implementation = definition && resolveShaderEffectImplementation(definition, { kind: "texture", hasSourceTexture: true, canPatchMaterial: false });
				return implementation ? [{ instance, implementation }] : [];
			}).find(({ implementation }) => Boolean(mappedTexture(material) && implementation.createTextureUniforms));
			if (textureEntry) {
				const binding = installTextureEffect(mesh, material, textureEntry.instance, textureEntry.implementation);
				if (binding) {
					textureBindings.current.set(mesh, binding);
					invalidate();
				}
				return;
			}
		});
		for (const [mesh, binding] of textureBindings.current) {
			if (seenMeshes.has(mesh)) continue;
			mesh.material = binding.original;
			binding.replacement.dispose();
			textureBindings.current.delete(mesh);
		}
	}, [groupRef, instances, invalidate]);
	useLayoutEffect(() => {
		sync();
		return () => {
			for (const binding of textureBindings.current.values()) { binding.mesh.material = binding.original; binding.replacement.dispose(); }
			textureBindings.current.clear();
		};
	}, [sync]);
	useFrame(() => {
		sync();
		for (const binding of textureBindings.current.values()) binding.implementation.updateTextureUniforms?.({ instance: binding.instance, uniforms: binding.replacement.uniforms });
	});
	return null;
}
