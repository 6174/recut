/**
 * [INPUT]: 依赖 i18n 键类型。
 * [OUTPUT]: 对外提供 TextGroupId 与文本资源二级分类词表 TEXT_GROUPS。
 * [POS]: text 模块的分类单一真相源；文本样式预设与组合型文本组件共享同一组分类 id。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { I18nKey } from "@timeline/i18n";

export type TextGroupId =
	| "title"
	| "body"
	| "quote"
	| "label"
	| "list"
	| "annotation"
	| "stat"
	| "person"
	| "combo";

export interface TextGroupDef {
	id: TextGroupId;
	labelKey: I18nKey;
}

/** 文本面板左侧二级分类（顺序即展示顺序）。 */
export const TEXT_GROUPS: TextGroupDef[] = [
	{ id: "title", labelKey: "textLib.group.title" },
	{ id: "body", labelKey: "textLib.group.body" },
	{ id: "quote", labelKey: "textLib.group.quote" },
	{ id: "label", labelKey: "textLib.group.label" },
	{ id: "list", labelKey: "textLib.group.list" },
	{ id: "annotation", labelKey: "textLib.group.annotation" },
	{ id: "stat", labelKey: "textLib.group.stat" },
	{ id: "person", labelKey: "textLib.group.person" },
	{ id: "combo", labelKey: "textLib.group.combo" },
];
