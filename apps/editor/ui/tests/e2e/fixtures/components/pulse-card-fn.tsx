import type { AnimApi, ContentBounds } from "@recut/runtime";

/**
 * 纯函数组件形态（react surface）：default export 是函数组件，
 * props = ctx 字段 + inputs 展开；元数据挂在函数静态属性上。
 * 与 pulse-card.tsx（定义对象）视觉等价，用于验证 loader 归一化与 props 映射。
 */
function PulseCard({
  progress = 0,
  text = "Recut",
  color = "#0ea5e9",
  anim,
}: {
  progress?: number;
  text?: string;
  color?: string;
  anim?: AnimApi;
}) {
  const p = anim ? anim.pulse(progress, { speed: 1.5 }) : 0;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif" }}>
      <div style={{ background: color, color: "#fff", fontWeight: 700, fontSize: 32, padding: "16px 28px", borderRadius: 16, opacity: 0.7 + 0.3 * p, transform: `translateY(${(p * -10).toFixed(2)}px)` }}>
        {text}
      </div>
    </div>
  );
}

PulseCard.inputs = [
  { key: "text", type: "text", default: "Recut", label: "文案" },
  { key: "color", type: "color", default: "#0ea5e9", label: "主色" },
];
PulseCard.getBaseSize = () => ({ width: 512, height: 512 });
PulseCard.getContentBounds = (): ContentBounds => ({ x: 140, y: 206, width: 232, height: 100 });

export default PulseCard;
