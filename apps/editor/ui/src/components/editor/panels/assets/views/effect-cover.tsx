/**
 * [INPUT]: 依赖特效定义的识别色（ComponentDefinition.color，来自 runtime 的 EFFECT_COLORS）。
 * [OUTPUT]: 对外提供 EffectCoverPreview，特效卡片在素材库中的静态封面。
 * [POS]: assets/views 的特效封面；复用 motion-presets-tab 的封面视觉语言
 *      （135° 对角渐变 + 斜向高光 + 左下角 PREVIEW 标记），按特效识别色生成渐变，
 *      替代原先「深色底 + 发光圆点」的占位封面。纯 CSS、离线、确定性。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { CSSProperties } from "react";
import { cn } from "@/utils/ui";

/** slate-950（#020617）：渐变暗端，与 motion presets 封面的 to-slate-950 一致。 */
const SLATE_950: [number, number, number] = [2, 6, 23];

function parseHex({ hex }: { hex: string }): [number, number, number] | null {
	let value = hex.trim().replace(/^#/, "");
	if (value.length === 3) value = [...value].map((ch) => ch + ch).join("");
	if (!/^[0-9a-f]{6}$/i.test(value)) return null;
	const n = Number.parseInt(value, 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** 将颜色按比例向 slate-950 压暗，模拟 `from-<color>/70 to-slate-950` 的 alpha 叠加效果。 */
function mixTowardSlate950({ hex, amount }: { hex: string; amount: number }): string {
	const rgb = parseHex({ hex });
	if (!rgb) return "#020617";
	const to2 = (channel: number, other: number) =>
		Math.round(channel * (1 - amount) + other * amount).toString(16).padStart(2, "0");
	return `#${to2(rgb[0], SLATE_950[0])}${to2(rgb[1], SLATE_950[1])}${to2(rgb[2], SLATE_950[2])}`;
}

/**
 * 特效封面：识别色对角渐变（亮端为识别色压暗 30%、暗端落入 slate-950），
 * 叠加与 motion presets 相同的斜向高光带，左下角固定 PREVIEW 标记。
 */
export function EffectCoverPreview({
	color,
	className,
}: {
	color?: string;
	className?: string;
}) {
	const accent = color ?? "#64748b";
	const background: CSSProperties = {
		backgroundImage: `linear-gradient(135deg, ${mixTowardSlate950({ hex: accent, amount: 0.3 })} 0%, ${mixTowardSlate950({ hex: accent, amount: 0.58 })} 55%, #020617 100%)`,
	};

	return (
		<div aria-hidden="true" className={cn("relative flex size-full items-end overflow-hidden", className)} style={background}>
			<span className="absolute inset-0 opacity-50 [background-image:linear-gradient(135deg,transparent_35%,rgba(255,255,255,.32)_36%,transparent_48%,transparent_62%,rgba(255,255,255,.18)_63%,transparent_74%)]" />
			<span className="relative px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-white/80">
				Preview
			</span>
		</div>
	);
}
