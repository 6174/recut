<!--
 * [INPUT]: 参考既有本地 App 范式：apps/gen-studio（manifest operations + gen_tasks 账本 + pumpQueue
 *          并发分类 + bootstrap.py 派生运行环境；本 App 的直接模板）、
 *          apps/audio-studio（任务中心 UX、profiles/settings、能力 op）、service/runtime.go
 *          （ctx.python/shell/media/files/sqlite/appFiles/paths/capabilities 契约；ctx.http 只有有限
 *          GET）、service/catalog.go Operation（surfaces api/mcp + capability 标记）、
 *          docs/app-contract.md（App 能力与权限边界）、docs/platform-comms-contract.md（recut.job.*
 *          统一异步 Handle）；
 *          外部事实：modal.com（$30/mo 免费算力、modal.App/Image/Volume/Secret/@app.function、
 *          gpu="H100"/"B200+"、Function.from_name(...).with_options(gpu=...).remote()/spawn()、
 *          modal deploy / modal run / modal volume）。
 * [OUTPUT]: 设计一个把开源 GPU 项目托管到 modal.com 的**标准 App**（recut.modal-studio，apps/modal-studio，
 *           「Modal 云函数」）。核心：**一个 App、多个预设包（modalapp）**——每个 modalapp 是一个自包含目录
 *           （manifest.json 声明 image/volume/functions/表单 + modal_app.py 定义云端 Modal App +
 *           bootstrap.py 准备 volume），App 只做本机薄客户端（modal_runner.py + goja background.js）：
 *           用户配置 modal.com token 后 `modal.deploy` 部署 image、`modal.install` 把权重下进 Modal Volume、
 *           `modal.generate` 用 `Function.from_name(...).remote()` 调用（**无需 HTTP，就当本机 python 函数**）。
 *           对齐 gen-studio：runtime(venv)↔Modal Image、model(权重)↔Modal Volume、prepare↔deploy、
 *           install↔bootstrap、generate↔invoke、modal_tasks 单槽 FIFO、Left 两 Tab（功能表单 / 记录）+
 *           Right 预览日志、Setup 门。
 *           **硬约束**：① 全部代码只落在 apps/modal-studio/，不改 service/ 任何 Go 代码；② **v1 不做任何
 *           平台特殊接入**——不写 contributes.media、不注册媒体 provider、不占用默认路由；平台后续会提供
 *           **hook 机制**，届时如需接入再按 hook 接。v1 的能力完全通过 App 自身的 MCP/API operation
 *           （`capability: true` 供跨 App 调用）+ 既有 `ctx.media` 入库暴露。第一版兑现 MiniMax H3 等
 *           开源视频/图像项目的云端自托管。不新增渲染引擎、不引入中间语言、不改异步 Handle 契约。
 * [POS]: rfc 的「标准 App 形态的云端 GPU 预设托管」设计稿；把 gen-studio 的「一个环境多模型」范式推广为
 *        「App 托管的预设包（modalapp）= 云端 Image + Volume + N 个 Function = N 个前端表单」，并**严守
 *        App 层边界**：不碰 service、v1 不碰平台接入；平台 hook 机制就绪后再评估是否接入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC：Modal 云函数（Modal Functions）——把开源 GPU 项目托管到 modal.com 的 App 扩展

- 状态：Proposal
- 作者：Recut
- 日期：2026-09-24
- 决策范围：`apps/modal-studio` **标准 App** 的包结构（纯 App 层、零 `service/` 改动）、**预设包（modalapp）= 云端 Image/Volume/Functions** 模型、token/profiles 与部署生命周期、`modal_tasks` 异步协议、Left/Right 交互、**v1 不做平台特殊接入**（不写 `contributes.media`、不占默认路由；平台 hook 机制就绪后如需接入再按 hook 做）
- 关联：[本地模型本地生成（gen-studio，同构先例）](./2026-09-23-local-generation-studio.md)、[AI 解说音频素材生命周期（local-audio 先例）](./2026-08-21-ai-narration-audio-asset-lifecycle.md)、[媒体生成提案](./2026-09-16-media-generation-proposal.md)、[生成提示词参考引用协议](./2026-09-15-generation-reference-protocol.md)、[Provider/模型目录 CDN](./2026-09-03-provider-model-catalog-cdn.md)、[平台通讯 Op 总线契约](../docs/platform-comms-contract.md)、[App 契约](../docs/app-contract.md)

## 0. 白话总结（先看这个）

**这件事是：** 很多好用的开源项目（视频/图像/音频模型）必须要显卡，而用户本机没有显卡。modal.com 每月送 $30 的 GPU 算力（用户可以自己开多个账号），所以我们可以做一个「Modal 云函数」App——**把开源项目的代码和权重托管到 Modal 云上跑，用户只要填一个 modal token，就能像调用本机函数一样在云端 GPU 上生成，不用依赖任何平台代持的云服务（比如 atlascloud）。**

**它长什么样（交互）：**

```text
┌───────────────────────────────┬──────────────────────────────────────────┐
│  Left                          │  Right                                    │
│  ┌───────────┬──────────────┐  │   统一的生产预览 + 进度/日志              │
│  │  功能     │   记录        │  │   ┌────────────────────────────────────┐ │
│  │ ───────── │ ──────────── │  │   │ 任务状态 · 进度条 · 取消 · 查看日志  │ │
│  │ [预设切换] │ 部署/权重/生成│  │   ├────────────────────────────────────┤ │
│  │ ┌───────┐ │ 统一任务列表  │  │   │ 生成：视频/图片预览 + 参数/耗时      │ │
│  │ │该函数  │ │ 点击一行 →    │  │   │       [保存入库]                     │ │
│  │ │的表单 │ │ Right 显示    │  │   │ 部署/下载：实时日志 + 就绪度          │ │
│  │ └───────┘ │ 结果/日志     │  │   └────────────────────────────────────┘ │
│  └───────────┴──────────────┘  │                                          │
└───────────────────────────────┴──────────────────────────────────────────┘
```

- **Left Tab 1「功能」**：顶部一个**预设切换器**（列出所有 modalapp），切换后下面是**该 modalapp 的函数表单**（提示词、参考图、时长、seed、GPU 档位……由 modalapp 的 `manifest.json` 声明），点「运行」即调用云端函数。
- **Left Tab 2「记录」**：和声音工坊/gen-studio 一样的**统一任务列表**——「部署环境」「下载模型」「运行函数」都是同一类任务；点任意一行，**Right 就显示对应的结果和日志**。
- **Right**：**统一的生产预览 + 进度日志**。选中生成任务显示视频/图片预览与参数、可保存入库；选中部署/下载任务显示实时日志与就绪度；顶部共享状态、进度、取消。

**几个关键决定：**

1. **纯标准 App，零 service 改动（最重要）**：这是一个标准 Recut App——`manifest.json` + `background.js` + `python/` + `ui/` + `skills/`，业务代码**全部在 `apps/modal-studio/`**，**不修改 `service/` 任何一行**。App 只用自己的 operation（api 面给 UI、mcp 面给 Agent、`capability: true` 给其他 App）和既有 `ctx.*` 能力实现全部逻辑。
2. **一个 App、多个预设包（modalapp）**：每个 modalapp 就是一个自包含目录（`modalapps/<id>/`），里面有 `manifest.json`（声明 image、volume、函数与表单）、`modal_app.py`（云端 Modal 代码）、`bootstrap.py`（准备 volume / 下载权重）。加一个新能力 = 加一个目录，不改 App 逻辑。
3. **充当本机 python 函数，不强依赖 HTTP**：本地只跑一个薄 Python 客户端，用 Modal SDK 的 `Function.from_name(...).remote()` 调用云上的函数（Modal 函数本来就支持「被另一段代码直接调用」）。HTTP endpoint 只作为可选后端。
4. **云端 image 就是「运行环境」**：modalapp 声明的 `Image`（基础镜像 + pip 依赖 + 系统包）在 Modal 云端构建；用户选的预设 = 选的镜像环境。
5. **模型权重统一进 Volume**：`bootstrap.py` 里在云端把权重下载进 Modal Volume，函数以 `volumes={"/models": vol}` 挂载；换模型只改 volume 内容，不重建镜像。
6. **只要一个 token 就能用**：用户填 `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET`（可配多个账号 = 多 profile，分给不同 modalapp）；token 只在本机保存、只按需注入子进程，不进日志。
7. **和 gen-studio 架构同构**：runtime(venv)↔Modal Image、model(权重)↔Modal Volume、prepare↔deploy、install↔bootstrap、generate↔invoke；`modal_tasks` 单槽 FIFO、提交不拒绝、`recut.job.*` 统一观察。
8. **v1 不做平台特殊接入（等平台 hook）**：不写 `contributes.media`、不注册媒体 provider、不占平台默认路由（`image/video.generate.default`）。能力通过 App 自己的 operation 暴露：UI 走 api、Agent 走 mcp（`modal.generate`/`modal.save`/`modal.catalog`/`modal.status`）、其他 App 走 `capability: true` 能力桥。**平台后续会提供 hook 机制，届时若要接默认路由/自动生命周期等，再按 hook 接**。
9. **付费/额度要透明**：Modal 有免费额度但超了要花钱。成本确认完全由 App 负责（UI 显式确认 + `modal.generate` 的 `confirmCost` 参数 + GPU 档位提示），不依赖平台提案门。

**一句话：** 把「本地生成」的「一个 App 多模型」范式，换成一个「一个 App 多预设包、云端 Image + Volume + Function」的范式——本机只做薄客户端，真正的 GPU 活在 modal.com 上，用户只出一个 token。

---

## 0.1 技术摘要

本文设计 `recut.modal-studio`（目录 `apps/modal-studio`，名称「Modal 云函数」）——一个**标准 App**、**本机薄客户端 + 云端 GPU 执行**、**一个 App 托管多个预设包（modalapp）**的图片/视频生成 App（可扩展音频）。**全部代码在 `apps/modal-studio/`，不改 `service/`。**

- **协议同构 gen-studio**：`manifest.json` 声明 `operations` + `runtime.python`（轻量主 venv，只装 `modal` 客户端）；`background.js`（goja）用 `ctx.sqlite` 维护 `modal_tasks` 账本、`ctx.python.run` 执行可观察 shell job（`modal_runner.py`）、`ctx.media` 物化参考/导入产物、`ctx.files` 提供私有预览 URL。
- **modalapp 模型（核心）**：`modalapps/<id>/` 三件套——
  - `manifest.json`：`engine`（appName / image / gpu 档位 / volumes / secrets / weights）+ `functions[]`（每个函数一个 id + entrypoint + `formSchema` + `output` + 可选 `invoke.mode`），是 App UI 表单的**单一信息源**（v1 不贡献平台模型）；
  - `modal_app.py`：云端 Modal App 定义（`Image` + `@app.function(volumes=..., gpu=..., timeout=...)` + 可选 `bootstrap_weights` 函数）；
  - `bootstrap.py`：内容准备入口（在云端把权重下进 Volume、校验大小/版本、可断点重试）。
- **环境/权重分离（对齐 gen-studio）**：`modal.deploy` 只构建/部署 Image（= runtime）；`modal.install` 只跑 `bootstrap` 把权重写进 Volume（= model）；`modal.generate` 调 `Function.from_name(...).with_options(gpu=...).remote()`（= invoke），并把结果文件（bytes 或 Volume key）拉回本机落成私有产物。
- **零 service 改动（硬约束）**：整个 App **全部代码只落在 `apps/modal-studio/`**，是一个标准 App，**不修改 `service/` 任何 Go 代码**。平台侧不使用任何需要新增字段/协议的机制（**不写 `contributes.media`、不注册媒体 provider、不占默认路由**）。能力只经 App 自己的 operation 暴露（api/mcp/`capability: true`）与既有 `ctx.*`（`sqlite/python/shell/media/files`）+ `recut.job.*` 实现。
- **平台接入延后（hook 机制）**：**v1 不做平台特殊接入**。若将来要让平台的默认生图/生视频路由、自动素材生命周期等直接走本 App，等平台提供 **hook 机制**后，按 hook 接入（本 RFC 不设计该接入）。
- **token / profiles**：`modal.profiles.add/list/remove` 管理多个 Modal 账号的 token（`{name, tokenId, tokenSecret}`）；`modal.settings.set` 选默认 profile 与权重源；token 存 App 私有状态（0600），只在 `modal_runner.py` 子进程的环境变量里出现，绝不写入日志。
- **交互**：Left 两 Tab（功能表单 / 统一任务记录）+ Right 统一生产预览与进度日志；表单由 modalapp 的 `formSchema` 驱动，顶部预设切换器来自 `modal.catalog`；未配置 token 时整屏显示 **Setup 门**（填 token / 验证连接）。
- **第一版兑现**：至少一个视频 modalapp（如 MiniMax H3 文/图生视频）与一个图片 modalapp，支持 GPU 档位选择、huggingface/modelscope/automatic 权重源。

**边界（非目标）**：**不改 `service/` 层任何代码**（纯标准 App，全部实现落在 `apps/modal-studio/`）、不新增平台渲染引擎、不引入 XML/DSL、不改 `async_ops`/Op 总线契约、不把生成产物默认入库（先私有、确认后 `modal.save`）、不做节点式工作流编辑器（表单式）、**不做平台代持 Modal 凭据**（token 永远在用户本机）、不保证离线可用（Modal 是远程服务）、不自动帮用户创建/结算 Modal 账号。

---

## 1. 目标与非目标

### 1.1 目标

1. 一个标准 App（`recut.modal-studio`）让**没有本地 GPU**的用户，用 modal.com 的免费额度跑开源图片/视频项目，并把产物落进 Recut 素材库。
2. **纯标准 App，零 `service/` 改动**：全部功能实现在 `apps/modal-studio/`；只使用既有 `ctx.*` 能力与自己的 operation，不新增/修改任何 Go 代码。
3. **多个预设包（modalapp）**：每个 modalapp 自包含（`manifest.json` + `modal_app.py` + `bootstrap.py`），用户选预设即选云端 image 环境；新增能力 = 新增目录。
4. **本机薄客户端，不依赖 HTTP**：本地用 Modal SDK 直接调用云端函数（`Function.from_name().remote()`），把云端当作「本机函数的 GPU 版」；HTTP 端点仅作可选后端。
5. **环境/权重分离**：部署 image（`modal.deploy`）与准备权重（`modal.install` → Volume）分开，各自独立可重试；权重源可选 `automatic | huggingface | modelscope`。
6. **一个 token 可用、多账号可切换**：用户配置 Modal token（profiles）后即可部署与调用；支持多个 Modal 账号绑定不同 modalapp。
7. **表单式调用**：每个函数一个前端表单，字段与校验由 modalapp `manifest.json` 的 `formSchema` 声明（App 层渲染）。
8. **（延后）平台接入**：**v1 不接**。全部能力经 App 自己的 operation（api/mcp/capability）暴露；平台的默认路由等特殊接入等平台 **hook 机制**就绪后另行按 hook 设计。
9. **与 gen-studio 同构的异步与交互**：`modal_tasks` 单槽 FIFO、提交永不拒绝、`recut.job.*` 统一观察、日志落文件可回看；Left 两 Tab + Right 预览日志 + Setup 门。
10. **可发现与可调用**：`modal.catalog` / `modal.status`（mcp 面）对外暴露「有哪些 modalapp/函数/就绪度/需不需要先部署」，Agent 可直接调用 `modal.generate` / `modal.save`；其他 App 可经 `ctx.capabilities.invoke` 复用（`capability: true`）。

### 1.2 非目标

- 不做本地 GPU 推理（本地只做编排与调用；GPU 全在 Modal）。
- **v1 不做平台特殊接入**：不写 `contributes.media`、不注册媒体 provider、不接默认生图/生视频路由、不依赖平台提案门；这些等平台 hook 机制后另行评估。
- 不做平台侧凭据代持/代付（token、额度、账号都是用户的）。
- 不做 Modal 账号注册、付费、额度结算或用量计费 API 集成（第一版只做透明度提示；用量集成见 §14 开放问题）。
- 不引入节点式/连线式工作流（保持「预设包 + 函数表单」）。
- 不改生成提案（proposal）语义、不改路由/`async_ops` 契约、**不改 `service/` 任何代码**（不使用任何需要平台新增字段的机制；若未来确需，按平台 hook 机制或另出平台 RFC）。
- 不做模型训练/LoRA 训练（只做推理）。
- 不保证离线：Modal 不可达时任务失败并给出结构化错误。

---

## 2. 总体架构

```text
   ┌─────────────────────────┐        ┌──────────────────────────┐
   │  Agent (MCP)            │        │  App UI (iframe)          │
   │  modal.generate / save  │        │  modal.generate (api)     │
   └───────────┬─────────────┘        └────────────┬─────────────┘
               │  App operation（既有 api/mcp/capability 面）    │
               └────────────────────┬───────────────────────────┘
                                    ▼
                    ┌──────────────────────────────────────────────────────────┐
                    │  recut.modal-studio (apps/modal-studio, goja background.js)│
                    │  modal_tasks 账本 + pumpQueue（invoke 单槽 / deploy 单槽 / │
                    │  bootstrap 并行）                                          │
                    │  ctx.python.run(modal_runner.py ...)  →  shell job          │
                    │  ctx.media.importFile（modal.save 入库）                    │
                    └──────────────────────────┬────────────────────────────────┘
                                               │ 本机主 venv（轻量：modal 客户端）
                                               ▼
                    ┌──────────────────────────────────────────────────────────┐
                    │  python/modal_runner.py（本机）                            │
                    │   status / deploy / bootstrap / invoke / teardown         │
                    │     · 读 modalapps/<id>/manifest.json 与 token profile     │
                    │     · modal deploy / modal run（image 构建 + volume 准备） │
                    │     · Function.from_name(appName, fn)                     │
                    │         .with_options(gpu=<tier>).remote(**params)         │
                    │     · 结果 bytes 落盘 / volume get 拉回本机               │
                    └──────────────────────────┬────────────────────────────────┘
                                               │ HTTPS + MODAL_TOKEN_ID/SECRET
                                               ▼
                    ┌──────────────────────────────────────────────────────────┐
                    │  modal.com（云端 GPU）                                    │
                    │   Image（依赖闭包） · Volume（权重/产物） · Secret（HF token）│
                    │   @app.function(...)  ← 每个函数 = 前端一个表单          │
                    └──────────────────────────────────────────────────────────┘

   未来（不在本 RFC）：平台 hook 机制就绪后，可选地把本 App 接到默认生图/生视频路由等。
```

与 gen-studio 的映射关系：

| gen-studio | modal-studio | 说明 |
|---|---|---|
| `runtime`（专属 venv，依赖闭包） | **Modal Image**（云端镜像） | 运行环境；在云端构建、缓存 |
| `model`（权重，归属 runtime） | **Modal Volume**（+ Secret） | 权重与运行期资源；`bootstrap` 写入 |
| `gen.prepare` | `modal.deploy` | 构建/部署环境（image） |
| `gen.install` | `modal.install` | 只下权重（写 Volume），不重建 image |
| `gen.generate` | `modal.generate` | 调用函数（单槽 FIFO） |
| `gen.save` | `modal.save` | 私有产物入库 |
| `gen.catalog` / `gen.status` | `modal.catalog` / `modal.status` | 能力/就绪枚举 |
| `gen_tasks` | `modal_tasks` | 统一任务账本 |
| `python/gen_runner.py` + `diffusers_runner.py` | `python/modal_runner.py` + 每个 modalapp 的 `modal_app.py` | 本机调度器 / 云端执行体 |
| `contributes.media`（local-gen provider） | **无**（v1 不接平台；能力只经 App operation） | 平台接入延后到 hook 机制 |
| `modalapps`（无） | **`modalapps/<id>/`** | 预设包（image + volume + functions） |

> **关键差异（相对 gen-studio）**：gen-studio 的「运行时」在用户本机、零成本、离线，且经 `contributes.media` 接进平台默认路由；modal-studio 的「运行时」在 modal.com、消耗用户额度、需联网，且 **v1 不接平台**（无 `contributes.media`、无默认路由、无平台提案门）。因此成本确认、就绪度、能力发现全部由 App 自己负责（UI + MCP op）；平台集成留给后续 hook 机制。

---

## 3. App 包设计

### 3.1 目录结构

```text
apps/modal-studio/
├── manifest.json                 # 身份/入口/权限/runtime.python/operations（内置分发见 service/builtin_apps/apps.json）
├── background.js                 # 唯一业务后端：modal_tasks 账本 + 队列 + 能力 op
├── bootstrap.py                  # App 级准备（创建主 venv 之外的一次性校验；可选）
├── python/
│   ├── modal_runner.py           # 本机薄客户端：status/deploy/bootstrap/invoke/teardown/secret
│   ├── registry.json             # 由 modalapps/* 生成：modalapp/function ↔ 调用契约 ↔ 就绪度兜底
│   ├── publish_registry.py       # 扫描 modalapps/*/manifest.json → 生成 registry.json + modalapps/index.json
│   └── requirements.lock         # 主 venv 锁定依赖（轻量：modal、requests、huggingface_hub、modelscope）
├── modalapps/                      # 预设包（每个 = 一个云端 Modal App）
│   ├── index.json                # modalapp id 列表（由 publish_registry.py 生成）
│   ├── minimax-h3/
│   │   ├── manifest.json         # engine + functions[]（表单/入口/输出）
│   │   ├── modal_app.py          # Image + Volume + @app.function（含 bootstrap_weights）
│   │   ├── bootstrap.py          # 权重准备入口（modal run）
│   │   └── README.md
│   └── <modalapp-2>/ ...
├── ui/                           # React + Vite：Left 两 Tab + Right 统一预览/日志 + Setup 门
│   ├── src/components/run-tab.tsx        # 预设切换器 + 函数表单（formSchema 驱动）
│   ├── src/components/records-tab.tsx    # 统一任务列表（部署/下载/运行）
│   ├── src/components/preview-pane.tsx   # Right：预览 + 进度 + 日志
│   ├── src/components/setup.tsx          # Setup 门：填 token / 验证连接
│   └── src/components/settings.tsx       # profiles / 权重源 / GPU 档位默认
├── skills/modal-studio/SKILL.md  # 面向 Agent 的能力说明与使用纪律
├── assets/                       # 图标与截图
├── README.md / README.en.md
└── rfc/                          # App 自身演进 RFC（可选）
```

### 3.2 manifest.json（关键字段）

```json
{
  "manifestVersion": 1,
  "id": "recut.modal-studio",
  "name": "Modal 云函数",
  "localized": { "en": { "name": "Modal Functions" } },
  "author": "Recut",
  "description": "把开源 GPU 项目托管到 modal.com：选择预设包，配置 modal token 后即可部署镜像、准备权重并调用云端函数。",
  "repository": "https://github.com/6174/recut-modal-studio",
  "version": "0.1.0",
  "type": "standalone",
  "background": "background.js",
  "ui": { "standaloneView": "ui/dist/index.html" },
  "permissions": ["sqlite", "files", "media.read", "media.write", "python", "shell"],
  "runtime": {
    "python": {
      "venv": "modal-studio",
      "version": "3.11",
      "requirements": "python/requirements.lock"
    }
  },
  "operations": [ /* 见 §6.1 */ ]
}
```

要点：

- `permissions` 与 gen-studio 一致；**不需要 `http`**——Modal 调用与下载都在 `modal_runner.py`（Python SDK）里完成。也不需要 `ffmpeg` 工具（视频编码在云端做）。
- `runtime.python.venv = "modal-studio"`：平台托管主 venv，只装轻量客户端依赖（`modal` 包等）；**没有 per-modalapp 的本地 venv**——modalapp 的重依赖在云端 Image 里。
- **内置分发不进 manifest**：manifest 只声明身份/权限/运行时/operations。若要随客户端自带，在 **`service/builtin_apps/apps.json`**（内置 App 单一清单）加一条 `{package, source, appId, include, exclude}` 即可（打包与 embed 全自动，不改 Go）；第一版按标准 App 分发（`recut.apps.install` / 开发期 `make app-link APP=apps/modal-studio`），不要求内置化。
- **v1 不写 `contributes.media`**：本 App 不贡献平台媒体 provider、不占默认路由。`manifest.operations` 才是对外能力面（`capability: true` 供跨 App 调用）。平台 hook 机制就绪后如需接入再评估。

### 3.3 分发：标准 App（零 service 改动）

**本 RFC 的核心约束**：这是标准 App，**不改 `service/`**。因此：

1. **开发/运行**：`make app-link APP=apps/modal-studio` 把 `~/.recut/apps/modal-studio` 软链到仓库目录；平台按既有 App 发现机制加载 `manifest.json`。
2. **分发**：用户经 `recut.apps.install { repository }` 安装（与其它 Git App 一致）；App 无 `.git` 时 `recut.apps.update` 无效可接受。
3. **不新增 Go 代码、不改 `builtin_apps.go` / `catalog_seed.go` / `app_media_bridge.go` / `jobs.go` 等**；App 只用既有 `ctx.*` 与自己的 operation，平台 hook 机制就绪前不做任何接入。
4. **可选内置化**（非本 RFC 必需）：若产品后续希望它随客户端自带，只需在 `service/builtin_apps/apps.json` 加一条（打包脚本与 Go 的目录 embed 全自动，不改 `builtin_apps.go`）；那是打包/发布议题，与 App 功能实现解耦。

---

## 4. 预设包（modalapp）模型

> modalapp 是「云端 Image + Volume + 一组 Function + 每个 Function 一张表单」的自包含单元。它是用户选择的**云端环境**；App 把它的函数暴露为自己的 MCP/API operation（v1 不把它贡献为平台模型）。

### 4.1 概念：Image / Volume / Function

| 概念 | 是什么 | 生命周期 | 对应 gen-studio |
|---|---|---|---|
| **Image** | 云端运行环境（基础镜像 + pip/系统依赖），在 Modal 构建并缓存 | `modal.deploy` 构建/更新 | runtime（venv） |
| **Volume** | 云端持久盘（权重、运行期资源、产物中转） | `modal.install`（bootstrap）写入/更新 | model（权重） |
| **Secret** | 云端密钥（如 `HF_TOKEN` / `MODELSCOPE_TOKEN`），供 bootstrap 下载私有权重 | `modal.secret.set` 创建/更新 | —（下载源凭据） |
| **Function** | 一个可调用单元（`@app.function` / `@modal.method`），一个函数 = 前端一个表单 = `modal.generate` 的一个 `recipe/function` 入参 | `modal.deploy` 随 image 部署 | 模型的一个能力 |

- **一个 modalapp 可以有多个函数**（如「文生视频」「图生视频」「首尾帧续接」），每个函数独立成表单，经 `modal.generate {modalapp, function, ...}` 调用（v1 不把它们贡献为平台模型）。
- **换函数不换环境**：同一 modalapp 的多个函数共享 Image 与 Volume；加函数只改 `manifest.json` + `modal_app.py`，不影响已部署的其它函数（除重新 deploy 外）。
- **加 modalapp 不改编排**：新增目录 + 重跑 `publish_registry.py`。

### 4.2 `modalapps/<id>/manifest.json`（单一信息源）

```json
{
  "id": "minimax-h3",
  "name": { "zh": "MiniMax H3 视频生成", "en": "MiniMax H3 Video" },
  "capability": "video.generate",
  "engine": {
    "appName": "recut-minimax-h3",
    "sourceDir": "modalapps/minimax-h3",
    "image": {
      "base": "debian_slim",
      "pythonVersion": "3.11",
      "apt": ["ffmpeg", "git"],
      "pip": ["torch==2.6.*", "diffusers==0.*", "transformers", "imageio-ffmpeg"],
      "buildCommands": ["pip install -e ./h3"]
    },
    "gpuTiers": {
      "default": "H100",
      "options": [
        { "id": "a100", "gpu": "A100-80GB", "label": { "zh": "A100 80G（省额度）", "en": "A100 80G (cheaper)" } },
        { "id": "h100", "gpu": "H100", "label": { "zh": "H100（更快）", "en": "H100 (faster)" } }
      ]
    },
    "timeoutSec": 3600,
    "idleTimeoutSec": 60,
    "volumes": [
      { "name": "recut-minimax-h3-models", "mount": "/models", "label": "模型权重" },
      { "name": "recut-minimax-h3-out", "mount": "/out", "label": "产物中转" }
    ],
    "secrets": [
      { "name": "recut-hf-token", "required": false, "label": { "zh": "Hugging Face Token（私有权重时需要）", "en": "Hugging Face token (private weights)" } }
    ]
  },
  "weights": {
    "bootstrapFunction": "bootstrap_weights",
    "repoHuggingFace": "MiniMaxAI/MiniMax-H3",
    "repoModelScope": "MiniMax/MiniMax-H3",
    "revision": "<pinned-commit>",
    "sizeGb": 24,
    "files": ["*.safetensors", "config.json", "tokenizer/*"]
  },
  "functions": [
    {
      "id": "text-to-video",
      "name": { "zh": "文生视频", "en": "Text to video" },
      "entrypoint": "generate_video",
      "invoke": { "mode": "sdk" },
      "output": { "kind": "video", "mimeType": "video/mp4" },
      "formSchema": [
        { "key": "prompt", "type": "textarea", "required": true, "label": { "zh": "提示词", "en": "Prompt" } },
        { "key": "referenceImages", "type": "media", "kind": "image", "multiple": true, "label": { "zh": "参考图", "en": "Reference images" } },
        { "key": "durationSec", "type": "number", "default": 5, "min": 1, "max": 15, "label": { "zh": "时长（秒）", "en": "Duration (s)" } },
        { "key": "aspectRatio", "type": "select", "options": ["16:9", "9:16", "1:1"], "default": "16:9" },
        { "key": "seed", "type": "number", "default": -1 }
      ],
      "defaultParams": { "durationSec": 5, "aspectRatio": "16:9" }
    },
    {
      "id": "image-to-video",
      "name": { "zh": "图生视频", "en": "Image to video" },
      "entrypoint": "generate_video_from_image",
      "output": { "kind": "video", "mimeType": "video/mp4" },
      "formSchema": [
        { "key": "prompt", "type": "textarea", "required": true, "label": { "zh": "提示词", "en": "Prompt" } },
        { "key": "referenceImages", "type": "media", "kind": "image", "multiple": false, "required": true, "label": { "zh": "首帧图", "en": "First frame" } },
        { "key": "durationSec", "type": "number", "default": 5, "min": 1, "max": 15 }
      ]
    }
  ]
}
```

- **`engine.image`**：直接映射 `modal.Image.debian_slim(python_version=...).apt_install(...).pip_install(...)` + `run_commands(...)`；`sourceDir` 用 `add_local_dir` 把 modalapp 代码带进镜像。
- **`engine.gpuTiers`**：`default` 为缺省，`options` 供 UI 选择；调用时用 `Function.with_options(gpu=<gpu>)` 动态覆盖（Modal 原生支持按调用覆盖 GPU，无需为每档重复定义函数）。
- **`engine.volumes`**：声明 volume 名称与挂载点；`bootstrap_weights` 与生成函数共享 `models` volume，`out` volume 作大文件产物中转。
- **`engine.secrets`**：声明需要的 Modal Secret（如 HF token），由用户在 Settings 里填值，App 用 `modal secret create` 落到用户自己的 Modal 账号。
- **`functions[].formSchema`**：字段类型见 §6.3；`media` 字段经平台素材选择器取 `assetId`，调用前用 `ctx.media.materialize` 转本地文件再上传云端。
- **`functions[].invoke`**：`mode: sdk`（`Function.from_name(...).remote()`，缺省）或 `http`（调用函数暴露的 web endpoint）；`modal.generate` 据 `modalapp + function` 解析到具体 entrypoint 与初值。

### 4.3 表单 schema（`formSchema`）：App 层的唯一表单真相

`formSchema` 是 **App 的调用契约**，被 App UI（「功能」Tab）与 `modal.catalog`/`modal.generate` 共同消费；**没有平台侧表单**（v1 不接平台，也就不存在「平台 schema 透传」问题）：

- **字段类型**（App 层控件）见 §6.3；`media` 字段经全局素材选择器取 `assetId`，调用前用 `ctx.media.materialize` 转本地文件再上传云端。
- **默认值/校验**由 App 在 `modal.generate` 内实现（`required`/`min`/`max`/`enum`）。
- **API/Agent 调用**：`modal.generate { modalapp, function, ...formFields, referenceAssetIds?, gpuTier?, confirmCost? }`；Agent 通过 `modal.catalog` 拿到各函数的 `formSchema` 以便正确填参。

### 4.4 函数输出契约

`modal_app.py` 的函数必须返回可 JSON 序列化的结果，由 `modal_runner.py` 归一为本地文件：

- **小产物（图片/短音频）**：返回 `{ "kind": "bytes", "data": <bytes>, "mimeType": "image/png", "meta": {...} }`；runner 直接写 `RECUT_APP_FILES_DIR`。
- **大产物（视频）**：函数写入 `/out` volume，返回 `{ "kind": "file", "volume": "recut-minimax-h3-out", "key": "runs/<id>.mp4", "mimeType": "video/mp4", "meta": {...} }`；runner 用 `modal volume get` 拉回本机。
- **`meta`**：`{width, height, durationSec, seed, steps, ...}`，写入 `<output>.meta.json`，供 `modal.generation.complete` 回填（与 gen-studio `applyGenerationMeta` 同构）。
- **错误**：函数抛异常 → Modal 返回失败 → runner 落结构化错误（`kind/code/message/hint`），任务终态 `failed`。

### 4.5 注册表生成（`publish_registry.py`）

单一信息源是 `modalapps/*/manifest.json`；生成器产出：

1. `python/registry.json`：`{ modalapps:[{id, appName, capability, gpuTiers, volumes, functions:[...], weights}] }`，供 `background.js` 解析「`modalapp + function` → entrypoint/表单/就绪」与 UI 渲染。
2. `modalapps/index.json`：modalapp id 列表。

> 生成器只在开发/构建期跑；运行期只读 `registry.json`，`background.js` 保留极简 `REGISTRY_FALLBACK`（照 gen-studio `REGISTRY_FALLBACK` 做法）。**不生成 `contributes.media`**（v1 不接平台）。

---

## 5. 平台接入：v1 不做特殊接入（等平台 hook）

> **v1 明确不接平台**：不写 `contributes.media`、不注册媒体 provider、不占默认生图/生视频路由、不依赖平台提案门。App 的能力完全走自己的 operation 面；平台侧不新增/修改任何字段。**平台后续会提供 hook 机制**，届时若要把本 App 接到默认路由、自动素材生命周期等，再按 hook 设计（本节只界定边界，不给出接入实现）。

### 5.1 v1 的对外能力面（全部在 App 层）

- **UI（iframe）**：直接用 `ctx`/HTTP 桥调用本 App 的 `api` 面 operation。
- **Agent（MCP）**：`modal.catalog` / `modal.status`（发现）与 `modal.generate` / `modal.save`（执行与入库）以 `surfaces:["mcp"]` 暴露，Agent 可直接调用；产物经 `modal.save`（`ctx.media.importFile`）进素材库。
- **跨 App**：`modal.generate` / `modal.save` / `modal.catalog` / `modal.status` 标 `capability: true`，其他 App 可经 `ctx.capabilities.invoke` 复用。
- **异步**：全部任务经 `recut.job.*` 统一观察（既有契约），无需平台特殊支持。

### 5.2 为什么 v1 不接（以及 hook 出现后怎么办）

- 平台当前的「App 代执行 provider」接入需要写 `contributes.media`（`protocol:"local"`）并占用平台目录/路由，语义上会把云 GPU 说成「本机 provider」，且平台路由拿不到逐字段表单与 per-model 提案标记。与其做一堆语义妥协，不如**等平台的 hook 机制**提供原生接入点（例如：声明式「外部生成来源」、生成生命周期 hook、默认路由挂载点）。
- **本 RFC 只承诺 App 层可用**（UI + Agent + 跨 App + 异步 + 入库）；平台级集成（默认路由、自动提案、能力目录聚合）**不在本 RFC 范围**。
- hook 机制就绪后的接入方式（示例方向，非本 RFC 设计）：App 声明 hook 清单 / 平台在生成分派处调用 App 的 `modal.generate` / 平台聚合 `modal.catalog` 的就绪度。具体以 hook 机制的平台 RFC 为准。

---

## 6. 能力与 MCP 契约

### 6.1 App operations 清单（`manifest.operations`）

| op | surfaces | capability | 说明 |
|---|---|---|---|
| `modal.status` | api, mcp | ✅ | token profile/连通性、各 modalapp 部署状态（app/function 是否存在）、volume 就绪度、在途任务 |
| `modal.catalog` | api, mcp | ✅ | 枚举 modalapp/函数：`{modalapps:[{id, label, capability, deployed, volumeReady, gpuTiers, functions:[{id, label, formSchema, defaultParams, output}]}]}` |
| `modal.profiles.add` | api | | 新增 token profile `{name, tokenId, tokenSecret}`（存 App 私有状态，0600） |
| `modal.profiles.list` | api | | 列出 profiles（**不返回 secret**，只返回 `{id, name, tokenIdMasked, tokenSet}`） |
| `modal.profiles.remove` | api | | 删除 profile |
| `modal.settings.set` | api | | 默认 profile、权重源（`automatic/huggingface/modelscope`）、默认 GPU 档位 |
| `modal.secret.set` | api | | 把 `{name, values}` 写成用户 Modal 账号下的 Secret（`modal secret create --force`），用于私有权重 token |
| `modal.deploy` | api, mcp | | 部署/更新 modalapp 的 Image 与函数（`modal deploy`）；异步单槽；`{modalapp}` |
| `modal.install` | api, mcp | | 只准备权重（跑 `bootstrap` 写 Volume，不重建 image）；异步、按 modalapp 串行；`{modalapp, source}` |
| `modal.generate` | api, mcp | ✅ | 调用函数：`{modalapp, function, ...formFields, referenceAssetIds?, gpuTier?, confirmCost?}`；单槽 FIFO；返回 `{job, taskId, generation:{id}}` |
| `modal.generations` | api, mcp | ✅ | 已完成运行记录（私有产物 + `savedAssetId`） |
| `modal.generation.complete` | api | | 任务终态后读取产物（`outputURL`/尺寸/时长/seed/耗时/错误） |
| `modal.save` | api, mcp | ✅ | 把私有产物导入素材库（`kind: image|video|audio`），返回真实 `assetId` |
| `modal.cancel` | api, mcp | ✅ | 取消最新在途任务 |
| `modal.tasks.list` | api, mcp | ✅ | 任务中心主列表（来源/状态/action 过滤、分页） |
| `modal.task.get` | api, mcp | ✅ | 单任务详情（来源、状态、meta、日志路径、产物） |
| `modal.task.logs` | api, mcp | ✅ | 持久日志（`tasks/<id>.log` JSON-lines，可回看） |
| `modal.task.cancel` | api, mcp | ✅ | 按任务 id 取消（queued 直接落 cancelled / running 走 shell cancel） |
| `modal.job` / `modal.resolve` | api | | UI 重连跟踪 / 确认终态（与 gen/audio 同构） |

`modal.generate` / `modal.save` 是核心执行与入库能力（`capability: true`，可被 Agent 与其他 App 经 `ctx.capabilities.invoke` 调用）；`modal.catalog` / `modal.status` 是发现面。

### 6.2 异步任务模型（复用 gen-studio）

**任务账本 `modal_tasks`**（App 私有 sqlite）与 gen-studio 的 `gen_tasks` 同构：

```sql
create table if not exists modal_tasks (
  id text primary key,
  shell_job_id text not null default '',
  action text not null,               -- deploy | install | generate | teardown
  modalapp text not null default '',
  function text not null default '',
  record_id text not null default '',
  source text not null default 'manual',   -- ai | manual
  submitted_by text not null default '',
  state text not null default 'queued',
  progress integer not null default 0,
  meta_json text not null default '{}',
  payload_json text not null default '',
  log_path text not null default '',
  error text not null default '',
  created_at text not null, started_at text not null default '', resolved_at text not null default ''
);
```

**产物表 `modal_generations`**：`id, modalapp, function, model, capability, prompt, params_json, width, height, duration, seed, reference_asset_ids, output_path, mime_type, saved_asset_id, gpu_tier, modal_call_id, created_at, job_id, status, error`。

**并发分类**：

| 类别 | 动作 | 并发规则 |
|---|---|---|
| 运行 | `generate` | **单槽 FIFO**（控制额度/并发）；依赖 modalapp 已 deploy 且（如声明）权重已就绪，否则保持 queued |
| 部署 | `deploy` | **单槽**（镜像构建不可并发，避免重复构建） |
| 权重 | `install` | **按 modalapp 串行**（同一 Volume 不并发写）、不同 modalapp 可并行 |
| 销毁 | `teardown` | 可并行 |

**提交永不拒绝 / 统一观察**：与 gen-studio 完全一致——先 `pumpQueue` 释放槽位，再写一行，占槽返回 `job:null + taskId`；日志 `--task-log` tee 到 `tasks/<id>.log`，`recut.job.*` 直接可观察（`kind: shell`）。

### 6.3 字段类型（`formSchema`）

| type | UI 控件 | 值 |
|---|---|---|
| `textarea` / `text` | 输入框 | string |
| `number` | 数字输入 | number（含 min/max/default） |
| `select` | 下拉 | 枚举 |
| `boolean` | 开关 | bool |
| `media` | 全局素材选择器（图片/视频/音频，可多选） | `assetId[]` → 调用前 `ctx.media.materialize` 转本地文件 → 上传云端 |

### 6.4 MCP 发现面（仅 App 层）

- **App 侧（唯一发现面）**：`modal.catalog`（modalapp/函数/表单/部署与 volume 就绪度）、`modal.status`（token/连通性/在途任务）。Agent 用它们决定「能否调用、需不需要先部署/下权重」。
- **平台侧不接入**：v1 不贡献平台媒体 provider，因此 `recut.media.list_capability_models` / `recut.context.media.readiness` **不会**出现本 App；这是 v1 的有意边界。hook 机制就绪后再评估把这些就绪度接入平台发现面。

---

## 7. 执行模型：token / profiles / 生命周期

### 7.1 Token 与多账号（profiles）

- **存储**：profiles 存 App 私有状态（`modal_settings` + `modal_profiles` 表 / appstate 文件，权限 0600）；`modal.profiles.list` 只回 `tokenIdMasked`，**永不回 secret**。
- **注入**：调用 `modal_runner.py` 时只把选中 profile 的 `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` 放进子进程环境；不写日志、不回传 UI。
- **多账号**：每个 modalapp 可绑定一个 `profileId`（缺省用全局默认 profile）；「多个 modal.com 账号」即多个 profiles。
- **连通性验证**：`modal.status` 跑一次轻量检查（如 `modal app list` 或 SDK 列 App），返回 `{connected, account?, error?}`。

### 7.2 `modal_runner.py`（本机薄客户端）

子命令：

| 命令 | 行为 |
|---|---|
| `status` | 读取 profiles、modalapp 部署状态（`Function.from_name` 探测 / `modal app list`）、volume 就绪度 |
| `catalog` | 读 `python/registry.json` + 动态就绪度，输出 modalapp/函数/表单 |
| `deploy --modalapp <id>` | `modal deploy modalapps/<id>/modal_app.py`（注入 token 环境；流式日志 tee） |
| `bootstrap --modalapp <id> --source <hf|ms|auto>` | `modal run modalapps/<id>/bootstrap.py`（云端把权重写进 Volume；校验大小/revision） |
| `invoke --modalapp <id> --function <fn> --params <json> --refs <json> --output <path> --task-log <log>` | `Function.from_name(appName, fn).with_options(gpu=<tier>).remote(**params, refs=...)`；结果 bytes 落盘 / `modal volume get` 拉回；写 `<output>.meta.json` |
| `teardown --modalapp <id>` | `modal app stop <appName>`（可选保留 volume） |
| `secret --modalapp <id> --name <n>` | 从 stdin 读值，`modal secret create --force` |

- **流式日志**：函数运行时把日志回传本机（SDK/CLI 的日志流），runner 解析为 `[modal] ...` 进度行 tee 到 `--task-log`（复用 gen-studio `run_worker_process` 模式）。
- **长任务**：`invoke` 用 `FunctionCall`（`.spawn()` + 轮询）或阻塞 `.remote()`；取消时 runner 响应 `ctx.shell.cancel` 终止本地进程，并尽力 `modal.FunctionCall.cancel()`。

> **本机 vs 云端边界**：本机只负责编排、上传参考、接收产物；真实计算与权重都在 Modal。这与「把云端函数当本地函数调用」的产品直觉一致。

### 7.3 生命周期

```text
配置 token(profiles) ─► modal.deploy(modalapp) ─► modal.install(modalapp, source) ─► modal.generate(modalapp, function, params)
      Setup 门               构建 image + 部署函数        准备 Volume（权重）           调用函数 → 拉回产物 → modal.save
```

- 未配置 token：`modal.status.connected=false`，UI 显示 Setup 门；Agent 调用 `modal.generate` 返回结构化错误 + 「先配置 Modal token」hint。
- 未 deploy：`modal.catalog` 标 `deployed=false`，运行按钮禁用并给「去部署」引导；Agent 调用同样得到结构化错误。
- 已 deploy 未装权重：`volumeReady=false`，给「下载模型」引导。

---

## 8. 环境与成本模型

### 8.1 GPU 档位与成本透明

- modalapp `engine.gpuTiers` 声明可选 GPU（如 `A100-80GB` / `H100`）；缺省档位由 modalapp 定，UI 可切档。
- 调用时用 `Function.with_options(gpu=<gpu>)` 动态覆盖（Modal 原生支持，无需重复函数定义）；不同 GPU 档位形成独立容器池、各自 scale-to-zero。
- UI 在函数表单旁显示：GPU 档位、预估耗时、「可能消耗 Modal 额度」提示；App 在 `modal.generate` / UI 层要求显式确认（`confirmCost`）后再花钱。

### 8.2 额度与账号

- $30/月免费额度归用户 Modal 账号；多个账号 = 多个 profile，可分给不同 modalapp（例如一个账号跑视频、一个跑图片）。
- 第一版**不做用量计费 API 集成**；只做透明度提示与确认门。用量展示见 §14 开放问题（若 Modal 提供 billing/usage API 则作为 M4 增强）。
- App 绝不把 token 或用量信息写入平台日志/素材元数据。

### 8.3 冷启动与保持

- 默认 `min_containers=0` / 短 `idleTimeoutSec`（scale-to-zero，省额度）。
- modalapp 可选声明「保持热容器」档位（`min_containers>0`），文案明确提示会持续消耗额度。

---

## 9. 交互设计

> 目标：与 gen-studio 的任务中心 UX 同源；差异只在「顶部是预设/函数切换」与「Setup 门填 token」。

### 9.1 布局

```text
┌──────────────────────────────────┬───────────────────────────────────────────┐
│ Left                              │ Right（统一生产预览 + 进度日志）            │
│ ┌────────────┬─────────────────┐ │ ┌───────────────────────────────────────┐ │
│ │ Tab1 功能  │ Tab2 记录        │ │ │ 任务头：名称 · 状态徽标 · 进度条 ·     │ │
│ │            │                  │ │ │         [取消] [查看日志]              │ │
│ │ [预设切换] │ [部署][下载][运行]│ │ ├───────────────────────────────────────┤ │
│ │ [函数切换] │ ┌──────────────┐ │ │ │ 运行任务：                            │ │
│ │ ┌────────┐ │ │ 统一任务列表  │ │ │ │   ┌─────────────────────────────┐     │ │
│ │ │该函数  │ │ │ · 部署环境    │ │ │ │   │ 视频/图片预览                │     │ │
│ │ │的表单  │ │ │ · 下载 权重   │ │ │ │   └─────────────────────────────┘     │ │
│ │ │(schema)│ │ │ · 运行 xxx    │ │ │ │   参数：modalapp/GPU/时长/seed/耗时      │ │
│ │ │[GPU档] │ │ │  （点击一行） │ │ │ │   [保存入库] [下载] [重跑]             │ │
│ │ │[运行]  │ │ └──────────────┘ │ │ │ 部署/下载任务：                        │ │
│ │ └────────┘ │                  │ │ │   实时日志流 + 就绪度摘要              │ │
│ └────────────┴─────────────────┘ │ └───────────────────────────────────────┘ │
└──────────────────────────────────┴───────────────────────────────────────────┘
```

### 9.2 Setup 门（替换 gen-studio 的 prepare 门）

- `modal.status.connected === false` 时整屏渲染 Setup 卡：粘贴 `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET`（或从 `~/.modal.toml` 导入）、「验证连接」按钮。
- 验证通过后进入主界面；profiles 管理与默认账号在 Settings。

### 9.3 Left · Tab 1「功能」

- **预设切换器**：来自 `modal.catalog.modalapps`；每个 modalapp 显示 `deployed`/`volumeReady` 徽标。
- **函数切换器**：modalapp 下多函数时显示（如「文生视频 / 图生视频」）。
- **表单**：由所选函数的 `formSchema` 渲染；`media` 字段用全局素材选择器；GPU 档位下拉来自 `engine.gpuTiers`。
- **就绪引导**：未 deploy / 未装权重时「运行」禁用，给「去部署 / 去下载模型」按钮（跳 Tab 2 或直接触发 `modal.deploy` / `modal.install`）。
- **提交**：`modal.generate` → `{job, taskId, generation}`；无论立即派发还是排队，Right 自动切到该任务。

### 9.4 Left · Tab 2「记录」

- 统一任务列表（`modal.tasks.list`）：`deploy → 部署 <modalapp 环境>`、`install → 下载 <modalapp> 权重`、`generate → 运行 <function> · <提示词摘要>`。
- 过滤：按 action/状态/来源；顶部快捷动作：「部署环境」「下载模型」（选 modalapp + 源）、「管理账号」（profiles）。

### 9.5 Right「统一生产预览 + 进度日志」

- 共享任务头 + 进度/取消/日志（同 gen-studio）。
- 运行任务：预览视频/图片（`modal.generation.complete.outputURL` 经 `ctx.files.url`）；显示 modalapp/函数/GPU/时长/seed/耗时；动作：`modal.save`、下载、「以本结果为参考再运行」（视频续接）。
- 部署/下载任务：实时日志流 + 就绪度摘要（`modal.status`：token/deployed/volume）。
- 无选中：显示账号与各 modalapp 就绪总览 + 引导。

### 9.6 实现与一致性

- React + TypeScript + Vite，`ui/dist` 单文件产物；组件拆分 `run-tab` / `records-tab` / `preview-pane` / `setup` / `settings`。
- i18n 走 `ctx.locale`（`manifest.localized`）；任务列表/日志/取消复用 audio-studio 任务中心节奏。
- 表单式，不做节点连线编辑器（见 §1.2）。

---

## 10. 与既有契约的关系

- **不接平台生成契约**：v1 不经 `recut.image/video.generate`、不经 `media.resolveRoute`、不走执行桥、不触发平台提案门；生成入口是本 App 的 `modal.generate`。
- **异步 Handle**：任务经 `ctx.python.run` / `ctx.job.*` 走既有 `async_ops`，`recut.job.*` 统一观察（不改契约）。
- **参考素材**：App 用 `ctx.media.materialize(assetId)` 把项目/素材库中的参考图/视频取成本地文件再上传云端；`referenceAssetIds` 由 App 自己解析（无平台侧 `referenceFields`）。
- **交付**：产物先私有（App 文件区），仅 `modal.save`（内部 `ctx.media.importFile`）后成为平台 Asset；不自动入库。
- **发现**：仅 App 层 `modal.catalog`/`modal.status`；平台发现面（`recut.media.*`）v1 不涉及。
- **不做**：不改 `async_ops`、不改 Op 总线、不新增渲染引擎、不引入 DSL、**不改 `service/`**。

---

## 11. 改动清单（全部在 App 层，零 service 改动）

| 位置 | 改动 | 类型 |
|---|---|---|
| `apps/modal-studio/*`（新） | 完整标准 App 包：`manifest.json` + `background.js` + `bootstrap.py` + `python/{modal_runner.py,publish_registry.py,registry.json,requirements.lock}` + `modalapps/<id>/{manifest.json,modal_app.py,bootstrap.py}` + `ui/` + `skills/` | 新增（App 层） |
| `apps/modal-studio/manifest.json` | 只声明身份 + `runtime.python` + `operations`（`capability: true`）；**不声明 `contributes.media`**（v1 不接平台） | App 层 |
| `rfc/README.md` | 增本 RFC 索引条目 | 文档 |
| `service/**` | **无任何改动** | — |

> 明确「不改」清单：`contributes.media` 契约、`ContributedMediaProvider/Model`、`app_media_bridge.go`、`jobs.go`、`catalog.go`、`capability_models.go`、`mcp.go`、`builtin_apps.go`、`catalog_seed.go` **全部保持原样**。App 不使用这些平台接入机制；平台 hook 机制就绪后再单独评估接入。因此本 RFC 的实现（Agent 生成代码）完全收敛在 `apps/modal-studio/`。

---

## 12. 里程碑

- **M0（纯 App 骨架 + 端到端烟测）**：搭出标准 App 包（`manifest` + `background` 注册全部 op + `python/modal_runner.py` + Setup 门），`make app-link` 后平台按既有机制加载；用一个最小 modalapp（小 GPU，函数生成一张小图）跑通 `deploy → install → generate → save`，全程只经 App 的 MCP/api operation。
- **M1（旗舰视频 modalapp 端到端）**：MiniMax H3 modalapp（`modal_app.py` + `bootstrap.py` + `manifest.json`）；`modal.deploy`/`modal.install`/`modal.generate`（GPU 档位、视频产物 `volume get`）、`modal_tasks` 队列；Agent 经 `modal.generate` 出片 → `modal.save` 入素材库。
- **M2（交互 + profiles）**：Left 两 Tab + Right 预览/日志完整交互（表单 `formSchema` 驱动）；profiles 多账号管理、`modal.secret.set`；`modal.catalog`/`modal.status` 发现面；Settings 卡（GPU 默认档、权重源、账号）。
- **M3（扩展点验证）**：再加一个图片 modalapp（验证同 modalapp 多函数、App 层成本确认）；验证「加 modalapp = 加目录 + 重跑生成器」零逻辑改动。
- **M4（打磨）**：进度百分比、热容器档位、Cancel 传播到 `FunctionCall.cancel`、用量/额度展示（若 Modal 有 API）、README/skill 完善。

---

## 13. 验收

1. **标准 App 安装、零 service 改动**：`make app-link APP=apps/modal-studio`（开发）或 `recut.apps.install { repository }`（发布）后，平台按既有机制加载，`id == recut.modal-studio`；**未改动任何 `service/` 文件**即可跑通全部验收项。
2. **Setup 门**：未配置 token 时整屏 Setup 卡；填入 token 并「验证连接」通过后进入主界面；`modal.profiles.list` 不回传 secret。
3. **环境/权重分离**：`modal.deploy` 完成后函数可被 `from_name` 探测到但 volume 为空；单独 `modal.install {modalapp, source:"modelscope"}` 完成权重写入；`modal.status` 分别反映两项。
4. **一个 App 多 modalapp/多函数**：`modal.catalog` 列出多个 modalapp 与每个 modalapp 的多个函数（含表单 schema）；新增 modalapp 只需加目录 + 重跑生成器。
5. **本机函数式调用**：`modal.generate` 经 `modal_runner.py` 用 `Function.from_name(...).with_options(gpu=...).remote()` 执行；产物（视频）经 Volume 拉回本机落私有路径；无需任何 HTTP endpoint。
6. **异步任务**：并发提交多个 `modal.generate` 时后到者 `job:null + taskId` 且 queued，前序完成后自动开始；`recut.job.wait` 可观察终态；`modal.task.cancel` 可取消 queued 与 running；任务结束后日志可回看。
7. **Agent/跨 App 调用**：Agent 经 MCP 调用 `modal.generate` 出片并 `modal.save` 入库；另一 App 经 `ctx.capabilities.invoke` 调用 `modal.generate` 同样成功（`capability: true`）；未配置 token/未部署时返回结构化错误 + hint。
8. **多账号**：配置两个 profile，分别绑定不同 modalapp；切换后调用使用对应账号 token（可在 Modal 控制台分别看到调用）。
9. **失败可操作**：Modal 不可达/未部署/未装权重/超时各有明确错误与 hint；绝不静默产出坏素材；token 与 secret 不出现在日志/素材元数据里。
10. **平台零接入**：`recut.media.list_capability_models` / 默认路由**不出现**本 App（v1 有意边界）；`service/` 无任何改动。

---

## 14. 风险与开放问题

- **v1 不接平台（有意边界）**：收益是零 `service/` 改动、App 完全自洽；代价是平台的默认生图/生视频路由、自动素材生命周期、能力目录聚合都不覆盖本 App，用户/Agent 必须显式调用本 App 的 operation。等平台 **hook 机制**就绪后再评估接入；届时可能仍需一个平台侧 RFC 定义 hook 契约。
- **长任务**：视频冷启动 + 生成可能很久。v1 走 App MCP（`modal.generate` + `recut.job.*` 轮询）天然可长；若将来接入平台 hook，需要 hook 支持长任务/异步回调。
- **日志流式**：SDK `.remote()` 的实时日志回传行为需在 M0 验证；若不理想，回退用 `modal run`（牺牲热容器）或用 `spawn` + 函数内写 Volume 进度。
- **产物回传**：视频经 Volume `modal volume get` 拉回需要临时磁盘与带宽；超大文件（>GB）是否改为 Modal 直接写入用户对象存储/签名 URL 直传，M2/M4 评估。
- **额度与计费**：Modal 是否提供用量 API（供 UI 显示剩余额度/本月花费）待查；第一版只做提示与确认。多个账号是否违反 Modal ToS 需用户自行确认（RFC 只提供技术能力）。
- **安全边界**：token 存 App 私有状态（明文 + 0600）；是否需要平台级 `ctx.secrets` 加密存储是更大的平台议题（可另出 RFC）。云端函数会执行 modalapp 代码，用户应只使用可信 modalapp。
- **modalapp 生态与供应链**：第三方 modalapp 是代码分发载体（image build 会执行 pip/git）；是否引入 modalapp 签名/白名单、以及 App Store 化的 modalapp 市场上架，属后续议题（第一版只随 App 附带官方 modalapp）。
