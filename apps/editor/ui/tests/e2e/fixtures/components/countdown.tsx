import { str } from "@recut/runtime";
import type { ComponentRenderContext } from "@recut/runtime";

export default {
  surface: "html",
  name: "Countdown",
  keywords: ["countdown", "倒计时"],
  inputs: [
    { key: "color", type: "color", default: "#0ea5e9", label: "主色" },
  ],
  render(ctx: ComponentRenderContext) {
    const { params, progress, anim } = ctx;
    const color = str(params.color, "#0ea5e9");
    const n = Math.ceil((1 - progress) * 5);
    const scale = 1 + anim.pulse(progress, { speed: 2 }) * 0.1;
    return `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-family:sans-serif;color:${color};font-weight:800;font-size:120px;transform:scale(${scale.toFixed(3)});">${n}</div>`;
  },
};
