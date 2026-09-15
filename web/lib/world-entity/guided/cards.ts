/*
 * [INPUT]: 无外部依赖（纯文本常量与拼装辅助）
 * [OUTPUT]: 对外提供三类「设定卡」的版式说明常量（CHARACTER/ENVIRONMENT/OBJECT_CARD_LAYOUT）与
 *   styleCardPreamble 辅助，供实体动作与媒体动作共用同一套排版提示词
 * [POS]: web/lib/world-entity/guided 的设定卡版式层；人物卡/环境卡/物体卡是 AI 生成里最常见的产出
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { MediaRef } from "./types";
import { refsLine } from "./context";

// 人物卡：对齐真实生产中的角色卡（信息栏 + 主视觉 + 三视图 + 细节/表情/剪影研究 + 引线标注）
export const CHARACTER_CARD_LAYOUT = `一张图内排版（严格保持人物一致性）：
① 信息栏：角色名（中文 + 拼音/英文）、角色定位、核心情绪、视觉标志、一句代表性台词；
② 中央主视觉：一张全身主图（可含半身）；
③ 人物三视图：正面 / 背面 / 侧面全身，比例、发型与服装严格一致；
④ 细节研究：耳饰、项链、眼睛、手部、服装材质等特写，并用引线标注关键特征文字（如「黑曜石耳钉」「银质项链」）；
⑤ 表情研究：4–6 格头部近景（平静 / 微笑 / 惊讶 / 冷峻…）；
⑥ 剪影 / 影视研究：全身剪影，检验轮廓识别度。`;

// 环境卡：信息栏 + establishing 全景 + 机位 + 细节 + 光影/时间 + 色卡
export const ENVIRONMENT_CARD_LAYOUT = `一张图内排版：
① 信息栏：场景名、场景定位、氛围、时间与天气；
② 主视觉：establishing 全景（决定空间关系）；
③ 机位：2–3 个角度（含一个反打），保持空间结构一致；
④ 细节研究：地面、墙面、道具、招牌等特写，并用引线标注；
⑤ 光影 / 时间变体：白天 / 黄昏 / 夜晚；
⑥ 色卡：主色与明暗阶（如需单独保存另记 role=color-card）。`;

// 物体卡：信息栏 + 多角度 + 细节 + 尺寸参照 + 状态变体
export const OBJECT_CARD_LAYOUT = `一张图内排版：
① 信息栏：名称、材质、来历 / 用途；
② 多角度：正 / 侧 / 背（或 3/4 视角）；
③ 细节研究：材质、纹样、铭文、磨损等特写，并用引线标注；
④ 尺寸参照：与参考物或人体比例对照；
⑤ 状态变体：崭新 / 陈旧 / 损坏。`;

export function stylePreamble(styleLock?: string): string {
  return styleLock?.trim() ? `风格（STYLE LOCK，逐字复用）：${styleLock.trim()}` : "风格沿用世界风格。";
}

export function cardRefsLine(refs: MediaRef[]): string {
  return refs.length ? `已有素材：${refsLine(refs)}（作为一致性参考，优先复用特征）。` : "";
}
