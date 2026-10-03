<!--
 * [INPUT]: 依赖 service/agent.go 的 runtime 分发与事件归一化（runCodex/runClaude/runOpencode + handleCodexEvent/handleClaudeEvent/handleOpencodeEvent + setNativeSession/emit/addAssistantTurn）、
 *          service/bridge.go 的 per-session 工作区写（materializeCodexWorkspace/writeOpencodeWorkspace/writeClaudeProfile + renderSessionGuide）、
 *          service/agent_cli.go 的 CLI 定位（AgentCommandResolver，isAgentCommand 已接受任意 [a-z_-] 命令名）、
 *          service/subagent.go 的子 Agent 三处 runtime switch、service/{server.go,agent_server.go} 的枚举与创建入口、
 *          service/{recut_skills.go,recut_skill_mcp.go} 的 skill 链接与全局 MCP 注入、web/components/agent-install-guide.tsx 的运行时前端契约、
 *          Command Code headless 契约（`cmd -p --output-format json` NDJSON 帧 + `--yolo` + `--resume <id>`）
 * [OUTPUT]: 把 Command Code（`cmd`）作为与 codex / claude / opencode **并列的第四个 Agent runtime** 接入 service：
 *           新增 runtime id `commandcode`、`runCommandcode`（headless print + NDJSON）、`handleCommandcodeEvent`（帧→平台事件映射）、
 *           `commandcodeWorkspace` / `WriteCommandcodeWorkspace`（AGENTS.md + project-scope `.mcp.json` 注入 per-session MCP）、
 *           在全部 runtime 枚举/switch 登记（Create 校验、runRuntime、agentRuntimeName、listAgents、诊断、skills 目标、全局 mcpConfig）。
 *           **模型选择（对齐 opencode）**：`agent_sessions.commandcode_model` 列 + `cmd --list-models` 目录
 *           （`GET /v1/agents/commandcode/models`）+ `PATCH …/commandcode-configuration` + `--model` + 前端模型选择器。
 *           不改 HTTP/MCP 既有契约（仅新增一个 runtime 取值与两个端点）。
 * [POS]: rfc 的「Command Code agent runtime」设计稿；证明 runtime 层虽为硬编码 switch 而非注册表，但按既有 claude 范式可低成本新增第四个并列 runtime，
 *        并锁定 Command Code headless NDJSON 帧到平台事件词的映射、bypass 与 MCP 注入方式。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC：Command Code 作为新的 Agent runtime（第四个并列 runtime）

- 状态：Accepted（M1 / M2 已实施；per-session 模型配置已实施；子 Agent 未做）
- 作者：Recut
- 日期：2026-10-03
- 决策范围：`service/` 的 agent runtime 层新增 `commandcode`（CLI 启动、事件解析、工作区与 MCP 注入、枚举登记、**模型选择**）与前端选择器；`agent_sessions` 仅新增可空列 `commandcode_model`；HTTP/MCP 既有契约不破坏（新增一个 runtime 取值与两个端点）；不改提案门禁。
- 关联：[子 Agent 任务卡片与全局预览](./2026-08-18-subagent-task-card-ws.md)、[Editor Agent 工具链成片体验复盘](./2026-09-23-editor-agent-toolchain-session-retro.md)、[平台通讯 Op 总线](./2026-08-19-platform-communication-op-bus.md)

## 0. 白话总结

Recut 的 Agent 面板可以让本机装的编码 Agent（Codex / Claude Code / OpenCode）来驱动创作。现在把 **Command Code（`cmd`）** 加成**第四个并列的 runtime**：用户在 Agent 面板里选它，Recut 就用 `cmd` 无头模式跑每一轮对话、把事件流解析成聊天里的「思考 / 说了一句话 / 调用了工具（含结果）」并落账本，和另外三个完全一样。

它需要满足和现有三个 runtime 相同的契约，这些 Command Code 都有：

1. **无头 + 结构化输出**：`cmd -p "<prompt>" --output-format json` 输出 NDJSON（逐行 JSON），既有进度事件帧、也有末行的终局结果行（含 `sessionId`、`finalText`）。对应 Claude Code 的 `-p --output-format stream-json`。
2. **权限 bypass（无人值守）**：`--yolo`（别名 `--dangerously-skip-permissions`，或 `--permission-mode yolo`）放开文件写入与命令执行。对应 Claude 的 `--permission-mode bypassPermissions`、OpenCode 的 `--auto`、Codex 的 `-s danger-full-access`。
3. **可续跑**：`cmd -p --resume <sessionId> "<prompt>"` 续上一轮的 native 会话；`sessionId` 在事件流很早就给出（`run_start`）。

**唯一需要绕一下的是 MCP 注入**：Command Code 没有 Claude 那种 `--mcp-config <file>` 标志。但它的 **project scope 就是「当前目录根下的 `.mcp.json`」**，而每个 runtime 的 cwd 都是 Recut 的 per-session 工作区——所以往工作区写一个 `.mcp.json`（stdio 适配器 `recut-service --mcp`，与 Codex/OpenCode 同构）就等价于 Claude 的 `claude-mcp.json`。

本 RFC 是 M1（service 侧打通 + 登记）的完整设计，M2 补前端选择器。

## 1. 背景与现状调研

recut 没有 runtime 注册表/接口：三个 runtime 的字符串散落在约 20 处 switch/if/字面量里（文件级证据）：

| 位置 | 作用 |
|---|---|
| `service/agent.go:442` | `Create` 的 runtime 白名单 |
| `service/agent.go:446-461` | 创建时 codex / opencode 配置校验 |
| `service/agent.go:1035-1044` | `runRuntime` 分发（→ runCodex/runClaude/runOpencode） |
| `service/agent.go:2787` | `agentRuntimeName` 显示名 |
| `service/agent.go:2148/2212/2250` | 每 runtime 的事件 parser |
| `service/bridge.go:372/409/465` | 每 runtime 的工作区 + MCP 配置写入 |
| `service/subagent.go:112/142/201` | 子 Agent 的模型路由 / 启动 / 事件扫描 |
| `service/server.go:288/310` | `GET /v1/agents` 枚举 / 诊断页 |
| `service/agent_server.go:121-123` | 创建会话缺省 runtime |
| `service/recut_skills.go:472-477` | skill 链接目标目录 |
| `service/recut_skill_mcp.go:114-128` | 各 Agent 全局 MCP 配置路径/格式 |

**关键结论**：CLI 定位层（`AgentCommandResolver` / `agent_cli.go`）已经是 runtime 无关的——`isAgentCommand` 只校验名字字符集 `[a-z_-]`，`commandcode` 与 `cmd` 都能被自动解析，无需改动。真正要改的只是「枚举与分发」。

Command Code 侧契约（已实测，见 §3 帧表）：非交互、NDJSON、bypass、resume 均具备；无 `--mcp-config` 标志。

## 2. 目标 / 非目标

**目标**

- 新增 runtime id `commandcode`，与 codex/claude/opencode **并列**，满足同一组能力契约（bypass + JSON 流 + resume + per-session MCP）。
- 打通一轮对话的完整链路：创建会话 → 运行 `cmd` → 事件归一化 → 落 `agent_turns`/`agent_events` → 续跑。
- per-session MCP 注入（工作区 `.mcp.json`）与全局注入（`~/.commandcode/mcp.json`）+ skill 链接目标。

**非目标**

- 不改 `agent_sessions` 表结构、不加 per-session 模型/effort 配置（与 Claude 同级，M1 用 CLI 默认）。
- 不做 Command Code 子 Agent（与 Claude 一致，M1 不支持）。
- 不做前端 runtime 选择器与 i18n（M2）。
- 不改提案/路由门禁、不改 Op 总线、不引入新事件词。

## 3. Command Code headless 帧契约（实测）

`cmd -p "<prompt>" --output-format json` 输出 **NDJSON**，两类行：**事件帧** `{"type":"event","event":{...}}` 与 **末行结果** `{"type":"result",...}`。实测事件帧序列：

| `event.type` | 关键字段 | 说明 |
|---|---|---|
| `run_start` | `sessionId` | native session id（**最早可得**） |
| `turn_start` | `turnNumber` | 一轮开始 |
| `message_start` | — | 一条 assistant 消息开始 |
| `model_request_start` | `model` | 一次模型请求开始 |
| `model_trace` | `traceId` | 追踪 id |
| `text_delta` | `delta` | 增量文本 |
| `message_update` | `content:[{type:text,text}\|{type:tool_use,id,name,input}]` | 消息内容快照 |
| `model_request_end` | `model,usage{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens},stopReason` | 请求结束 + usage |
| `message_end` | `content:[...]` | 消息结束 |
| `tool_queued` | `toolCallId,toolName,input` | 工具入参 |
| `tool_running` | `toolCallId,toolName,description` | 工具开始执行 |
| `tool_completed` | `toolCallId,toolName,result:[{type:text,text}],deferred` | 工具结果 |
| `turn_end` | `turnNumber,hadToolCalls,usage` | 一轮结束 |
| `run_end` | `result:{finalText,stopReason,turnCount,usage,nextState:{sessionId,...}}` | 终局 |

> 文档只举了 `tool_running` 一个例子；以上为真实抓帧，因此事件词以本节为准。未知 `event.type` 一律忽略（前向兼容）。

**事件映射（Command Code 帧 → 平台事件词）**

| 帧 | 平台动作 |
|---|---|
| `run_start.sessionId` | `m.setNativeSession(sessionID, sessionId)` + `emit("session.updated", {label:"已连接 Agent"})` |
| `turn_start` | `emit("status", {phase:"thinking", label:"正在分析"})` |
| `text_delta` | 累积到本轮文本缓冲（不即时落账，避免逐 token 刷屏） |
| `turn_end` | 若本轮缓冲非空 → `addAssistantTurn` + `emit("assistant.completed", {text})`；清空缓冲 |
| `tool_queued` | `emit("tool.started", {toolCallId, tool, toolName, label, input})` |
| `tool_completed` | `emit("tool.completed", {toolCallId, tool, toolName, label, output})`（`result[].text` 拼成 output；失败帧→`tool.failed`/`phase:"error"`） |
| `run_end` | 若仍是错误终局 → `emit("status", {phase:"error", ...})`；否则以 `result.finalText` 兜底补一条 assistant（防止末轮缓冲缺失） |
| 其它 | 忽略 |

工具名经既有 `canonicalMCPToolName` 归一；payload 键与 codex/opencode 对齐（`toolCallId/tool/toolName/label/input/output`）。

## 4. 决策记录

- **D1｜runtime id 与命令**：id `commandcode`，CLI 命令 `cmd`，显示名「Command Code」。
- **D2｜无头调用形态**：`cmd -p <prompt> --output-format json`，对齐 Claude 的 `-p --output-format stream-json`（Recut 每轮一次调用，天然契合 `-p` 一次运行语义）。
- **D3｜bypass 权限**：`--yolo`（等价 `--permission-mode yolo` / `--dangerously-skip-permissions`）。理由：Recut 的无人值守 Agent 需读写 `~/.recut` 下的 App 包/模型/素材，与 `--auto`/`danger-full-access` 同级。
- **D4｜resume 与工作区 pin**：native id 取 `run_start.sessionId`（缺失则 `run_end.result.sessionId`）；续跑 `cmd -p --resume <id>`。工作区像 Claude 一样**首轮 pin、后续复用**（`NativeWorkspace`），保证 MCP 配置与 cwd 稳定。Command Code 按 cwd 存会话（`~/.commandcode/projects/<slugified-cwd>/<id>.jsonl`），**只有提交过 transcript 的会话可 resume**；若首轮只写了 checkpoint 没写 transcript（`messageCount:0`），`--resume` 会报 `No session … found to resume`——此时**自动清除 native 指针并以新会话重试一次**，不让续聊 dead-end（`isCommandcodeResumeMissing`）。**无 native 可 resume 时（首轮或上面这种回退）由 recut 自己回放近期对话**（`commandcodeHistoryPrompt`，从 `agent_turns` 取 user/assistant 文本，封顶 20 条 / 单条 2000B / 共 20KB）——否则新会话只看到孤立的「继续」，AI 会完全不理解上下文。实测 `--resume` 本身是带历史的（plant→resume 能答对），需要回放的只是「会话丢失后新起」这一档。
- **D5｜per-session MCP 注入**：因无 `--mcp-config`，改在 `workspace/.mcp.json` 写 **project-scope** MCP（`command: <recut-service>`、`args: ["--mcp","--mcp-target",<daemon>]`、`env: {RECUT_AGENT_SESSION,RECUT_AGENT_TOKEN}`），启动加 `--trust` 跳过项目信任提示。与 Codex 的 `.codex/config.toml`、OpenCode 的 `opencode.json` 三处同构。
- **D6｜模型选择（已实施，对齐 opencode）**：新增 `agent_sessions.commandcode_model` 列；模型目录来自 `cmd --list-models`（`provider/name`，按 provider 分组）；`GET /v1/agents/commandcode/models` 供选择器、创建/`PATCH /v1/agent-sessions/{id}/commandcode-configuration` 落库、`runCommandcode` 传 `--model`。默认 `deepseek/deepseek-v4.1-flash`（Recut 选定的默认；CLI 自身的 `(default)` 标注是 `deepseek/deepseek-v4-flash`）。**reasoning effort 暂不暴露**（opencode 亦无），留待需要时再加。
- **D7｜子 Agent**：M1 不支持（命中 `subagent.go` 的 `default` 分支报错），与 Claude 一致；M3 再评估。
- **D8｜全局注入与 skill 目标**：`recut_skill_mcp.go` 加 `case "commandcode"` → 写 `~/.commandcode/mcp.json`（`mcpServers.recut`，HTTP 到 daemon）；`recut_skills.go` 加链接目标 `~/.commandcode/skills/<skill>`。
- **D9｜事件缓冲**：`text_delta` 累积、`turn_end` 落账，避免逐 token 写库；`tool_queued`/`tool_completed` 即时落账。
- **D10｜不改既有契约**：`POST /v1/agent-sessions` 仅多接受一个 `runtime` 取值；`GET /v1/agents` 多一条。无新端点、无迁移。

## 5. 服务端改造

| 位置 | 改动 |
|---|---|
| `service/agent.go` | `Create` 白名单加 `commandcode`；`runRuntime` 加 `case`；新增 `runCommandcode` / `commandcodeWorkspace` / `handleCommandcodeEvent`；`agentRuntimeName` 加名 |
| `service/bridge.go` | 新增 `WriteCommandcodeWorkspace` / `...To` + `writeCommandcodeWorkspace`（AGENTS.md + `.mcp.json`） |
| `service/server.go` | `listAgents` 与诊断循环加 `commandcode`/`cmd` |
| `service/recut_skill_mcp.go` | `mcpConfig` 加 `case "commandcode"`（→ `~/.commandcode/mcp.json`） |
| `service/recut_skills.go` | `agentSkillTargets` 加 `~/.commandcode/skills/<skill>` |
| `service/project.go` | `agent_sessions` 加 `commandcode_model` 列（create + migration） |
| `service/agent_server.go`、`service/server.go` | 模型列表端点 + 配置 PATCH 端点 + create 入参 |
| `web/{agent-store,agent-panel-types,agent-composer,project-agent-panel}.tsx`、`workspace-agent-dict.ts` | runtime 联合类型/顺序、安装登录命令、**模型选择器**与 i18n |

**DB 迁移**：`agent_sessions` 仅新增一个可空列 `commandcode_model`（create table + `alter table ... add column` 迁移，幂等）；其余复用既有列。

## 6. 写契约（HTTP）

- `POST /v1/agent-sessions` body `{ "runtime": "commandcode" }` → 201，返回会话。缺省 runtime 仍为 `codex`。
- `GET /v1/agents` → 增 `{ "id":"commandcode","name":"Command Code","command":"cmd","available":<bool> }`。
- 其余契约不变。

## 7. 里程碑与回滚

- **M1（本次）**：service 侧 runtime 打通 + 登记 + per-session/全局 MCP 注入；`go build` / `go test` 通过；`cmd -p` 冒烟。
- **M2（已实施）**：前端 runtime 选择器、安装/登录引导、i18n、**模型选择器**（agent-composer / project-agent-panel / agent-store）。
- **M3（部分）**：per-session 模型选择已实施；reasoning effort 与子 Agent 支持未做。

**回滚**：改动集中在新增分支与枚举项；回滚即从白名单/分发移除 `commandcode`，无数据副作用。

## 8. 验收

1. `cd service && go build ./... && go test ./...` 通过。
2. `go test -run 'Agent'` 覆盖：`Create("commandcode")` 成功、`runRuntime` 分发、`handleCommandcodeEvent` 帧映射（run_start/tool_queued/tool_completed/turn_end/run_end）。
3. 手动冒烟：本机装 `cmd` 后，创建 `commandcode` 会话并发一条消息，事件账本出现 `session.updated` / `status(thinking)` / `assistant.completed`，且 native session id 已写入。
4. `recut_skill_mcp` 单测：`mcpConfig("commandcode")` 指向 `~/.commandcode/mcp.json`。

## 9. 边界与未决

- **未决｜自动更新**：`cmd` 启动可能自更新（实测打印 `Updated 1.69.0 → 1.74.1`，走 stderr，不污染 stdout）。若长驻会话不希望中途升级，需确认关闭自更新的准确 `--config` 键名后加参数。M1 不处理。
- **未决｜登录/安装命令**：前端安装引导（M2）的确切安装与登录命令以官方为准，不在 M1 范围。
- **边界｜工具输出体积**：`tool_completed.result[].text` 直接进 payload；超长由既有 CLI 输出上限/账本约束兜底，M1 不额外截断。
- **边界｜stderr**：与 claude 同构，仅用于诊断与失败信息。
