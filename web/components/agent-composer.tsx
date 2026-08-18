/*
 * [INPUT]: 依赖共享 Agent 会话配置类型、素材引用选择器、Agent runtime 安装状态与 UI 原子组件
 * [OUTPUT]: 对外提供 Composer 与 RuntimePicker；以单行紧凑芯片展示素材、Work Surface 与 Focus，悬浮查看完整上下文，并让文本区随内容增长至固定上限
 * [POS]: components Agent 对话模块的交互输入层；让用户发送前明确看见 Agent 的目标与局部选区
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowUp, AtSign, Bot, Check, ChevronLeft, ChevronRight, CircleStop, FileText, Globe2, ImagePlus, SlidersHorizontal, X } from "lucide-react";
import { type ClipboardEvent, type FormEvent, type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { RUNTIME_ORDER, runtimeAgentName, syntheticAgent, type AgentRuntimeStatus, type Runtime } from "@/components/agent-install-guide";
import { AssetReferenceChip, AssetReferenceDialog, AssetReferenceMenu, mediaReferenceIDs, mediaReferenceText } from "@/components/asset-reference-picker";
import { WorldPicker, type WorldPick } from "@/components/world-picker";
import { Button } from "@/components/ui/button";
import { codexModelLabel, defaultCodexConfiguration, defaultOpencodeConfiguration, opencodeModelLabel, opencodeProviderLabel, runtimeLabel, type AgentEvent, type Attachment, type CodexConfiguration, type OpencodeConfiguration, type OpencodeModel, type UploadedAsset, type WorkFocusContext, type WorkSurfaceContext, type WorldReference } from "@/components/agent-panel-types";
import { useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";

const COMPOSER_TEXT_MAX_HEIGHT = 192;

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
  content,
  disabled,
  firstTurn,
  onAddAsset,
  onAddWorld,
  onChange,
  onRemoveAttachment,
  onRemoveWorld,
  onRemoveWorkFocus,
  onRemoveWorkSurface,
  onSaveCodexConfiguration,
  onSaveOpencodeConfiguration,
  onSend,
  onStop,
  onUpload,
  opencodeConfiguration,
  opencodeModels,
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
  content: string;
  disabled: boolean;
  firstTurn: boolean;
  onAddAsset: (asset: UploadedAsset) => void;
  onAddWorld: (world: WorldReference) => void;
  onChange: (value: string) => void;
  onRemoveAttachment: (assetID: string) => void;
  onRemoveWorld: (worldID: string) => void;
  onRemoveWorkFocus: () => void;
  onRemoveWorkSurface: () => void;
  onSaveCodexConfiguration: (
    configuration: CodexConfiguration,
  ) => Promise<boolean>;
  onSaveOpencodeConfiguration: (
    configuration: OpencodeConfiguration,
  ) => Promise<boolean>;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
  onStop: () => void;
  onUpload: (files: FileList | File[]) => void;
  opencodeConfiguration: OpencodeConfiguration;
  opencodeModels: OpencodeModel[];
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
  const textInput = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [worldPickerOpen, setWorldPickerOpen] = useState(false);
  function pasteMedia(event: ClipboardEvent<HTMLTextAreaElement>) {
    const text = event.clipboardData.getData("text/plain");
    const ids = mediaReferenceIDs(text);
    const files = [...event.clipboardData.files].filter((file) =>
      /^(image|video|audio)\//.test(file.type),
    );
    if (ids.length || files.length) event.preventDefault();
    if (files.length) onUpload(files);
    if (ids.length) {
      onChange(`${content}${mediaReferenceText(text)}`);
      void Promise.all(
        ids.map(async (id) => {
          const response = await fetch(
            `${apiBase}/v1/media/assets/${encodeURIComponent(id)}`,
          );
          if (!response.ok) return;
          onAddAsset((await response.json()) as UploadedAsset);
        }),
      );
    }
  }
  async function saveCodex(next: CodexConfiguration) {
    if (await onSaveCodexConfiguration(next)) setConfigOpen(false);
  }
  async function saveOpencode(next: OpencodeConfiguration) {
    if (await onSaveOpencodeConfiguration(next)) setConfigOpen(false);
  }
  const mention = content.match(/@([^\s@]*)$/)?.[1];
  function pickAsset(asset: UploadedAsset) {
    onAddAsset(asset);
    onChange(content.replace(/@([^\s@]*)$/, ""));
  }
  function pickWorld(world: WorldPick) {
    onAddWorld({ worldId: world.worldId, name: world.name });
    onChange(content.replace(/@([^\s@]*)$/, ""));
  }
  const configButtonTitle =
    runtime === "codex"
      ? t("agent.composer.config.codex")
      : runtime === "opencode"
        ? t("agent.composer.config.opencode")
        : t("agent.composer.config.claude");
  const configDisabled = disabled || runtime === "claude";
  const configSummary =
    runtime === "codex"
      ? `${codexModelLabel(codexConfiguration.codexModel)} · ${localizedReasoningLabel(t, codexConfiguration.reasoningEffort)}`
      : runtime === "opencode"
        ? opencodeModelLabel(opencodeConfiguration.opencodeModel)
        : "";
  const placeholder = firstTurn
    ? interpolate(t("agent.composer.placeholder.first"), { name: runtimeAgentName(runtime) })
    : t("agent.composer.placeholder");
  function resizeTextInput() {
    const input = textInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, COMPOSER_TEXT_MAX_HEIGHT)}px`;
  }
  useLayoutEffect(resizeTextInput, [content]);
  return (
    <form
      className="absolute inset-x-0 bottom-0 border-t bg-card p-3"
      onSubmit={onSend}
    >
      <div className="relative rounded-md border bg-popover px-3 py-2 shadow-[var(--shadow-overlay)]">
        {(attachments.length > 0 || worldReferences.length > 0 || (workSurface && workSurfaceIncluded) || (workFocus && workFocusIncluded && workSurface && workSurfaceIncluded)) && (
          <div className="mb-2 flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {attachments.map((attachment) => (
              <AssetReferenceChip
                apiBase={apiBase}
                key={attachment.assetId}
                onRemove={() => onRemoveAttachment(attachment.assetId)}
                reference={attachment}
              />
            ))}
            {worldReferences.map((world) => (
              <button className="inline-flex h-7 max-w-60 shrink-0 items-center gap-1 rounded-sm border bg-secondary/70 py-0.5 pl-1.5 pr-1.5 text-[10px] text-foreground" key={world.worldId} onClick={() => onRemoveWorld(world.worldId)} title={interpolate(t("agent.composer.removeWorld"), { name: world.name })} type="button">
                <Globe2 className="size-3 text-primary" />
                <span className="truncate">{world.name}</span>
                <X className="size-3 text-muted-foreground" />
              </button>
            ))}
            {workSurface && workSurfaceIncluded && <WorkSurfaceChip onRemove={onRemoveWorkSurface} surface={workSurface} />}
            {workFocus && workFocusIncluded && workSurface && workSurfaceIncluded && <WorkFocusChip focus={workFocus} onRemove={onRemoveWorkFocus} />}
          </div>
        )}
        <textarea
          className="block min-h-12 w-full resize-none overflow-y-auto bg-transparent py-0.5 text-xs leading-5 outline-none"
          disabled={disabled}
          onChange={(event) => {
            resizeTextInput();
            onChange(event.target.value);
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              !composing.current
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          onPaste={pasteMedia}
          placeholder={placeholder}
          ref={textInput}
          value={content}
        />
        {mention !== undefined && (
          <AssetReferenceMenu
            apiBase={apiBase}
            onOpenLibrary={() => setLibraryOpen(true)}
            onOpenWorlds={() => setWorldPickerOpen(true)}
            onPick={pickAsset}
            projectID={projectID}
            query={mention}
            selectedIDs={attachments.map((attachment) => attachment.assetId)}
          />
        )}
        <div className="mt-1 flex items-center justify-between">
          <div className="relative min-w-0 flex-1">
            <button
              aria-expanded={configOpen}
              className="flex min-h-8 w-full min-w-0 items-center gap-1.5 rounded-sm px-1 text-left text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed"
              disabled={configDisabled}
              onClick={() => setConfigOpen((value) => !value)}
              title={configButtonTitle}
              type="button"
            >
              <Bot className="size-3" />
              <span>{runtimeLabel(runtime)}</span>
              {configSummary && (
                <span className="min-w-0 truncate text-muted-foreground/70">
                  {configSummary}
                </span>
              )}
              <SlidersHorizontal className="size-3.5" />
            </button>
            {configOpen && runtime === "codex" && (
              <CodexConfigurationPopover
                configuration={codexConfiguration}
                onChange={(next) => void saveCodex(next)}
              />
            )}
            {configOpen && runtime === "opencode" && (
              <OpencodeConfigurationPopover
                configuration={opencodeConfiguration}
                models={opencodeModels}
                onChange={(next) => void saveOpencode(next)}
              />
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
              onClick={() => setLibraryOpen(true)}
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
                  !(workSurface && workSurfaceIncluded))
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
      <AssetReferenceDialog
        apiBase={apiBase}
        onClose={() => setLibraryOpen(false)}
        onPick={(asset) => {
          pickAsset(asset);
          setLibraryOpen(false);
        }}
        open={libraryOpen}
        projectID={projectID}
        selectedIDs={attachments.map((attachment) => attachment.assetId)}
      />
      <WorldPicker apiBase={apiBase} onClose={() => setWorldPickerOpen(false)} onPick={(world) => { pickWorld(world); setWorldPickerOpen(false); }} open={worldPickerOpen} />
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
    <section className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-md border bg-popover p-1.5 shadow-[var(--shadow-overlay)]">
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
  const matchingModels = models.filter((model) =>
    model.id.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const providers = [...new Set(matchingModels.map((model) => model.provider))];
  return (
    <section className="absolute bottom-full left-0 z-30 mb-2 w-80 overflow-hidden rounded-md border bg-popover p-1.5 shadow-[var(--shadow-overlay)]">
      <p className="px-2 py-1.5 text-xs font-medium">{t("agent.composer.model")}</p>
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
              .map((model) => (
                <button
                  className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs hover:bg-muted"
                  key={model.id}
                  onClick={() => onChange({ opencodeModel: model.id })}
                  type="button"
                >
                  <span className="min-w-0 flex-1 break-all font-mono text-[10px]">
                    {model.id}
                  </span>
                  {model.id === configuration.opencodeModel && (
                    <Check className="size-3.5 shrink-0 text-primary" />
                  )}
                </button>
              ))}
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
    <section className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-md border bg-popover p-1.5 shadow-[var(--shadow-overlay)]">
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
    <span className="group inline-flex h-7 max-w-60 shrink-0 items-center gap-1 rounded-sm border bg-secondary/70 py-0.5 pl-1.5 pr-1.5 text-[10px] text-foreground" title={`${label} · ${guidance}`}>
      <FileText className="size-3 shrink-0 text-primary" />
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
    <span className="group inline-flex h-7 max-w-60 shrink-0 items-center gap-1 rounded-sm border bg-secondary/70 py-0.5 pl-1 pr-1.5 text-[10px] text-foreground" title={label}>
      <FileText className="size-3 shrink-0 text-primary" />
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
    <section className="absolute right-3 top-14 z-30 w-[calc(100%-1.5rem)] overflow-hidden rounded-md border bg-popover p-1.5 shadow-[var(--shadow-overlay)]">
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
