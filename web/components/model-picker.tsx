/*
 * [INPUT]: 依赖 Radix Popover、lucide 图标、media Model 类型与 i18n 字典
 * [OUTPUT]: 对外提供双栏 ModelPicker 弹出选择器：左侧搜索 + 按 Provider 分组的模型列表，
 *          右侧悬停/聚焦模型的详情卡（状态徽章、Provider、凭据状态、简介、计费、输入/输出参数、
 *          参考素材上限、标签、文档链接），可选底部连接入口
 * [POS]: 设置面板用途模型选择的专用组件；复用 CustomSelect 的视觉语言但不复用其单栏结构
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { BookOpen, Check, ChevronDown, Plus, Search } from "lucide-react";
import { useState } from "react";
import type { Model } from "@/app/media/media-types";
import { useI18n } from "@/lib/i18n";
import { interpolate } from "@/lib/i18n/workspace-dict";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

const inputModeLabels: Record<string, Record<"zh" | "en", string>> = {
  text: { zh: "文本", en: "Text" },
  image: { zh: "图片", en: "Image" },
  video: { zh: "视频", en: "Video" },
  audio: { zh: "音频", en: "Audio" },
};

function formatBytes(bytes: number): string {
  if (bytes >= 1 << 20) return `${Math.round(bytes / (1 << 20))}MB`;
  return `${Math.max(1, Math.round(bytes / (1 << 10)))}KB`;
}

function statusBadge(t: (key: string) => string, status?: Model["status"]): { label: string; className: string } | null {
  if (status === "deprecated") return { label: t("settings.model.badge.deprecated"), className: "border-warning/40 bg-warning/10 text-warning" };
  if (status === "new") return { label: t("settings.model.badge.new"), className: "border-primary/25 bg-primary/10 text-primary" };
  return null;
}

function modelTitle(t: (key: string) => string, model: Model) {
  return model.name;
}

// PickerBody lives inside PopoverContent so the search query and hover preview
// reset whenever the popover closes (Radix unmounts content by default).
function PickerBody({ models, value, onChange, onConnect, providerName, credentialConnected, retiredHidden }: { models: Model[]; value: string; onChange: (modelID: string) => void; onConnect?: () => void; providerName: (id: string) => string; credentialConnected?: (providerID: string) => boolean; retiredHidden: number }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [previewID, setPreviewID] = useState(value);
  const normalized = query.trim().toLowerCase();
  const visible = normalized ? models.filter((model) => `${providerName(model.provider)} ${model.name} ${model.meta?.summary ?? ""} ${model.meta?.tags?.join(" ") ?? ""}`.toLowerCase().includes(normalized)) : models;
  const preview = models.find((model) => model.id === previewID) ?? models[0];
  const grouped = visible.reduce<Map<string, Model[]>>((groups, model) => {
    const key = providerName(model.provider);
    groups.set(key, [...(groups.get(key) ?? []), model]);
    return groups;
  }, new Map());
  return <div className="grid h-[min(480px,calc(100vh-12rem))] grid-cols-[248px_minmax(0,1fr)] overflow-hidden"><div className="flex min-h-0 flex-col border-r"><div className="relative p-2 pb-1"><Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input aria-label={t("settings.model.search.placeholder")} className="h-8 w-full rounded-sm border bg-background pl-8 pr-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" onChange={(event) => setQuery(event.target.value)} placeholder={t("settings.model.search.placeholder")} type="search" value={query} /></div><p className="px-3 pb-1 text-[10px] text-muted-foreground">{interpolate(t("settings.model.picker.count"), { count: visible.length })}</p><div className="min-h-0 flex-1 overflow-y-auto p-1 pt-0">{Array.from(grouped).map(([group, groupModels]) => <div key={group}><div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</div>{groupModels.map((model) => { const active = model.id === value; const badge = statusBadge(t, model.status); return <button aria-selected={active} className={`flex w-full items-center justify-between gap-2 rounded-xs px-2.5 py-2 text-left text-xs hover:bg-muted ${active ? "bg-accent" : ""}`} key={model.id} onClick={() => onChange(model.id)} onFocus={() => setPreviewID(model.id)} onMouseEnter={() => setPreviewID(model.id)} role="option" type="button"><span className="min-w-0"><span className="block truncate">{modelTitle(t, model)}</span></span><span className="flex shrink-0 items-center gap-1">{badge && <span className={`rounded-xs border px-1 py-0.5 text-[9px] font-medium leading-none ${badge.className}`}>{badge.label}</span>}{active && <Check className="size-3.5 text-primary" />}</span></button>; })}</div>)}</div>{retiredHidden > 0 && <p className="border-t px-3 py-2 text-[10px] text-muted-foreground">{interpolate(t("settings.model.picker.retired"), { count: retiredHidden })}</p>}</div><div className="min-h-72 p-3">{preview ? <ModelDetail credentialConnected={credentialConnected} model={preview} providerName={providerName} /> : <p className="py-10 text-center text-xs text-muted-foreground">{t("settings.model.picker.noMatch")}</p>}</div>{onConnect && <button className="col-span-2 flex items-center justify-center gap-1.5 border-t px-3 py-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onConnect} type="button"><Plus className="size-3.5" />{t("settings.model.picker.more")}</button>}</div>;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3"><dt className="shrink-0 pt-0.5 text-muted-foreground">{label}</dt><dd className="min-w-0 text-right font-medium">{children}</dd></div>;
}

function ModelDetail({ model, providerName, credentialConnected }: { model: Model; providerName: (id: string) => string; credentialConnected?: (providerID: string) => boolean }) {
  const { t, locale } = useI18n();
  const badge = statusBadge(t, model.status);
  const connected = credentialConnected?.(model.provider);
  const budgets = model.referenceBudgets ?? [];
  const budgetSummary = budgets.map((budget) => [budget.maxImages && `${t("model.kind.image")}≤${budget.maxImages}`, budget.maxVideos && `${t("model.kind.video")}≤${budget.maxVideos}`, budget.maxAudios && `${t("model.kind.audio")}≤${budget.maxAudios}`].filter(Boolean).join(" / ")).filter(Boolean).join("；");
  const budgetSizes = budgets.flatMap((budget) => [budget.image?.maxBytes && `${t("model.kind.image")}≤${formatBytes(budget.image.maxBytes)}`, budget.video?.maxBytes && `${t("model.kind.video")}≤${formatBytes(budget.video.maxBytes)}`, budget.audio?.maxBytes && `${t("model.kind.audio")}≤${formatBytes(budget.audio.maxBytes)}`].filter(Boolean) as string[]).join(" / ");
  return <div className="flex h-full flex-col overflow-y-auto text-xs"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-medium">{modelTitle(t, model)}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{providerName(model.provider)}</p></div>{badge && <span className={`shrink-0 rounded-xs border px-1.5 py-0.5 text-[9px] font-medium leading-none ${badge.className}`}>{badge.label}</span>}</div>{model.meta?.summary && <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{model.meta.summary}</p>}<dl className="mt-3 space-y-2">{connected !== undefined && <DetailRow label={t("settings.model.detail.credential")}><span className={`inline-flex items-center gap-1 ${connected ? "text-primary" : "text-muted-foreground"}`}><span className={`size-1.5 rounded-full ${connected ? "bg-primary" : "bg-muted-foreground/40"}`} />{connected ? t("settings.model.detail.credential.connected") : t("settings.model.detail.credential.missing")}</span></DetailRow>}{model.meta?.pricing && <DetailRow label={t("settings.model.detail.pricing")}><span className="whitespace-pre-line">{model.meta.pricing}</span></DetailRow>}{model.inputModes.length > 0 && <DetailRow label={t("settings.model.detail.inputs")}><span>{model.inputModes.map((mode) => inputModeLabels[mode]?.[locale] ?? mode).join(" / ")}</span></DetailRow>}{model.outputModes && model.outputModes.length > 0 && <DetailRow label={t("settings.model.detail.outputs")}><span className="flex flex-wrap justify-end gap-1">{model.outputModes.map((mode) => <span className="border bg-muted/40 px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground" key={mode}>{mode}</span>)}</span></DetailRow>}{budgetSummary && <DetailRow label={t("settings.model.detail.budgets")}><span>{budgetSummary}{budgetSizes && <span className="block text-[10px] font-normal text-muted-foreground">{budgetSizes}</span>}</span></DetailRow>}{model.meta?.tags && model.meta.tags.length > 0 && <DetailRow label={t("settings.model.detail.tags")}><span className="flex flex-wrap justify-end gap-1">{model.meta.tags.map((tag) => <span className="rounded-xs bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary" key={tag}>{tag}</span>)}</span></DetailRow>}</dl>{model.meta?.docsUrl && <a className="mt-auto inline-flex items-center justify-end gap-1 pt-3 text-[11px] text-primary hover:underline" href={model.meta.docsUrl} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank"><BookOpen className="size-3" />{t("settings.model.detail.docs")}</a>}</div>;
}

export function ModelPicker({ id, models, value, onChange, onConnect, providerName, credentialConnected }: { id: string; models: Model[]; value: string; onChange: (modelID: string) => void; onConnect?: () => void; providerName: (id: string) => string; credentialConnected?: (providerID: string) => boolean }) {
  const { t } = useI18n();
  const selected = models.find((model) => model.id === value);
  const retiredHidden = models.filter((model) => model.status === "retired").length;
  return <Popover><PopoverTrigger asChild><button aria-label={t("settings.model.choose")} className="flex min-h-9 w-full items-center justify-between gap-2 rounded-sm border bg-background px-2 py-1.5 text-left text-xs font-normal hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" id={id} type="button"><span className="min-w-0"><span className="block truncate font-medium">{selected ? modelTitle(t, selected) : t("settings.model.choose")}</span>{selected && <span className="mt-0.5 block truncate text-[10px] font-normal text-muted-foreground">{providerName(selected.provider)}</span>}</span><ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /></button></PopoverTrigger><PopoverContent align="start" className="w-[600px] z-[110] p-0"><PickerBody credentialConnected={credentialConnected} models={models} onConnect={onConnect} providerName={providerName} retiredHidden={retiredHidden} value={value} onChange={onChange} /></PopoverContent></Popover>;
}
