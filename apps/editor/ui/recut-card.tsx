import { str } from "@recut/runtime";
import type { ComponentRenderContext } from "@recut/runtime";

export default {
  surface: "react",
  name: "Recut Card",
  keywords: ["recut", "卡片", "intro", "介绍"],
  inputs: [
    { key: "title", type: "text", default: "Recut", label: "标题" },
    { key: "subtitle", type: "text", default: "视频创作平台", label: "副标题" },
    { key: "accent", type: "color", default: "#ff5c39", label: "强调色" },
  ],
  getBaseSize: () => ({ width: 720, height: 720 }),
  // 卡片含入场位移与阴影，选择框采用全程稳定 footprint。
  getContentBounds: () => ({ x: 10, y: 90, width: 700, height: 540 }),
  render(ctx: ComponentRenderContext) {
    const { params, progress, anim } = ctx;
    const title = str(params.title, "Recut");
    const subtitle = str(params.subtitle, "视频创作平台");
    const accent = str(params.accent, "#ff5c39");
    const enter = anim.lerp(0, 1, Math.min(1, progress * 2.2));
    const lift = anim.lerp(40, 0, Math.min(1, progress * 2.2));
    const p = anim.pulse(progress, { speed: 1 });
    const features = ["时间线剪辑", "AI 短片", "组件化视觉"];
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Helvetica Neue',Arial,sans-serif", opacity: enter, transform: `translateY(${lift.toFixed(1)}px)` }}>
        <div style={{ width: 620, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 40, padding: "48px 40px", boxShadow: `0 ${(26 + p * 10).toFixed(0)}px 70px rgba(0,0,0,0.45)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 30 }}>
            <div style={{ width: 84, height: 84, borderRadius: 24, background: accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 46, fontWeight: 900, color: "#0b1020" }}>R</div>
            <div>
              <div style={{ fontSize: 88, fontWeight: 900, color: "#ffffff", lineHeight: 1 }}>{title}</div>
              <div style={{ fontSize: 42, color: "rgba(255,255,255,0.7)", marginTop: 10 }}>{subtitle}</div>
            </div>
          </div>
          <div style={{ width: "100%", height: 4, borderRadius: 2, background: accent, opacity: 0.8, marginBottom: 28 }} />
          {features.map((f, i) => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 0", borderBottom: i < features.length - 1 ? "1px solid rgba(255,255,255,0.1)" : "none" }}>
              <div style={{ width: 14, height: 14, borderRadius: 7, background: accent, opacity: 0.45 + 0.55 * p }} />
              <div style={{ fontSize: 44, fontWeight: 600, color: "rgba(255,255,255,0.92)" }}>{f}</div>
            </div>
          ))}
        </div>
      </div>
    );
  },
};
