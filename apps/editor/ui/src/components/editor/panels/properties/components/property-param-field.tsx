/**
 * [INPUT]: 依赖 params 的参数契约、属性草稿 hook 与基础表单控件。
 * [OUTPUT]: 对外提供 PropertyParamField，统一渲染组件和元素参数编辑器。
 * [POS]: properties/components 的叶子字段渲染器，负责把关键帧入口与可编辑参数对齐。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useState } from "react";
import type {
	ParamDefinition,
	NumberParamDefinition,
	ParamValue,
} from "@/params";
import { getParamLabel, getSelectOptionLabel, isParamKeyframable } from "@/params";
import {
	formatNumberForDisplay,
	getFractionDigitsForStep,
	snapToStep,
} from "@/utils/math";
import { SectionField } from "@/components/section";
import { NumberField } from "@/components/ui/number-field";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ColorPicker } from "@/components/ui/color-picker";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { usePropertyDraft } from "../hooks/use-property-draft";
import { KeyframeToggle } from "./keyframe-toggle";
import { Textarea } from "@/components/ui/textarea";
import { FontPicker } from "@/components/ui/font-picker";
import { t, useRecutLocale } from "@/i18n";

export function PropertyParamField({
	param,
	value,
	onPreview,
	onCommit,
	keyframe,
}: {
	param: ParamDefinition;
	value: ParamValue;
	onPreview: (value: ParamValue) => void;
	onCommit: () => void;
	keyframe?: {
		isActive: boolean;
		isDisabled: boolean;
		onToggle: () => void;
	};
}) {
	const locale = useRecutLocale();
	const label = getParamLabel({ param, locale });
	return (
		<SectionField
			label={label}
			trailing={
				keyframe && isParamKeyframable({ param }) ? (
					<KeyframeToggle
						isActive={keyframe.isActive}
						isDisabled={keyframe.isDisabled}
						title={t(locale, "prop.toggleKeyframe", {
							label: label.toLowerCase(),
						})}
						onToggle={keyframe.onToggle}
					/>
				) : undefined
			}
		>
			<ParamInput
				param={param}
				value={value}
				onPreview={onPreview}
				onCommit={onCommit}
			/>
		</SectionField>
	);
}

function ParamInput({
	param,
	value,
	onPreview,
	onCommit,
}: {
	param: ParamDefinition;
	value: ParamValue;
	onPreview: (value: ParamValue) => void;
	onCommit: () => void;
}) {
	const locale = useRecutLocale();
	if (param.type === "number") {
		return (
			<NumberParamField
				param={param}
				value={typeof value === "number" ? value : Number(value)}
				onPreview={onPreview}
				onCommit={onCommit}
			/>
		);
	}

	if (param.type === "boolean") {
		return (
			<div className="flex justify-end">
				<Switch
					checked={Boolean(value)}
					onCheckedChange={(checked) => {
						onPreview(checked);
						onCommit();
					}}
				/>
			</div>
		);
	}

	if (param.type === "select") {
		return (
			<Select
				value={String(value)}
				onValueChange={(selected) => {
					onPreview(selected);
					onCommit();
				}}
			>
				<SelectTrigger className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{param.options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{getSelectOptionLabel({ option, locale })}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		);
	}

	if (param.type === "color") {
		return (
			<ColorPicker
				value={String(value).replace(/^#/, "").toUpperCase()}
				onChange={(color) => onPreview(`#${color}`)}
				onChangeEnd={(color) => {
					onPreview(`#${color}`);
					onCommit();
				}}
			/>
		);
	}

	if (param.type === "text") {
		return (
			<StringParamField
				param={param}
				value={String(value)}
				onPreview={onPreview}
				onCommit={onCommit}
				multiline
			/>
		);
	}

	if (param.type === "font") {
		return (
			<FontParamField
				param={param}
				value={String(value)}
				onPreview={onPreview}
				onCommit={onCommit}
			/>
		);
	}

	return null;
}

/**
 * 字符串参数输入：输入框作为主源（本地 draft 即时显示），
 * 预览按 60ms 防抖，失焦 flush + commit——打字不依赖 store/渲染 round-trip。
 */
function StringParamField({
	param,
	value,
	onPreview,
	onCommit,
	multiline = false,
}: {
	param: ParamDefinition;
	value: string;
	onPreview: (value: ParamValue) => void;
	onCommit: () => void;
	multiline?: boolean;
}) {
	const draft = usePropertyDraft({
		displayValue: value,
		parse: (input) => input,
		onPreview: (nextValue) => onPreview(nextValue),
		onCommit,
		previewDelayMs: 60,
	});

	if (multiline) {
		return (
			<Textarea
				value={draft.displayValue}
				onFocus={draft.onFocus}
				onChange={draft.onChange}
				onBlur={draft.onBlur}
			/>
		);
	}

	return (
		<Input
			value={draft.displayValue}
			onFocus={draft.onFocus}
			onChange={draft.onChange}
			onBlur={draft.onBlur}
		/>
	);
}

function FontParamField({
	value,
	onPreview,
	onCommit,
}: {
	param: ParamDefinition;
	value: string;
	onPreview: (value: ParamValue) => void;
	onCommit: () => void;
}) {
	return (
		<FontPicker
			defaultValue={value}
			onValueChange={(nextValue) => {
				onPreview(nextValue);
				onCommit();
			}}
		/>
	);
}

function NumberParamField({
	param,
	value,
	onPreview,
	onCommit,
}: {
	param: NumberParamDefinition;
	value: number;
	onPreview: (value: number) => void;
	onCommit: () => void;
}) {
	const locale = useRecutLocale();
	const label = getParamLabel({ param, locale });
	const { min, max, step, displayMultiplier = 1 } = param;
	const displayValue = value * displayMultiplier;
	const [previewDisplayValue, setPreviewDisplayValue] = useState<
		number | null
	>(null);
	const clampDisplayValue = (nextDisplayValue: number) =>
		Math.max(
			min,
			max !== undefined ? Math.min(max, nextDisplayValue) : nextDisplayValue,
		);

	useEffect(() => {
		setPreviewDisplayValue(null);
	}, [displayValue]);

	const previewFromDisplay = (displayVal: number) => {
		const clamped = clampDisplayValue(
			snapToStep({ value: displayVal, step }),
		);
		setPreviewDisplayValue(clamped);
		onPreview(clamped / displayMultiplier);
	};

	const maxFractionDigits = getFractionDigitsForStep({ step });

	const draft = usePropertyDraft({
		displayValue: formatNumberForDisplay({
			value: displayValue,
			maxFractionDigits,
		}),
		parse: (input) => {
			const parsed = parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return clampDisplayValue(snapToStep({ value: parsed, step }));
		},
		onPreview: previewFromDisplay,
		onCommit,
	});

	const handleReset = () => {
		setPreviewDisplayValue(null);
		onPreview(param.default);
		onCommit();
	};
	const isRange = max !== undefined;
	const effectiveDisplayValue = previewDisplayValue ?? displayValue;
	const fieldDisplayValue =
		previewDisplayValue === null
			? draft.displayValue
			: formatNumberForDisplay({
					value: previewDisplayValue,
					maxFractionDigits,
				});

	return (
		<div className="flex min-w-0 items-center gap-2">
			<NumberField
				className={isRange ? "w-20 shrink-0" : undefined}
				label={label}
				icon={param.shortLabel}
				value={fieldDisplayValue}
				dragSensitivity="slow"
				scrubStep={step}
				isDefault={value === param.default}
				onFocus={draft.onFocus}
				onChange={draft.onChange}
				onBlur={draft.onBlur}
				onScrub={previewFromDisplay}
				onScrubEnd={onCommit}
				onReset={handleReset}
			/>
			{isRange && (
				<Slider
					aria-label={`${label} ${t(locale, "prop.range")}`}
					className="min-w-0 flex-1"
					value={[clampDisplayValue(effectiveDisplayValue)]}
					min={min}
					max={max}
					step={step}
					onValueChange={([nextValue]) => previewFromDisplay(nextValue)}
					onValueCommit={() => onCommit()}
				/>
			)}
		</div>
	);
}
