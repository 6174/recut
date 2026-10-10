/*
 * [INPUT]: 依赖 scenarios/ 目录下每个需求场景文件与 types.ts
 * [OUTPUT]: 汇总创作场景为有序 Scenario 列表 SCENARIOS，并转出类型与 localizedLabel
 * [POS]: web/lib/scenarios 的对外入口；scenario-gallery 渲染、scenario-dialog 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { startSeries } from "./scenarios/01-start-series";
import { seriesEpisode } from "./scenarios/02-series-episode";
import { ipCharacter } from "./scenarios/03-ip-character";
import { cloneVideo } from "./scenarios/04-clone-video";
import type { Scenario } from "./types";

export * from "./types";

// 对齐 video GTM：核心承诺「一个栏目，持续出片」→ 人群 A（主题→成片，可选沿用栏目 World）→ 人群 B（IP 角色）→ 辅助钩子（复刻参考视频）。
export const SCENARIOS: Scenario[] = [
  startSeries,
  seriesEpisode,
  ipCharacter,
  cloneVideo,
];
