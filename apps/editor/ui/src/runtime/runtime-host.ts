/**
 * @recut/runtime 宿主导出（共享实例）。
 * 与宿主主包同一 React/R3F/three 实例：component-loader 把它注入 globalThis.__recutRuntime，
 * 组件 bundle 经 prelude blob 从该桥取用——永远单 React 实例。
 */
export { jsx, jsxs, Fragment } from "react/jsx-runtime";
export { useState, useMemo, useRef, useCallback, useEffect } from "react";
export { useThree } from "@react-three/fiber";
export * as THREE from "three";
export { useCanvasTexture } from "./texture";
export { anim } from "./anim";
export { useMotionTextSegments } from "./text-motion";
export { segmentText } from "./text-segmentation";
export { num, str, bool } from "./utils";
export { gsap } from "gsap";
export { useGSAP } from "@gsap/react";
export {
	useTimeline,
	useFrameContext,
	FrameTimeContext,
	MotionProgramContext,
	activeTimelines,
	activeMotionRuntimes,
	plugins,
	useMotionProgram,
	useMotionProgramContext,
} from "./timeline";
export type {
	FrameTime,
	TimelineSeekMode,
	UseTimelineOptions,
} from "./timeline";
export {
	MotionRuntime,
	MotionTargetRegistry,
	createDomMotionAdapter,
	createThreeTransformAdapter,
	createShaderUniformAdapter,
	selectMotionProgram,
	compileMotionProgram,
} from "./motion-runtime";
export type {
	MotionBlend,
	MotionKey,
	MotionProgram,
	MotionTargetAdapter,
	MotionTargetKind,
	MotionTrack,
	MotionValue,
	TransformTarget,
	ShaderUniformTarget,
	ShaderMaterialTarget,
} from "./motion-runtime";
export type { ParamDefinition, ParamValues } from "@/params";
export type { ComponentRenderContext, ComponentSurface, AnimApi } from "./types";
export type { MotionTextSegment, TextSegment, TextSegmentMode } from "./text-motion";
