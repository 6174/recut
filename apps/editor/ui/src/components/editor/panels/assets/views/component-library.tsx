"use client";

/**
 * [INPUT]: 依赖组件注册表、项目组件同步、时间线插入能力与 ComponentPreview 的承载面自动路由；
 *          特效卡片无封面图，用 EffectCoverPreview 按识别色渲染静态渐变封面。
 * [OUTPUT]: 对外提供 EffectLibraryView、ComponentLibraryView 与 ComponentAssetLibraryView 三个组件资源视图。
 * [POS]: assets/views 的组件库入口；挂载时触发可见组件验证/封面准备，单击卡片打开按 surface 自适应的预览，并可复制组件 Debug 上下文。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

import { useEffect, useLayoutEffect, useState } from "react";
import {
	DraggableItem,
	RESOURCE_CARD_ASPECT_RATIO,
} from "@/components/editor/panels/assets/draggable-item";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { componentsRegistry, ensureComponent, getComponentName } from "@/runtime";
import { syncTimelineComponents } from "@/recut/components";
import { ensureVisibleComponentCovers } from "@/recut/component-cover";
import { ensureBuiltinComponentCovers, getBuiltinCovers } from "@/recut/builtin-cover";
import type { ComponentDefinition } from "@/runtime/types";
import { useEditor } from "@/editor/use-editor";
import type { AiComponentInput, AiComponentSurface } from "@/recut/ai-components";
import {
	archiveAiComponent,
	getComponentSource,
	listComponentAssets,
	type ComponentAssetRef,
} from "@/recut/ai-components";
import { buildComponentElement } from "@/timeline/element-utils";
import type { MediaTime } from "@/wasm";
import { ComponentPreview } from "./component-preview";
import { EffectCoverPreview } from "./effect-cover";
import { t, useRecutLocale } from "@/i18n";
import { getParamLabel } from "@/params";
import { cn } from "@/utils/ui";
import { toast } from "sonner";
import { recut } from "@/recut/sdk";
import {
	AlertDiamondIcon,
	CodeIcon,
	Copy01Icon,
	CopyCheckIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

/** 可插入组件库的组件：跳过媒体/文字原语（有专门分类）。 */
function isInsertable(definition: ComponentDefinition): boolean {
	return !["video", "image", "text"].includes(definition.id);
}

/** 项目组件素材：归属由 runtime 元数据表达，不依赖 ID 命名。 */
function isProjectAssetComponent(definition: ComponentDefinition): boolean {
	return definition.origin === "asset";
}

/** 加载失败的组件素材：卡片仍显示，错误可发现并复制上下文给 AI 修复。 */
export interface FailedComponent {
	id: string;
	name: string;
	error: Error;
}

/** 加载失败组件详情：错误信息 + 源码 + 一键复制上下文（可粘贴给 AI 请求修复）。 */
function ComponentErrorDialog({
	failed,
	open,
	onOpenChange,
}: {
	failed: FailedComponent;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [source, setSource] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [sourceError, setSourceError] = useState(false);
	const [copied, setCopied] = useState(false);
	const locale = useRecutLocale();

	useEffect(() => {
		if (!open) return;
		let alive = true;
		setSource(null);
		setSourceError(false);
		setLoading(true);
		getComponentSource(failed.id)
			.then((result) => {
				if (!alive) return;
				setSource(result?.source ?? null);
				setSourceError(result == null);
				setLoading(false);
			})
			.catch(() => {
				if (!alive) return;
				setSourceError(true);
				setLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [open, failed.id]);

	const contextText = [
		`组件「${failed.name}」无法加载，请修复：`,
		`componentId: ${failed.id}`,
		`错误: ${failed.error.message}`,
		``,
		`源码:`,
		"```tsx",
		source ?? "(源码读取失败)",
		"```",
	].join("\n");

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(contextText);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2000);
		} catch (error) {
			console.error("复制组件错误上下文失败:", error);
			toast.error(locale === "zh" ? "复制失败" : "Copy failed");
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="w-[min(96vw,860px)] max-w-none gap-0 overflow-hidden p-0">
				<DialogHeader className="border-b px-5 py-4 text-left">
					<DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
						<HugeiconsIcon icon={AlertDiamondIcon} className="size-5 text-red-400" />
						<span className="text-lg font-semibold">组件「{failed.name}」无法加载</span>
						<Badge variant="destructive" className="font-mono text-xs">
							加载失败
						</Badge>
						<span className="font-mono text-xs text-muted-foreground">
							{failed.id}
						</span>
					</DialogTitle>
				</DialogHeader>
				<div className="flex max-h-[min(76vh,720px)] min-h-0 flex-col">
					<div className="shrink-0 space-y-2 border-b px-4 py-3">
						<p className="text-xs text-muted-foreground">错误信息</p>
						<pre className="overflow-auto rounded border border-red-400/30 bg-red-400/10 px-3 py-2 font-mono text-[12px] whitespace-pre-wrap text-red-200">
							{failed.error.message}
						</pre>
						<div className="flex items-center gap-2 pt-1">
							<Button size="sm" onClick={handleCopy} className="gap-1.5">
								<HugeiconsIcon icon={copied ? CopyCheckIcon : Copy01Icon} className="size-4" />
								{copied ? "已复制上下文" : "复制上下文，提交给 AI 修复"}
							</Button>
						</div>
					</div>
					<div className="min-h-0 flex-1 overflow-hidden">
						<SourceCodeViewer source={source} loading={loading} error={sourceError} />
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

/** 单击图库项打开单一实时预览；承载面决定渲染器。 */
function ComponentPreviewDialog({
	component,
	open,
	onOpenChange,
}: {
	component: ComponentDefinition;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const locale = useRecutLocale();
	const showSource = component.origin === "asset";
	const [source, setSource] = useState<string | null>(null);
	const [sourceError, setSourceError] = useState(false);
	const [debugCopied, setDebugCopied] = useState(false);
	const [previewPane, setPreviewPane] = useState<HTMLDivElement | null>(null);
	const [previewSize, setPreviewSize] = useState({ width: 320, height: 180 });
	const inputs = component.inputs.map((input) => ({
		key: input.key,
		label: input.labelKey ? getParamLabel({ param: input, locale }) : input.label,
		type: input.type,
		default: input.default,
	})) as AiComponentInput[];

	useEffect(() => {
		if (!open || !showSource) return;
		let alive = true;
		setSource(null);
		setSourceError(false);
		getComponentSource(component.id)
			.then((result) => {
				if (alive && result) setSource(result.source);
				else if (alive) setSourceError(true);
			})
			.catch(() => alive && setSourceError(true));
		return () => {
			alive = false;
		};
	}, [open, component.id, showSource]);

	useLayoutEffect(() => {
		if (!open || !previewPane) return;
		const updateSize = () => {
			const availableWidth = previewPane.clientWidth;
			const maxWidth = showSource ? 704 : 896;
			const width = Math.max(240, Math.min(maxWidth, availableWidth - 32));
			setPreviewSize({ width, height: Math.round((width * 9) / 16) });
		};
		updateSize();
		const frame = window.requestAnimationFrame(updateSize);
		const observer = new ResizeObserver(updateSize);
		observer.observe(previewPane);
		return () => {
			window.cancelAnimationFrame(frame);
			observer.disconnect();
		};
	}, [open, previewPane, showSource]);

	const buildDebugContext = (sourceText: string | null) => {
		const params = Object.fromEntries(inputs.map((input) => [input.key, input.default]));
		const baseSize = component.getBaseSize?.({ params }) ?? null;
		const debugWorld = {
			id: `debug-preview-${component.id}`,
			width: previewSize.width,
			height: previewSize.height,
			fps: 30,
			duration: 6,
			environment: { background: "#101014" },
			objects: [],
		};
		const debugObject = {
			id: "debug-preview-object",
			kind: "component" as const,
			componentId: component.id,
			name: getComponentName({ definition: component, locale }),
			startTime: 0,
			duration: 6,
			params,
			transform: {
				position: { x: 0, y: 0, z: 0 },
				scaleX: 1,
				scaleY: 1,
				rotationZ: 0,
			},
			renderOrder: 0,
		};
		const debugCtx = {
			world: debugWorld,
			object: debugObject,
			params,
			time: 0,
			localTime: 0,
			progress: 0,
		};
		let contentBounds: unknown = null;
		let contentBoundsError: string | null = null;
		try {
			contentBounds = component.getContentBounds?.(debugCtx) ?? null;
		} catch (error) {
			contentBoundsError = error instanceof Error ? error.message : String(error);
		}
		const lines = [
			"# Recut component debug context",
			`componentId: ${component.id}`,
			`name: ${getComponentName({ definition: component, locale })}`,
			`surface: ${component.surface ?? "r3f"}`,
			`origin: ${component.origin ?? "unknown"}`,
			`category: ${component.category ?? "3d"}`,
			`selectable: ${component.selectable ?? true}`,
			"",
			"## Runtime geometry",
			"```json",
			JSON.stringify(
				{
					previewSize,
					baseSize,
					capturePadding: component.capturePadding ?? 48,
					declaredContentBounds: contentBounds,
					contentBoundsError,
					previewObject: debugObject,
				},
				null,
				2,
			),
			"```",
			"",
			"## Inputs",
			"```json",
			JSON.stringify(inputs, null, 2),
			"```",
			"",
			"## Source",
			"```tsx",
			sourceText ?? "(component.source unavailable; this may be a built-in component)",
			"```",
		];
		return lines.join("\n");
	};

	const handleCopyDebug = async () => {
		let sourceText = source;
		if (showSource && sourceText == null && !sourceError) {
			try {
				const result = await getComponentSource(component.id);
				sourceText = result?.source ?? null;
				if (result) setSource(result.source);
			} catch {
				sourceText = null;
			}
		}
		try {
			const debugText = buildDebugContext(sourceText);
			let copiedThroughHost = false;
			if (window.parent !== window && recut.isConnected()) {
				// iframe 的 Clipboard API 受宿主 Permissions Policy 约束，优先让全局
				// Recut Host 在顶层文档执行复制；直接打开 demo 时再走浏览器降级。
				try {
					await recut.clipboard.writeText(debugText);
					copiedThroughHost = true;
				} catch {
					// 复制被宿主拒绝时，继续尝试当前文档的 API。
				}
			}
			if (!copiedThroughHost) await navigator.clipboard.writeText(debugText);
			setDebugCopied(true);
			window.setTimeout(() => setDebugCopied(false), 2000);
			toast.success(locale === "zh" ? "组件 Debug 上下文已复制" : "Component debug context copied");
		} catch (error) {
			console.error("复制组件 Debug 上下文失败:", error);
			toast.error(locale === "zh" ? "复制失败" : "Copy failed");
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="w-[min(96vw,1200px)] max-w-none gap-0 overflow-hidden p-0">
				<DialogHeader className="border-b px-5 py-4 text-left">
					<DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
						<span className="text-lg font-semibold">
							{getComponentName({ definition: component, locale })}
						</span>
						<Badge variant="secondary" className="font-mono text-xs">
							{component.surface}
						</Badge>
						<span className="font-mono text-xs text-muted-foreground">
							{component.id}
						</span>
						<Button
							size="sm"
							variant="outline"
							className="ml-auto gap-1.5"
							onClick={handleCopyDebug}
							aria-label={locale === "zh" ? "复制组件 Debug 上下文" : "Copy component debug context"}
						>
							<HugeiconsIcon icon={debugCopied ? CopyCheckIcon : CodeIcon} className="size-4" />
							{debugCopied
								? locale === "zh" ? "已复制" : "Copied"
								: locale === "zh" ? "Debug 上下文" : "Debug context"}
						</Button>
					</DialogTitle>
				</DialogHeader>
				<div
					className={cn(
						"grid max-h-[min(78vh,760px)] min-h-0 grid-cols-1 overflow-hidden",
						showSource && "md:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]",
					)}
				>
					<div ref={setPreviewPane} className="flex min-w-0 items-center justify-center overflow-hidden bg-muted/30 p-4 sm:p-6">
						<ComponentPreview
							componentId={component.id}
							name={getComponentName({ definition: component, locale })}
							surface={(component.surface ?? "r3f") as AiComponentSurface}
							inputs={inputs}
							width={previewSize.width}
							height={previewSize.height}
						/>
					</div>
					{showSource ? (
						<SourceCodeViewer source={source} loading={!sourceError && source == null} error={sourceError} />
					) : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function SourceCodeViewer({
	source,
	loading,
	error,
}: {
	source: string | null;
	loading: boolean;
	error: boolean;
}) {
	return (
		<div className="flex min-h-0 min-w-0 flex-col border-t bg-[#0b1220] md:border-l md:border-t-0">
			<div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/10 px-4 text-xs font-medium text-slate-300">
				<span>源码</span>
				<span className="font-mono text-[10px] text-slate-500">.tsx</span>
			</div>
			<div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[12px] leading-5 text-slate-200">
				{error ? (
					<div className="rounded border border-red-400/30 bg-red-400/10 px-3 py-2 text-red-300">
						源码不可用
					</div>
				) : loading ? (
					<div className="text-slate-500">加载中…</div>
				) : (
					<ol className="m-0 min-w-0 list-none p-0">
						{(source ?? "").split(/\r?\n/).map((line, index) => (
							<li key={index} className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] gap-3">
								<span className="select-none text-right text-slate-600">{index + 1}</span>
								<code className="min-w-0 whitespace-pre-wrap break-words">{line || " "}</code>
							</li>
						))}
					</ol>
				)}
			</div>
		</div>
	);
}

function ComponentGrid({
	components,
	failedComponents = [],
	onRemove,
	embedded = false,
	coverPending = false,
}: {
	components: ComponentDefinition[];
	failedComponents?: FailedComponent[];
	onRemove?: (componentId: string) => void;
	embedded?: boolean;
	/** 封面生成中：无封面的卡片在占位块上显示小 loading，保持卡片稳定（不引入布局抖动）。 */
	coverPending?: boolean;
}) {
	const editor = useEditor();
	const locale = useRecutLocale();
	const [preview, setPreview] = useState<ComponentDefinition | null>(null);
	const [errorPreview, setErrorPreview] = useState<FailedComponent | null>(null);

	const handleAdd =
		(componentId: string) =>
		({ currentTime }: { currentTime: MediaTime }) => {
			const activeScene = editor.scenes.getActiveScene();
			if (!activeScene) return;
			const element = buildComponentElement({
				componentId,
				startTime: currentTime,
			});
			editor.timeline.insertElement({
				element,
				placement: { mode: "auto" },
			});
		};

	const cards = (
		<>
			{components.map((definition) => {
				const name = getComponentName({ definition, locale });
					const card = (
						<DraggableItem
							key={definition.id}
							name={name}
							isDraggable={false}
							preview={
								definition.coverUrl ? (
									<img
										alt={name}
										className="size-full object-contain"
										src={definition.coverUrl}
									/>
								) : definition.category === "effect" ? (
									<EffectCoverPreview color={definition.color} />
								) : (
									<div className="relative flex size-full items-center justify-center bg-[#101014]">
										<span
											aria-hidden="true"
											className="size-3 rounded-full shadow-[0_0_18px_currentColor]"
											style={{ color: definition.color ?? "#94a3b8", backgroundColor: "currentColor" }}
										/>
										{coverPending ? (
											<div className="absolute inset-0 grid place-items-center bg-black/25">
												<Spinner className="size-4 text-foreground/75" />
											</div>
										) : null}
									</div>
								)
							}
							dragData={{
								id: definition.id,
								name,
								type: "graphic",
								definitionId: definition.id,
								params: {},
							}}
							aspectRatio={RESOURCE_CARD_ASPECT_RATIO}
							onAddToTimeline={handleAdd(definition.id)}
							onPreview={() => setPreview(definition)}
						/>
					);
					if (!onRemove) return card;
					return (
						<ContextMenu key={definition.id}>
							<ContextMenuTrigger asChild>
								<div className="min-w-0">{card}</div>
							</ContextMenuTrigger>
							<ContextMenuContent>
								<ContextMenuItem
									variant="destructive"
									onClick={() => onRemove(definition.id)}
								>
									{t(locale, "assets.delete")}
								</ContextMenuItem>
							</ContextMenuContent>
						</ContextMenu>
					);
				})}
				{failedComponents.map((failed) => {
					const card = (
						<div key={failed.id} title={failed.error.message}>
							<DraggableItem
								name={failed.name}
								preview={
									<div className="text-red-400 flex size-full items-center justify-center border border-dashed border-red-400/40 bg-red-400/5">
										<HugeiconsIcon icon={AlertDiamondIcon} className="size-6" />
									</div>
								}
								dragData={{ id: failed.id, name: failed.name, type: "graphic", definitionId: failed.id, params: {} }}
								isDraggable={false}
								shouldShowPlusOnDrag={false}
								aspectRatio={RESOURCE_CARD_ASPECT_RATIO}
								onPreview={() => setErrorPreview(failed)}
							/>
						</div>
					);
					if (!onRemove) return card;
					return (
						<ContextMenu key={failed.id}>
							<ContextMenuTrigger asChild>
								<div className="min-w-0">{card}</div>
							</ContextMenuTrigger>
							<ContextMenuContent>
								<ContextMenuItem
									variant="destructive"
									onClick={() => onRemove(failed.id)}
								>
									{t(locale, "assets.delete")}
								</ContextMenuItem>
							</ContextMenuContent>
						</ContextMenu>
					);
				})}
		</>
	);

	return (
		<>
			{embedded ? (
				cards
			) : components.length === 0 && failedComponents.length === 0 ? (
				<div className="flex min-h-24 items-center justify-center px-4 text-center text-sm text-muted-foreground">
					{t(locale, "assets.emptyComponents")}
				</div>
			) : (
				<div
					className="grid gap-2 p-2"
					style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 7rem), 1fr))" }}
				>
					{cards}
				</div>
			)}
			{preview ? (
				<ComponentPreviewDialog
					component={preview}
					open={preview != null}
					onOpenChange={(open) => {
						if (!open) setPreview(null);
					}}
				/>
			) : null}
			{errorPreview ? (
				<ComponentErrorDialog
					failed={errorPreview}
					open={errorPreview != null}
					onOpenChange={(open) => {
						if (!open) setErrorPreview(null);
					}}
				/>
			) : null}
		</>
	);
}

const EFFECT_GROUPS: Array<{ id: string; label: string }> = [
	{ id: "all", label: "全部" },
	{ id: "distort", label: "扭曲" },
	{ id: "stylize", label: "风格化" },
	{ id: "retro", label: "复古" },
];

function getEffectGroupId(definition: ComponentDefinition): string {
	const haystack = `${definition.id} ${definition.name ?? ""}`.toLowerCase();
	if (/(magnify|displacement|ripple|droplets|bubble|dither)/.test(haystack)) return "distort";
	if (/(vhs|vintage|crt|glitch|frost|glass)/.test(haystack)) return "retro";
	return "stylize";
}

/**
 * 特效分类：调整已有内容的全画布后处理（消费场景纹理）。
 * 提供"内容"的程序化环境层（group 设置了的）归组件面板。
 * 布局复用 ComponentLibraryView 的左侧二级分类 + 右侧可滚动网格，修复无滚动问题。
 */
export function EffectLibraryView() {
	const [activeGroup, setActiveGroup] = useState("all");
	const [, setRevision] = useState(0);

	useEffect(() => {
		const refresh = () => setRevision((v) => v + 1);
		window.addEventListener("recut:components-changed", refresh);
		return () => window.removeEventListener("recut:components-changed", refresh);
	}, []);

	const allEffects = componentsRegistry
		.getAll()
		.filter(isInsertable)
		.filter((component) => component.category === "effect" && !component.group);

	const availableGroups = EFFECT_GROUPS.filter(({ id }) => {
		if (id === "all") return true;
		return allEffects.some((c) => getEffectGroupId(c) === id);
	});

	const effects =
		activeGroup === "all" ? allEffects : allEffects.filter((c) => getEffectGroupId(c) === activeGroup);

	return (
		<div className="flex h-full min-h-0">
			<div className="flex w-16 shrink-0 flex-col gap-1 border-r p-1.5">
				{availableGroups.map(({ id, label }) => (
					<button
						key={id}
						onClick={() => setActiveGroup(id)}
						className={`rounded-md px-1 py-2 text-center text-[11px] transition ${
							activeGroup === id
								? "bg-white/10 font-medium text-white"
								: "text-white/50 hover:bg-white/5 hover:text-white/80"
						}`}
					>
						{label}
					</button>
				))}
			</div>
			<div className="min-w-0 flex-1 overflow-y-auto">
				<ComponentGrid components={effects} />
			</div>
		</div>
	);
}

/** 组件二级分类（剪映风格左侧 tab）：内容提供型组件按 group 分组。 */
const COMPONENT_GROUPS: Array<{ id: string; label: string }> = [
	{ id: "all", label: "全部" },
	{ id: "bg", label: "背景" },
	{ id: "scene", label: "3D" },
	{ id: "demo", label: "示例" },
];

/** 3D 组件分类：平台内置可变换场景组件（不含特效、不含项目素材）。 */
export function ComponentLibraryView() {
	const [, setRevision] = useState(0);
	const [coverMap, setCoverMap] = useState<Record<string, string>>({});
	const [coverPending, setCoverPending] = useState(false);
	const [activeGroup, setActiveGroup] = useState("all");

	useEffect(() => {
		let alive = true;
		const platformIds = () =>
			componentsRegistry
				.getAll()
				.filter(isInsertable)
				.filter(isComponentPanelComponent)
				.map((component) => component.id);
		const refreshCovers = async () => {
			const covers = await getBuiltinCovers(platformIds());
			if (alive) setCoverMap(covers);
		};
		const refresh = () => setRevision((revision) => revision + 1);
		// 挂载时读取已缓存封面，并后台生成缺失封面（一次性，IndexedDB 缓存）。
		setCoverPending(true);
		void refreshCovers()
			.then(() => ensureBuiltinComponentCovers())
			.finally(() => {
				if (alive) setCoverPending(false);
				void refreshCovers();
			});
		const onCoversChanged = () => {
			if (alive) void refreshCovers();
		};
		window.addEventListener("recut:components-changed", refresh);
		window.addEventListener("recut:builtin-covers-changed", onCoversChanged);
		return () => {
			alive = false;
			window.removeEventListener("recut:components-changed", refresh);
			window.removeEventListener("recut:builtin-covers-changed", onCoversChanged);
		};
	}, []);

	/** 组件面板归属：普通场景对象 + 提供内容的 shader 层（设置了 group 的全画布组件）。 */
	const isComponentPanelComponent = (component: ComponentDefinition): boolean =>
		component.category !== "effect" || !!component.group;

	const groups = componentsRegistry
		.getAll()
		.filter(isInsertable)
		.filter(isComponentPanelComponent)
		.filter((component) => activeGroup === "all" || (component.group ?? "scene") === activeGroup)
		.map((component) =>
			coverMap[component.id] ? { ...component, coverUrl: coverMap[component.id] } : component,
		);

	const availableGroups = COMPONENT_GROUPS.filter(({ id }) => {
		if (id === "all") return true;
		return componentsRegistry
			.getAll()
			.filter(isInsertable)
			.filter(isComponentPanelComponent)
			.some((component) => (component.group ?? "scene") === id);
	});

	return (
		<div className="flex h-full min-h-0">
			{/* 二级分类：左侧竖排 tab（剪映风格） */}
			<div className="flex w-16 shrink-0 flex-col gap-1 border-r p-1.5">
				{availableGroups.map(({ id, label }) => (
					<button
						key={id}
						onClick={() => setActiveGroup(id)}
						className={`rounded-md px-1 py-2 text-center text-[11px] transition ${
							activeGroup === id
								? "bg-white/10 font-medium text-white"
								: "text-white/50 hover:bg-white/5 hover:text-white/80"
						}`}
					>
						{label}
					</button>
				))}
			</div>
			<div className="min-w-0 flex-1 overflow-y-auto">
				<ComponentGrid components={groups} coverPending={coverPending} />
			</div>
		</div>
	);
}

/** 项目组件 asset：通过 asset.list 取得引用，再用 runtime 定义渲染和插入。 */
export function ComponentAssetLibraryView({
	onAssetStateChange,
	embedded = false,
}: {
	onAssetStateChange?: (state: { count: number; ready: boolean }) => void;
	embedded?: boolean;
}) {
	const editor = useEditor();
	const [, setRevision] = useState(0);
	const [assetComponentIds, setAssetComponentIds] = useState<Set<string> | null>(null);
	const [assetRefs, setAssetRefs] = useState<ComponentAssetRef[] | null>(null);
	const locale = useRecutLocale();

	useEffect(() => {
		let alive = true;
		const refresh = async () => {
			setAssetComponentIds(null);
			onAssetStateChange?.({ count: 0, ready: false });
			// 素材库是真正的可见性边界：验证与封面完成后，asset.list
			// 返回组件引用；runtime 只负责把引用解析成可执行定义。
			await ensureVisibleComponentCovers();
			await syncTimelineComponents(editor.project.getActiveOrNull());
			const assets = await listComponentAssets();
			if (!alive) return;
			const refs = assets ?? [];
			const ids = new Set(refs.map((asset) => asset.componentId));
			// 物化还没有状态的组件（加载成功或失败都记进 registry），让失败卡片可发现。
			const uninitialized = refs
				.filter((asset) => componentsRegistry.getState(asset.componentId) == null)
				.map((asset) => asset.componentId);
			if (uninitialized.length > 0) {
				await Promise.allSettled(uninitialized.map((id) => ensureComponent(id)));
			}
			if (!alive) return;
			setAssetRefs(refs);
			setAssetComponentIds(ids);
			onAssetStateChange?.({ count: ids.size, ready: true });
			setRevision((revision) => revision + 1);
		};
		void refresh();
		window.addEventListener("recut:components-changed", refresh);
		return () => {
			alive = false;
			window.removeEventListener("recut:components-changed", refresh);
		};
	}, [editor, onAssetStateChange]);

	const handleRemove = async (componentId: string) => {
		try {
			await archiveAiComponent(componentId);
			setAssetComponentIds((current) => {
				if (!current) return current;
				const next = new Set(current);
				next.delete(componentId);
				return next;
			});
			onAssetStateChange?.({
				count: Math.max(0, (assetComponentIds?.size ?? 1) - 1),
				ready: true,
			});
		} catch (error) {
			console.error("Failed to archive component asset:", error);
			toast.error(t(locale, "assets.deleteComponentFailed"));
		}
	};

	const aiComponents = componentsRegistry
		.getAll()
		.filter(isInsertable)
		.filter((component) =>
			assetComponentIds === null
				? isProjectAssetComponent(component)
				: assetComponentIds.has(component.id),
		);

	// 加载失败的组件素材：卡片照常显示，错误可双击查看并复制上下文给 AI。
	const failedComponents = (assetRefs ?? [])
		.filter((ref) => assetComponentIds === null || assetComponentIds.has(ref.componentId))
		.map((ref) => {
			const state = componentsRegistry.getState(ref.componentId);
			if (!state || state.status !== "failed") return null;
			return { id: ref.componentId, name: ref.name, error: state.error };
		})
		.filter((failed): failed is FailedComponent => failed != null);

	return (
		<ComponentGrid
			components={aiComponents}
			failedComponents={failedComponents}
			onRemove={handleRemove}
			embedded={embedded}
			coverPending={assetComponentIds === null}
		/>
	);
}
