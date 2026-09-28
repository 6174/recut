/*
 * [INPUT]: 依赖 lib/marketing-worlds 的 MarketingWorld（构建期经 props 注入的 CDN 世界观投影）
 * [OUTPUT]: 对外提供官网首页「案例」区块的数据模型 MarketingCase、确定性占位色调与 buildMarketingCases(worlds)——
 *   把真实 World 映射为「一条由该世界观生成的成片」，并预留 CASE_VIDEO_SOURCES 覆盖表供真实成片就位
 * [POS]: web/lib 的官网案例数据派生层；不发请求、不读工作台状态；真实视频只改 CASE_VIDEO_SOURCES，不改 UI
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { MarketingWorld } from "@/lib/marketing-worlds";

/** 无真实封面时的确定性渐变色调（tone → 线性渐变在组件侧消费）。 */
export type MarketingCaseTone = "forest" | "night" | "sand" | "sunset" | "teal" | "violet";

export type MarketingCase = {
  id: string;
  worldId: string;
  /** 案例标题（当前即所属 World 名称）。 */
  title: string;
  /** 发布者（World 的 provenance.author），案例卡作者行使用。 */
  author: string;
  /** World 类型 id（由消费方经 worlds.type.* 本地化）。 */
  typeLabel: string;
  /** 成片封面；为空时消费方渲染 tone 渐变占位。 */
  poster: string;
  tone: MarketingCaseTone;
  /** 真实成片地址；为空时播放器展示 poster 占位。 */
  videoUrl: string;
  /** 完整 World，供播放器「世界观画布」一栏复用其只读画布投影。 */
  world: MarketingWorld;
};

/**
 * 真实成片就位后：把 URL 填到这里（key 为 World id）即可播放真实视频，无需改动任何组件。
 * 例：{ "pgc.xiaohuige": "https://cdn.recut.video/cases/xiaohuige.mp4" }
 */
export const CASE_VIDEO_SOURCES: Record<string, string> = {};

const TONES: MarketingCaseTone[] = ["sunset", "teal", "violet", "sand", "night", "forest"];

export function buildMarketingCases(worlds: MarketingWorld[], limit = 9): MarketingCase[] {
  return worlds.slice(0, limit).map((world, index) => ({
    id: world.id,
    worldId: world.id,
    title: world.name,
    author: world.author,
    typeLabel: world.type,
    poster: world.coverUrl || world.images[0] || "",
    tone: TONES[index % TONES.length],
    videoUrl: CASE_VIDEO_SOURCES[world.id] ?? "",
    world,
  }));
}
