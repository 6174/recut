/*
 * [INPUT]: 依赖 locales.ts 的 Locale
 * [OUTPUT]: 工作台 Studio 首页 Header 与每日灵感的逐语言字典；en 必须覆盖 zh 全部 key（Record<keyof typeof zh, string> 编译期保证）
 * [POS]: web/lib/i18n 的 studio 命名空间；合并进 workspaceDictionary，app/page.tsx 的 Studio 与 WebGL hero 消费；创作场景（模板/表单/首访）文案已迁往 workspace-scenario-dict 与 lib/scenarios
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Locale } from "./locales";

// 每日灵感的条目数：app/page.tsx 按此遍历命名空间 key（studio.inspiration.{i}）。
export const STUDIO_INSPIRATION_COUNT = 20;

const zh = {
  "studio.placeholder": "创作台",

  // 每日灵感（内容面，按日期稳定轮换）
  "studio.inspiration.0": "今天，镜头先于语言，让画面替你说出未尽的话。",
  "studio.inspiration.1": "把时间剪开一条缝，光就会从那里透进来。",
  "studio.inspiration.2": "一帧是一念，把念想连成故事。",
  "studio.inspiration.3": "每个故事都值得一个耐心的开始。",
  "studio.inspiration.4": "别急着回答，先让画面安静一会儿。",
  "studio.inspiration.5": "光影落下的地方，就是叙事的起点。",
  "studio.inspiration.6": "好故事不是被发现的，是被剪辑出来的。",
  "studio.inspiration.7": "从第一秒开始，让观看变成一场呼吸。",
  "studio.inspiration.8": "灵感是一阵风，剪进画面，它就停住了。",
  "studio.inspiration.9": "把日常拍成诗的，不是技巧，是目光。",
  "studio.inspiration.10": "空白也是内容，留白处有回声。",
  "studio.inspiration.11": "让节奏慢一点，情绪就会自己长出来。",
  "studio.inspiration.12": "你在意的细节，就是观众动容的瞬间。",
  "studio.inspiration.13": "今天的素材里，藏着你明天的代表作。",
  "studio.inspiration.14": "声音先到，画面随后抵达。",
  "studio.inspiration.15": "把想法落到时间轴上，它才算真正开始。",
  "studio.inspiration.16": "色彩会说话，情绪有形状。",
  "studio.inspiration.17": "好的开头是一句邀请，观众不会拒绝。",
  "studio.inspiration.18": "每一个转场，都是写给下个镜头的情书。",
  "studio.inspiration.19": "记录世界，或者创造它，都从这一帧开始。",

  // WebGL 英雄区渲染错误
  "studio.hero.texture.error": "无法创建 WebGL 磨砂纹理。",
  "studio.hero.glow.error": "无法创建 WebGL 光晕纹理。",
} as const;

const en: Record<keyof typeof zh, string> = {
  "studio.placeholder": "Studio",

  // Daily inspiration (content; rotates on a stable day-based cycle)
  "studio.inspiration.0": "Today, let the lens speak before words — let the frame say what remains unsaid.",
  "studio.inspiration.1": "Cut a slit in time and the light will come pouring through.",
  "studio.inspiration.2": "A frame is a thought; stitch thoughts into a story.",
  "studio.inspiration.3": "Every story deserves a patient beginning.",
  "studio.inspiration.4": "Don't rush to answer — let the image sit quiet for a moment.",
  "studio.inspiration.5": "Where light and shadow fall is where your narrative begins.",
  "studio.inspiration.6": "Great stories aren't found — they're cut into being.",
  "studio.inspiration.7": "From the very first second, let watching become breathing.",
  "studio.inspiration.8": "Inspiration is a breeze; cut it into the frame and it stops to stay.",
  "studio.inspiration.9": "What turns the everyday into poetry isn't technique — it's your eye.",
  "studio.inspiration.10": "Emptiness is content too; in the negative space, there's an echo.",
  "studio.inspiration.11": "Slow the rhythm and emotion will grow on its own.",
  "studio.inspiration.12": "The details you care about are the moments that move your audience.",
  "studio.inspiration.13": "Hidden in today's footage is tomorrow's signature work.",
  "studio.inspiration.14": "Sound arrives first; the picture follows.",
  "studio.inspiration.15": "An idea only truly begins once it lands on the timeline.",
  "studio.inspiration.16": "Color speaks, emotion has a shape.",
  "studio.inspiration.17": "A good opening is an invitation no viewer will refuse.",
  "studio.inspiration.18": "Every transition is a love letter to the next shot.",
  "studio.inspiration.19": "Whether you record the world or create it, it all starts with this frame.",

  // WebGL hero rendering errors
  "studio.hero.texture.error": "Couldn't create the WebGL frosted texture.",
  "studio.hero.glow.error": "Couldn't create the WebGL glow texture.",
};

export const studioZh = zh;
export const studioEn = en;
export type StudioDictionary = Record<Locale, typeof zh>;
