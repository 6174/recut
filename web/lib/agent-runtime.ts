/*
 * [INPUT]: 依赖 Recut service /v1/agents HTTP API
 * [OUTPUT]: 对外提供 firstAvailableAgentRuntime，按官方 runtime 顺序选取当前可用的 Agent，缺省 codex
 * [POS]: web/lib 的 App host 助手；用于 App iframe 的 agent.send 自动建会话
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

type AgentRuntimeStatus = { id: string; available: boolean };

const PREFERRED_ORDER = ["codex", "opencode", "claude"] as const;

export async function firstAvailableAgentRuntime(apiBase: string): Promise<string> {
  try {
    const response = await fetch(`${apiBase}/v1/agents`);
    if (!response.ok) return "codex";
    const agents = (await response.json()) as AgentRuntimeStatus[];
    for (const id of PREFERRED_ORDER) {
      if (agents.some((agent) => agent.id === id && agent.available)) return id;
    }
    if (agents.some((agent) => agent.available)) return agents.find((agent) => agent.available)!.id;
  } catch {
    // Network or parse failure: fall back to the default runtime rather than block the iframe call.
  }
  return "codex";
}
