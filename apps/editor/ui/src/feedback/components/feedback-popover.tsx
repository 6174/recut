"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ClockIcon } from "lucide-react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
	Form,
	FormField,
	FormItem,
	FormControl,
	clearFormDraft,
} from "@/components/ui/form";
import type { FeedbackEntry } from "../types";
import { t, useRecutLocale, type RecutLocale } from "@/i18n";

const PERSIST_KEY = "feedback-draft";
const HISTORY_KEY = "feedback-history";
const MAX_HISTORY = 20;

interface FeedbackFormValues {
	message: string;
}

function readHistory(): FeedbackEntry[] {
	try {
		const stored = localStorage.getItem(HISTORY_KEY);
		return stored ? (JSON.parse(stored) as FeedbackEntry[]) : [];
	} catch {
		return [];
	}
}

function writeHistory({ entries }: { entries: FeedbackEntry[] }): void {
	try {
		localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
	} catch {
		// localStorage may be full or unavailable
	}
}

function useFeedback() {
	const locale = useRecutLocale();
	const [entries, setEntries] = useState<FeedbackEntry[]>(readHistory);
	const [isSubmitting, setIsSubmitting] = useState(false);

	async function submit({
		values,
		onSuccess,
	}: {
		values: FeedbackFormValues;
		onSuccess: () => void;
	}) {
		if (isSubmitting) return;
		setIsSubmitting(true);

		try {
			const res = await fetch("/api/feedback", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(values),
			});

			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(data?.error ?? t(locale, "feedback.failedSubmit"));
			}

			const { entry } = await res.json();
			const next = [entry, ...entries].slice(0, MAX_HISTORY);
			setEntries(next);
			writeHistory({ entries: next });
			onSuccess();
			toast.success(t(locale, "feedback.sent"));
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: t(locale, "feedback.failedSend"),
			);
		} finally {
			setIsSubmitting(false);
		}
	}

	return { entries, isSubmitting, submit };
}

export function FeedbackPopover() {
	const [open, setOpen] = useState(false);
	const locale = useRecutLocale();

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="outline" className="h-8">
					{t(locale, "feedback.sendFeedback")}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 p-0">
				<FeedbackPopoverContent onClose={() => setOpen(false)} />
			</PopoverContent>
		</Popover>
	);
}

type View = "compose" | "history";

function FeedbackPopoverContent({ onClose }: { onClose: () => void }) {
	const locale = useRecutLocale();
	const { entries, isSubmitting, submit } = useFeedback();
	const [view, setView] = useState<View>("compose");

	const form = useForm<FeedbackFormValues>({
		defaultValues: { message: "" },
	});

	async function handleSubmit(values: FeedbackFormValues) {
		await submit({
			values,
			onSuccess: () => {
				form.reset({ message: "" });
				clearFormDraft({ key: PERSIST_KEY });
				onClose();
			},
		});
	}

	if (view === "history") {
		return (
			<div className="flex flex-col">
				<div
					className="max-h-72 overflow-y-auto divide-y"
					style={{
						maskImage:
							"linear-gradient(to bottom, black 80%, transparent 100%)",
					}}
				>
					{entries.map((entry) => (
						<FeedbackEntryItem key={entry.id} entry={entry} />
					))}
				</div>
				<div className="border-t px-3 py-2">
					<button
						type="button"
						onClick={() => setView("compose")}
						className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
					>
						{t(locale, "feedback.back")}
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			<Form persistKey={PERSIST_KEY} {...form}>
				<form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col">
					<FormField
						control={form.control}
						name="message"
						render={({ field }) => (
							<FormItem>
								<FormControl>
									<Textarea
										placeholder={t(locale, "feedback.placeholder")}
										className="min-h-[7rem] text-sm p-3 bg-background shadow-none border-none! resize-none"
										{...field}
									/>
								</FormControl>
							</FormItem>
						)}
					/>
					<div className="flex items-center justify-between border-t px-3 py-2">
						{entries.length > 0 ? (
							<button
								type="button"
								onClick={() => setView("history")}
								className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
							>
								<ClockIcon className="size-3" />
								{entries.length}
							</button>
						) : (
							<span />
						)}
						<div className="flex gap-2">
							{!form.watch("message").trim() && (
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={onClose}
								>
									{t(locale, "common.cancel")}
								</Button>
							)}
							<Button
								type="submit"
								size="sm"
								disabled={isSubmitting || !form.watch("message").trim()}
							>
								{isSubmitting ? <Spinner /> : t(locale, "common.send")}
							</Button>
						</div>
					</div>
				</form>
			</Form>
		</div>
	);
}

function relativeDate({ iso, locale }: { iso: string; locale: RecutLocale }): string {
	const diff = Date.now() - new Date(iso).getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return t(locale, "feedback.justNow");
	if (mins < 60) return t(locale, "feedback.minutesAgo", { n: mins });
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return t(locale, "feedback.hoursAgo", { n: hrs });
	const days = Math.floor(hrs / 24);
	if (days < 7) return t(locale, "feedback.daysAgo", { n: days });
	return new Date(iso).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
}

function FeedbackEntryItem({ entry }: { entry: FeedbackEntry }) {
	const locale = useRecutLocale();
	return (
		<div className="px-3 py-2.5">
			<p className="text-sm text-muted-foreground leading-snug whitespace-pre-wrap break-words">
				{entry.message}
			</p>
			<span className="mt-1 block text-[11px] text-muted-foreground/50">
				{relativeDate({ iso: entry.createdAt, locale })}
			</span>
		</div>
	);
}
