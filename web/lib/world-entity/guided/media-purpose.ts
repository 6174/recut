/*
 * [INPUT]: 依赖 guided/types 的 MediaPurpose/GenerationRefRole/MediaModality
 * [OUTPUT]: 对外提供 inferMediaPurpose（属性名/元素名/素材名 → purpose/role，最长关键词、分源优先级）与
 *   MEDIA_PURPOSE_LEXICON（词表真相，供 UI 解释与未来扩展）
 * [POS]: web/lib/world-entity/guided 的纯推断层；无 React/无 I/O，可单测（RFC §5.8.1）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { GenerationRefRole, MediaModality, MediaPurpose } from "./types";

type LexiconEntry = { id: string; role?: GenerationRefRole; keywords: string[] };

// 关键词匹配前归一：去空白、去常见前缀（"属性 · "）、全角转半角不必，统一 lower-case 用于英文
const ELEMENT_NAME_PREFIX = /^属性\s*[·:：]\s*/;

export function normalizeMediaLabel(value?: string): string {
  if (!value) return "";
  return value.replace(ELEMENT_NAME_PREFIX, "").replace(/\s+/g, "").trim().toLowerCase();
}

// 词表（RFC §5.8.1）：顺序无关；命中冲突时取最长关键词
export const MEDIA_PURPOSE_LEXICON: LexiconEntry[] = [
  { id: "storyboard", role: "storyboard", keywords: ["分镜", "分镜表", "故事板", "storyboard"] },
  { id: "turnaround", role: "character", keywords: ["三视图", "转身", "正侧背", "turnaround"] },
  { id: "expression", role: "character", keywords: ["表情", "情绪", "神态", "expression", "face"] },
  { id: "wardrobe", role: "character", keywords: ["服装", "穿搭", "服饰", "造型", "配饰", "衣服", "outfit", "costume"] },
  { id: "hair", role: "character", keywords: ["发型", "发色", "hair"] },
  { id: "appearance", role: "character", keywords: ["外貌", "外观", "形象", "立绘", "容貌", "脸", "头像", "半身", "全身", "appearance", "portrait", "avatar"] },
  { id: "color-card", role: "color-card", keywords: ["色卡", "配色", "调色", "palette", "colorcard"] },
  { id: "environment", role: "environment", keywords: ["场景", "环境", "地点", "全局图", "全景", "空镜", "背景", "environment", "scene", "establishing"] },
  { id: "prop", role: "prop", keywords: ["道具", "物件", "饰品", "武器", "prop"] },
  { id: "material", keywords: ["材质", "纹理", "面料", "material", "texture"] },
  { id: "lighting", role: "environment", keywords: ["光影", "灯光", "打光", "lighting"] },
  { id: "style-ref", role: "style-ref", keywords: ["风格", "画风", "美术", "mood", "style"] },
  { id: "motion", role: "motion-ref", keywords: ["动作", "表演", "动态", "运动", "motion"] },
  { id: "voice", role: "voice", keywords: ["音色", "声音", "配音", "台词", "voice"] },
  { id: "music", role: "music", keywords: ["音乐", "配乐", "bgm", "主题曲", "music"] },
  { id: "sfx", role: "sfx", keywords: ["音效", "环境音", "拟音", "sfx"] },
  { id: "detail", role: "prop", keywords: ["细节", "特写", "局部", "纹样", "detail", "closeup"] },
];

type Source = MediaPurpose["source"];

function matchIn(haystack: string, source: Source): MediaPurpose | null {
  if (!haystack) return null;
  let best: { entry: LexiconEntry; keyword: string } | null = null;
  for (const entry of MEDIA_PURPOSE_LEXICON) {
    for (const keyword of entry.keywords) {
      const needle = keyword.toLowerCase();
      if (!haystack.includes(needle)) continue;
      if (!best || keyword.length > best.keyword.length) best = { entry, keyword };
    }
  }
  if (!best) return null;
  return {
    id: best.entry.id,
    ...(best.entry.role ? { role: best.entry.role } : {}),
    // 归一后命中：按关键词长度给一个简单置信度（越具体越高），封顶 0.95
    confidence: Math.min(0.95, 0.5 + best.keyword.length * 0.08),
    matched: best.keyword,
    source,
  };
}

// 分源优先级：attr-label > element-name > asset-name > fallback
export function inferMediaPurpose(input: {
  attrLabel?: string;
  elementName?: string;
  assetName?: string;
  modality?: MediaModality;
}): MediaPurpose {
  const sources: Array<{ source: Source; value: string }> = [
    { source: "attr-label", value: input.attrLabel ?? "" },
    { source: "element-name", value: input.elementName ?? "" },
    { source: "asset-name", value: input.assetName ?? "" },
  ];
  for (const { source, value } of sources) {
    const hit = matchIn(normalizeMediaLabel(value), source);
    if (hit) return hit;
  }
  return fallbackPurpose(input.modality);
}

export function fallbackPurpose(modality?: MediaModality): MediaPurpose {
  return {
    id: "unknown",
    confidence: 0,
    matched: "",
    source: "fallback",
    ...(modality === "audio" ? { role: "voice" as GenerationRefRole } : {}),
  };
}
