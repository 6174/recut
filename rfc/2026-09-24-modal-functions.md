<!--
 * [INPUT]: 依赖既有本地 App 范式与刚确立的「App 声明式本地生成 provider」：apps/gen-studio（manifest
 *          contributes.media 静态声明 provider/模型 + gen_tasks 账本 + pumpQueue 并发分类 + 能力桥
 *          gen.generate/gen.save + bootstrap.py 派生运行环境 + distribution.builtin 内置分发）、
 *          service/app_media_bridge.go（manifest 驱动的通用执行桥：generate → 等 shell job → 授权 save →
 *          回读 Asset → Attach）、service/media/app_providers.go（App 贡献 provider 并入全局目录、CDN 刷新不丢）、
 *          service/media/capability_models.go（Protocol=="local" 的能力模型聚合 + localModelProvider 注入）、
 *          service/media/jobs.go execute()（按 provider id 分派到 localAppExec）、service/media/catalog.go
 *          configuredModelFor（本地 provider 跳过凭据）、service/catalog.go Manifest.Contributes.Media /
 *          ContributedMediaModel / validateMediaContribution、service/runtime.go（ctx.python/shell/media/
 *          files/sqlite/appFiles/paths/capabilities 契约；ctx.http 只有有限 GET）、service/mcp.go
 *          mediaReadiness/local branch、docs/app-contract.md、docs/platform-comms-contract.md；
 *          外部事实：modal.com（$30/mo 免费算力、modal.App/Image/Volume/Secret/@app.function、
 *          gpu="H100"/"B200+"、Function.from_name(...).with_options(gpu=...).remote()/spawn()、
 *          modal deploy / modal run / modal volume）。
 * [OUTPUT]: 设计一个把开源 GPU 项目托管到 modal.com 的 App（recut.modal-studio，apps/modal-studio，
 *           「Modal 云函数」）。核心：**一个 App、多个预设包（recipe）**——每个 recipe 是一个自包含目录
 *           （manifest.json 声明 image/volume/functions/表单 + modal_app.py 定义云端 Modal App +
 *           bootstrap.py 准备 volume），App 只做本机薄客户端（modal_runner.py + goja background.js）：
 *           用户配置 modal.com token 后 `modal.deploy` 部署 image、`modal.install` 把权重下进 Modal Volume、
 *           `modal.generate` 用 `Function.from_name(...).remote()` 调用（**无需 HTTP，就当本机 python 函数**）。
 *           对齐 gen-studio：runtime(venv)↔Modal Image、model(权重)↔Modal Volume、prepare↔deploy、
 *           install↔bootstrap、generate↔invoke、gen_tasks 单槽 FIFO、能力桥 modal.generate/modal.save、
 *           Left 两 Tab（功能表单 / 记录）+ Right 预览日志、Setup 门。平台侧只做两处小泛化：
 *           ① contributes.media 允许 `protocol: "app"`（App 代执行的远程/付费 provider，凭据由 App 自持）
 *           并与 local 共用通用执行桥；② ContributedMediaModel 透传 parameters/referenceFields/
 *           requiresProposal/editModelId（Modal 的每函数表单与视频确认门）。第一版兑现 MiniMax H3 等
 *           开源视频/图像项目的云端自托管，使 `video.generate.default` 可指向 `modal/<model>`，
 *           不再依赖 atlascloud 等平台代持凭据。不新增渲染引擎、不引入中间语言、不改异步 Handle 契约。
 * [POS]: rfc 的「App 代执行的云端 GPU provider」设计稿；把 gen-studio 的「本地 runtime 多模型」范式
 *        推广为「App 托管的预设包（recipe）= 云端 Image + Volume + N 个 Function = N 个前端表单」，
 *        平台只需把 contributed provider 从「只允许 local」放宽为「local（本机零成本）/ app（App 代执行）」
 *        两种协议并透传模型表单 schema，即可让任意开源 GPU 项目经 modal.com 变成平台可路由模型。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC：Modal 云函数（Modal Functions）——把开源 GPU 项目托管到 modal.com 的 App 扩展

- 状态：Proposal
- 作者：Recut
- 日期：2026-09-24
- 决策范围：`apps/modal-studio` 内置 App 的包结构、**预设包（recipe）= 云端 Image/Volume/Functions** 模型、token/profiles 与部署生命周期、`modal_tasks` 异步协议、Left/Right 交互、`contributes.media` 的 `protocol: "app"` 泛化与模型 schema 透传、`video.generate.default` 指向 `modal/<model>` 的路由
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

- **Left Tab 1「功能」**：顶部一个**预设切换器**（列出所有 recipe），切换后下面是**该 recipe 的函数表单**（提示词、参考图、时长、seed、GPU 档位……由 recipe 的 `manifest.json` 声明），点「运行」即调用云端函数。
- **Left Tab 2「记录」**：和声音工坊/gen-studio 一样的**统一任务列表**——「部署环境」「下载模型」「运行函数」都是同一类任务；点任意一行，**Right 就显示对应的结果和日志**。
- **Right**：**统一的生产预览 + 进度日志**。选中生成任务显示视频/图片预览与参数、可保存入库；选中部署/下载任务显示实时日志与就绪度；顶部共享状态、进度、取消。

**几个关键决定：**

1. **一个 App、多个预设包（recipe）**：每个 recipe 就是一个自包含目录（`recipes/<id>/`），里面有 `manifest.json`（声明 image、volume、函数与表单）、`modal_app.py`（云端 Modal 代码）、`bootstrap.py`（准备 volume / 下载权重）。加一个新能力 = 加一个目录，不改 App 逻辑。
2. **充当本机 python 函数，不强依赖 HTTP**：本地只跑一个薄 Python 客户端，用 Modal SDK 的 `Function.from_name(...).remote()` 调用云上的函数（Modal 函数本来就支持「被另一段代码直接调用」）。HTTP endpoint 只作为可选后端。
3. **云端 image 就是「运行环境」**：recipe 声明的 `Image`（基础镜像 + pip 依赖 + 系统包）在 Modal 云端构建；用户选的预设 = 选的镜像环境。
4. **模型权重统一进 Volume**：`bootstrap.py` 里在云端把权重下载进 Modal Volume，函数以 `volumes={"/models": vol}` 挂载；换模型只改 volume 内容，不重建镜像。
5. **只要一个 token 就能用**：用户填 `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET`（可配多个账号 = 多 profile，分给不同 recipe）；token 只在本机保存、只按需注入子进程，不进日志。
6. **和 gen-studio 架构同构**：runtime(venv)↔Modal Image、model(权重)↔Modal Volume、prepare↔deploy、install↔bootstrap、generate↔invoke；`modal_tasks` 单槽 FIFO、提交不拒绝、`recut.job.*` 统一观察。
7. **接进平台路由**：App 在 manifest 用 `contributes.media` 声明 `modal` provider 与静态模型；平台把 `video.generate.default` 指向 `modal/<model>` 后，编辑器/Agent 的 `recut.video.generate` 就能走本机代执行的 Modal 云函数（视频默认仍走确认提案门，因为会花额度）。
8. **付费/额度要透明**：Modal 有免费额度但超了要花钱，所以视频与高成本模型默认 `requiresProposal: true`（先提案、用户确认才花钱），表单上显示 GPU 档位与预估耗时。

**一句话：** 把「本地生成」的「一个 App 多模型」范式，换成一个「一个 App 多预设包、云端 Image + Volume + Function」的范式——本机只做薄客户端，真正的 GPU 活在 modal.com 上，用户只出一个 token。

---

## 0.1 技术摘要

本文设计 `recut.modal-studio`（目录 `apps/modal-studio`，名称「Modal 云函数」）——一个**内置**、**本机薄客户端 + 云端 GPU 执行**、**一个 App 托管多个预设包（recipe）**的生成 App，覆盖图片/视频（可扩展音频）。

- **协议同构 gen-studio**：`manifest.json` 声明 `operations` + `runtime.python`（轻量主 venv，只装 `modal` 客户端）+ `distribution.builtin`；`background.js`（goja）用 `ctx.sqlite` 维护 `modal_tasks` 账本、`ctx.python.run` 执行可观察 shell job（`modal_runner.py`）、`ctx.media` 物化参考/导入产物、`ctx.files` 提供私有预览 URL。
- **recipe 模型（核心）**：`recipes/<id>/` 三件套——
  - `manifest.json`：`engine`（appName / image / gpu 档位 / volumes / secrets / weights）+ `functions[]`（每个函数一个 id + entrypoint + `formSchema` + `output` + 可选 `invoke.mode`），是 UI 表单与平台模型贡献的**单一信息源**；
  - `modal_app.py`：云端 Modal App 定义（`Image` + `@app.function(volumes=..., gpu=..., timeout=...)` + 可选 `bootstrap_weights` 函数）；
  - `bootstrap.py`：内容准备入口（在云端把权重下进 Volume、校验大小/版本、可断点重试）。
- **环境/权重分离（对齐 gen-studio）**：`modal.deploy` 只构建/部署 Image（= runtime）；`modal.install` 只跑 `bootstrap` 把权重写进 Volume（= model）；`modal.generate` 调 `Function.from_name(...).with_options(gpu=...).remote()`（= invoke），并把结果文件（bytes 或 Volume key）拉回本机落成私有产物。
- **平台接线（声明式，无 per-app 代码）**：App 在 `contributes.media` 声明 provider `modal`（`protocol: "app"`）与静态模型（每个可路由函数一个模型，id 为 `<recipeId>` 或 `<recipeId>-<functionId>`）；平台把 provider 并入全局目录并复用 `app_media_bridge.go` 通用执行桥（`modal.generate` → 等 shell job → 授权 `modal.save` → 回读 Asset → Attach）。**平台只做两处小泛化**：允许 `protocol: "app"`、透传 `ContributedMediaModel` 的 `parameters/referenceFields/requiresProposal/editModelId`。`catalog_seed.go` 无需改动。
- **token / profiles**：`modal.profiles.add/list/remove` 管理多个 Modal 账号的 token（`{name, tokenId, tokenSecret}`）；`modal.settings.set` 选默认 profile 与权重源；token 存 App 私有状态（0600），只在 `modal_runner.py` 子进程的环境变量里出现，绝不写入日志。
- **交互**：Left 两 Tab（功能表单 / 统一任务记录）+ Right 统一生产预览与进度日志；表单由 recipe 的 `formSchema` 驱动，顶部预设切换器来自 `modal.catalog`；未配置 token 时整屏显示 **Setup 门**（填 token / 验证连接）。
- **第一版兑现**：至少一个视频 recipe（如 MiniMax H3 文/图生视频）与一个图片 recipe，支持 GPU 档位选择、huggingface/modelscope/automatic 权重源。

**边界（非目标）**：不新增平台渲染引擎、不引入 XML/DSL、不改 `async_ops`/Op 总线契约、不把生成产物默认入库（先私有、确认后 `modal.save`）、不做节点式工作流编辑器（表单式）、**不做平台代持 Modal 凭据**（token 永远在用户本机）、不保证离线可用（Modal 是远程服务）、不自动帮用户创建/结算 Modal 账号。

---

## 1. 目标与非目标

### 1.1 目标

1. 一个内置 App（`recut.modal-studio`）让**没有本地 GPU**的用户，用 modal.com 的免费额度跑开源图片/视频项目，并接进 Recut 的生成流水线。
2. **多个预设包（recipe）**：每个 recipe 自包含（`manifest.json` + `modal_app.py` + `bootstrap.py`），用户选预设即选云端 image 环境；新增能力 = 新增目录。
3. **本机薄客户端，不依赖 HTTP**：本地用 Modal SDK 直接调用云端函数（`Function.from_name().remote()`），把云端当作「本机函数的 GPU 版」；HTTP 端点仅作可选后端。
4. **环境/权重分离**：部署 image（`modal.deploy`）与准备权重（`modal.install` → Volume）分开，各自独立可重试；权重源可选 `automatic | huggingface | modelscope`。
5. **一个 token 可用、多账号可切换**：用户配置 Modal token（profiles）后即可部署与调用；支持多个 Modal 账号绑定不同 recipe。
6. **表单式调用**：每个函数一个前端表单，字段与校验由 recipe `manifest.json` 的 `formSchema` 声明。
7. **接入平台路由**：把 `modal` 声明为 App 贡献的媒体 provider，使 `image.generate.default` / `video.generate.default` 可指向 `modal/<model>`；高成本能力默认走提案确认门。
8. **与 gen-studio 同构的异步与交互**：`modal_tasks` 单槽 FIFO、提交永不拒绝、`recut.job.*` 统一观察、日志落文件可回看；Left 两 Tab + Right 预览日志 + Setup 门。
9. **可发现与可代执行**：`modal.catalog` / `modal.status` 对外暴露「有哪些 recipe/函数/就绪度」，模型经平台聚合（`recut.media.list_capability_models`）可被 Agent 发现与经桥调用。

### 1.2 非目标

- 不做本地 GPU 推理（本地只做编排与调用；GPU 全在 Modal）。
- 不做平台侧凭据代持/代付（token、额度、账号都是用户的；平台只当执行桥）。
- 不做 Modal 账号注册、付费、额度结算或用量计费 API 集成（第一版只做透明度提示；用量集成见 §14 开放问题）。
- 不引入节点式/连线式工作流（保持「预设包 + 函数表单」）。
- 不改生成提案（proposal）语义、不改路由/`async_ops` 契约（仅在 provider 协议与模型 schema 透传上做小泛化）。
- 不做模型训练/LoRA 训练（只做推理）。
- 不保证离线：Modal 不可达时任务失败并给出结构化错误。

---

## 2. 总体架构

```text
                    ┌──────────────────────────────────────────────────────────┐
   Agent / UI  ──►  │  平台 MCP / HTTP                                          │
                    │  recut.video.generate ─► media.resolveRoute ─► execute()  │
                    │        (route: video.generate.default)                    │
                    │                         │ Protocol=="app" (App 代执行)     │
                    │                         ▼                                 │
                    │   app_media_bridge.go ──► AppHost.InvokeMCP             │
                    │        ▲                        │                         │
                    │        │ GetAsset/Attach        │ modal.generate          │
                    └────────┼────────────────────────┼─────────────────────────┘
                             │                        ▼
                    ┌────────┴──────────────────────────────────────────────────┐
                    │  recut.modal-studio (apps/modal-studio, goja background.js)│
                    │  modal_tasks 账本 + pumpQueue（invoke 单槽 / deploy 单槽 / │
                    │  bootstrap 并行）                                          │
                    │  ctx.python.run(modal_runner.py ...)  →  shell job          │
                    └──────────────────────────┬────────────────────────────────┘
                                               │ 本机主 venv（轻量：modal 客户端）
                                               ▼
                    ┌──────────────────────────────────────────────────────────┐
                    │  python/modal_runner.py（本机）                            │
                    │   status / deploy / bootstrap / invoke / teardown         │
                    │     · 读 recipes/<id>/manifest.json 与 token profile       │
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
| `python/gen_runner.py` + `diffusers_runner.py` | `python/modal_runner.py` + 每个 recipe 的 `modal_app.py` | 本机调度器 / 云端执行体 |
| `local-gen` provider（`protocol:"local"`） | **`modal` provider（`protocol:"app"`）** | App 声明的 provider |
| `app_media_bridge.go` | `app_media_bridge.go`（**共用，仅泛化协议**） | 通用执行桥 |
| `recipes`（无） | **`recipes/<id>/`** | 预设包（image + volume + functions） |

> **关键差异（相对 gen-studio）**：gen-studio 的「运行时」在用户本机、零成本、离线；modal-studio 的「运行时」在 modal.com、消耗用户额度、需联网。因此：① 生成默认不是零成本 → 视频/高成本模型默认 `requiresProposal: true`；② 平台 provider 用 `protocol: "app"`（App 代执行的远程 provider），就绪度与文案区分「本机零成本」；③ recipe 的每个函数是平台可见的一个模型单位（成本/GPU 粒度更细）。

---

## 3. App 包设计

### 3.1 目录结构

```text
apps/modal-studio/
├── manifest.json                 # 身份/入口/权限/runtime.python/operations/contributes.media/distribution.builtin
├── background.js                 # 唯一业务后端：modal_tasks 账本 + 队列 + 能力 op
├── bootstrap.py                  # App 级准备（创建主 venv 之外的一次性校验；可选）
├── python/
│   ├── modal_runner.py           # 本机薄客户端：status/deploy/bootstrap/invoke/teardown/secret
│   ├── registry.json             # 由 recipes/* 生成：recipe/function ↔ 平台模型 id ↔ 就绪度兜底
│   ├── publish_registry.py       # 扫描 recipes/*/manifest.json → 生成 registry.json + manifest.contributes
│   └── requirements.lock         # 主 venv 锁定依赖（轻量：modal、requests、huggingface_hub、modelscope）
├── recipes/                      # 预设包（每个 = 一个云端 Modal App）
│   ├── index.json                # recipe id 列表（由 publish_registry.py 生成）
│   ├── minimax-h3/
│   │   ├── manifest.json         # engine + functions[]（表单/入口/输出）
│   │   ├── modal_app.py          # Image + Volume + @app.function（含 bootstrap_weights）
│   │   ├── bootstrap.py          # 权重准备入口（modal run）
│   │   └── README.md
│   └── <recipe-2>/ ...
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
  "distribution": {
    "builtin": {
      "include": ["."],
      "exclude": ["rfc", "__pycache__", "**/__pycache__", "ui/node_modules", "ui/src",
                  "ui/package-lock.json", "ui/package.json", "ui/tsconfig.json",
                  "ui/vite.config.ts", "ui/components.json"]
    }
  },
  "contributes": {
    "media": {
      "providers": [
        {
          "id": "modal",
          "name": "Modal 云函数（GPU）",
          "localized": { "en": { "name": "Modal Functions (GPU)" } },
          "protocol": "app",
          "operations": {
            "generate": "modal.generate",
            "save": "modal.save",
            "catalog": "modal.catalog",
            "status": "modal.status"
          },
          "models": [
            {
              "id": "minimax-h3-video",
              "name": "MiniMax H3 · 云端文生视频",
              "capability": "video.generate",
              "runtime": "minimax-h3",
              "sizeGb": 24,
              "inputModes": ["text", "image"],
              "outputModes": ["durationSec", "seed", "aspectRatio"],
              "requiresProposal": true,
              "parameters": [ /* 见 §4.3，与 recipe 函数 formSchema 一致 */ ],
              "referenceFields": { "image": "reference_images" }
            }
          ]
        }
      ]
    }
  },
  "operations": [ /* 见 §6.1 */ ]
}
```

要点：

- `permissions` 与 gen-studio 一致；**不需要 `http`**——Modal 调用与下载都在 `modal_runner.py`（Python SDK）里完成。也不需要 `ffmpeg` 工具（视频编码在云端做）。
- `runtime.python.venv = "modal-studio"`：平台托管主 venv，只装轻量客户端依赖（`modal` 包等）；**没有 per-recipe 的本地 venv**——recipe 的重依赖在云端 Image 里。
- `distribution.builtin` 与 audio-studio/gen-studio 同构，仅被 `scripts/package-builtin-app.mjs` 消费。
- `contributes.media` 中的 provider/模型由 `publish_registry.py` 从 `recipes/*/manifest.json` **生成**，避免手写漂移（见 §4.5）。

### 3.3 内置应用与分发

沿用 audio-studio/gen-studio 的「编译内嵌 + 启动原子替换」机制，不引入新机制：

1. **生成期**：`make builtin-apps` 前先跑 `python3 apps/modal-studio/python/publish_registry.py`（扫描 recipes → 写 `registry.json` / `recipes/index.json` / 同步 `manifest.contributes.media`），再 `scripts/package-builtin-app.mjs apps/modal-studio service/builtin_apps/modal-studio.tar.gz`。
2. **内嵌**：`service/builtin_apps.go` 增 `//go:embed builtin_apps/modal-studio.tar.gz` 与 `builtinAppList` 条目 `{Package:"modal-studio", AppID:"recut.modal-studio", Archive: embeddedModalStudio}`。
3. **自更新**：`BuiltinAppManager.Ensure()` 同 gen-studio；开发期 `make app-link APP=apps/modal-studio` 建软链接跳过替换。
4. **不上架 App Store**（与其它内置 App 一致）。

---

## 4. 预设包（recipe）模型

> recipe 是「云端 Image + Volume + 一组 Function + 每个 Function 一张表单」的自包含单元。它是用户选择的**环境**，也是平台的**模型**来源。

### 4.1 概念：Image / Volume / Function

| 概念 | 是什么 | 生命周期 | 对应 gen-studio |
|---|---|---|---|
| **Image** | 云端运行环境（基础镜像 + pip/系统依赖），在 Modal 构建并缓存 | `modal.deploy` 构建/更新 | runtime（venv） |
| **Volume** | 云端持久盘（权重、运行期资源、产物中转） | `modal.install`（bootstrap）写入/更新 | model（权重） |
| **Secret** | 云端密钥（如 `HF_TOKEN` / `MODELSCOPE_TOKEN`），供 bootstrap 下载私有权重 | `modal.secret.set` 创建/更新 | —（下载源凭据） |
| **Function** | 一个可调用单元（`@app.function` / `@modal.method`），一个函数 = 前端一个表单 = 平台一个模型 | `modal.deploy` 随 image 部署 | 模型的一个能力 |

- **一个 recipe 可以有多个函数**（如「文生视频」「图生视频」「首尾帧续接」），每个函数独立成表单；需要接入平台路由的函数由 `contributes.media.models` 声明为独立模型。
- **换函数不换环境**：同一 recipe 的多个函数共享 Image 与 Volume；加函数只改 `manifest.json` + `modal_app.py`，不影响已部署的其它函数（除重新 deploy 外）。
- **加 recipe 不改编排**：新增目录 + 重跑 `publish_registry.py`。

### 4.2 `recipes/<id>/manifest.json`（单一信息源）

```json
{
  "id": "minimax-h3",
  "name": { "zh": "MiniMax H3 视频生成", "en": "MiniMax H3 Video" },
  "capability": "video.generate",
  "engine": {
    "appName": "recut-minimax-h3",
    "sourceDir": "recipes/minimax-h3",
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
      "exposeModel": "minimax-h3-video",
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
      "exposeModel": "minimax-h3-i2v",
      "formSchema": [
        { "key": "prompt", "type": "textarea", "required": true, "label": { "zh": "提示词", "en": "Prompt" } },
        { "key": "referenceImages", "type": "media", "kind": "image", "multiple": false, "required": true, "label": { "zh": "首帧图", "en": "First frame" } },
        { "key": "durationSec", "type": "number", "default": 5, "min": 1, "max": 15 }
      ]
    }
  ]
}
```

- **`engine.image`**：直接映射 `modal.Image.debian_slim(python_version=...).apt_install(...).pip_install(...)` + `run_commands(...)`；`sourceDir` 用 `add_local_dir` 把 recipe 代码带进镜像。
- **`engine.gpuTiers`**：`default` 为缺省，`options` 供 UI 选择；调用时用 `Function.with_options(gpu=<gpu>)` 动态覆盖（Modal 原生支持按调用覆盖 GPU，无需为每档重复定义函数）。
- **`engine.volumes`**：声明 volume 名称与挂载点；`bootstrap_weights` 与生成函数共享 `models` volume，`out` volume 作大文件产物中转。
- **`engine.secrets`**：声明需要的 Modal Secret（如 HF token），由用户在 Settings 里填值，App 用 `modal secret create` 落到用户自己的 Modal 账号。
- **`functions[].formSchema`**：字段类型见 §6.3；`media` 字段经平台素材选择器取 `assetId`，调用前用 `ctx.media.materialize` 转本地文件再上传云端。
- **`functions[].exposeModel`**：当该函数要接入平台路由时，声明它对应的平台模型 id（`contributes.media.models` 里的简单名）；同一 recipe 多个函数可各自暴露；不写则不暴露（仅 App UI 可用）。

### 4.3 表单 schema（`formSchema`）与平台 `parameters` 的对应

`formSchema` 是 App/UI 的表单真相；`contributes.media.models[].parameters` 是平台看到的模型参数面，两者由 `publish_registry.py` 从同一份 `manifest.json` 生成，保持一致：

| formSchema type | 平台 MediaParameter 形态 | 说明 |
|---|---|---|
| `textarea` / `text` | `{name, type:"string"}` | 提示词等长文本 |
| `number` | `{name, type:"number", min, max, default}` | 时长/seed/steps |
| `select` | `{name, type:"string", enum:[...]}` | 画幅/档位 |
| `boolean` | `{name, type:"boolean"}` | 开关 |
| `media` | 不进入 parameters，走 `referenceFields`（如 `image→reference_images`） | 参考图/参考视频 |

> 平台 `output` 里出现的参数名（`aspectRatio/seed/durationSec/...`）由桥透传给 `modal.generate`（见 `app_media_bridge.go` 的 key 列表，需补 `duration` 等视频键，见 §11）。

### 4.4 函数输出契约

`modal_app.py` 的函数必须返回可 JSON 序列化的结果，由 `modal_runner.py` 归一为本地文件：

- **小产物（图片/短音频）**：返回 `{ "kind": "bytes", "data": <bytes>, "mimeType": "image/png", "meta": {...} }`；runner 直接写 `RECUT_APP_FILES_DIR`。
- **大产物（视频）**：函数写入 `/out` volume，返回 `{ "kind": "file", "volume": "recut-minimax-h3-out", "key": "runs/<id>.mp4", "mimeType": "video/mp4", "meta": {...} }`；runner 用 `modal volume get` 拉回本机。
- **`meta`**：`{width, height, durationSec, seed, steps, ...}`，写入 `<output>.meta.json`，供 `modal.generation.complete` 回填（与 gen-studio `applyGenerationMeta` 同构）。
- **错误**：函数抛异常 → Modal 返回失败 → runner 落结构化错误（`kind/code/message/hint`），任务终态 `failed`。

### 4.5 注册表生成（`publish_registry.py`）

单一信息源是 `recipes/*/manifest.json`；生成器产出：

1. `python/registry.json`：`{ recipes:[{id, appName, capability, gpuTiers, volumes, functions:[...], weights}], models:[{model: <平台模型id>, recipe, function, capability, readyHint}] }`，供 `background.js` 解析「平台模型 → recipe+function」与 UI 渲染。
2. `recipes/index.json`：recipe id 列表。
3. `manifest.json` 的 `contributes.media` 块：按 `functions[].exposeModel` 生成 `ContributedMediaModel`（含 `parameters / referenceFields / requiresProposal`）。

> 生成器只在开发/构建期跑；运行期只读 `registry.json`，`background.js` 保留极简 `REGISTRY_FALLBACK`（照 gen-studio `REGISTRY_FALLBACK` 做法）。

---

## 5. 平台接入：App 声明式 `app` provider

> **核心决策：复用 gen-studio 的通用执行桥，只把「contributed provider 只允许 local」放宽为「local 或 app」，并透传模型表单 schema。** 不新增 per-app Go 代码。

### 5.1 协议泛化：`protocol: "local" | "app"`

- `local`：在用户本机执行、零成本、离线（gen-studio、audio-studio）。
- `app`：由 App 代执行，可能调用远程/付费后端，凭据由 App 自持（modal-studio）。平台不查询任何平台凭据。

`validateMediaContribution` 放开为：

```go
if provider.Protocol != "local" && provider.Protocol != "app" {
    return fmt.Errorf("contributed media provider %q must use protocol \"local\" or \"app\"", provider.ID)
}
```

### 5.2 执行分派（`service/media/jobs.go` `execute()`）

当前入口按 `credential.Provider` 查 provider，`Protocol == "local"` 才走 App 执行桥。改为按「App 代执行」判定：

```go
if provider, ok := providerByID(credential.Provider); ok && isAppExecutedMediaProvider(provider) {
    if provider.ID == "local-audio" {
        // 现有 local-audio 分支原样保留
    } else if exec := m.localAppExec[provider.ID]; exec != nil {
        asset, err := exec(job, model, job.Output)
        ...
    } else {
        m.failExecution(job, fmt.Errorf("app provider %s is not connected; install/start its App or switch the default route", provider.ID))
    }
    return
}
```

其中 `isAppExecutedMediaProvider(p) = p.Protocol == "local" || p.Protocol == "app"`。

### 5.3 目录与就绪度泛化

- `service/media/app_providers.go` 不变（`Source: "app"` 已区分来源）。
- `service/media/catalog.go` `configuredModelFor`：`p.Protocol == "local"` → `isAppExecutedMediaProvider(p)`，`CredentialName` 用 `provider.Name`。
- `service/mcp.go` `mediaReadiness`：`Protocol == "local"` → `isAppExecutedMediaProvider`；`local` 分支文案改为：`local` 标 `local:"true"`（零成本），`app` 标 `local:"false"` + `cost:"metered"`（提示可能消耗额度）。
- `service/media/capability_models.go`：`provider.Protocol != "local"` → `!isAppExecutedMediaProvider(provider)`（让 `modal` 也进入能力模型聚合；`CapabilityModelGroup` 增加 `Protocol` 已有，前端据 `app` 显示计费徽标）。

### 5.4 模型 schema 透传（`ContributedMediaModel`）

当前 `ContributedMediaModel` 有 `Parameters` 但 `mediaProviderFromContribution` 未透传，且缺 `RequiresProposal`/`ReferenceFields`/`EditModelID`。补齐：

```go
type ContributedMediaModel struct {
    // ...existing...
    Parameters     []map[string]any `json:"parameters,omitempty"`
    ReferenceFields map[string]string `json:"referenceFields,omitempty"`
    EditModelID    string          `json:"editModelId,omitempty"`
    RequiresProposal bool          `json:"requiresProposal,omitempty"`
}
```

并在 `mediaProviderFromContribution` 映射 `Parameters`（解为 `[]MediaParameter`）、`ReferenceFields`、`EditModelID`、`RequiresProposal` 到 `MediaModel`。这样 `modal/minimax-h3-video` 的每函数表单、参考图字段与视频确认门都被平台正确识别。

### 5.5 等待窗口（长任务）

本地扩散/TTS 桥用 30 分钟 `WaitByID`。Modal 冷启动 + 大模型加载 + 视频生成可能超过 30 分钟（尤其首次拉镜像）。改动：

- `ContributedMediaProviderOperations` 增可选 `waitMinutes int`（缺省沿用 30）；`modal` provider 声明如 `45`。
- `runAppGeneration` 用 `waitMinutes` 计算等待窗口，并在超时错误里提示「任务可能仍在云端运行，可在 App 记录里继续查看」。

### 5.6 全局视频/图片选择 Modal

- **默认路由**：`POST /v1/media/routes` 把 `video.generate.default`（或 `image.generate.default`）指向 `modal/<model>`；`SaveRoute` 对 App 代执行 provider 自动清空 `credentialId`。
- **单次覆盖**：`recut.video.generate { modelId: "modal/minimax-h3-video" }`（无需 `credentialId`）。
- **确认门**：视频能力默认 `videoRequiresProposal()`，且模型可显式 `requiresProposal: true`；提案确认后复用同一 assetId 转 queued，交由 Modal 执行。

---

## 6. 能力与 MCP 契约

### 6.1 App operations 清单（`manifest.operations`）

| op | surfaces | capability | 说明 |
|---|---|---|---|
| `modal.status` | api, mcp | ✅ | token profile/连通性、各 recipe 部署状态（app/function 是否存在）、volume 就绪度、在途任务 |
| `modal.catalog` | api, mcp | ✅ | 枚举 recipe/函数：`{recipes:[{id, label, capability, deployed, volumeReady, gpuTiers, functions:[{id, label, formSchema, defaultParams, output}]}]}` |
| `modal.profiles.add` | api | | 新增 token profile `{name, tokenId, tokenSecret}`（存 App 私有状态，0600） |
| `modal.profiles.list` | api | | 列出 profiles（**不返回 secret**，只返回 `{id, name, tokenIdMasked, tokenSet}`） |
| `modal.profiles.remove` | api | | 删除 profile |
| `modal.settings.set` | api | | 默认 profile、权重源（`automatic/huggingface/modelscope`）、默认 GPU 档位 |
| `modal.secret.set` | api | | 把 `{name, values}` 写成用户 Modal 账号下的 Secret（`modal secret create --force`），用于私有权重 token |
| `modal.deploy` | api, mcp | | 部署/更新 recipe 的 Image 与函数（`modal deploy`）；异步单槽；`{recipe}` |
| `modal.install` | api, mcp | | 只准备权重（跑 `bootstrap` 写 Volume，不重建 image）；异步、按 recipe 串行；`{recipe, source}` |
| `modal.generate` | api, mcp | ✅ | 调用函数：`{model | recipe+function, ...formFields, referenceAssetIds?, gpuTier?}`；单槽 FIFO；返回 `{job, taskId, generation:{id}}` |
| `modal.generations` | api, mcp | ✅ | 已完成运行记录（私有产物 + `savedAssetId`） |
| `modal.generation.complete` | api | | 任务终态后读取产物（`outputURL`/尺寸/时长/seed/耗时/错误） |
| `modal.save` | api, mcp | ✅ | 把私有产物导入素材库（`kind: image|video|audio`），返回真实 `assetId` |
| `modal.cancel` | api, mcp | ✅ | 取消最新在途任务 |
| `modal.tasks.list` | api, mcp | ✅ | 任务中心主列表（来源/状态/action 过滤、分页） |
| `modal.task.get` | api, mcp | ✅ | 单任务详情（来源、状态、meta、日志路径、产物） |
| `modal.task.logs` | api, mcp | ✅ | 持久日志（`tasks/<id>.log` JSON-lines，可回看） |
| `modal.task.cancel` | api, mcp | ✅ | 按任务 id 取消（queued 直接落 cancelled / running 走 shell cancel） |
| `modal.job` / `modal.resolve` | api | | UI 重连跟踪 / 确认终态（与 gen/audio 同构） |

`modal.generate` / `modal.save` 是平台执行桥依赖的两个能力。

### 6.2 异步任务模型（复用 gen-studio）

**任务账本 `modal_tasks`**（App 私有 sqlite）与 gen-studio 的 `gen_tasks` 同构：

```sql
create table if not exists modal_tasks (
  id text primary key,
  shell_job_id text not null default '',
  action text not null,               -- deploy | install | generate | teardown
  recipe text not null default '',
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

**产物表 `modal_generations`**：`id, recipe, function, model, capability, prompt, params_json, width, height, duration, seed, reference_asset_ids, output_path, mime_type, saved_asset_id, gpu_tier, modal_call_id, created_at, job_id, status, error`。

**并发分类**：

| 类别 | 动作 | 并发规则 |
|---|---|---|
| 运行 | `generate` | **单槽 FIFO**（控制额度/并发）；依赖 recipe 已 deploy 且（如声明）权重已就绪，否则保持 queued |
| 部署 | `deploy` | **单槽**（镜像构建不可并发，避免重复构建） |
| 权重 | `install` | **按 recipe 串行**（同一 Volume 不并发写）、不同 recipe 可并行 |
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

### 6.4 MCP 发现面

- **App 侧**：`modal.catalog`（recipe/函数/表单/部署与 volume 就绪度）、`modal.status`（token/连通性/在途任务）。
- **平台侧**：`recut.media.list_capability_models { capability }` 经泛化后**同时聚合 `modal` provider**（`Protocol=="app"`），返回模型、协议、是否默认路由与就绪度；未配置 token/未部署时分组带 `error`。
- `recut.context.media.readiness` 的本地/App 分支泛化后，会话一开始即可见「Modal provider / 模型 / 就绪度 / 是否计费」。

---

## 7. 执行模型：token / profiles / 生命周期

### 7.1 Token 与多账号（profiles）

- **存储**：profiles 存 App 私有状态（`modal_settings` + `modal_profiles` 表 / appstate 文件，权限 0600）；`modal.profiles.list` 只回 `tokenIdMasked`，**永不回 secret**。
- **注入**：调用 `modal_runner.py` 时只把选中 profile 的 `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` 放进子进程环境；不写日志、不回传 UI。
- **多账号**：每个 recipe 可绑定一个 `profileId`（缺省用全局默认 profile）；「多个 modal.com 账号」即多个 profiles。
- **连通性验证**：`modal.status` 跑一次轻量检查（如 `modal app list` 或 SDK 列 App），返回 `{connected, account?, error?}`。

### 7.2 `modal_runner.py`（本机薄客户端）

子命令：

| 命令 | 行为 |
|---|---|
| `status` | 读取 profiles、recipe 部署状态（`Function.from_name` 探测 / `modal app list`）、volume 就绪度 |
| `catalog` | 读 `python/registry.json` + 动态就绪度，输出 recipe/函数/表单 |
| `deploy --recipe <id>` | `modal deploy recipes/<id>/modal_app.py`（注入 token 环境；流式日志 tee） |
| `bootstrap --recipe <id> --source <hf|ms|auto>` | `modal run recipes/<id>/bootstrap.py`（云端把权重写进 Volume；校验大小/revision） |
| `invoke --recipe <id> --function <fn> --params <json> --refs <json> --output <path> --task-log <log>` | `Function.from_name(appName, fn).with_options(gpu=<tier>).remote(**params, refs=...)`；结果 bytes 落盘 / `modal volume get` 拉回；写 `<output>.meta.json` |
| `teardown --recipe <id>` | `modal app stop <appName>`（可选保留 volume） |
| `secret --recipe <id> --name <n>` | 从 stdin 读值，`modal secret create --force` |

- **流式日志**：函数运行时把日志回传本机（SDK/CLI 的日志流），runner 解析为 `[modal] ...` 进度行 tee 到 `--task-log`（复用 gen-studio `run_worker_process` 模式）。
- **长任务**：`invoke` 用 `FunctionCall`（`.spawn()` + 轮询）或阻塞 `.remote()`；取消时 runner 响应 `ctx.shell.cancel` 终止本地进程，并尽力 `modal.FunctionCall.cancel()`。

> **本机 vs 云端边界**：本机只负责编排、上传参考、接收产物；真实计算与权重都在 Modal。这与「把云端函数当本地函数调用」的产品直觉一致。

### 7.3 生命周期

```text
配置 token(profiles) ─► modal.deploy(recipe) ─► modal.install(recipe, source) ─► modal.generate(model, params)
      Setup 门               构建 image + 部署函数        准备 Volume（权重）           调用函数 → 拉回产物 → modal.save
```

- 未配置 token：`modal.status.connected=false`，UI 显示 Setup 门；此时平台 `modal` provider 就绪度为「未连接」，路由提交得到结构化错误。
- 未 deploy：`modal.catalog` 标 `deployed=false`，运行按钮禁用并给「去部署」引导。
- 已 deploy 未装权重：`volumeReady=false`，给「下载模型」引导。

---

## 8. 环境与成本模型

### 8.1 GPU 档位与成本透明

- recipe `engine.gpuTiers` 声明可选 GPU（如 `A100-80GB` / `H100`）；缺省档位由 recipe 定，UI 可切档。
- 调用时用 `Function.with_options(gpu=<gpu>)` 动态覆盖（Modal 原生支持，无需重复函数定义）；不同 GPU 档位形成独立容器池、各自 scale-to-zero。
- UI 在函数表单旁显示：GPU 档位、预估耗时、`requiresProposal` 徽标与「可能消耗 Modal 额度」提示；视频/高成本模型强制先提案。

### 8.2 额度与账号

- $30/月免费额度归用户 Modal 账号；多个账号 = 多个 profile，可分给不同 recipe（例如一个账号跑视频、一个跑图片）。
- 第一版**不做用量计费 API 集成**；只做透明度提示与确认门。用量展示见 §14 开放问题（若 Modal 提供 billing/usage API 则作为 M4 增强）。
- App 绝不把 token 或用量信息写入平台日志/素材元数据。

### 8.3 冷启动与保持

- 默认 `min_containers=0` / 短 `idleTimeoutSec`（scale-to-zero，省额度）。
- recipe 可选声明「保持热容器」档位（`min_containers>0`），文案明确提示会持续消耗额度。

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
│ │ │(schema)│ │ │ · 运行 xxx    │ │ │ │   参数：recipe/GPU/时长/seed/耗时      │ │
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

- **预设切换器**：来自 `modal.catalog.recipes`；每个 recipe 显示 `deployed`/`volumeReady` 徽标。
- **函数切换器**：recipe 下多函数时显示（如「文生视频 / 图生视频」）。
- **表单**：由所选函数的 `formSchema` 渲染；`media` 字段用全局素材选择器；GPU 档位下拉来自 `engine.gpuTiers`。
- **就绪引导**：未 deploy / 未装权重时「运行」禁用，给「去部署 / 去下载模型」按钮（跳 Tab 2 或直接触发 `modal.deploy` / `modal.install`）。
- **提交**：`modal.generate` → `{job, taskId, generation}`；无论立即派发还是排队，Right 自动切到该任务。

### 9.4 Left · Tab 2「记录」

- 统一任务列表（`modal.tasks.list`）：`deploy → 部署 <recipe 环境>`、`install → 下载 <recipe> 权重`、`generate → 运行 <function> · <提示词摘要>`。
- 过滤：按 action/状态/来源；顶部快捷动作：「部署环境」「下载模型」（选 recipe + 源）、「管理账号」（profiles）。

### 9.5 Right「统一生产预览 + 进度日志」

- 共享任务头 + 进度/取消/日志（同 gen-studio）。
- 运行任务：预览视频/图片（`modal.generation.complete.outputURL` 经 `ctx.files.url`）；显示 recipe/函数/GPU/时长/seed/耗时；动作：`modal.save`、下载、「以本结果为参考再运行」（视频续接）。
- 部署/下载任务：实时日志流 + 就绪度摘要（`modal.status`：token/deployed/volume）。
- 无选中：显示账号与各 recipe 就绪总览 + 引导。

### 9.6 实现与一致性

- React + TypeScript + Vite，`ui/dist` 单文件产物；组件拆分 `run-tab` / `records-tab` / `preview-pane` / `setup` / `settings`。
- i18n 走 `ctx.locale`（`manifest.localized`）；任务列表/日志/取消复用 audio-studio 任务中心节奏。
- 表单式，不做节点连线编辑器（见 §1.2）。

---

## 10. 与既有生成契约的关系

- **提案（proposal）**：Modal 生成默认可能花钱——视频能力天然 `videoRequiresProposal()`；图片若 recipe/model 声明 `requiresProposal: true` 也走确认门。确认后 `ConfirmProposal → generateBoundToAsset → resolveRoute → 执行桥`，同一 assetId 原位转 queued，无需重指。
- **参考协议**：`<reference id kind role label />` 与 `imageAssetIds`/`videoAssetIds` 由平台解析为 `job.AssetIDs`；桥透传 `referenceAssetIds`，App 用 `ctx.media.materialize` 取本地文件再上传云端；`referenceFields` 控制平台 kind → 上游字段名的映射。
- **交付**：产物先私有（App 文件区），仅 `modal.save` 后成为平台 Asset；桥在默认路由路径上自动 `modal.save` + `Attach`，与 gen-studio 一致。
- **发现**：`recut.media.list_capability_models` 与 `recut.context.media.readiness` 泛化后同时覆盖 `app` provider，并标注 `local:false` / 计费提示。
- **不做**：不改 `async_ops`、不改 Op 总线、不新增渲染引擎、不引入 DSL。

---

## 11. 契约改动清单

| 契约 | 改动 | 类型 |
|---|---|---|
| `service/catalog.go` `ContributedMediaProvider.Protocol` | 允许 `"local" \| "app"`；`validateMediaContribution` 放开 | **manifest 契约** |
| `service/catalog.go` `ContributedMediaModel` | 新增 `RequiresProposal` / `ReferenceFields` / `EditModelID`（`Parameters` 已存在） | **manifest 契约** |
| `service/catalog.go` `ContributedMediaProviderOperations` | 新增可选 `WaitMinutes` | **manifest 契约** |
| `service/app_media_bridge.go` `mediaProviderFromContribution` | 透传 `Parameters/ReferenceFields/EditModelID/RequiresProposal` 到 `MediaModel` | 执行桥 |
| `service/app_media_bridge.go` `runAppGeneration` | 等待窗口用 `WaitMinutes`（缺省 30）；`output` 透传 key 白名单按视频参数补全（`durationSec` 已在，补 `frameRate` 等） | 执行桥 |
| `service/media/jobs.go` `execute()` | 本地分支判定改为 `isAppExecutedMediaProvider`（`local`/`app`） | 行为 |
| `service/media/service.go` / 帮助函数 | 新增 `isAppExecutedMediaProvider(provider)` | 泛化 |
| `service/media/catalog.go` `configuredModelFor` | 本地判定泛化为 `isAppExecutedMediaProvider` | 泛化 |
| `service/mcp.go` `mediaReadiness` | 本地判定泛化；`app` 分支标 `local:false` + `cost:"metered"` | 泛化 |
| `service/media/capability_models.go` | 聚合判定泛化为 `isAppExecutedMediaProvider`；分组含 `app` | 聚合 |
| `service/builtin_apps.go` | `//go:embed` + `builtinAppList` 增 `modal-studio` | 内置 |
| `Makefile` `builtin-apps` | 生成 registry 后打包 `apps/modal-studio` | 构建 |
| `apps/modal-studio/*`（新） | 完整 App 包（manifest/background/python/recipes/ui/skills） | 新增 |
| `docs/app-contract.md` | 记录 `protocol: "app"` 与模型 schema 透传 | 文档 |
| `rfc/README.md` | 增本 RFC 索引条目 | 文档 |

---

## 12. 里程碑

- **M0（平台泛化 + 内置可安装 + 端到端烟测）**：`protocol: "app"` 与模型 schema 透传；`isAppExecutedMediaProvider` 泛化；`execute()`/`readiness`/`capability_models` 更新；等待窗口可配；App 空壳（manifest + background 注册全部 op + Setup 门）内置打包/内嵌/启动自更新；一个最小 recipe（CPU 或小 GPU，函数回显/生成一张小图）跑通 `deploy → install → generate → save`。
- **M1（旗舰视频 recipe 端到端）**：MiniMax H3 recipe（`modal_app.py` + `bootstrap.py` + `manifest.json`）；`modal.deploy`/`modal.install`/`modal.generate`（GPU 档位、视频产物 `volume get`）、`modal_tasks` 队列；平台路由 `video.generate.default → modal/minimax-h3-video`，经提案确认门 → 云端出片 → 平台 Asset。
- **M2（交互 + profiles + 发现面）**：Left 两 Tab + Right 预览/日志完整交互（表单 `formSchema` 驱动）；profiles 多账号管理、`modal.secret.set`；`modal.catalog`/`modal.status` 与 `recut.media.list_capability_models` 聚合；Settings 卡（GPU 默认档、权重源、账号）。
- **M3（扩展点验证）**：再加一个图片 recipe（验证同 image 多函数、`requiresProposal` 可控）；验证「加 recipe = 加目录 + 重跑生成器」零逻辑改动；验证一个 recipe 多函数各自暴露平台模型。
- **M4（打磨）**：进度百分比、热容器档位、Cancel 传播到 `FunctionCall.cancel`、用量/额度展示（若 Modal 有 API）、README/skill 完善。

---

## 13. 验收

1. **内置分发**：全新安装的 Recut 启动后出现 `~/.recut/apps/modal-studio` 且 `id == recut.modal-studio`；`make app-link APP=apps/modal-studio` 后不被覆盖。
2. **Setup 门**：未配置 token 时整屏 Setup 卡；填入 token 并「验证连接」通过后进入主界面；`modal.profiles.list` 不回传 secret。
3. **环境/权重分离**：`modal.deploy` 完成后函数可被 `from_name` 探测到但 volume 为空；单独 `modal.install {recipe, source:"modelscope"}` 完成权重写入；`modal.status` 分别反映两项。
4. **一个 App 多 recipe/多函数**：`modal.catalog` 列出多个 recipe 与每个 recipe 的多个函数（含表单 schema）；新增 recipe 只需加目录 + 重跑生成器。
5. **本机函数式调用**：`modal.generate` 经 `modal_runner.py` 用 `Function.from_name(...).with_options(gpu=...).remote()` 执行；产物（视频）经 Volume 拉回本机落私有路径；无需任何 HTTP endpoint。
6. **异步任务**：并发提交多个 `modal.generate` 时后到者 `job:null + taskId` 且 queued，前序完成后自动开始；`recut.job.wait` 可观察终态；`modal.task.cancel` 可取消 queued 与 running；任务结束后日志可回看。
7. **平台路由**：`video.generate.default → modal/minimax-h3-video` 后，`recut.video.generate { text }` 走确认提案门 → 确认后云端生成 → 平台 Asset；`recut.media.list_capability_models { capability:"video.generate" }` 能列出 `modal` provider 与就绪度/计费提示；未连接时提交返回结构化错误 + hint。
8. **多账号**：配置两个 profile，分别绑定不同 recipe；切换后调用使用对应账号 token（可在 Modal 控制台分别看到调用）。
9. **失败可操作**：Modal 不可达/未部署/未装权重/超时各有明确错误与 hint；绝不静默产出坏素材；token 与 secret 不出现在日志/素材元数据里。

---

## 14. 风险与开放问题

- **平台抽象是否该引入 `app` 协议**：也可以简单复用 `protocol:"local"`（零平台改动），代价是语义与就绪度文案错误（把云端付费 provider 说成「本机」）。本 RFC 选择引入 `app`，先决条件是泛化 helper 到位、测试覆盖 `local`/`app` 两分支。
- **等待窗口**：视频冷启动 + 生成可能远超 30 分钟。`WaitMinutes` 只是缓解；MCP 短命进程仍应以 `recut.job.*` 轮询为主。是否需要云端任务「异步 + 回调」模型（Modal `spawn` + 轮询）作为默认路径，M1 决策点。
- **日志流式**：SDK `.remote()` 的实时日志回传行为需在 M0 验证；若不理想，回退用 `modal run`（牺牲热容器）或用 `spawn` + 函数内写 Redis/Volume 进度。
- **产物回传**：视频经 Volume `modal volume get` 拉回需要临时磁盘与带宽；超大文件（>GB）是否改为 Modal 直接写入用户对象存储/签名 URL 直传平台，M2/M4 评估。
- **额度与计费**：Modal 是否提供用量 API（供 UI 显示剩余额度/本月花费）待查；第一版只做提示与确认门。多个账号是否违反 Modal ToS 需用户自行确认（RFC 只提供技术能力）。
- **安全边界**：token 存 App 私有状态（明文 + 0600）；是否需要平台级 `ctx.secrets` 加密存储是更大的平台议题（可另出 RFC）。云端函数会执行 recipe 代码，用户应只使用可信 recipe。
- **recipe 生态与供应链**：第三方 recipe 是代码分发载体（image build 会执行 pip/git）；是否引入 recipe 签名/白名单、以及 App Store 化的 recipe 市场上架，属后续议题（第一版只内置官方 recipe）。
- **provider 命名与聚合**：`modal` provider 与既有 `local-gen`/`local-audio` 在 `list_capability_models` 里的展示是否要统一「生成来源」视角（本机 / 云 GPU），M2 依实际调用面决定。
