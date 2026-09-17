import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
	createShaderUniformAdapter,
	MotionTargetRegistry,
	selectMotionProgram,
} from "../../../motion-runtime";
import { useMotionProgram, useMotionProgramContext } from "../../../timeline";

type UniformMap = Record<string, THREE.IUniform>;

/**
 * 着色器特效的原始 sRGB 颜色：跳过 ColorManagement 的 sRGB→linear 转换。
 * WGSL 移植的程序化 shader（网格/壁纸等）直接输出颜色到 sRGB 画布
 * （ShaderMaterial 无 colorspace_fragment 回编），uniform 必须携带
 * 未转换的 sRGB 值，否则画面偏暗数倍（暗色内容经 H.264 后不可见）。
 */
export function rawSrgbColor(value: string): THREE.Color {
	return new THREE.Color().setStyle(value, THREE.LinearSRGBColorSpace);
}

/**
 * 创建并持有 material 实例与 uniforms：
 * - `build`：创建 uniform 对象（内容纹理/静态几何值），只在挂载时运行一次；
 * - `update`：每次渲染后写入最新派生值（时间、强度、镜头位置…）。
 * 动态值必须放进 `update`，build 只放生命周期内不变的纹理/几何；避免每帧 new Uniform。
 * ref 仅在提交后可用，因此更新放在 useLayoutEffect，保证第一帧即生效。
 */
export const useMaterialUniforms = <T extends THREE.ShaderMaterial>(
	build: () => UniformMap,
	update: (uniforms: UniformMap) => void,
) => {
	const material = useRef<T>(null);
	const buildRef = useRef(build);
	const updateRef = useRef(update);
	buildRef.current = build;
	updateRef.current = update;
	const uniforms = useMemo(() => buildRef.current(), []);
	const sourceProgram = useMotionProgramContext();
	const program = useMemo(
		() => {
			const selected = selectMotionProgram(sourceProgram, "shader");
			if (!selected) return undefined;
			// 一个 shader 预设可以复用到不同特效；只保留当前 material 真正声明的
			// uniform，避免把“不兼容预设”变成组件错误边界。
			const tracks = selected.tracks.filter((track) => {
				const match = track.path.match(/^uniforms\.([A-Za-z_][\w]*)/);
				return Boolean(match && uniforms[match[1]]);
			});
			return tracks.length ? { ...selected, tracks } : undefined;
		},
		[sourceProgram, uniforms],
	);
	const createRegistry = useCallback(() => {
		const registry = new MotionTargetRegistry();
		registry.register(createShaderUniformAdapter({ "material:main": { uniforms } }));
		return registry;
	}, [uniforms]);
	useLayoutEffect(() => {
		if (!material.current) return;
		updateRef.current(material.current.uniforms);
	});
	// 基础参数先写入，预设随后 seek；这样 shader 预设是对组件现有 uniform
	// 的局部覆盖，而不是被组件每帧 update 覆盖掉。
	useMotionProgram(program, createRegistry);
	return { material, uniforms };
};
