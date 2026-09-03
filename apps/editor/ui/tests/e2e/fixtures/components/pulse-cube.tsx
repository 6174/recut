import { str } from "@recut/runtime";
import type { ComponentRenderContext } from "@recut/runtime";

export default {
  surface: "r3f",
  name: "Pulse Cube",
  keywords: ["cube", "方块"],
  inputs: [
    { key: "color", type: "color", default: "#ff2244", label: "主色" },
  ],
  render(ctx: ComponentRenderContext) {
    const { params, progress, anim } = ctx;
    const color = str(params.color, "#ff2244");
    const size = 100 + anim.pulse(progress) * 40;
    return <mesh><boxGeometry args={[size, size, size]} /><meshBasicMaterial color={color} /></mesh>;
  },
};
