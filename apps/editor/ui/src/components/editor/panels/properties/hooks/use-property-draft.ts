import { useRef, useState } from "react";
import { evaluateMathExpression } from "@/utils/math";

function looksLikeExpression({ input }: { input: string }): boolean {
	const trimmed = input.trim();
	if (!trimmed) return false;
	if (/[+*/]/.test(input)) return true;
	const minusIndex = trimmed.indexOf("-");
	return minusIndex > 0;
}

/**
 * 输入框作为主源：编辑期间显示本地 draft（即时、跟手），
 * 预览更新按 previewDelayMs 防抖，失焦时 flush + commit。
 */
export function usePropertyDraft<T>({
	displayValue: sourceDisplay,
	parse,
	onPreview,
	onCommit,
	onStartEditing,
	supportsExpressions = true,
	previewDelayMs = 0,
}: {
	displayValue: string;
	parse: (input: string) => T | null;
	onPreview: (value: T) => void;
	onCommit: () => void;
	onStartEditing?: () => void;
	supportsExpressions?: boolean;
	/** 预览更新的防抖毫秒；0 = 即时。 */
	previewDelayMs?: number;
}) {
	const [isEditing, setIsEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const previewRef = useRef(onPreview);
	previewRef.current = onPreview;

	const flushPreview = (raw: string) => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		const parsed = parse(raw);
		if (parsed !== null) previewRef.current(parsed);
	};

	const schedulePreview = (raw: string) => {
		if (previewDelayMs > 0) {
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				flushPreview(raw);
			}, previewDelayMs);
			return;
		}
		flushPreview(raw);
	};

	return {
		displayValue: isEditing ? draft : sourceDisplay,
		scrubTo: (value: number) => {
			const parsed = parse(String(value));
			if (parsed !== null) previewRef.current(parsed);
		},
		commitScrub: onCommit,
		onFocus: () => {
			setIsEditing(true);
			setDraft(sourceDisplay);
			onStartEditing?.();
		},
		onChange: (
			event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
		) => {
			const nextDraft = event.target.value;
			setDraft(nextDraft);
			schedulePreview(nextDraft);
		},
		onBlur: (
			event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
		) => {
			const nextDraft = event.target.value;
			if (supportsExpressions && looksLikeExpression({ input: nextDraft })) {
				const evaluated = evaluateMathExpression({ input: nextDraft });
				if (evaluated !== null) {
					flushPreview(String(evaluated));
				} else {
					flushPreview(nextDraft);
				}
			} else {
				flushPreview(nextDraft);
			}
			onCommit();
			setIsEditing(false);
			setDraft("");
		},
	};
}
