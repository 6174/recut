/*
 * [INPUT]: 依赖 world-canvas/graph-theme（配色单一真源）
 * [OUTPUT]: 对外提供分组容器的几何/视觉常量与背景色板：GROUP_PADDING（内容内边距）/
 *           GROUP_MIN_SIZE（容器最小尺寸）/ GROUP_RADIUS（圆角）/
 *           GROUP_BACKGROUND_DEFAULT 与 GROUP_BACKGROUND_SWATCHES（面板预设底色）/
 *           GROUP_LAYOUT_LABELS（布局模式文案，面板与撤销标签共用）。
 * [POS]: lib/pomelo/world-canvas/group 的常量单一真源（渲染 / 命中 / 面板 / store 共用）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { GRAPH_COLORS } from "../graph-theme";

/** 组内容盒相对容器框的内边距（世界坐标）：标题栏之下、四周边距，也是 resize 不能小于的 bbox 外扩量。 */
export const GROUP_PADDING = 24;

/** 容器最小尺寸（世界坐标）：空组时也保持可点可拖。 */
export const GROUP_MIN_SIZE = 80;

/** 容器圆角。 */
export const GROUP_RADIUS = 14;

/** 默认底色（与 graph-theme 的 groupFill 一致，但存 hex 供 props 持久化）。 */
export const GROUP_BACKGROUND_DEFAULT = GRAPH_COLORS.groupFill;

/** 面板预设底色（浅色主题下也够区分；「透明」用空串表示无底色）。 */
export const GROUP_BACKGROUND_SWATCHES = [
  { value: "", label: "透明" },
  { value: "#2b2d31", label: "石墨" },
  { value: "#1f2a44", label: "暗蓝" },
  { value: "#243b2f", label: "暗绿" },
  { value: "#3a2a24", label: "暗棕" },
  { value: "#3a2440", label: "暗紫" },
] as const;

/** 布局模式：free = 不自动排布（自由摆放，仅记录最近一次布局）。 */
export type GroupLayoutMode = "free" | "grid" | "tree-down" | "tree-right";

export const GROUP_LAYOUT_LABELS: Record<GroupLayoutMode, string> = {
  free: "自由摆放",
  grid: "网格布局",
  "tree-down": "树形布局（从上到下）",
  "tree-right": "树形布局（从左到右）",
};
