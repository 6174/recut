export { metalforgeWallpaperComponent, metalforgeWallpaperStylePreset } from "./wallpaper-bg";

import type { ComponentDefinition } from "../../types";
import { metalforgeWallpaperComponent, metalforgeWallpaperStylePreset } from "./wallpaper-bg";

/** MetalForge 内置组件（P0：wallpaper 案例）。 */
export const METALFORGE_COMPONENTS: ComponentDefinition[] = [
	metalforgeWallpaperComponent,
];

/** select style 联动 preset：面板在切换这些 select 时 merge 返回值进 params。 */
export const METALFORGE_SELECT_PRESETS: Record<string, (value: string) => Record<string, unknown>> = {
	"mf.bg.wallpaper:style": metalforgeWallpaperStylePreset,
};
