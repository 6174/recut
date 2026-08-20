/*
 * [INPUT]: 依赖五个 App 专属 Landing 模块与 Locale
 * [OUTPUT]: 对外提供 appLandingRegistry，将 app id 映射到真正独立的产品页组件
 * [POS]: app-landing 的静态注册边界；只分发，不承载共享内容或主题分支
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Locale } from "@/lib/i18n";
import { AudioStudioLanding } from "./audio-studio-landing";
import { CoverStudioLanding } from "./cover-studio-landing";
import { DepthAnythingLanding } from "./depth-anything-landing";
import { RemotionStudioLanding } from "./remotion-studio-landing";
import { VoxBrollLanding } from "./vox-broll-landing";
type Landing = React.ComponentType<{ locale: Locale }>;
export const appLandingRegistry: Record<string, Landing> = { "recut.audio-studio": AudioStudioLanding, "recut.cover-studio": CoverStudioLanding, "recut.depth-anything": DepthAnythingLanding, "recut.remotion-studio": RemotionStudioLanding, "recut.vox-broll": VoxBrollLanding };
