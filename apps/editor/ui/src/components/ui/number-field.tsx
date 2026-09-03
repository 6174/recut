/**
 * [INPUT]: 依赖基础按钮、焦点锁和 math 约束能力。
 * [OUTPUT]: 对外提供支持直接输入、标签拖拽、步长吸附与默认值复原的 NumberField。
 * [POS]: components/ui 的通用数值控件，被属性面板、速度、网格和画布设置复用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { cn } from "@/utils/ui";
import { t, useRecutLocale } from "@/i18n";
import { clamp } from "@/utils/math";
import { useRef, useState, useLayoutEffect, type ComponentProps } from "react";
import { useFocusLock } from "@/hooks/use-focus-lock";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowTurnBackwardIcon } from "@hugeicons/core-free-icons";

const SUFFIX_GAP_PX = 6;

const DRAG_SENSITIVITIES = {
	default: 1,
	slow: 0.5,
} as const;

type DragSensitivity = "default" | "slow";

type ScrubRange = {
	from: number;
	to: number;
	pixelsPerUnit: number;
};

type ScrubClamp = {
	min?: number;
	max?: number;
};

function clampScrubValue({
	value,
	min,
	max,
}: {
	value: number;
	min?: number;
	max?: number;
}): number {
	if (min != null && max != null) return clamp({ value, min, max });
	if (min != null) return Math.max(min, value);
	if (max != null) return Math.min(max, value);
	return value;
}

function getActiveRange({
	value,
	direction,
	ranges,
}: {
	value: number;
	direction: number;
	ranges: readonly ScrubRange[];
}): ScrubRange | undefined {
	return ranges.find((range) =>
		direction > 0
			? value >= range.from && value < range.to
			: value > range.from && value <= range.to,
	);
}

function scrubAcrossRanges({
	startValue,
	pixelDelta,
	ranges,
	min,
	max,
}: {
	startValue: number;
	pixelDelta: number;
	ranges: readonly ScrubRange[];
	min?: number;
	max?: number;
}): number {
	let currentValue = clampScrubValue({ value: startValue, min, max });
	let remainingPixels = pixelDelta;

	while (remainingPixels !== 0) {
		const direction = Math.sign(remainingPixels);

		const range = getActiveRange({ value: currentValue, direction, ranges });
		if (!range) break;

		const boundary = direction > 0 ? range.to : range.from;
		const pixelsToBoundary =
			Math.abs(boundary - currentValue) * range.pixelsPerUnit;

		if (Math.abs(remainingPixels) <= pixelsToBoundary) {
			currentValue += remainingPixels / range.pixelsPerUnit;
			break;
		}

		currentValue = boundary;
		remainingPixels -= direction * pixelsToBoundary;
	}

	return clampScrubValue({ value: currentValue, min, max });
}

interface NumberFieldProps
	extends Omit<ComponentProps<"input">, "size" | "type"> {
	/** 字段语义标签；未显式传 icon 时，自动生成可拖拽的短标识。 */
	label?: string;
	icon?: React.ReactNode;
	suffix?: string;
	suffixClassName?: string;
	dragSensitivity?: DragSensitivity;
	scrubRanges?: readonly ScrubRange[];
	scrubClamp?: ScrubClamp;
	onScrub?: (value: number) => void;
	onScrubEnd?: () => void;
	allowExpressions?: boolean;
	/** 每个拖拽刻度代表的数值变化；未设置时保留连续拖拽。 */
	scrubStep?: number;
	onReset?: () => void;
	isDefault?: boolean;
}

function NumberField({
	className,
	label,
	icon,
	suffix,
	suffixClassName,
	disabled,
	dragSensitivity = "default",
	scrubRanges,
	scrubClamp,
	onScrub,
	onScrubEnd,
	value,
	allowExpressions = true,
	scrubStep,
	onKeyDown,
	onFocus,
	onBlur,
	onMouseDown,
	onReset,
	isDefault = false,
	ref,
	...props
}: NumberFieldProps & { ref?: React.Ref<HTMLInputElement> }) {
	const locale = useRecutLocale();
	const iconRef = useRef<HTMLButtonElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const ghostRef = useRef<HTMLSpanElement>(null);
	const startValueRef = useRef(0);
	const cumulativeDeltaRef = useRef(0);
	const [isInputFocused, setIsInputFocused] = useState(false);
	const [suffixLeft, setSuffixLeft] = useState(0);
	const ghostValue = Array.isArray(value) ? value.join(", ") : String(value ?? "");
	const scrubHandle = icon ?? (label ? getNumberIdentifier({ label }) : undefined);

	useLayoutEffect(() => {
		if (!suffix) {
			setSuffixLeft(0);
			return;
		}
		if (!ghostRef.current || !inputRef.current) return;
		if (ghostRef.current.textContent !== ghostValue) {
			ghostRef.current.textContent = ghostValue;
		}
		const paddingLeft =
			parseFloat(getComputedStyle(inputRef.current).paddingLeft) || 0;
		setSuffixLeft(paddingLeft + ghostRef.current.offsetWidth);
	}, [ghostValue, suffix]);

	const { containerRef: wrapperRef } = useFocusLock<HTMLDivElement>({
		isActive: isInputFocused,
		onDismiss: () => inputRef.current?.blur(),
		cursor: "text",
		allowSelector: "input, textarea, [contenteditable]",
	});

	const handleIconPointerDown = (event: React.PointerEvent) => {
		if (!onScrub || disabled || event.button !== 0) return;
		const parsed = parseFloat(String(value ?? "0"));
		startValueRef.current = Number.isNaN(parsed) ? 0 : parsed;
		cumulativeDeltaRef.current = 0;
		let hasReceivedFirstMove = false;
		iconRef.current?.requestPointerLock();

		const handlePointerMove = (moveEvent: PointerEvent) => {
			// first movementX after pointer lock often contains a bogus warp delta
			if (!hasReceivedFirstMove) {
				hasReceivedFirstMove = true;
				return;
			}
			cumulativeDeltaRef.current += moveEvent.movementX;
			const rawValue = scrubRanges
				? scrubAcrossRanges({
						startValue: startValueRef.current,
						pixelDelta: cumulativeDeltaRef.current,
						ranges: scrubRanges,
						min: scrubClamp?.min,
						max: scrubClamp?.max,
					})
				: startValueRef.current +
					cumulativeDeltaRef.current * DRAG_SENSITIVITIES[dragSensitivity];
			const newValue =
				scrubStep && scrubStep > 0 && !scrubRanges
					? startValueRef.current +
						Math.round(
							(rawValue - startValueRef.current) / scrubStep,
						) * scrubStep
					: rawValue;
			onScrub(newValue);
		};

		const handlePointerUp = () => {
			document.removeEventListener("pointermove", handlePointerMove);
			document.removeEventListener("pointerup", handlePointerUp);
			document.exitPointerLock();
			onScrubEnd?.();
		};

		document.addEventListener("pointermove", handlePointerMove);
		document.addEventListener("pointerup", handlePointerUp);
	};

	const canScrub = Boolean(scrubHandle && onScrub);

	const inputNode = (
		<input
			type={allowExpressions ? "text" : "number"}
			inputMode={allowExpressions ? "decimal" : undefined}
			ref={inputRef}
			disabled={disabled}
			value={value}
			className="text-sm leading-none bg-transparent outline-none min-w-0 flex-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
			onMouseDown={(event) => {
				const inputElement = event.currentTarget;
				const shouldPreventNativeCaretPlacement =
					event.button === 0 && document.activeElement !== inputElement;
				if (shouldPreventNativeCaretPlacement) {
					event.preventDefault();
					inputElement.focus();
					inputElement.select();
				}
				onMouseDown?.(event);
			}}
			onFocus={(event) => {
				setIsInputFocused(true);
				event.currentTarget.select();
				onFocus?.(event);
			}}
			onKeyDown={(event) => {
				const shouldBlurInput = event.key === "Enter" || event.key === "Escape";
				if (shouldBlurInput) event.currentTarget.blur();
				onKeyDown?.(event);
			}}
			onBlur={(event) => {
				setIsInputFocused(false);
				onBlur?.(event);
			}}
			{...props}
		/>
	);

	return (
		<div
			ref={wrapperRef}
			className={cn(
				"border-border bg-background flex h-7 w-full min-w-0 items-center rounded-xs border text-sm outline-none cursor-text disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
				disabled && "pointer-events-none cursor-not-allowed opacity-50",
				className,
			)}
		>
			{scrubHandle &&
				(canScrub ? (
					<button
						ref={iconRef}
						type="button"
						aria-label={t(locale, "ui.dragAdjust")}
						disabled={disabled}
						className="text-muted-foreground [&_svg]:size-3.5! shrink-0 select-none pl-2.5 text-sm leading-none cursor-ew-resize"
						onMouseDown={(event) => event.preventDefault()}
						onPointerDown={handleIconPointerDown}
					>
						{scrubHandle}
					</button>
				) : (
					<span className="text-muted-foreground [&_svg]:size-3.5! shrink-0 select-none pl-2.5 text-sm leading-none">
					{scrubHandle}
					</span>
				))}
			<span
				className={cn(
					"relative flex flex-1 min-w-0 items-center",
					scrubHandle ? "px-1.5" : "pl-2.5",
					onReset ? "pr-0" : "pr-2.5",
				)}
			>
				{inputNode}
				{suffix && (
					<>
						{/* Ghost mirrors value text to measure width for suffix positioning */}
						<span
							ref={ghostRef}
							className="invisible absolute text-sm leading-none whitespace-pre pointer-events-none"
							aria-hidden="true"
						>
							{ghostValue}
						</span>
						<span
							className={cn(
								"absolute top-1/2 -translate-y-1/2 select-none pointer-events-none text-sm leading-none",
								suffixClassName,
							)}
							style={{ left: suffixLeft + SUFFIX_GAP_PX }}
						>
							{suffix}
						</span>
					</>
				)}
			</span>
			{onReset && !isDefault && (
				<div className="shrink-0 pr-2 flex items-center">
					<Button
						variant="text"
						size="text"
						aria-label={t(locale, "ui.resetDefault")}
						onClick={onReset}
					>
						<HugeiconsIcon icon={ArrowTurnBackwardIcon} className="size-3.5!" />
					</Button>
				</div>
			)}
		</div>
	);
}

function getNumberIdentifier({ label }: { label: string }): string {
	const axis = label.match(/(?:^|\s)([XYZ])$/i)?.[1];
	if (axis) return axis.toUpperCase();
	return label.trim().slice(0, 1).toUpperCase();
}

export { NumberField };
