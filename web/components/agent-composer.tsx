/*
 * [INPUT]: 依赖共享 Agent 会话配置类型、素材引用选择器、上下文目录运行时/选项构造、芯片 hover 预览、Agent runtime 安装状态与 UI 原子组件
 * [OUTPUT]: 对外提供 Composer 与 RuntimePicker（两者都只提供浮层内容、由宿主用 @/components/ui/popover 定位，点外部/Esc 自动收起）；上下文默认不附带，芯片行把「当前工作面 / 当前 Focus」作为虚线候选芯片直接摆出来供一键添加、随后以多行换行的紧凑芯片展示已添加项并保留「添加上下文」全量入口，所有芯片 hover 弹出完整预览，文本区随内容增长至固定上限
 * [POS]: components Agent 对话模块的交互输入层；让用户发送前明确看见 Agent 的目标与局部选区
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowUp, AtSign, Bot, Check, ChevronLeft, ChevronRight, CircleStop, FileText, Globe2, ImagePlus, Plus, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { RUNTIME_ORDER, runtimeAgentName, syntheticAgent, type AgentRuntimeStatus, type Runtime } from "@/components/agent-install-guide";
import { AssetReferenceChip } from "@/components/asset-reference-picker";
import { ChipPreviewPopover } from "@/components/context-panel/context-chip-preview";
import { ContextMentionPopover } from "@/components/context-panel/context-mention-popover";
import { RichComposer } from "@/components/rich-composer/rich-composer";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { codexModelLabel, defaultCodexConfiguration, defaultCommandcodeConfiguration, defaultOpencodeConfiguration, hasWorkFocusSelection, opencodeProviderLabel, runtimeLabel, type AgentEvent, type Attachment, type CodexConfiguration, type CommandcodeConfiguration, type CommandcodeModel, type OpencodeConfiguration, type OpencodeModel, type PickedContext, type UploadedAsset, type WorkFocusContext, type WorkSurfaceContext, type WorldReference } from "@/components/agent-panel-types";
import { resolveContextOption } from "@/lib/context-catalog/resolve";
import { useContextRuntime } from "@/lib/context-catalog/runtime";
import { focusOption, surfaceOption } from "@/lib/context-catalog/sources/current";
import type { ContextOption } from "@/lib/context-catalog/types";
import { useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";

// reasoningLabel 的本地化包装：字典缺失时回退原始 effort 值。
function localizedReasoningLabel(t: (key: string) => string, effort?: string): string {
  const value = effort ?? defaultCodexConfiguration.reasoningEffort;
  const key = `agent.composer.reasoning.${value}`;
  const label = t(key);
  return label !== key ? label : value;
}

export function Composer({
  apiBase,
  attachments,
  codexConfiguration,
  commandcodeConfiguration,
  commandcodeModels,
  content,
  disabled,
  firstTurn,
  onAddAsset,
  onAddWorkFocus,
  onAddWorkSurface,
  onAddWorld,
  onChange,
  onPickContext,
  onRemoveAttachment,
  onRemovePickedContext,
  onRemoveWorld,
  onRemoveWorkFocus,
  onRemoveWorkSurface,
  onSaveCodexConfiguration,
  onSaveCommandcodeConfiguration,
  onSaveOpencodeConfiguration,
  onSend,
  onStop,
  onUpload,
  opencodeConfiguration,
  opencodeModels,
  pickedContexts,
  workFocus,
  workFocusIncluded,
  workSurface,
  workSurfaceIncluded,
  projectID,
  runtime,
  running,
  stopping,
  uploading,
  worldReferences,
}: {
  apiBase: string;
  attachments: Attachment[];
  codexConfiguration: CodexConfiguration;
  commandcodeConfiguration: CommandcodeConfiguration;
  commandcodeModels: CommandcodeModel[];
  content: string;
  disabled: boolean;
  firstTurn: boolean;
  onAddAsset: (asset: UploadedAsset) => void;
  onAddWorkFocus: () => void;
  onAddWorkSurface: () => void;
  onAddWorld: (world: WorldReference) => void;
  onChange: (value: string) => void;
  onPickContext: (option: ContextOption) => void;
  onRemoveAttachment: (assetID: string) => void;
  onRemovePickedContext: (key: string) => void;
  onRemoveWorld: (worldID: string) => void;
  onRemoveWorkFocus: () => void;
  onRemoveWorkSurface: () => void;
  onSaveCodexConfiguration: (
    configuration: CodexConfiguration,
  ) => Promise<boolean>;
  onSaveCommandcodeConfiguration: (
    configuration: CommandcodeConfiguration,
  ) => Promise<boolean>;
  onSaveOpencodeConfiguration: (
    configuration: OpencodeConfiguration,
  ) => Promise<boolean>;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
  onStop: () => void;
  onUpload: (files: FileList | File[]) => void;
  opencodeConfiguration: OpencodeConfiguration;
  opencodeModels: OpencodeModel[];
  pickedContexts: PickedContext[];
  workFocus: WorkFocusContext | null;
  workFocusIncluded: boolean;
  workSurface: WorkSurfaceContext | null;
  workSurfaceIncluded: boolean;
  projectID: string | null;
  runtime: Runtime;
  running: boolean;
  stopping: boolean;
  uploading: boolean;
  worldReferences: WorldReference[];
}) {
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  // 芯片 hover 预览复用目录运行时快照；与 RichComposer 内部的实例共享 store 缓存，不产生额外请求。
  const contextRuntime = useContextRuntime({ apiBase, projectID, workSurface, workFocus });
  const workSurfacePreview = useMemo(() => surfaceOption(contextRuntime), [contextRuntime]);
  const workFocusPreview = useMemo(() => focusOption(contextRuntime), [contextRuntime]);
  // 已附带的目录键：既是 @ 面板的选中态，也用于把已添加项从候选里剔除。
  const attachedKeys = useMemo(
    () =>
      new Set([
        ...attachments.map((attachment) => `media:${attachment.assetId}`),
        ...worldReferences.map((world) => `creation_world:${world.worldId}`),
        ...pickedContexts.map((picked) => picked.key),
        ...(workSurface && workSurfaceIncluded && workSurfacePreview ? [workSurfacePreview.key] : []),
        ...(workFocusIncluded && workFocusPreview ? [workFocusPreview.key] : []),
      ]),
    [attachments, pickedContexts, workFocusIncluded, workFocusPreview, workSurface, workSurfaceIncluded, workSurfacePreview, worldReferences],
  );
  // 候选 = 当前工作面 / 当前 Focus，二者互相独立：各自都能单独添加、单独移除。
  // Focus 自身已概括整段选区（refs + 完整选择态），所以不再把每个 ref 拆成独立候选。
  const candidates = useMemo(() => {
    const raw = [surfaceOption(contextRuntime), focusOption(contextRuntime)];
    return raw.filter((option): option is ContextOption => option !== null && !attachedKeys.has(option.key));
  }, [attachedKeys, contextRuntime]);
  const composerValue = useMemo(
    () => ({ text: content, refs: [], isEmpty: content.trim().length === 0 }),
    [content],
  );
  async function saveCodex(next: CodexConfiguration) {
    if (await onSaveCodexConfiguration(next)) setConfigOpen(false);
  }
  async function saveOpencode(next: OpencodeConfiguration) {
    if (await onSaveOpencodeConfiguration(next)) setConfigOpen(false);
  }
  async function saveCommandcode(next: CommandcodeConfiguration) {
    if (await onSaveCommandcodeConfiguration(next)) setConfigOpen(false);
  }
  function pickAsset(asset: UploadedAsset) {
    onAddAsset(asset);
  }
  // @ 面板选择分流：媒体/World 走既有芯片，work_surface/focus 走 toggle，其余走通用 contexts。
  function handlePickContext(option: ContextOption) {
    if (option.sourceType === "media" && option.data && typeof option.data === "object") {
      const asset = option.data as UploadedAsset;
      if (asset.id) {
        pickAsset(asset);
        return;
      }
    }
    if (option.sourceType === "creation_world" && option.data && typeof option.data === "object") {
      const world = option.data as { id?: string; name?: string };
      if (world.id) {
        onAddWorld({ worldId: world.id, name: world.name ?? world.id });
        return;
      }
    }
    if (option.sourceType === "work_surface") {
      onAddWorkSurface();
      return;
    }
    if (option.sourceType === "work_focus") {
      onAddWorkFocus();
      return;
    }
    if (option.context) onPickContext(option);
  }
  function closeContextPanel() {
    setContextPanelOpen(false);
    composerRef.current?.querySelector<HTMLElement>(".recut-rich-composer")?.focus();
  }
  const configButtonTitle =
    runtime === "codex"
      ? t("agent.composer.config.codex")
      : runtime === "opencode"
        ? t("agent.composer.config.opencode")
        : runtime === "commandcode"
          ? t("agent.composer.config.commandcode")
          : t("agent.composer.config.claude");
  const configDisabled = disabled || runtime === "claude";
  const currentModel =
    runtime === "codex"
      ? codexConfiguration.codexModel
      : runtime === "opencode"
        ? opencodeConfiguration.opencodeModel
        : runtime === "commandcode"
          ? commandcodeConfiguration.commandcodeModel
          : "";
  const placeholder = firstTurn
    ? interpolate(t("agent.composer.placeholder.first"), { name: runtimeAgentName(runtime) })
    : t("agent.composer.placeholder");
  return (
    <form
      className="absolute inset-x-0 bottom-0 p-3"
      onSubmit={onSend}
      ref={formRef}
    >
      <div className="relative rounded-md border bg-popover px-3 py-2 shadow-[var(--shadow-overlay)]" ref={composerRef}>
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5">
          {attachments.map((attachment) => (
            <ChipPreviewPopover
              apiBase={apiBase}
              key={attachment.assetId}
              option={resolveContextOption("media", { assetid: attachment.assetId }, contextRuntime)}
              runtime={contextRuntime}
            >
              <AssetReferenceChip
                apiBase={apiBase}
                onRemove={() => onRemoveAttachment(attachment.assetId)}
                reference={attachment}
              />
            </ChipPreviewPopover>
          ))}
          {worldReferences.map((world) => (
            <ChipPreviewPopover
              apiBase={apiBase}
              key={world.worldId}
              option={resolveContextOption("creation_world", { worldid: world.worldId }, contextRuntime)}
              runtime={contextRuntime}
            >
              <button className="inline-flex h-7 max-w-40 shrink-0 items-center gap-1 rounded-sm border bg-secondary/70 py-0.5 pl-1.5 pr-1.5 text-[10px] text-foreground" onClick={() => onRemoveWorld(world.worldId)} title={interpolate(t("agent.composer.removeWorld"), { name: world.name })} type="button">
                <Globe2 className="size-3 text-primary" />
                <span className="truncate">{world.name}</span>
                <X className="size-3 text-muted-foreground" />
              </button>
            </ChipPreviewPopover>
          ))}
          {workSurface && workSurfaceIncluded && (
            <ChipPreviewPopover apiBase={apiBase} option={workSurfacePreview} runtime={contextRuntime}>
              <WorkSurfaceChip onRemove={onRemoveWorkSurface} surface={workSurface} />
            </ChipPreviewPopover>
          )}
          {hasWorkFocusSelection(workFocus) && workFocus && workFocusIncluded && (
            <ChipPreviewPopover apiBase={apiBase} option={workFocusPreview} runtime={contextRuntime}>
              <WorkFocusChip focus={workFocus} onRemove={onRemoveWorkFocus} />
            </ChipPreviewPopover>
          )}
          {pickedContexts.map((picked) => (
            <ChipPreviewPopover
              apiBase={apiBase}
              fallback={{ title: picked.title, subtitle: picked.sourceType, facts: Object.entries(picked.context.payload).map(([key, value]) => ({ key, label: key, value: String(value) })) }}
              key={picked.key}
              runtime={contextRuntime}
            >
              <button className="inline-flex h-7 max-w-40 shrink-0 items-center gap-1 rounded-sm border bg-secondary/70 py-0.5 pl-1.5 pr-1.5 text-[10px] text-foreground" onClick={() => onRemovePickedContext(picked.key)} title={`${picked.sourceType} · ${picked.title}`} type="button">
                <AtSign className="size-3 text-primary" />
                <span className="truncate">{picked.title}</span>
                <X className="size-3 text-muted-foreground" />
              </button>
            </ChipPreviewPopover>
          ))}
          {candidates.map((option) => (
            <ChipPreviewPopover apiBase={apiBase} key={option.key} option={option} runtime={contextRuntime}>
              <button
                aria-label={interpolate(t("agent.composer.addContextItem"), { name: candidateLabel(option, t) })}
                className="group inline-flex h-7 max-w-40 shrink-0 items-center gap-1 rounded-sm border border-dashed py-0.5 pl-1.5 pr-1.5 text-[10px] text-muted-foreground hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled || uploading}
                onClick={() => handlePickContext(option)}
                type="button"
              >
                <span className="min-w-0 truncate">{candidateLabel(option, t)}</span>
                <Plus className="size-3 shrink-0" />
              </button>
            </ChipPreviewPopover>
          ))}
          <button
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm border border-dashed px-1.5 text-[10px] text-muted-foreground hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || uploading}
            onClick={() => setContextPanelOpen(true)}
            title={t("agent.composer.addContext")}
            type="button"
          >
            <Plus className="size-3" />
            {t("agent.composer.addContext")}
          </button>
        </div>
        <RichComposer
          apiBase={apiBase}
          autoFocus={false}
          disabled={disabled}
          minRows={3}
          mode="referencing"
          onChange={(next) => onChange(next.text)}
          onPasteFiles={(files) => onUpload(files)}
          onSubmit={() => formRef.current?.requestSubmit()}
          placeholder={placeholder}
          projectID={projectID}
          value={composerValue}
          variant="composer"
          workFocus={workFocus}
          workSurface={workSurface}
        />
        <div className="mt-1 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-1.5">
          <Popover onOpenChange={setConfigOpen} open={configOpen}>
            <PopoverTrigger asChild>
              <Button
                aria-label={configButtonTitle}
                className="size-6 rounded-full p-0 text-muted-foreground hover:text-foreground"
                disabled={configDisabled}
                title={configButtonTitle}
                type="button"
                variant="ghost"
              >
                <Bot className="size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className={runtime === "opencode" || runtime === "commandcode" ? "w-80 p-1.5" : "w-72 p-1.5"}
              side="top"
              sideOffset={8}
            >
              {runtime === "codex" && (
                <CodexConfigurationPopover
                  configuration={codexConfiguration}
                  onChange={(next) => void saveCodex(next)}
                />
              )}
              {runtime === "opencode" && (
                <OpencodeConfigurationPopover
                  configuration={opencodeConfiguration}
                  models={opencodeModels}
                  onChange={(next) => void saveOpencode(next)}
                />
              )}
              {runtime === "commandcode" && (
                <CommandcodeConfigurationPopover
                  configuration={commandcodeConfiguration}
                  models={commandcodeModels}
                  onChange={(next) => void saveCommandcode(next)}
                />
              )}
            </PopoverContent>
          </Popover>
          {currentModel && (
            <span
              className="min-w-0 max-w-[180px] truncate font-mono text-[10px] text-muted-foreground"
              title={currentModel}
            >
              {currentModel}
            </span>
          )}
          </div>
          <div className="flex items-center gap-1">
            <input
              accept="image/*,video/*,audio/*"
              className="hidden"
              multiple
              onChange={(event) => {
                if (event.target.files) onUpload(event.target.files);
                event.currentTarget.value = "";
              }}
              ref={fileInput}
              type="file"
            />
            <Button
              className="size-6 rounded-full p-0"
              disabled={disabled || uploading}
              onClick={() => setContextPanelOpen((value) => !value)}
              title={t("agent.composer.reference")}
              type="button"
              variant="ghost"
            >
              <AtSign className="size-3.5" />
            </Button>
            <Button
              className="size-6 rounded-full p-0"
              disabled={disabled || uploading}
              onClick={() => fileInput.current?.click()}
              title={t("agent.composer.upload")}
              type="button"
              variant="ghost"
            >
              <ImagePlus className="size-3.5" />
            </Button>
            {running && !stopping && (
              <Button
                className="size-6 rounded-full p-0"
                onClick={onStop}
                title={t("agent.composer.stop")}
                type="button"
                variant="outline"
              >
                <CircleStop className="size-3" />
              </Button>
            )}
            <Button
              className="size-6 rounded-full p-0"
              disabled={
                disabled ||
                uploading ||
                (!content.trim() &&
                  !attachments.length &&
                  !worldReferences.length &&
                  !pickedContexts.length &&
                  !(workSurface && workSurfaceIncluded) &&
                  !(hasWorkFocusSelection(workFocus) && workFocusIncluded))
              }
              title={
                firstTurn
                  ? interpolate(t("agent.composer.sendCreate"), { name: runtimeAgentName(runtime) })
                  : running
                    ? t("agent.composer.sendQueued")
                    : t("agent.composer.send")
              }
              type="submit"
            >
              <ArrowUp className="size-3" />
            </Button>
          </div>
        </div>
      </div>
      {contextPanelOpen && (
        <ContextMentionPopover
          anchor={composerRef.current}
          apiBase={apiBase}
          onCancel={closeContextPanel}
          onDismiss={() => setContextPanelOpen(false)}
          onPick={(option, keepOpen) => {
            handlePickContext(option);
            if (!keepOpen) closeContextPanel();
          }}
          open={contextPanelOpen}
          projectID={projectID}
          selectedKeys={attachedKeys}
          workFocus={workFocus}
          workSurface={workSurface}
        />
      )}
    </form>
  );
}

const codexModels = [
  ["gpt-5.6-sol", "5.6 Sol"],
  ["gpt-5.6-terra", "5.6 Terra"],
  ["gpt-5.6-luna", "5.6 Luna"],
  ["gpt-5.5", "5.5"],
  ["gpt-5.4", "5.4"],
  ["gpt-5.4-mini", "5.4 Mini"],
  ["gpt-5.2", "5.2"],
] as const;
const reasoningEfforts = ["low", "medium", "high", "xhigh", "max"] as const;
function CodexConfigurationPopover({
  configuration,
  onChange,
}: {
  configuration: CodexConfiguration;
  onChange: (configuration: CodexConfiguration) => void;
}) {
  const { t } = useI18n();
  const [page, setPage] = useState<"menu" | "model" | "reasoning">("menu");
  if (page === "model")
    return (
      <ConfigurationChoices
        current={configuration.codexModel}
        label={t("agent.composer.model")}
        onBack={() => setPage("menu")}
        onChoose={(codexModel) => onChange({ ...configuration, codexModel })}
        options={codexModels}
      />
    );
  if (page === "reasoning")
    return (
      <ConfigurationChoices
        current={configuration.reasoningEffort}
        label={t("agent.composer.reasoning")}
        onBack={() => setPage("menu")}
        onChoose={(reasoningEffort) =>
          onChange({ ...configuration, reasoningEffort })
        }
        options={reasoningEfforts.map((value) => [value, t(`agent.composer.reasoning.${value}`)] as const)}
      />
    );
  return (
    <section>
      <ConfigurationMenuItem
        label={t("agent.composer.model")}
        onClick={() => setPage("model")}
        value={codexModelLabel(configuration.codexModel)}
      />
      <ConfigurationMenuItem
        label={t("agent.composer.reasoning")}
        onClick={() => setPage("reasoning")}
        value={localizedReasoningLabel(t, configuration.reasoningEffort)}
      />
    </section>
  );
}
function OpencodeConfigurationPopover({
  configuration,
  models,
  onChange,
}: {
  configuration: OpencodeConfiguration;
  models: OpencodeModel[];
  onChange: (configuration: OpencodeConfiguration) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const selectedRef = useRef<HTMLButtonElement>(null);
  const matchingModels = models.filter((model) =>
    model.id.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const providers = [...new Set(matchingModels.map((model) => model.provider))];
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [models.length]);
  return (
    <section>
      <div className="flex items-baseline justify-between gap-2 px-2 py-1.5">
        <p className="shrink-0 text-xs font-medium">{t("agent.composer.currentModel")}</p>
        <p
          className="min-w-0 truncate font-mono text-[10px] text-muted-foreground"
          title={configuration.opencodeModel}
        >
          {configuration.opencodeModel}
        </p>
      </div>
      <label className="sr-only" htmlFor="opencode-model-search">
        {t("agent.composer.searchModel")}
      </label>
      <input
        autoFocus
        className="mt-1 w-full rounded-sm border bg-background px-2.5 py-2 font-mono text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        id="opencode-model-search"
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("agent.composer.searchPlaceholder")}
        type="search"
        value={query}
      />
      <div className="mt-1 max-h-80 space-y-2 overflow-y-auto border-t pt-2">
        {providers.map((provider) => (
          <section key={provider}>
            <p className="px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
              {opencodeProviderLabel(provider)}
            </p>
            {matchingModels
              .filter((model) => model.provider === provider)
              .map((model) => {
                const selected = model.id === configuration.opencodeModel;
                return (
                  <button
                    className={`flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs hover:bg-muted ${selected ? "bg-secondary/60" : ""}`}
                    key={model.id}
                    onClick={() => onChange({ opencodeModel: model.id })}
                    ref={selected ? selectedRef : undefined}
                    type="button"
                  >
                    <span className="min-w-0 flex-1 break-all font-mono text-[10px]">
                      {model.id}
                    </span>
                    {selected && (
                      <Check className="size-3.5 shrink-0 text-primary" />
                    )}
                  </button>
                );
              })}
          </section>
        ))}
        {matchingModels.length === 0 && (
          <p className="px-2.5 py-3 text-xs text-muted-foreground">
            {models.length === 0
              ? t("agent.composer.noModels")
              : t("agent.composer.noMatch")}
          </p>
        )}
      </div>
    </section>
  );
}
function CommandcodeConfigurationPopover({
  configuration,
  models,
  onChange,
}: {
  configuration: CommandcodeConfiguration;
  models: CommandcodeModel[];
  onChange: (configuration: CommandcodeConfiguration) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const selectedRef = useRef<HTMLButtonElement>(null);
  const matchingModels = models.filter((model) =>
    model.id.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const providers = [...new Set(matchingModels.map((model) => model.provider))];
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [models.length]);
  return (
    <section>
      <div className="flex items-baseline justify-between gap-2 px-2 py-1.5">
        <p className="shrink-0 text-xs font-medium">
          {t("agent.composer.currentModel")}
        </p>
        <p
          className="min-w-0 truncate font-mono text-[10px] text-muted-foreground"
          title={configuration.commandcodeModel}
        >
          {configuration.commandcodeModel ||
            defaultCommandcodeConfiguration.commandcodeModel}
        </p>
      </div>
      <label className="sr-only" htmlFor="commandcode-model-search">
        {t("agent.composer.searchModel.commandcode")}
      </label>
      <input
        autoFocus
        className="mt-1 w-full rounded-sm border bg-background px-2.5 py-2 font-mono text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        id="commandcode-model-search"
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("agent.composer.searchPlaceholder")}
        type="search"
        value={query}
      />
      <div className="mt-1 max-h-80 space-y-2 overflow-y-auto border-t pt-2">
        {providers.map((provider) => (
          <section key={provider}>
            <p className="px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
              {provider}
            </p>
            {matchingModels
              .filter((model) => model.provider === provider)
              .map((model) => {
                const selected = model.id === configuration.commandcodeModel;
                return (
                  <button
                    className={`flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs hover:bg-muted ${selected ? "bg-secondary/60" : ""}`}
                    key={model.id}
                    onClick={() => onChange({ commandcodeModel: model.id })}
                    ref={selected ? selectedRef : undefined}
                    type="button"
                  >
                    <span className="min-w-0 flex-1 break-all font-mono text-[10px]">
                      {model.id}
                    </span>
                    {selected && (
                      <Check className="size-3.5 shrink-0 text-primary" />
                    )}
                  </button>
                );
              })}
          </section>
        ))}
        {matchingModels.length === 0 && (
          <p className="px-2.5 py-3 text-xs text-muted-foreground">
            {models.length === 0
              ? t("agent.composer.noModels.commandcode")
              : t("agent.composer.noMatch")}
          </p>
        )}
      </div>
    </section>
  );
}
function ConfigurationMenuItem({
  label,
  onClick,
  value,
}: {
  label: string;
  onClick: () => void;
  value: string;
}) {
  return (
    <button
      className="flex w-full items-center gap-3 rounded-sm px-2.5 py-2 text-left text-xs hover:bg-muted"
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <span className="ml-auto truncate text-muted-foreground">{value}</span>
      <ChevronRight className="size-3.5 text-muted-foreground" />
    </button>
  );
}
function ConfigurationChoices({
  current,
  label,
  onBack,
  onChoose,
  options,
}: {
  current: string;
  label: string;
  onBack: () => void;
  onChoose: (value: string) => void;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <section>
      <button
        className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-muted"
        onClick={onBack}
        type="button"
      >
        <ChevronLeft className="size-3.5" />
        {label}
      </button>
      <div className="mt-1 border-t pt-1">
        {options.map(([value, optionLabel]) => (
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs hover:bg-muted"
            key={value}
            onClick={() => onChoose(value)}
            type="button"
          >
            <span>{optionLabel}</span>
            {value === current && (
              <Check className="ml-auto size-3.5 text-primary" />
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
// WorkSurfaceChip mirrors the AssetReferenceChip visual, while naming the
// concrete object the Agent will operate on instead of a vague current page.
export function WorkSurfaceChip({
  onRemove,
  surface,
}: {
  onRemove?: () => void;
  surface: WorkSurfaceContext;
}) {
  const { t } = useI18n();
  const label = interpolate(t("agent.composer.workSurface"), { title: surface.title });
  const guidance = workSurfaceGuidance(surface, t);
  return (
    <span className="group inline-flex h-7 max-w-40 shrink-0 items-center gap-1 rounded-sm border bg-secondary/70 py-0.5 pl-1.5 pr-1.5 text-[10px] text-foreground" title={`${label} · ${guidance}`}>
      <FileText className="size-3 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{label}</span>
      {onRemove && (
        <button
          aria-label={interpolate(t("agent.composer.removeWorkSurface"), { title: surface.title })}
          className="ml-0.5 grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
          onClick={onRemove}
          type="button"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

// 候选芯片的文案与已附带芯片保持一致：当前工作面/Focus 用同一组前缀，其余直接用目录标题。
function candidateLabel(option: ContextOption, t: (key: string) => string): string {
  if (option.sourceType === "work_surface") return interpolate(t("agent.composer.workSurface"), { title: option.title });
  if (option.sourceType === "work_focus") return interpolate(t("agent.composer.workFocus"), { summary: option.title });
  return option.title;
}

function workSurfaceGuidance(surface: WorkSurfaceContext, t: (key: string) => string) {
  if (surface.target?.kind === "project") return t("agent.composer.workSurfaceProject");
  if (surface.target?.kind === "world") return t("agent.composer.workSurfaceWorld");
  if (surface.target?.kind === "media_library") return t("agent.composer.workSurfaceMedia");
  if (surface.target?.kind === "app_scope") return t("agent.composer.workSurfaceApp");
  return t("agent.composer.workSurfaceBrowse");
}

export function WorkFocusChip({ focus, onRemove }: { focus: WorkFocusContext; onRemove?: () => void }) {
  const { t } = useI18n();
  const label = interpolate(t("agent.composer.workFocus"), { summary: focus.summary || focus.view || t("agent.composer.workFocusDefault") });
  return (
    <span className="group inline-flex h-7 max-w-40 shrink-0 items-center gap-1 rounded-sm border bg-secondary/70 py-0.5 pl-1 pr-1.5 text-[10px] text-foreground" title={label}>
      <FileText className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
      {onRemove && <button aria-label={t("agent.composer.removeWorkFocus")} className="ml-0.5 grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground" onClick={onRemove} type="button">
        <X className="size-3" />
      </button>}
    </span>
  );
}
export function RunningStatus({ events, now }: { events: AgentEvent[]; now: number }) {
  const { t } = useI18n();
  const started = [...events]
    .reverse()
    .find((event) => event.type === "turn.started");
  const status =
    [...events].reverse().find((event) => event.type === "status")?.payload
      ?.label || t("agent.composer.statusWorking");
  const elapsed = started
    ? Math.max(
        0,
        Math.floor((now - new Date(started.createdAt).getTime()) / 1000),
      )
    : 0;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="size-1.5 animate-pulse rounded-full bg-success" />
      {status} · {elapsed}s
    </p>
  );
}
export function ActionIcon({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      className="grid size-6 place-items-center rounded-sm hover:bg-muted hover:text-foreground [&>svg]:size-3"
      type="button"
    >
      {children}
    </button>
  );
}
export function RuntimePicker({
  creating,
  onChoose,
  onInstall,
  runtimeStatus,
}: {
  creating: boolean;
  onChoose: (runtime: Runtime) => void;
  onInstall: (agent: AgentRuntimeStatus) => void;
  runtimeStatus: AgentRuntimeStatus[];
}) {
  const { t } = useI18n();
  // Show every supported runtime, even ones the backend has not yet reported. Missing
  // entries get a synthetic placeholder so the user can still trigger the install dialog.
  const rows = RUNTIME_ORDER.map((runtime) => ({
    runtime,
    status:
      runtimeStatus.find((agent) => agent.id === runtime) ??
      syntheticAgent(runtime),
  }));
  return (
    <section>
      {rows.length === 0 ? (
        <p className="px-2 py-3 text-center text-xs text-muted-foreground">
          {t("agent.composer.noAgent")}
        </p>
      ) : (
        rows.map(({ runtime, status }) => {
          const available = status.available;
          return (
            <button
              className={`flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${creating ? "cursor-not-allowed opacity-50" : ""}`}
              disabled={creating}
              key={runtime}
              onClick={() =>
                available ? onChoose(runtime) : onInstall(status)
              }
              type="button"
            >
              <span className="font-medium">{runtimeLabel(runtime)}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {available ? t("agent.composer.ready") : t("agent.composer.notInstalled")}
              </span>
            </button>
          );
        })
      )}
    </section>
  );
}
