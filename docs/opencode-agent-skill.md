# OpenCode Agent Skill：从 Shell Spawn 一个 headless 子任务

> 目标：让任何 Agent 学会用 `opencode` CLI 在 shell 里跑一个无人值守的子任务（子 Agent），
> 指定模型、工作区、输出格式，并正确消费其 JSON 事件流。
> 真实参照实现：本仓库 `service/subagent.go:229-243`（`runOpencodeSubAgent`）。

---

## 1. 核心命令

```bash
opencode run "<prompt>" \
  --format json \
  --print-logs \
  --auto \
  --dir /path/to/workspace \
  --model provider/model
```

最小可用版本（当前目录即工作区、默认模型）：

```bash
opencode run "帮我把 src 下的 JS 文件都改成 TS"
```

`opencode run` 是一次性 headless 模式：发一条消息 → Agent 自主执行到完成 → 退出。
它不是 REPL；多轮续跑用 `--session` / `--continue`（见 §5）。

---

## 2. 关键参数

| 参数 | 说明 |
| --- | --- |
| `--model provider/model` | 指定模型，格式必须是 `provider/model`（如 `opencode/gpt-5.6-terra`、`anthropic/claude-sonnet-4`）。不指定则用 opencode.json 里的默认模型 |
| `--variant high` | provider 特定的推理力度（如 high / max / minimal），相当于 reasoning effort |
| `--format json` | stdout 输出逐行 JSON 事件流（程序化消费必开）；缺省 `default` 是人读格式 |
| `--print-logs` | 日志走 stderr，不污染 stdout 的 JSON 流 |
| `--log-level DEBUG\|INFO\|WARN\|ERROR` | 日志级别，排障时配 `--print-logs` 用 |
| `--dir <path>` | 工作目录；Agent 的文件操作、AGENTS.md、opencode.json 都从这里解析 |
| `--auto` | **自动批准所有未显式拒绝的权限**。headless 必备（无人应答权限询问会卡死），但意味着信任该任务的文件操作 |
| `--agent <name>` | 使用已定义的 agent（如 build/plan 或自定义 subagent） |
| `--command <name>` | 执行已定义的 command（自定义 prompt 模板） |
| `--pure` | 不加载外部插件，最干净的沙盒形态 |
| `--title "..."` | 给会话起名（缺省截断 prompt） |
| `--thinking` | 输出 thinking 块 |
| `-f/--file <path>` | 附件文件，可多次 |
| `-s/--session <id>` / `-c/--continue` | 续跑已有会话 |
| `--port <n>` / `--attach <url>` | 起固定端口 server / 附着到已运行的 server |

超时控制 CLI 层没有参数——**在 shell 层自己做**：

```bash
timeout 1800 opencode run "..." --format json ...
# macOS 无 GNU timeout 时用 gtimeout 或 perl-alarm 包一层
```

---

## 3. Spawn 子任务的标准模式（父 Agent 视角）

> 前置条件：**权限已开放**（见 §4，`--auto` 或 opencode.json 的 permission 配置）。
> 没有这一步，下面的流程会卡死在权限询问上。

### 3.1 推荐流程

```bash
# 1. 准备独立工作区（隔离，且可整体清理）
WORK=$(mktemp -d /tmp/opencode-subtask.XXXXXX)
printf '你是 XX 专家，规则如下…\n' > "$WORK/AGENTS.md"   # 给子 Agent 的任务 guide

# 2. 带 timeout 跑，stdout 是 JSON 事件流，stderr 是日志
timeout 1800 opencode run "$TASK_PROMPT" \
  --format json --print-logs --auto \
  --dir "$WORK" \
  --model opencode/gpt-5.6-terra \
  > "$WORK/events.jsonl" 2> "$WORK/opencode.log"

# 3. 判断退出码 + 消费事件流
```

### 3.2 消费 JSON 事件流

`--format json` 的 stdout 是**逐行 JSON 事件**（每行一个独立 JSON 对象）。典型处理：

```bash
# 只看最终 assistant 文本
jq -r 'select(.type=="message" and .part.type=="text") | .part.text' "$WORK/events.jsonl" | tail -n +1

# 看工具调用轨迹
jq -r 'select(.type=="message" and .part.type=="tool") | .part.state.status + " " + .part.tool' \
  "$WORK/events.jsonl"

# 统计是否真的干了活（对照：进程正常退出但零工具调用 ≈ prompt 有问题）
grep -c '"tool"' "$WORK/events.jsonl"
```

要点（源自本仓库 `scanSubagentEvents` 的同构做法）：

- **逐行解析，容忍非 JSON 行**：日志/告警可能混入 stdout，`jq` 前先 `grep '^{'` 或逐行 try-parse。
- **部分结果要保留**：子进程被 timeout 杀掉时，stdout 里已完成的事件不要丢——先落文件再判断成败。
- **空产出即失败信号**：退出码 0 但没有任何工具调用/文本输出，按失败处理，回头修 prompt。

### 3.3 并发多个子任务

opencode 每次运行是独立会话进程，天然可并行：

```bash
for task in task1 task2 task3; do
  ( opencode run "..." --dir "$WORK/$task" --format json > "$WORK/$task/events.jsonl" 2>"$WORK/$task/log" ) &
done
wait
```

每个子任务用**独立 `--dir`**，避免 AGENTS.md / opencode.json / 文件写入互相踩。

---

## 4. 权限开放（headless 的生死线）

> **没有权限开放，headless 必挂。** opencode 遇到需要审批的动作会在 TUI 里弹权限询问；
> headless 下没有 TUI、没有人应答，进程就永远停在那里——表现为"挂住不动、无输出、不退出"。
> 这是 headless 跑不起来排名第一的原因。

### 4.1 为什么会卡：默认值里藏着两个 ask

opencode 默认大多数权限是 `allow`，但有两个例外默认 `ask`：

- `external_directory` —— 工具触碰**工作区之外**的路径时（read/glob/grep/很多 bash 命令都算）。
  headless 子任务几乎必然会碰到工作区外路径（读全局配置、临时目录、项目依赖……），一碰就 ask。
- `doom_loop` —— 同一工具调用以完全相同输入重复 3 次时触发。子 Agent 陷入循环时也会卡死。

所以最小可跑配置就是放开这两个：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "external_directory": "allow",
    "doom_loop": "allow"
  }
}
```

### 4.2 三种开放姿势（按信任度递减推荐）

**姿势 A：`--auto` 命令行开关（最常用）**

```bash
opencode run "..." --auto
```

自动批准一切"会弹 ask"的请求；**显式 `deny` 仍然生效**。适合父 Agent spawn 的子任务：
配合独立临时工作区 + timeout 使用，风险可控。本仓库 `service/subagent.go` 即采用此姿势。

**姿势 B：配置一刀切**

```json
{ "permission": "allow" }
```

整个权限面全开，包括 deny 默认（`.env` 读取默认是 deny 的，这也会被放开）。
只用于**一次性 throwaway 工作区**。

**姿势 C：细粒度规则（想保留安全边界时）**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "*": "allow",
    "bash": { "*": "allow", "rm *": "deny", "git push *": "deny" },
    "edit": { "*": "allow", "~/secrets/**": "deny" },
    "external_directory": { "~/projects/personal/**": "allow" },
    "doom_loop": "allow"
  }
}
```

规则要点（对象语法）：

- 通配符：`*` 匹配任意字符，`?` 匹配单个字符；**last-match-wins**，把 `"*"` 兜底放最前、
  具体规则放后面。
- `~` / `$HOME` 开头的 pattern 会展开为家目录（主要用于 `external_directory` 和路径类规则）。
- bash 规则匹配的是解析后的命令前缀：`"git *"` 允许 `git status --porcelain`，
  但 `"git status"`（不带 `*`）挡不住带参数的调用。

### 4.3 可配置的权限键（对象语法的 key）

| key | 触发时机 |
| --- | --- |
| `read` / `edit` / `glob` / `grep` | 读文件 / 一切文件修改（edit/write/patch）/ glob / 内容搜索 |
| `bash` | 执行 shell 命令 |
| `task` | 启动子 Agent（按 subagent 类型匹配） |
| `skill` | 加载 skill |
| `lsp` | LSP 查询 |
| `question` | 执行中向用户提问（headless 下这个也必须 allow/由 --auto 覆盖，否则提问即挂） |
| `webfetch` / `websearch` | 抓 URL / 联网搜索 |
| `external_directory` | 触碰工作区外路径（默认 ask ⚠️） |
| `doom_loop` | 同输入重复调用 3 次（默认 ask ⚠️） |

### 4.4 headless 决策速查

- 能接受子任务做任何事（临时工作区、跑完即删）→ `--auto`，完事。
- 要留安全边界 → 姿势 C，至少显式 allow `external_directory` + `doom_loop` + `question`，
  并 deny 掉 `rm *`、`git push *`、敏感路径。
- 任何情况下**不要**在 headless 里保留任何 `ask`：ask 在 headless = 永久挂起，不是失败，
  是 hang，连 timeout 都只能靠外层 shell 兜底。

---

## 5. 工作区配置（opencode.json）

`--dir` 指向的目录就是配置根。放一个 `opencode.json` 可控制该子任务的行为
（参照本仓库 `bridge.go: writeOpencodeWorkspace`）：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode/gpt-5.6-terra",
  "mcp": {
    "my-tools": {
      "type": "local",
      "command": ["/path/to/tool", "serve"],
      "enabled": true,
      "timeout": 300000
    }
  },
  "permission": {
    "external_directory": "allow"
  },
  "experimental": { "mcp_timeout": 300000 }
}
```

- MCP server 配置在这里，子 Agent 就能调用你注入的受限工具面；配合 `--pure` 可关掉其他插件。
- 同目录的 `AGENTS.md` 是子 Agent 的 system-level 任务说明，优先级高于你在 prompt 里重复的内容。
- 配置叠加顺序：项目 `--dir` 下的 opencode.json > 全局 `~/.config/opencode/opencode.json`；
  权限也可在 agent 级（`agent.<name>.permission` 或 agent markdown frontmatter）覆盖，agent 规则优先。

---

## 6. 多轮与续跑

- 找 session id：事件流里每条事件都带 `sessionID`；或 `opencode` 的会话存储。
- 续跑：

```bash
opencode run "继续，把上一步的测试补完" --session <sessionID> --dir <原工作区> --format json
opencode run "..." --continue        # 续最近一次会话
```

- **`--dir` 必须与创建会话时一致**：换个目录 resume，opencode 不会报错但事件流为空、
  进程挂住（本仓库 `bridge.go` 为此专门持久化原始工作区路径并在续跑时复用）。

---

## 7. 失败排查清单

| 现象 | 原因/处理 |
| --- | --- |
| 进程挂住不动 | 99% 是权限询问无人应答：加 `--auto`，或 opencode.json 里放开 `external_directory` / `doom_loop` / `question`（见 §4） |
| resume 后无事件、hang | `--dir` 与创建会话时的工作区不一致，回到原目录续跑 |
| 退出码 0 但什么都没做 | prompt 歧义或没给可执行目标；查 `--print-logs` 的 stderr 日志 |
| 模型报错 | `--model` 必须是 `provider/model` 完整格式，且该 provider 已配置凭据 |
| MCP 工具调不到 | opencode.json 的 `mcp.*.enabled`、`timeout`（headless 长任务建议 ≥300000ms） |
| 被杀后结果全丢 | 你没先把 stdout 落盘；永远 `> events.jsonl` 而不是只看管道输出 |

---

## 8. 速查：最常用三条

```bash
# 一次性任务，指定模型（--auto = 自动批准权限，headless 必备）
opencode run "重构 utils.ts 并跑通测试" --model anthropic/claude-sonnet-4 --auto

# 程序化消费（父 Agent spawn 子任务的标准形态）
opencode run "$PROMPT" --format json --print-logs --auto --dir "$WORK" --model opencode/gpt-5.6-terra

# 续跑
opencode run "继续" --session "$SID" --dir "$WORK" --format json
```
