import { str, num } from "@recut/runtime";
import type { ComponentRenderContext } from "@recut/runtime";

export default {
  surface: "html",
  name: "Hello World",
  keywords: ["hello", "hello world", "欢迎", "标题"],
  inputs: [
    { key: "text", type: "text", default: "Hello World", label: "文案" },
    { key: "color", type: "color", default: "#ff5c39", label: "主色" },
    { key: "fontSize", type: "number", default: 150, min: 48, max: 360, step: 4, label: "字号" },
  ],
  getBaseSize: () => ({ width: 1080, height: 1920 }),
  // 为逐字入场保留一块稳定交互区；不让首帧的少数字符决定选择框。
  getContentBounds: () => ({ x: 0, y: 640, width: 1080, height: 640 }),
  render(ctx: ComponentRenderContext) {
    const { params, progress, anim } = ctx;
    const text = str(params.text, "Hello World");
    const color = str(params.color, "#ff5c39");
    const fontSize = num(params.fontSize, 150);
    const letters = text.split("");
    const chars = letters.map((ch, i) => {
      const u = Math.max(0, Math.min(1, progress * 1.6 - i * 0.06));
      const op = anim.lerp(0, 1, u);
      const ty = anim.lerp(80, 0, u);
      return `<span style="display:inline-block;opacity:${op.toFixed(3)};transform:translateY(${ty.toFixed(1)}px);">${ch}</span>`;
    }).join("");
    const glow = anim.pulse(progress, { speed: 1.2 }) * 18;
    const tagOp = anim.lerp(0, 1, Math.max(0, (progress - 0.4) * 2));
    return `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Helvetica Neue',Arial,sans-serif;gap:40px;background:transparent;">
      <div style="color:${color};font-weight:900;font-size:${fontSize}px;letter-spacing:6px;text-shadow:0 0 ${glow.toFixed(1)}px ${color}88;text-align:center;line-height:1.1;">${chars}</div>
      <div style="color:rgba(255,255,255,0.85);font-size:56px;font-weight:600;letter-spacing:16px;opacity:${tagOp.toFixed(3)};text-align:center;">RECUT</div>
    </div>`;
  },
};
