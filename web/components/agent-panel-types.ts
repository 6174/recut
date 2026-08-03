/*
 * [INPUT]: 依赖 Agent runtime 与素材引用类型
 * [OUTPUT]: 对外提供 Agent 会话、Turn、事件、配置与面板 Props 的共享类型及默认配置
 * [POS]: components Agent 对话模块的唯一数据契约；被面板控制器、会话视图与输入区共同消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Runtime } from "@/components/agent-install-guide";
import type { AssetReference } from "@/components/asset-reference-picker";

export function runtimeLabel(runtime: string): string {
  return (
    (
      { codex: "Codex", opencode: "OpenCode", claude: "Claude Code" } as Record<
        string,
        string
      >
    )[runtime] ?? runtime
  );
}

export type Session = {
  id: string;
  title: string;
  runtime: string;
  status: string;
  updatedAt: string;
  projectName?: string;
  appId?: string;
  codexModel?: string;
  reasoningEffort?: string;
  opencodeModel?: string;
};
export type CodexConfiguration = { codexModel: string; reasoningEffort: string };
export const defaultCodexConfiguration: CodexConfiguration = {
  codexModel: "gpt-5.6-terra",
  reasoningEffort: "xhigh",
};
export type OpencodeConfiguration = { opencodeModel: string };
export type OpencodeModel = { id: string; provider: string };
export const defaultOpencodeConfiguration: OpencodeConfiguration = {
  opencodeModel: "opencode-go/deepseek-v4-flash",
};
export type Attachment = AssetReference;
export type UploadedAsset = {
  id: string;
  name: string;
  mimeType: string;
  kind: Attachment["kind"];
  origin: string;
  status: string;
};
export type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  attachments?: Attachment[];
};
export type ToolPayload = {
  label?: string;
  message?: string;
  phase?: string;
  toolCallId?: string;
  tool?: string;
  toolName?: string;
  detail?: string;
  input?: string;
  output?: string;
  error?: string;
  cost?: string;
};
export type AgentEvent = {
  id: number;
  turnId?: string;
  type: string;
  createdAt: string;
  payload?: ToolPayload;
};
export type CLIEntry = {
  sequence: number;
  stream: "stdout" | "stderr";
  text: string;
  createdAt: string;
};
export type Detail = Session & {
  turns: Turn[];
  events: AgentEvent[];
  lastEventId: number;
};
export type Props = { apiBase: string; online: boolean; projectID: string | null };


export function codexModelLabel(model?: string) {
  return (
    (
      {
        "gpt-5.6-sol": "5.6 Sol",
        "gpt-5.6-terra": "5.6 Terra",
        "gpt-5.6-luna": "5.6 Luna",
        "gpt-5.5": "5.5",
        "gpt-5.4": "5.4",
        "gpt-5.4-mini": "5.4 Mini",
        "gpt-5.2": "5.2",
      } as Record<string, string>
    )[model || defaultCodexConfiguration.codexModel] ?? "Codex"
  );
}
export function reasoningLabel(effort?: string) {
  return (
    (
      {
        low: "低",
        medium: "中",
        high: "高",
        xhigh: "极高",
        max: "最大",
      } as Record<string, string>
    )[effort || defaultCodexConfiguration.reasoningEffort] ?? "默认推理"
  );
}
export function opencodeModelLabel(model?: string) {
  return model || defaultOpencodeConfiguration.opencodeModel;
}
export function opencodeProviderLabel(provider: string) {
  return provider === "opencode"
    ? "OpenCode Zen"
    : provider === "opencode-go"
      ? "OpenCode Go"
      : provider;
}
