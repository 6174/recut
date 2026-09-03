import type { TProject } from "@/project/types";
import type { MediaAsset } from "@/media/types";

/** Demo 模式的全局状态：无 Recut 宿主时由 /demo.html 注入。 */
export let demoProject: TProject | null = null;
export let demoAssets: MediaAsset[] = [];

export function isDemoMode(): boolean {
	return typeof window !== "undefined" && (window as any).__recutDemo === true;
}

export function setDemoState({
	project,
	assets,
}: {
	project: TProject | null;
	assets: MediaAsset[];
}) {
	demoProject = project;
	demoAssets = assets;
}
