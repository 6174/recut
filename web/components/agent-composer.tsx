/*
 * [INPUT]: 依赖共享 Agent 会话配置类型、素材引用选择器、Agent runtime 安装状态与 UI 原子组件
 * [OUTPUT]: 对外提供消息输入区 Composer 及新会话 runtime 选择器 RuntimePicker；Composer 同时渲染用户选择的素材附件与自动附带、可移除的当前页面上下文 chip，并让文本区随内容增长至固定上限
 * [POS]: components Agent 对话模块的交互输入层；通过回调把发送、上传、配置保存交回面板控制器
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowUp, AtSign, Bot, Check, ChevronLeft, ChevronRight, CircleStop, FileText, ImagePlus, SlidersHorizontal, X } from "lucide-react";
import { type ClipboardEvent, type FormEvent, type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { RUNTIME_ORDER, runtimeAgentName, syntheticAgent, type AgentRuntimeStatus, type Runtime } from "@/components/agent-install-guide";
import { AssetReferenceChip, AssetReferenceDialog, AssetReferenceMenu, mediaReferenceIDs, mediaReferenceText } from "@/components/asset-reference-picker";
import { Button } from "@/components/ui/button";
import { codexModelLabel, defaultCodexConfiguration, defaultOpencodeConfiguration, opencodeModelLabel, opencodeProviderLabel, reasoningLabel, runtimeLabel, type AgentEvent, type Attachment, type CodexConfiguration, type OpencodeConfiguration, type OpencodeModel, type PageContext, type UploadedAsset } from "@/components/agent-panel-types";

const COMPOSER_TEXT_MAX_HEIGHT = 192;

export function Composer({
  apiBase,
  attachments,
  codexConfiguration,
  content,
  disabled,
  firstTurn,
  onAddAsset,
  onChange,
  onRemoveAttachment,
  onRemovePageContext,
  onSaveCodexConfiguration,
  onSaveOpencodeConfiguration,
  onSend,
  onStop,
  onUpload,
  opencodeConfiguration,
  opencodeModels,
  pageContext,
  pageContextIncluded,
  projectID,
  runtime,
  running,
  stopping,
  uploading,
}: {
  apiBase: string;
  attachments: Attachment[];
  codexConfiguration: CodexConfiguration;
  content: string;
  disabled: boolean;
  firstTurn: boolean;
  onAddAsset: (asset: UploadedAsset) => void;
  onChange: (value: string) => void;
  onRemoveAttachment: (assetID: string) => void;
  onRemovePageContext: () => void;
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
  pageContext: PageContext | null;
  pageContextIncluded: boolean;
  projectID: string | null;
  runtime: Runtime;
  running: boolean;
  stopping: boolean;
  uploading: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
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
  const configButtonTitle =
    runtime === "codex"
      ? "配置 Codex"
      : runtime === "opencode"
        ? "配置 OpenCode 模型"
        : "Claude Code 暂不支持运行时配置";
  const configDisabled = disabled || runtime === "claude";
  const configSummary =
    runtime === "codex"
      ? `${codexModelLabel(codexConfiguration.codexModel)} · ${reasoningLabel(codexConfiguration.reasoningEffort)}`
      : runtime === "opencode"
        ? opencodeModelLabel(opencodeConfiguration.opencodeModel)
        : "";
  const placeholder = firstTurn
    ? `告诉 AI 需要做什么，发送后将创建 ${runtimeAgentName(runtime)} 对话`
    : "告诉 AI 需要做什么，输入 @ 引用项目资源或素材库资源";
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
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((attachment) => (
              <AssetReferenceChip
                apiBase={apiBase}
                key={attachment.assetId}
                onRemove={() => onRemoveAttachment(attachment.assetId)}
                reference={attachment}
              />
            ))}
          </div>
        )}
        {pageContext && pageContextIncluded && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <PageContextChip
              onRemove={onRemovePageContext}
              selection={pageContext.selection}
              title={pageContext.title}
            />
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
              title="引用资源"
              type="button"
              variant="ghost"
            >
              <AtSign className="size-3.5" />
            </Button>
            <Button
              className="size-6 rounded-full p-0"
              disabled={disabled || uploading}
              onClick={() => fileInput.current?.click()}
              title="上传素材"
              type="button"
              variant="ghost"
            >
              <ImagePlus className="size-3.5" />
            </Button>
            {running && !stopping && (
              <Button
                className="size-6 rounded-full p-0"
                onClick={onStop}
                title="停止当前回复"
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
                  !(pageContext && pageContextIncluded))
              }
              title={
                firstTurn
                  ? `发送并创建 ${runtimeAgentName(runtime)} 对话`
                  : running
                    ? "加入待发送消息"
                    : "发送"
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
const reasoningEfforts = [
  ["low", "低"],
  ["medium", "中"],
  ["high", "高"],
  ["xhigh", "极高"],
  ["max", "最大"],
] as const;
function CodexConfigurationPopover({
  configuration,
  onChange,
}: {
  configuration: CodexConfiguration;
  onChange: (configuration: CodexConfiguration) => void;
}) {
  const [page, setPage] = useState<"menu" | "model" | "reasoning">("menu");
  if (page === "model")
    return (
      <ConfigurationChoices
        current={configuration.codexModel}
        label="模型"
        onBack={() => setPage("menu")}
        onChoose={(codexModel) => onChange({ ...configuration, codexModel })}
        options={codexModels}
      />
    );
  if (page === "reasoning")
    return (
      <ConfigurationChoices
        current={configuration.reasoningEffort}
        label="推理强度"
        onBack={() => setPage("menu")}
        onChoose={(reasoningEffort) =>
          onChange({ ...configuration, reasoningEffort })
        }
        options={reasoningEfforts}
      />
    );
  return (
    <section className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-md border bg-popover p-1.5 shadow-[var(--shadow-overlay)]">
      <ConfigurationMenuItem
        label="模型"
        onClick={() => setPage("model")}
        value={codexModelLabel(configuration.codexModel)}
      />
      <ConfigurationMenuItem
        label="推理强度"
        onClick={() => setPage("reasoning")}
        value={reasoningLabel(configuration.reasoningEffort)}
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
  const [query, setQuery] = useState("");
  const matchingModels = models.filter((model) =>
    model.id.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const providers = [...new Set(matchingModels.map((model) => model.provider))];
  return (
    <section className="absolute bottom-full left-0 z-30 mb-2 w-80 overflow-hidden rounded-md border bg-popover p-1.5 shadow-[var(--shadow-overlay)]">
      <p className="px-2 py-1.5 text-xs font-medium">模型</p>
      <label className="sr-only" htmlFor="opencode-model-search">
        搜索 OpenCode 模型
      </label>
      <input
        autoFocus
        className="mt-1 w-full rounded-sm border bg-background px-2.5 py-2 font-mono text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        id="opencode-model-search"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索模型或 provider"
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
              ? "未读取到 OpenCode 可用模型。"
              : "没有匹配的模型。"}
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
// PageContextChip mirrors the AssetReferenceChip visual so the auto-attached
// current page reads identically to a media attachment chip in the composer and
// the conversation history.
export function PageContextChip({
  onRemove,
  selection,
  title,
}: {
  onRemove?: () => void;
  selection?: string;
  title: string;
}) {
  return (
    <span className="group inline-flex h-7 max-w-60 items-center gap-1 rounded-sm border bg-secondary/70 py-0.5 pl-1 pr-1.5 text-[10px] text-foreground">
      <FileText className="size-3.5 shrink-0 text-primary" />
      <span className="truncate">
        当前页面 · {title}
        {selection ? ` · ${selection}` : ""}
      </span>
      {onRemove && (
        <button
          aria-label={`移除 ${title}`}
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
export function RunningStatus({ events, now }: { events: AgentEvent[]; now: number }) {
  const started = [...events]
    .reverse()
    .find((event) => event.type === "turn.started");
  const status =
    [...events].reverse().find((event) => event.type === "status")?.payload
      ?.label || "正在继续处理";
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
          暂未检测到任何 Agent
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
                {available ? "已就绪" : "未安装"}
              </span>
            </button>
          );
        })
      )}
    </section>
  );
}
