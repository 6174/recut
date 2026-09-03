import { createContext, useContext } from "react";
import type * as THREE from "three";

/**
 * 场景纹理上下文：WorldScene 每帧把「底层内容」渲染进 WebGLRenderTarget，
 * 通过此 context 提供给全画布特效组件采样（glass / magnify 等）。
 * 特效组件位于 content group 之外，避免自递归。
 */
const SceneTextureContext = createContext<THREE.Texture | null>(null);

export { SceneTextureContext };

export function useSceneTexture(): THREE.Texture | null {
	return useContext(SceneTextureContext);
}
