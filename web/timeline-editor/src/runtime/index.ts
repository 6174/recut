export { ComponentRegistry, componentsRegistry } from "./component-registry";
export { getComponentName } from "./component-registry";
export type { ComponentLoadState, ComponentModule } from "./component-registry";
export { registerBuiltinComponents, isComponentElementSelectable } from "./components";
export {
	ensureComponent,
	ensureRuntimeHost,
	installComponentResolver,
	loadComponentDefinition,
	loadComponentModule,
	validateComponentDefinition,
} from "./component-loader";
export type {
	ComponentResolveResult,
	ComponentResolver,
} from "./component-loader";
export { useComponentDefinition } from "./use-component-definition";
export { buildWorld } from "./build-world";
export { VisualRuntime } from "./world-runtime";
export { WorldRenderer } from "./world-renderer";
export { WorldScene } from "./world-scene";
export { anim } from "./anim";
export { useMotionTextSegments } from "./text-motion";
export { segmentText } from "./text-segmentation";
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
export type * from "./types";
export type { MotionTextSegment, TextSegment, TextSegmentMode } from "./text-motion";
export {
	SHADER_EFFECTS,
	getShaderEffect,
	createShaderEffectInstances,
	ElementShaderHost,
} from "./shader-effects";
export type {
	ShaderEffectId,
	ShaderEffectDefinition,
	ShaderEffectInstance,
	ShaderEffectStage,
	ShaderUniforms,
} from "./shader-effects";
export {
	MOTION_PRESETS,
	getMotionPreset,
	compileMotionBinding,
	compileElementMotion,
	applyMotionPreset,
	removeMotionPreset,
	replaceMotionPreset,
	updateMotionPresetParams,
} from "./motion-presets";
export type {
	MotionSlot,
	MotionBinding,
	ElementMotion,
	TextMotionBinding,
	MotionPresetDefinition,
	MotionPresetStatus,
	MotionPresetCategory,
	PresetChannel,
	PresetParameter,
} from "./motion-presets";
