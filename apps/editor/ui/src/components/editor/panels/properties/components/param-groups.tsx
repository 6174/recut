/**
 * [INPUT]: 依赖参数的 group 契约与 Section 折叠容器。
 * [OUTPUT]: 对外提供 ParamGroups，按语义分组渲染可折叠参数字段。
 * [POS]: properties/components 的分组编排器，被元素与组件属性面板共同复用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { ReactNode } from "react";
import type { ParamDefinition, ParamGroup } from "@/params";
import {
	Section,
	SectionContent,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { t, useRecutLocale, type I18nKey } from "@/i18n";

const GROUP_TITLES: Record<ParamGroup, I18nKey> = {
	background: "prop.group.background",
	stroke: "prop.group.stroke",
};

export function ParamGroups<TParam extends ParamDefinition>({
	params,
	sectionKey,
	renderParam,
}: {
	params: readonly TParam[];
	sectionKey: string;
	renderParam: (param: TParam) => ReactNode;
}) {
	const { ungrouped, groups } = groupParams({ params });
	const locale = useRecutLocale();

	return (
		<>
			{ungrouped.length > 0 && (
				<SectionContent className="pt-3 pb-4">
					<SectionFields>{ungrouped.map(renderParam)}</SectionFields>
				</SectionContent>
			)}
			{groups.map(([group, groupParams]) => (
				<Section
					key={group}
					collapsible
					defaultOpen={group !== "background"}
					className="border-t"
					sectionKey={`${sectionKey}:${group}`}
				>
					<SectionHeader>
						<SectionTitle>{t(locale, GROUP_TITLES[group])}</SectionTitle>
					</SectionHeader>
					<SectionContent className="pt-3 pb-4">
						<SectionFields>{groupParams.map(renderParam)}</SectionFields>
					</SectionContent>
				</Section>
			))}
		</>
	);
}

function groupParams<TParam extends ParamDefinition>({
	params,
}: {
	params: readonly TParam[];
}): {
	ungrouped: TParam[];
	groups: Array<[ParamGroup, TParam[]]>;
} {
	const ungrouped: TParam[] = [];
	const grouped = new Map<ParamGroup, TParam[]>();

	for (const param of params) {
		if (!param.group) {
			ungrouped.push(param);
			continue;
		}
		const group = grouped.get(param.group) ?? [];
		group.push(param);
		grouped.set(param.group, group);
	}

	return { ungrouped, groups: Array.from(grouped.entries()) };
}
