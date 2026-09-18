/*
 * [INPUT]: 依赖 i18n 的 Locale；与 workspace-studio-dict 的 studio.template.{i}.* 按索引一一对应
 * [OUTPUT]: 对外提供每个 Studio 场景的表单 schema（text/textarea/select/assets + 双语 label/placeholder/options/kinds）与本地化辅助
 * [POS]: web/lib 的创作台场景表单真相；app/page.tsx 按场景索引取用，StudioScenarioDialog 渲染并组装提示词
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Locale } from "@/lib/i18n/locales";

type Localized = Record<Locale, string>;

export type StudioFieldType = "text" | "textarea" | "select" | "assets";

export type StudioAssetKind = "image" | "video" | "audio";

export type StudioFieldOption = {
  value: string;
  label: Localized;
};

export type StudioFieldDef = {
  /** 组装提示词时用于拼接的稳定键，不作为展示文案 */
  key: string;
  type: StudioFieldType;
  label: Localized;
  placeholder?: Localized;
  required?: boolean;
  options?: StudioFieldOption[];
  /** assets 字段允许的媒体类型，缺省 image/video */
  kinds?: StudioAssetKind[];
};

const zh = (text: string): Localized => ({ zh: text, en: text });

const PLATFORM_OPTIONS: StudioFieldOption[] = [
  { value: "douyin", label: { zh: "抖音", en: "Douyin" } },
  { value: "xiaohongshu", label: { zh: "小红书", en: "Xiaohongshu" } },
  { value: "shipinhao", label: { zh: "视频号", en: "WeChat Channels" } },
  { value: "bilibili", label: { zh: "B 站", en: "Bilibili" } },
  { value: "youtube", label: { zh: "YouTube", en: "YouTube" } },
  { value: "universal", label: { zh: "通用", en: "General" } },
];

const DURATION_OPTIONS: StudioFieldOption[] = [
  { value: "15s", label: { zh: "15 秒", en: "15 seconds" } },
  { value: "30s", label: { zh: "30 秒", en: "30 seconds" } },
  { value: "60s", label: { zh: "60 秒", en: "60 seconds" } },
  { value: "180s", label: { zh: "3 分钟", en: "3 minutes" } },
  { value: "custom", label: { zh: "其他（在补充里说明）", en: "Other (explain in notes)" } },
];

const ASPECT_OPTIONS: StudioFieldOption[] = ["9:16", "16:9", "1:1", "4:5"].map((value) => ({ value, label: zh(value) }));

const platformField = (required = false): StudioFieldDef => ({
  key: "platform",
  type: "select",
  label: { zh: "目标平台", en: "Target platform" },
  required,
  options: PLATFORM_OPTIONS,
});

const durationField = (required = false): StudioFieldDef => ({
  key: "duration",
  type: "select",
  label: { zh: "目标时长", en: "Target duration" },
  required,
  options: DURATION_OPTIONS,
});

const assetsField = (labelZh: string, labelEn: string, kinds: StudioAssetKind[]): StudioFieldDef => ({
  key: "assets",
  type: "assets",
  kinds,
  label: { zh: labelZh, en: labelEn },
});

// 与 STUDIO_TEMPLATE_COUNT 一一对应；索引即 studio.template.{index}.*。
export const STUDIO_SCENARIO_FIELDS: StudioFieldDef[][] = [
  // 0 把一段文字做成视频
  [
    { key: "script", type: "textarea", required: true, label: { zh: "脚本或正文", en: "Script or text" }, placeholder: { zh: "粘贴你的脚本、故事或文案…", en: "Paste your script, story or copy…" } },
    { key: "style", type: "text", label: { zh: "风格与情绪", en: "Style & mood" }, placeholder: { zh: "例如：温柔旁白、纪录片感", en: "e.g. gentle voiceover, documentary feel" } },
    durationField(),
  ],
  // 1 给现有视频补一些画面
  [
    { key: "topic", type: "textarea", required: true, label: { zh: "主题与现有素材", en: "Topic & existing footage" }, placeholder: { zh: "描述主题、已有主镜头或脚本…", en: "Describe the topic, existing master shots or script…" } },
    { key: "count", type: "text", label: { zh: "需要补几个画面", en: "How many shots" }, placeholder: { zh: "例如：5 个", en: "e.g. 5 shots" } },
    { key: "style", type: "text", label: { zh: "风格参考", en: "Style reference" }, placeholder: { zh: "例如：真实质感、冷色调", en: "e.g. realistic, cool tones" } },
    assetsField("参考画面", "Reference visuals", ["image", "video"]),
  ],
  // 2 做一支剪纸风格动画
  [
    { key: "topic", type: "textarea", required: true, label: { zh: "故事主题", en: "Story idea" }, placeholder: { zh: "想讲一个什么故事…", en: "What story do you want to tell…" } },
    durationField(),
    { key: "mood", type: "text", label: { zh: "想要的感觉", en: "Desired feeling" }, placeholder: { zh: "例如：温暖、俏皮", en: "e.g. warm, playful" } },
    assetsField("风格参考图", "Style reference image", ["image"]),
  ],
  // 3 给产品拍一条短片
  [
    { key: "product", type: "text", required: true, label: { zh: "产品", en: "Product" }, placeholder: { zh: "产品名称…", en: "Product name…" } },
    { key: "sellingPoints", type: "textarea", required: true, label: { zh: "卖点与受众", en: "Selling points & audience" }, placeholder: { zh: "核心卖点、目标人群…", en: "Core selling points, target audience…" } },
    { key: "context", type: "text", label: { zh: "发布场景", en: "Launch context" }, placeholder: { zh: "例如：新品上线、电商详情页", en: "e.g. launch, e-commerce page" } },
    assetsField("产品图", "Product images", ["image"]),
  ],
  // 4 做一支 Remotion 视频
  [
    { key: "topic", type: "textarea", required: true, label: { zh: "主题", en: "Topic" }, placeholder: { zh: "想讲清楚什么…", en: "What to explain…" } },
    { key: "style", type: "text", label: { zh: "风格", en: "Style" }, placeholder: { zh: "例如：清爽动态图形", en: "e.g. clean motion graphics" } },
    durationField(),
  ],
  // 5 把数据讲成一支视频
  [
    { key: "data", type: "textarea", required: true, label: { zh: "数据与观点", en: "Data & takeaway" }, placeholder: { zh: "粘贴数据，并写下要传达的结论…", en: "Paste the data and the conclusion to convey…" } },
    { key: "audience", type: "text", label: { zh: "受众", en: "Audience" }, placeholder: { zh: "例如：管理层、普通用户", en: "e.g. executives, general users" } },
    durationField(),
  ],
  // 6 拍一个产品介绍视频
  [
    { key: "product", type: "text", required: true, label: { zh: "产品", en: "Product" }, placeholder: { zh: "产品名称…", en: "Product name…" } },
    { key: "features", type: "textarea", required: true, label: { zh: "核心功能与使用方式", en: "Core features & usage" }, placeholder: { zh: "产品能做什么、怎么用…", en: "What it does and how it's used…" } },
    { key: "audience", type: "text", label: { zh: "目标用户", en: "Target users" }, placeholder: { zh: "例如：初次购买者、老用户", en: "e.g. first-time buyers, existing users" } },
    assetsField("产品图", "Product images", ["image"]),
  ],
  // 7 把一个人的故事剪成短片
  [
    { key: "person", type: "textarea", required: true, label: { zh: "人物与故事", en: "Person & story" }, placeholder: { zh: "他是谁、经历了什么…", en: "Who they are, what they went through…" } },
    { key: "footage", type: "text", label: { zh: "现有素材", en: "Existing footage" }, placeholder: { zh: "采访、日常片段…", en: "Interviews, everyday clips…" } },
    assetsField("现有素材", "Existing footage", ["image", "video"]),
    durationField(),
  ],
  // 8 给短视频想一个好开头
  [
    { key: "topic", type: "text", required: true, label: { zh: "主题", en: "Topic" }, placeholder: { zh: "短视频讲什么…", en: "What the short is about…" } },
    platformField(),
    { key: "audience", type: "text", label: { zh: "目标观众", en: "Target audience" }, placeholder: { zh: "例如：新手父母", en: "e.g. new parents" } },
  ],
  // 9 做一支教程演示视频
  [
    { key: "topic", type: "text", required: true, label: { zh: "教程主题", en: "Tutorial topic" }, placeholder: { zh: "教什么…", en: "What to teach…" } },
    { key: "steps", type: "textarea", required: true, label: { zh: "步骤", en: "Steps" }, placeholder: { zh: "按顺序写下关键步骤…", en: "List the key steps in order…" } },
    assetsField("画面素材", "Footage", ["image", "video"]),
    durationField(),
  ],
  // 10 做一段循环的氛围视频
  [
    { key: "scene", type: "text", required: true, label: { zh: "使用场景", en: "Usage context" }, placeholder: { zh: "例如：音乐背景、活动大屏", en: "e.g. music backdrop, event screen" } },
    { key: "mood", type: "text", label: { zh: "情绪关键词", en: "Mood keywords" }, placeholder: { zh: "例如：安静、流动、呼吸感", en: "e.g. calm, flowing, breathing" } },
    { key: "aspect", type: "select", label: { zh: "画幅", en: "Aspect ratio" }, options: ASPECT_OPTIONS },
    durationField(),
  ],
  // 11 把一段长视频剪成多条短视频
  [
    { key: "source", type: "textarea", required: true, label: { zh: "长视频素材或链接", en: "Long video or link" }, placeholder: { zh: "粘贴本地素材路径或视频链接…", en: "Paste a local path or video URL…" } },
    platformField(true),
    { key: "count", type: "text", label: { zh: "切几条", en: "Number of clips" }, placeholder: { zh: "例如：3–5 条", en: "e.g. 3–5 clips" } },
    { key: "clipDuration", type: "text", label: { zh: "每条时长", en: "Per-clip duration" }, placeholder: { zh: "例如：30–60 秒", en: "e.g. 30–60 seconds" } },
    assetsField("源视频", "Source video", ["video", "audio"]),
  ],
  // 12 克隆一支抖音 / YouTube 视频
  [
    { key: "reference", type: "textarea", required: true, label: { zh: "参考视频链接或素材", en: "Reference video or link" }, placeholder: { zh: "粘贴抖音 / YouTube 链接或本地素材…", en: "Paste a Douyin / YouTube link or local footage…" } },
    { key: "subject", type: "text", required: true, label: { zh: "要替换的主体", en: "Subject to swap in" }, placeholder: { zh: "换成我的…", en: "Swap in my…" } },
    assetsField("参考素材", "Reference footage", ["video", "image"]),
    platformField(),
    durationField(),
  ],
  // 13 用 World Canvas 克隆一个视频账号
  [
    { key: "account", type: "text", required: true, label: { zh: "账号主页链接或参考视频", en: "Account link or reference videos" }, placeholder: { zh: "粘贴账号主页或一批参考视频…", en: "Paste the account homepage or reference videos…" } },
    platformField(),
    { key: "goal", type: "text", label: { zh: "目标", en: "Goal" }, placeholder: { zh: "例如：涨粉、带货、个人 IP", en: "e.g. growth, sales, personal IP" } },
    assetsField("参考素材", "Reference footage", ["video", "image"]),
  ],
  // 14 创建一个长期的 IP 角色
  [
    { key: "character", type: "textarea", required: true, label: { zh: "角色设定", en: "Character brief" }, placeholder: { zh: "外貌、性格、声音、世界观…", en: "Appearance, personality, voice, world…" } },
    { key: "audience", type: "text", label: { zh: "目标受众", en: "Target audience" }, placeholder: { zh: "例如：年轻职场人", en: "e.g. young professionals" } },
    { key: "usage", type: "text", label: { zh: "使用场景", en: "Use cases" }, placeholder: { zh: "例如：口播、短剧、直播", en: "e.g. talking head, short drama, livestream" } },
    assetsField("角色参考图", "Character reference images", ["image"]),
  ],
  // 15 给账号做一套可复用的风格模板
  [
    { key: "account", type: "text", required: true, label: { zh: "账号定位", en: "Account positioning" }, placeholder: { zh: "账号讲什么、给谁看…", en: "What the account covers and for whom…" } },
    { key: "reference", type: "text", label: { zh: "参考视频", en: "Reference videos" }, placeholder: { zh: "想对齐的参考…", en: "References to align with…" } },
    { key: "style", type: "textarea", label: { zh: "想统一的风格", en: "Style to unify" }, placeholder: { zh: "开场、字幕、转场、配色、BGM…", en: "Opening, captions, transitions, palette, BGM…" } },
    assetsField("参考素材", "Reference footage", ["video", "image"]),
    platformField(),
  ],
];

export function localizedLabel(value: Localized, locale: Locale): string {
  return value[locale] ?? value.zh;
}
