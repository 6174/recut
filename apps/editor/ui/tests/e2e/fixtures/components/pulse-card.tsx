import { str } from "@recut/runtime";
import type { ComponentRenderContext, ContentBounds } from "@recut/runtime";

export default {
  surface: "react",
  name: "Pulse Card",
  keywords: ["card", "卡片"],
  inputs: [
    { key: "text", type: "text", default: "Recut", label: "文案" },
    { key: "color", type: "color", default: "#0ea5e9", label: "主色" },
  ],
  // 交互框覆盖入场上移的完整卡片范围；不依赖每帧 alpha 像素扫描。
  getContentBounds: (): ContentBounds => ({ x: 140, y: 206, width: 232, height: 100 }),
  render(ctx: ComponentRenderContext) {
    const { params, progress, anim } = ctx;
    const text = str(params.text, "Recut");
    const color = str(params.color, "#0ea5e9");
    const p = anim.pulse(progress, { speed: 1.5 });
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif" }}>
        <div style={{ background: color, color: "#fff", fontWeight: 700, fontSize: 32, padding: "16px 28px", borderRadius: 16, opacity: 0.7 + 0.3 * p, transform: `translateY(${(p * -10).toFixed(2)}px)` }}>
          {text}
        </div>
      </div>
    );
  },
};
