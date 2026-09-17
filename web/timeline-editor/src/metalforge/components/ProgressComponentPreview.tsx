import { useMemo } from "react";
import ProgressBar, { type ProgressBarColors, type ProgressBarProps } from "../generated/ProgressBar";
import type { EffectSchema } from "../types";

interface ProgressComponentPreviewProps {
  effect: EffectSchema;
  values: Record<string, unknown>;
}

function hex(values: Record<string, unknown>, effect: EffectSchema, key: string): string {
  const v = values[key];
  if (typeof v === "string" && v.startsWith("#")) return v;
  const p = effect.params.find((x) => x.key === key);
  return p && typeof p.default === "string" ? p.default : "#000000";
}

// Official web deliverable (imports/web__ProgressBar.tsx) mounted live, driven
// by the same param panel values where they map.
export function ProgressComponentPreview({ effect, values }: ProgressComponentPreviewProps) {
  const styleIndex = useMemo(() => {
    const p = effect.params.find((x) => x.key === "style");
    if (!p || p.type !== "select") return 0;
    const v = values.style;
    const idx =
      typeof v === "string" ? (p.options ?? []).findIndex((o) => o.value === v) : -1;
    return Math.max(0, idx);
  }, [effect, values.style]);

  const manual = values.autoplay === "manual";
  const progress = manual && typeof values.progress === "number" ? values.progress : -1;

  const colors: ProgressBarColors = {
    track: hex(values, effect, "background"),
    deep: hex(values, effect, "color1"),
    mid: hex(values, effect, "color2"),
    glow: hex(values, effect, "color3"),
    bright: hex(values, effect, "color4"),
    core: hex(values, effect, "color5"),
    trail: hex(values, effect, "color6"),
    trailHot: hex(values, effect, "color7"),
  };

  const props: ProgressBarProps = {
    progress,
    style: styleIndex,
    colors,
    title: "SYNCING LIBRARY",
    subtitle: "PREPARING YOUR FILES",
    showsContent: true,
  };

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 p-8">
      <div className="w-full max-w-[760px]" style={{ color: hex(values, effect, "titleColor") }}>
        <ProgressBar {...props} />
      </div>
      <p className="font-mono text-[11px] text-white/35">
        官方导出组件 imports/web__ProgressBar.tsx · 实时挂载 · 面板参数即 props
      </p>
    </div>
  );
}
