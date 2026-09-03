"use client";

/**
 * [INPUT]: 依赖 EditorCore 的项目加载状态、路由与渲染初始化能力，以及 Recut 项目同步的 AI 锁状态。
 * [OUTPUT]: 对外提供 EditorProvider，在项目初始化或同步重载时隔离场景依赖 UI，并以不遮挡内容的边框标签表达 AI 编辑锁；demo/test 模式绕过不必要的 GPU WASM 前置等待。
 * [POS]: 编辑器界面的生命周期边界；子界面仅在有效项目和活动场景就绪后挂载。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { useRecutProjectSync } from "@/recut/use-project-sync";
import { useRecutCoverSync } from "@/recut/use-cover-sync";
import { useFrameRender } from "@/recut/use-frame-render";
import { useKeybindingsListener } from "@/actions/use-keybindings";
import { useKeybindingsStore } from "@/actions/keybindings-store";
import { useTimelineStore } from "@/timeline/timeline-store";
import { useEditorActions } from "@/actions/use-editor-actions";
import { t, useRecutLocale, getRecutLocale } from "@/i18n";
import { loadFontAtlas } from "@/fonts/google-fonts";
import { isDemoMode } from "@/demo/demo-store";
import {
	initializeGpuRenderer,
	isGpuAvailable,
} from "@/services/renderer/gpu-renderer";

interface EditorProviderProps {
	projectId: string;
	children: React.ReactNode;
}

export function EditorProvider({ projectId, children }: EditorProviderProps) {
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const isProjectLoading = useEditor((e) => e.project.getIsLoading());
	const router = useRouter();
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const { setLoadingProject } = useKeybindingsStore();
	const isAiEditing = useRecutProjectSync({ projectId });
	useRecutCoverSync({ projectId });
	useFrameRender({ projectId });

	useEffect(() => {
		setLoadingProject(isLoading);
	}, [isLoading, setLoadingProject]);

	useEffect(() => {
		let cancelled = false;
		const editor = EditorCore.getInstance();

		const loadProject = async () => {
			try {
				setIsLoading(true);
				if (!isDemoMode()) await initializeGpuRenderer();
				editor.renderer.setDegraded(!isGpuAvailable());
				await editor.project.loadProject({ id: projectId });

				if (cancelled) return;

				setIsLoading(false);
				loadFontAtlas();
			} catch (err) {
				if (cancelled) return;

				const isNotFound =
					err instanceof Error &&
					(err.message.includes("not found") ||
						err.message.includes("does not exist"));

				if (isNotFound) {
					try {
						const newProjectId = await editor.project.createNewProject({
							name: t(getRecutLocale(), "project.untitled"),
						});
						router.replace(`/editor/${newProjectId}`);
					} catch (_createErr) {
						setError(t(getRecutLocale(), "project.failedCreate"));
						setIsLoading(false);
					}
				} else {
					const wasmPanic = (window as Window & { __wasmPanic?: string })
						.__wasmPanic;
					if (wasmPanic) {
						delete (window as Window & { __wasmPanic?: string }).__wasmPanic;
						setError(wasmPanic);
					} else {
						setError(
							err instanceof Error ? err.message : t(getRecutLocale(), "project.failedLoad"),
						);
					}
					setIsLoading(false);
				}
			}
		};

		loadProject();

		return () => {
			cancelled = true;
		};
	}, [projectId, router]);

	if (error) {
		return (
			<div className="bg-background flex h-screen w-screen items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<p className="text-destructive text-sm">{error}</p>
				</div>
			</div>
		);
	}

	if (isLoading || isProjectLoading) {
		return (
			<div className="bg-background flex h-screen w-screen items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<Loader2 className="text-muted-foreground size-8 animate-spin" />
					<p className="text-muted-foreground text-sm">{t(getRecutLocale(), "project.loading")}</p>
				</div>
			</div>
		);
	}

	if (!activeProject) {
		return (
			<div className="bg-background flex h-screen w-screen items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<Loader2 className="text-muted-foreground size-8 animate-spin" />
					<p className="text-muted-foreground text-sm">{t(getRecutLocale(), "project.exiting")}</p>
				</div>
			</div>
		);
	}

	return (
		<>
			<EditorRuntimeBindings />
			{children}
			{isAiEditing ? <AiEditingBorder /> : null}
		</>
	);
}

function AiEditingBorder() {
	const locale = useRecutLocale();
	return (
		<div
			aria-live="polite"
			className="ai-editing-border pointer-events-none fixed inset-2 z-50 rounded-md"
		>
			<span className="ai-editing-border__label">
				{t(locale, "editor.aiEditing")}
			</span>
		</div>
	);
}

function EditorRuntimeBindings() {
	const editor = useEditor();
	const rippleEditingEnabled = useTimelineStore(
		(state) => state.rippleEditingEnabled,
	);

	useEffect(() => {
		editor.command.isRippleEnabled = rippleEditingEnabled;
	}, [editor, rippleEditingEnabled]);

	useEffect(() => {
		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			if (!editor.save.getIsDirty()) return;
			event.preventDefault();
			(event as unknown as { returnValue: string }).returnValue = "";
		};

		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, [editor]);

	useEditorActions();
	useKeybindingsListener();
	return null;
}
