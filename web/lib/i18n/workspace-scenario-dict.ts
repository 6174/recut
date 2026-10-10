/*
 * [INPUT]: 依赖 locales.ts 的 Locale
 * [OUTPUT]: 工作台「创作需求场景」入口与表单的逐语言字典：场景区标题/说明、卡片 aria、表单文案；en 必须覆盖 zh 全部 key（Record<keyof typeof zh, string> 编译期保证）
 * [POS]: web/lib/i18n 的 scenario 命名空间；合并进 workspaceDictionary，scenario-gallery 与 scenario-dialog 消费（各场景自身的标题/说明/提示词在 lib/scenarios 内联）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Locale } from "./locales";

const zh = {
  "scenario.section.title": "从你的需求开始",
  "scenario.section.desc": "挑一个最接近你目标的场景，填好关键信息，AI 会带着它开始。",
  "scenario.card.aria": "从「{title}」开始",

  // 场景表单弹框
  "scenario.form.subtitle": "填好下面几项，AI 会带着这些信息开始。",
  "scenario.form.briefHeading": "创作需求",
  "scenario.form.required": "必填",
  "scenario.form.missing": "请先填写必填项。",
  "scenario.form.referenceHint": "支持输入 @ 引用素材、世界和角色。",
  "scenario.form.submit": "交给 AI 开始",
  "scenario.form.cancel": "取消",
  "scenario.form.close": "关闭表单",
  "scenario.form.pickAssets": "从资源库选择",
  "scenario.form.removeAsset": "移除素材",
  "scenario.form.pickWorld": "选择栏目 World（可选）",
  "scenario.form.removeWorld": "移除 World",
} as const;

const en: Record<keyof typeof zh, string> = {
  "scenario.section.title": "Start from your need",
  "scenario.section.desc": "Pick the scenario closest to your goal, fill in the essentials, and the AI starts with it.",
  "scenario.card.aria": "Start with \"{title}\"",

  // Scenario form dialog
  "scenario.form.subtitle": "Answer a few fields and the AI will start with them.",
  "scenario.form.briefHeading": "Creative brief",
  "scenario.form.required": "Required",
  "scenario.form.missing": "Please fill in the required fields first.",
  "scenario.form.referenceHint": "Type @ to reference assets, worlds and characters.",
  "scenario.form.submit": "Hand off to AI",
  "scenario.form.cancel": "Cancel",
  "scenario.form.close": "Close form",
  "scenario.form.pickAssets": "Choose from library",
  "scenario.form.removeAsset": "Remove asset",
  "scenario.form.pickWorld": "Choose a series World (optional)",
  "scenario.form.removeWorld": "Remove World",
};

export const scenarioZh = zh;
export const scenarioEn = en;
export type ScenarioDictionary = Record<Locale, typeof zh>;
