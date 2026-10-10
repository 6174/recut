/*
 * [INPUT]: 依赖 locales.ts 的 Locale 与 lucide-react 的图标类型
 * [OUTPUT]: 场景（Scenario）的共享契约与字段构造器：Localized、Scenario/ScenarioField、文本/下拉/素材字段工厂、平台/时长/画幅通用选项与 localizedLabel
 * [POS]: web/lib/scenarios 的类型与字段真相；每个场景文件据此声明自身，scenario-gallery / scenario-dialog 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

import type { Locale } from "@/lib/i18n/locales";

export type Localized = Record<Locale, string>;

export type ScenarioFieldType = "text" | "textarea" | "select" | "assets" | "world";

export type ScenarioAssetKind = "image" | "video" | "audio";

export type ScenarioFieldOption = {
  value: string;
  label: Localized;
};

export type ScenarioField = {
  /** 组装提示词时用于拼接的稳定键，不作为展示文案 */
  key: string;
  type: ScenarioFieldType;
  label: Localized;
  placeholder?: Localized;
  required?: boolean;
  options?: ScenarioFieldOption[];
  /** assets 字段允许的媒体类型，缺省 image/video */
  kinds?: ScenarioAssetKind[];
};

/**
 * 一个「用户需求层」创作场景：面向用户自身的需求（做什么、给谁看），
 * 而非底层能力。声明自身全部信息（图标 / 双语标题·说明·提示词 / 表单字段），
 * 新增场景只需新增一个文件并登记到 index.ts。
 *
 * 表单有两条路径，按复杂度选择：
 * - 简单场景：只声明 `fields`，由 ScenarioDialog 渲染通用结构化表单；
 * - 复杂/特殊场景：额外导出 `Form` 组件接管弹框主体（含自身操作区），做差异化设计。
 */
export type Scenario = {
  /** 稳定标识，用于列表 key 与埋点 */
  id: string;
  icon: LucideIcon;
  title: Localized;
  description: Localized;
  prompt: Localized;
  /** 声明式表单字段；仅在没有 `Form` 时生效 */
  fields: ScenarioField[];
  /**
   * 可选的自定义表单组件（弹框主体，含操作区）。提供后完全取代基于 `fields` 的通用表单，
   * 用于需要专属交互/视觉的场景；仍在 ScenarioDialog 的弹框壳与标题头内渲染。
   */
  Form?: ComponentType<ScenarioFormProps>;
};

/** 自定义场景表单组件接收的宿主契约。 */
export type ScenarioFormProps = {
  apiBase: string;
  /** 当前工作台语言，便于自定义表单本地化 */
  locale: Locale;
  /** 所属场景（标题 / 说明 / 提示词 / 字段声明） */
  scenario: Scenario;
  /** 用组装好的草稿文本回填 AI 输入框（绝不自动发送） */
  onSubmit: (text: string) => void;
  /** 关闭弹框 */
  onClose: () => void;
};

export function localizedLabel(value: Localized, locale: Locale): string {
  return value[locale] ?? value.zh;
}

const zh = (text: string): Localized => ({ zh: text, en: text });

export const PLATFORM_OPTIONS: ScenarioFieldOption[] = [
  { value: "douyin", label: { zh: "抖音", en: "Douyin" } },
  { value: "xiaohongshu", label: { zh: "小红书", en: "Xiaohongshu" } },
  { value: "shipinhao", label: { zh: "视频号", en: "WeChat Channels" } },
  { value: "bilibili", label: { zh: "B 站", en: "Bilibili" } },
  { value: "youtube", label: { zh: "YouTube", en: "YouTube" } },
  { value: "universal", label: { zh: "通用", en: "General" } },
];

export const DURATION_OPTIONS: ScenarioFieldOption[] = [
  { value: "15s", label: { zh: "15 秒", en: "15 seconds" } },
  { value: "30s", label: { zh: "30 秒", en: "30 seconds" } },
  { value: "60s", label: { zh: "60 秒", en: "60 seconds" } },
  { value: "180s", label: { zh: "3 分钟", en: "3 minutes" } },
  { value: "custom", label: { zh: "其他（在补充里说明）", en: "Other (explain in notes)" } },
];

export const ASPECT_OPTIONS: ScenarioFieldOption[] = ["9:16", "16:9", "1:1", "4:5"].map((value) => ({ value, label: zh(value) }));

export function platformField(required = false): ScenarioField {
  return {
    key: "platform",
    type: "select",
    label: { zh: "目标平台", en: "Target platform" },
    required,
    options: PLATFORM_OPTIONS,
  };
}

export function durationField(required = false): ScenarioField {
  return {
    key: "duration",
    type: "select",
    label: { zh: "目标时长", en: "Target duration" },
    required,
    options: DURATION_OPTIONS,
  };
}

export function assetsField(labelZh: string, labelEn: string, kinds: ScenarioAssetKind[]): ScenarioField {
  return {
    key: "assets",
    type: "assets",
    kinds,
    label: { zh: labelZh, en: labelEn },
  };
}

/** 可选的已有世界引用：复用其中的作品与资产（组装为 `<creation_world>` 标签随草稿交 AI，绝不复制世界内容）。 */
export function worldField(labelZh = "已有世界（可选）", labelEn = "Existing world (optional)"): ScenarioField {
  return {
    key: "world",
    type: "world",
    label: { zh: labelZh, en: labelEn },
  };
}
