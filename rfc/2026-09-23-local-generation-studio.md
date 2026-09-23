<!--
 * [INPUT]: 依赖既有本地 App 范式：apps/audio-studio（manifest.json / background.js 的 gen_tasks 式异步
 *          账本 + pumpQueue 并发分类 + capability operation + bootstrap.py 派生专属 venv +
 *          distribution.builtin + 任务中心/设置 UI）、apps/depth-anything（本地生成类 App 的
 *          prepare/install/generate/save 形状）、service/python_runtime.go（manifest 驱动主 venv +
 *          RECUT_PYTHON/RECUT_VENV/RECUT_MODELS_DIR/RECUT_TOOLCHAIN_DIR 注入）、service/builtin_apps.go
 *          （//go:embed tar.gz + 每次启动原子替换）、scripts/package-builtin-app.mjs + Makefile
 *          builtin-apps、service/catalog.go（Manifest.operations/runtime.python/permissions）、
 *          service/runtime.go（ctx.python/shell/media/sqlite/files/capabilities/job/paths 契约）、
 *          service/capability_bridge.go（ctx.capabilities.invoke 授权与审计）、service/shell_jobs.go
 *          （queued/running/completed/failed/cancelled/interrupted + JSONL 日志）、
 *          docs/platform-comms-contract.md（async_ops 统一 Handle）、docs/app-contract.md；
 *          平台媒体生成侧：service/media/{types,catalog_seed,catalog_loader,config,jobs,capability_voices,
 *          service}.go（provider/model/route/credential 四层 + Protocol=="local" 无凭据路由 + 执行桥注入 +
 *          CapabilityVoiceGroups 聚合）、service/local_speech_bridge.go（local-audio 端到端桥的权威先例）、
 *          service/mcp.go（mediaRoutesView/mediaReadiness/list_capability_voices 投影）。
 * [OUTPUT]: 设计一个基于本机模型、可切换模型的图片/视频生成 App（recut.gen-studio，apps/gen-studio），
 *           以 audio-studio 协议落地：内置分发（distribution.builtin + 嵌入 tar.gz + 启动自更新）、
 *           **一个运行环境（runtime venv）托管多个模型（ComfyUI 式：环境=依赖闭包，模型=权重）**、
 *           prepare（建 runtime）与 install（下权重）分离、可切换 huggingface/modelscope 权重源、
 *           gen_tasks 异步账本与单槽 FIFO、能力桥（gen.generate/gen.save）；
 *           **App 声明式平台接入**：manifest `contributes.media` 静态声明本地 provider/模型，
 *           平台通用桥（media.RegisterAppProviders + app_media_bridge.go）按 provider id 分派，
 *           无 per-app Go 代码；`image.generate.default` 路由/单次 modelId 选择本地模型；
 *           MCP 发现面（App gen.catalog/gen.status + 平台 recut.media.list_capability_models）；
 *           交互：Left 两 Tab（① 生成表单：顶部切换模型、每模型独立表单；② 记录：环境/下载/生成统一
 *           任务列表）+ Right 统一生产预览与进度日志。第一版兑现 Qwen-Image（Qwen-Image-2.1）文生图。
 *           不新增渲染引擎、不新增中间语言、不绕过既有 route/proposal/async Handle 契约。
 * [POS]: rfc 的「本地模型生成 App」设计稿；把 audio-studio 的本地能力范式推广为「App 声明的本地生成
 *        provider 家族」——平台只新增一个 manifest 贡献契约（contributes.media）与一个通用执行桥，
 *        provider/模型/operation 接线全部由 App 自声明；App 内以「一个 runtime 多模型」注册表统一承载
 *        换模型/加能力。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC：本地模型生成工坊（Generation Studio）——一个环境、多个模型的本机生成 App

- 状态：Proposal
- 作者：Recut
- 日期：2026-09-23
- 决策范围：`apps/gen-studio` 内置 App 的包结构、**runtime（venv）/ model（权重）分离的环境模型**、`gen_tasks` 异步协议、Left/Right 交互、manifest `contributes.media` 声明式本地 provider 与平台通用执行桥、`image.generate.default` 路由选择、面向外部的 MCP 模型发现面
- 关联：[AI 解说音频素材生命周期（local-audio 先例）](./2026-08-21-ai-narration-audio-asset-lifecycle.md)、[编辑器字幕对接 audio-studio ASR（能力桥）](./2026-08-22-editor-captions-audio-studio-asr.md)、[媒体生成提案](./2026-09-16-media-generation-proposal.md)、[生成提示词参考引用协议](./2026-09-15-generation-reference-protocol.md)、[Provider/模型目录 CDN](./2026-09-03-provider-model-catalog-cdn.md)、[平台通讯 Op 总线契约](../docs/platform-comms-contract.md)、[App 契约](../docs/app-contract.md)

## 0. 白话总结（先看这个）

**这件事是：** 我们要做一个「装了就自带」的本地生图/生视频应用（第一版先做本地文生图），用用户自己的显卡跑模型，不联网、不花钱。**它的目标不是「一种模型一个 App」，而是像 ComfyUI 一样——一个 App、一套环境、装很多模型，顶部切换就能用。**

**它长什么样（交互）：**

```text
┌───────────────────────────────┬──────────────────────────────────────────┐
│  Left                          │  Right                                    │
│  ┌───────────┬──────────────┐  │   统一的生产预览 + 进度/日志              │
│  │  生成     │   记录        │  │   ┌────────────────────────────────────┐ │
│  │ ───────── │ ──────────── │  │   │ 任务状态 · 进度条 · 取消 · 查看日志  │ │
│  │ [模型切换] │ 环境/下载/生成│  │   ├────────────────────────────────────┤ │
│  │ ┌───────┐ │ 统一任务列表  │  │   │ 生成：图片预览 + 参数/seed/耗时      │ │
│  │ │该模型  │ │ 点击一行 →    │  │   │       [保存入库]                     │ │
│  │ │的表单 │ │ Right 显示    │  │   │ 环境/下载：实时日志 + 就绪度          │ │
│  │ └───────┘ │ 结果/日志     │  │   └────────────────────────────────────┘ │
│  └───────────┴──────────────┘  │                                          │
└───────────────────────────────┴──────────────────────────────────────────┘
```

- **Left Tab 1「生成」**：顶部一个**模型切换器**（列出本机所有可用 GenModel），切换后下面是**该模型自己的表单**（提示词、负向词、画幅、步数、CFG、seed、参考图……由模型注册表声明），提交即生成。
- **Left Tab 2「记录」**：和声音工坊一样的**统一任务列表**——「准备环境」「下载模型」「生成」都是同一类任务；点任意一行，**Right 就显示对应的结果和日志**。
- **Right**：**统一的生产预览 + 进度日志**。选中生成任务显示图片/视频预览与参数、可保存入库；选中环境/下载任务显示实时日志与就绪度；顶部共享状态、进度、取消。

**几个关键决定：**

1. **装了就自带**：它跟着 Recut 客户端一起发布（内置 App），用户升级客户端就自动更新，不需要单独去装。开发期用软链接覆盖，不会被自动更新冲掉。
2. **一个环境托管多个模型**（ComfyUI 式）：把「运行环境（runtime，即依赖闭包/venv）」和「模型（model，即权重文件）」彻底分开——一个 runtime（默认 `diffusers`）能加载很多个模型权重；只有依赖冲突时才再加一个 runtime。换模型 = 换权重，不换环境。
3. **环境准备和模型下载分开**：先准备 runtime（Python 依赖 + 专属 venv），再单独下载模型权重。两件事分开做、分开重试、分开看进度。
4. **生成用独立 venv**：基础 venv 只放轻量的调度/下载工具；真正跑扩散模型的重依赖（torch/diffusers）放在一个专属 runtime venv 里，和基础环境互不污染。
5. **权重来源可选**：模型权重用户可以在 Hugging Face 和 ModelScope 之间选（或自动回退），和声音工坊一样。
6. **全局生图能选本地环境**：平台的「生图默认路由」可以指向本地的 `local-gen/qwen-image`；也可以单次调用里显式指定本地模型。选中本地后，生成任务自动交给这个 App 执行。
7. **有 MCP 告诉外部「本机有哪些模型/环境」**：App 侧提供 `gen.catalog`（模型清单 + 每模型表单 schema）与 `gen.status`；平台侧聚合出一个 `recut.media.list_capability_models`。
8. **任务模型照抄声音工坊**：生成单槽 FIFO 排队（一张卡同时只能跑一个模型），环境准备单槽排队（等生成排空），模型下载可并行；提交永不拒绝，空槽立即跑、占槽自动排队；统一用 `recut.job.*` 观察，日志落文件可回看，可取消。

**一句话：** 把「声音工坊」的本地能力范式，做成一个 ComfyUI 式的「生成工坊」——App 内一个 runtime 托管多模型，平台侧只新增一个「本地生图 provider + 执行桥」，其余全部复用现有契约。

---

## 0.1 技术摘要

本文设计 `recut.gen-studio`（目录 `apps/gen-studio`，名称「生成工坊 · Generation Studio」）——一个**内置**、**本机运行**、**一个 runtime 多模型**的图片/视频生成 App。

- **协议同构**：完全复用 audio-studio 的 App 协议——`manifest.json` 声明 `operations` + `runtime.python` + `distribution.builtin`；`background.js` 用 `ctx.sqlite` 维护 `gen_tasks` 任务账本、`ctx.python` 执行可观察 shell job、`ctx.media` 复制/导入素材、`ctx.files` 提供私有预览 URL、`ctx.capabilities` 供跨 App 调用。
- **runtime/model 分离（核心）**：注册表 `python/registry.json` 分两段——`runtimes`（依赖闭包 + 专属 venv，默认一个 `diffusers` runtime 托管绝大多数图片模型）与 `models`（权重 + 归属 runtime + **表单 schema**）。`gen.prepare { target }` 只建 runtime；`gen.install { model, source }` 只下权重；`gen.generate { model, ... }` 在模型所属 runtime 里跑。目标目录：venv 在 `~/.recut/python/envs/recut.gen-studio/`，权重在 `~/.recut/models/gen-studio/<runtime>/<model>/`。
- **平台接线（声明式，无 per-app 代码）**：App 在 `manifest.json` 的 `contributes.media` 静态声明本地 provider `local-gen` 与模型 `qwen-image`；平台新增 `media.RegisterAppProviders` 把它并入全局目录（`service/media/app_providers.go`），并用通用执行桥 `service/app_media_bridge.go`（遍历已安装 App 的贡献，按 provider id 分派；`gen.generate` → 等 shell job → 授权 `gen.save` → 回读平台 Asset → 挂项目）。全局生图选择本地 = 把 `image.generate.default` 路由指向 `local-gen/qwen-image`（或单次传 `modelId`）。`catalog_seed.go` 无需改动。
- **发现面**：App 侧 `gen.catalog`（本机模型/能力/runtime/表单 schema/就绪度）与 `gen.status`（含在途任务）；平台侧 `recut.media.list_capability_models`（聚合所有 `Protocol=="local"` 生成 provider 的模型与就绪度，镜像 `CapabilityVoiceGroups` 的写法）。
- **交互**：Left 两 Tab（生成表单 / 统一任务记录）+ Right 统一生产预览与进度日志；表单由注册表 `formSchema` 驱动，顶部模型切换器来自 `gen.catalog`。
- **第一版兑现**：Qwen-Image（`Qwen/Qwen-Image-2.1`）文生图，支持 huggingface/modelscope/automatic 三种权重源；参考图编辑/视频模型作为同一注册表下的后续条目（不改协议）。

**边界（非目标）**：不新增渲染引擎、不引入 XML/DSL 中间语言、不改 `async_ops`/Op 总线契约、不做多机/分布式推理、不把生成产物默认入库（先私有、确认后 `gen.save`）、不改既有提案与路由门禁（图片默认直生，视频仍走既有确认）、不做节点式工作流编辑器（表单式，非 ComfyUI 的 graph 编辑）。

---

## 1. 目标与非目标

### 1.1 目标

1. 一个内置 App（`recut.gen-studio`）在本机用开源扩散模型完成**图片生成**（第一版），并预留**视频生成**与**换模型**能力。
2. 与 audio-studio 使用**同一套 App 协议**：manifest operations、goja background、`ctx.python`/`ctx.shell` 可观察任务、能力桥、任务中心。
3. **一个 runtime 托管多模型**（ComfyUI 式）：环境（依赖闭包）与模型（权重）解耦；换模型不换环境，加模型不改协议。
4. **环境准备与模型下载分离**：`gen.prepare`（runtime + venv）与 `gen.install`（权重）各自独立、可并行/可分别重试。
5. **专属 venv**：主 venv 保持轻量；生成重依赖放独立 runtime venv，避免依赖互相覆盖。
6. **权重源可选**：`automatic | huggingface | modelscope`，并持久化用户选择。
7. **接入全局生图**：平台把本地生成作为一类 provider（`local-gen`），用户可在全局生图设置里把默认路由指向本地模型，或单次生成显式选择。
8. **可发现**：提供 MCP，告诉外部「本机有哪些模型/环境、是否就绪、支持什么能力、表单长什么样」。
9. **异步任务**：照搬 audio-studio 的单槽 FIFO + 提交不拒绝 + 统一 `recut.job.*` 观察。
10. **统一交互**：Left（模型切换 + 表单 / 统一记录）+ Right（统一预览 + 进度日志），与 audio-studio 任务中心 UX 同源。

### 1.2 非目标

- 不做云端 provider（本文只做 `Protocol=="local"` 的本地 provider；云端仍走既有 atlas/openai/skymind 等）。
- 不做节点式/连线式工作流编辑器（保持表单式；复杂工作流留在未来）。
- 不实现视频模型本体（第一版只定义扩展点与契约；视频作为后续 model 条目）。
- 不改生成提案（proposal）语义与视频确认门；本地图片沿用图片「默认直生」。
- 不做模型训练/LoRA 训练（只做推理；LoRA 加载可作为模型参数后续扩展）。
- 不做多卡/分布式；单机单卡单槽。

---

## 2. 总体架构

```text
                    ┌──────────────────────────────────────────────────────────┐
   Agent / UI  ──►  │  平台 MCP / HTTP                                          │
                    │  recut.image.generate ─► media.resolveRoute ─► execute() │
                    │        (route: image.generate.default)                    │
                    │                         │ Protocol=="local"               │
                    │                         ▼                                 │
                    │   app_media_bridge.go ──► AppHost.InvokeMCP             │
                    │        ▲                        │                         │
                    │        │ GetAsset/Attach        │ gen.generate            │
                    └────────┼────────────────────────┼─────────────────────────┘
                             │                        ▼
                    ┌────────┴──────────────────────────────────────────────────┐
                    │  recut.gen-studio (apps/gen-studio, goja background.js)    │
                    │  gen_tasks 账本 + pumpQueue（生成单槽 / prepare 单槽 /     │
                    │  install 并行）                                            │
                    │  ctx.python.run(gen_runner.py ...)  →  shell job           │
                    └──────────────────────────┬────────────────────────────────┘
                                               │ 主 venv 调度
                                               ▼
                    ┌──────────────────────────────────────────────────────────┐
                    │  python/gen_runner.py（主 venv，轻量）                     │
                    │   status / catalog / install / generate                   │
                    │      └─ 派发到模型所属 runtime venv python:                │
                    │           ~/.recut/python/envs/.../<fp>-diffusers/bin/python│
                    │           python/diffusers_runner.py generate --model ...  │
                    │  权重: ~/.recut/models/gen-studio/<runtime>/<model>/       │
                    └──────────────────────────────────────────────────────────┘
```

与 audio-studio 的映射关系：

| audio-studio | gen-studio | 说明 |
|---|---|---|
| `audio.status` / `audio.prepare` / `audio.install` | `gen.status` / `gen.prepare` / `gen.install` | 环境检查、环境准备、模型下载 |
| `audio.transcribe` / `audio.synthesize` | `gen.generate` | 推理（单槽 FIFO） |
| `audio.save` | `gen.save` | 私有产物入库 |
| `audio.characters` / `audio.presets` | `gen.catalog` / `gen.generations` | 能力/模型枚举 / 历史产物 |
| `audio_tasks` | `gen_tasks` | 统一任务账本 |
| `-cosyvoice` / `-voxcpm` 专属 venv | `-diffusers` runtime venv | 生成重依赖独立运行环境（按依赖闭包分，不按模型分） |
| `local-audio` provider | `local-gen` provider（App 声明） | 平台本地 provider（`contributes.media`） |
| `local_speech_bridge.go` | `app_media_bridge.go` | 通用执行桥（manifest 驱动，无 per-app 代码） |

> **关键差异（相对 audio-studio）**：audio-studio 的「引擎」是异构 TTS 框架（CosyVoice vs VoxCPM），依赖冲突 → 每引擎一个 venv。gen-studio 的多数扩散图片模型共享同一套 diffusers/torch 依赖 → **默认只有一个 runtime venv 托管所有图片模型**，模型只是权重。这与 ComfyUI 一致，也满足「一个环境搞定不同模型」。

---

## 3. App 包设计

### 3.1 目录结构

```text
apps/gen-studio/
├── manifest.json                 # 身份/入口/权限/runtime.python/operations/distribution.builtin
├── background.js                 # 唯一业务后端：gen_tasks 账本 + 队列 + 能力 op
├── bootstrap.py                  # 代码准备 + runtime venv 创建（--target all|diffusers|...）
├── python/
│   ├── gen_runner.py             # 主 venv 调度器：status/catalog/install/generate
│   ├── diffusers_runner.py       # 默认 runtime venv 内的通用 diffusers 推理 worker（多模型）
│   ├── requirements.lock         # 主 venv 锁定依赖（轻量：huggingface_hub/modelscope 等）
│   ├── diffusers.requirements.lock # 默认 runtime 锁定依赖（torch/diffusers/transformers...）
│   └── registry.json             # runtimes + models 注册表（单一信息源，见 §6.4）
├── ui/                           # React + Vite：Left 两 Tab + Right 统一预览/日志
│   ├── src/components/generate-tab.tsx   # 模型切换器 + 表单（formSchema 驱动）
│   ├── src/components/records-tab.tsx    # 统一任务列表（环境/下载/生成）
│   └── src/components/preview-pane.tsx   # Right：预览 + 进度 + 日志
├── skills/gen-studio/SKILL.md    # 面向 Agent 的能力说明与使用纪律
├── assets/                       # 图标与截图
├── README.md / README.en.md
└── rfc/                          # App 自身演进 RFC（可选）
```

### 3.2 manifest.json（关键字段）

```json
{
  "manifestVersion": 1,
  "id": "recut.gen-studio",
  "name": "生成工坊",
  "author": "Recut",
  "description": "在本机用开源模型生成图片与视频：一个环境托管多个模型，先准备运行环境，再按需下载模型权重，结果确认后进入素材库。",
  "repository": "https://github.com/6174/recut-gen-studio",
  "version": "0.1.0",
  "type": "standalone",
  "background": "background.js",
  "ui": { "standaloneView": "ui/dist/index.html" },
  "permissions": ["sqlite", "files", "media.read", "media.write", "python", "shell"],
  "runtime": {
    "python": {
      "venv": "gen-studio",
      "version": "3.11",
      "tools": ["ffmpeg"],
      "requirements": "python/requirements.lock",
      "bootstrap": "bootstrap.py"
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
  "operations": [ /* 见 §5.1 */ ]
}
```

要点：

- `permissions` 与 audio-studio 一致；**不需要 `http`**——权重下载由 Python（huggingface_hub / modelscope）完成。
- `runtime.python.venv = "gen-studio"`：平台托管主 venv；runtime 专属 venv 由 `bootstrap.py` 自行派生（§6）。
- `distribution.builtin`：仅被打包脚本消费（Go 的 `Manifest` 不解析该键），与 audio-studio 同构。

### 3.3 内置应用与分发

沿用 audio-studio 的「编译内嵌 + 启动原子替换」机制，不引入新机制：

1. **打包**：`scripts/package-builtin-app.mjs apps/gen-studio service/builtin_apps/gen-studio.tar.gz`（读取 `distribution.builtin.include/exclude`）。
2. **Makefile**：在 `builtin-apps` 目标新增一行；`builtin-apps` 已是 `dev` / `service-build` / `service-release` / `service-test` 的前置。
3. **内嵌**：`service/builtin_apps.go` 增 `//go:embed builtin_apps/gen-studio.tar.gz` 与 `builtinAppList` 条目 `{Package:"gen-studio", AppID:"recut.gen-studio", Archive: embeddedGenStudio}`。
4. **自更新**：`BuiltinAppManager.Ensure()` 在 daemon 启动、Catalog 读取前执行：非软链接目录一律原子替换为新 tar（升级客户端即升级 App）；开发期用 `make app-link APP=apps/gen-studio` 建软链接，自动跳过替换。
5. **不上架 App Store**：内置 App 不写入 `service/appstore/apps.json`（与 `recut.audio-studio` 一致，`refactor_test.go` 已固化该约束）；用户经客户端内置安装，`recut.apps.update` 对其无效（无 `.git`）。

---

## 4. 平台接入：App 声明式本地生成 provider

> **核心决策：不做平台级硬编码。** 本地生成 provider/模型由 App 自己声明——静态的 provider 身份与模型清单写在 `manifest.json` 的 `contributes.media`，动态就绪度由 App 的 `gen.catalog`/`gen.status` 提供；平台只做「通用合并 + 通用执行桥」，无 per-app Go 代码。这与 App 契约「manifest 是唯一运行时配置」一致。

### 4.1 manifest 贡献契约（`service/catalog.go`）

新增 `Manifest.Contributes.Media`：App 静态声明它服务的本地 provider 与模型（模型清单是**静态**的——「有哪些模型」由 App 声明；**变化的是本机是否已下载/就绪**，由 App 的 catalog/status op 动态上报）。

```json
"contributes": {
  "media": {
    "providers": [{
      "id": "local-gen",
      "name": "Generation Studio（本机）",
      "localized": { "en": { "name": "Generation Studio (local)" } },
      "protocol": "local",
      "operations": { "generate": "gen.generate", "save": "gen.save", "catalog": "gen.catalog", "status": "gen.status" },
      "models": [{
        "id": "qwen-image", "name": "Qwen-Image · 本机文生图",
        "capability": "image.generate", "runtime": "diffusers", "sizeGb": 40,
        "inputModes": ["text", "image"], "outputModes": ["size", "seed"],
        "weights": { "huggingFace": "Qwen/Qwen-Image-2.1", "modelScope": "Qwen/Qwen-Image-2.1", "revision": "main" }
      }]
    }]
  }
}
```

- `validateManifest` 校验：`protocol` 必须是 `local`；capability 必须是已知媒体能力；`id` 简单名；`generate`/`save` 必填且必须指向 manifest 中**已声明且可调用**（mcp surface 或 `capability:true`）的 operation；`catalog`/`status` 可选。
- 平台模型 ID 规则：`<providerID>/<modelID>`（平台路由照常解析，如 `local-gen/qwen-image`）。
- **模型静态化**带来一个直接好处：平台在目录构建期即可解析路由，无需在启动时调用 App；只有「就绪度」是运行期动态的。

### 4.2 目录合并：App 贡献的 provider 进入全局目录（`service/media/app_providers.go`）

- `media.RegisterAppProviders([]MediaProvider)`：daemon 启动、AppHost 就绪后调用一次，把 App 贡献的 provider 合并进全局目录快照（`swapCatalog`）。
- `withAppProviders(base)` 在每次 `mergeCatalogProviders(seed, cdn)` 后重新追加 App provider（CDN 6h 刷新不会丢）；App provider 永不来自 CDN。
- 因此 **`catalog_seed.go` / `providerCatalogExcluded` 不需要任何 local-gen 改动**；未安装该 App 时目录里就没有 local-gen，本地路由不可解析（符合预期）。

### 4.3 执行分派（`service/media/jobs.go` `execute()`）

当前 `execute()` 对 `ImageGenerate` 先走 `model_providers.For(provider)` / OpenAI 协议，两条路径都先 `m.secret(credential.ID)`（本地空凭据会失败）；只有 `SpeechGenerate` 有 `credential.Provider == "local-audio"` 分支。

**改法（最小且通用）**：在 `execute()` 入口、按能力分派前，统一拦截本地 provider，按 provider id 分派到执行桥：

```go
if provider, ok := providerByID(credential.Provider); ok && provider.Protocol == "local" {
    if provider.ID == "local-audio" {
        // 现有 local-audio 分支原样保留
    } else if exec := m.localAppExec[provider.ID]; exec != nil {
        asset, err := exec(job, model, job.Output); ...
    } else {
        m.failExecution(job, fmt.Errorf("local provider %s is not connected; install/start its App or switch the default route to a cloud provider", provider.ID))
    }
    return
}
```

- `MediaService` 新增通用字段与 setter：`localAppExec map[string]func(job, model, output) (MediaAsset, error)` + `SetLocalAppExecutor(providerID, exec)`（`service/media/service.go`），`local-audio` 的 `localSpeechExec` 保持不变。
- **泛化硬编码**：`catalog.go` 的 `configuredModelFor` 把 `CredentialName = "Audio Studio（本机）"` 改为 `provider.Name`；`mcp.go` 的 `mediaReadiness` 把 `provider.ID == "local-audio"` 泛化为「`Protocol=="local"`」。

### 4.4 通用执行桥（`service/app_media_bridge.go`）

完全由 manifest 驱动，无 per-app 代码：

```go
func wireAppMediaProviders(host *AppHost, platformMedia *media.MediaService) {
    apps, _ := host.catalog.List()
    providers := []media.MediaProvider{}
    for _, app := range apps {
        if app.Manifest.Contributes == nil || app.Manifest.Contributes.Media == nil { continue }
        for _, c := range app.Manifest.Contributes.Media.Providers {
            providers = append(providers, mediaProviderFromContribution(c))          // 静态目录
            platformMedia.SetLocalAppExecutor(c.ID, func(job, model, output) (...) {  // 执行桥
                return runAppGeneration(host, platformMedia, app.Manifest.ID, c, job, model, output)
            })
        }
    }
    media.RegisterAppProviders(providers)
    platformMedia.SetLocalModelProvider(func() []media.LocalModelInfo {             // 动态就绪面
        return appLocalModels(host, apps)
    })
}
```

`runAppGeneration` 只用 App 声明的 operation：`generate`（提交，`model.APIModelID` + prompt + 参考 assetIds + output 参数）→ `host.jobs.WaitByID`（30 分钟）→ `capabilityInvoke(save)`（授权落库）→ `GetAsset` + `Attach`。失败面与 local-speech 桥同构（结构化 `mcpError` + hint）。**参考图**用 `job.ReferenceIDs`（不是 `job.AssetIDs`——后者是输出占位资产）透传为 `referenceAssetIds`，App 内部 `ctx.media.materialize` 取本地文件。

`appLocalModels` 遍历各 App 贡献的 provider，调用其 `catalog`（或 `status`）op，把 `models[]` 投影为 `media.LocalModelInfo`（就绪度/权重），供能力模型聚合。

- **等待窗口**：本地扩散推理比 TTS 慢，`WaitByID` 用 30 分钟；MCP 短命进程无执行桥（本地路由提交得到引导错误，与 local-audio 相同）。
- **装配**：`main.go` 在 `wireLocalSpeechBridge` 旁调用 `wireAppMediaProviders(host, media)`。

### 4.5 全局生图选择本地环境

两条路径，均无需新契约：

1. **默认路由**：把 `image.generate.default` 指向 `local-gen/qwen-image`。写入面是既有 `POST /v1/media/routes`（`SaveRoute` 对 `Protocol=="local"` 自动清空 `credentialId`）。UI 用 `GET /v1/media/capabilities/{capability}/models`（§5.3）列出本地模型，提供「设为生图默认」一键动作。
2. **单次覆盖**：`recut.image.generate { modelId: "local-gen/qwen-image" }`（无需 `credentialId`，`resolveRoute` 已支持本地 modelId 直连）。

> 选择「本地环境」= 选择平台模型 `local-gen/<model>`；模型归属哪个 runtime 由 App 注册表决定，平台无需感知。`gen.catalog` 告诉调用方有哪些 `<model>` 可选。

---

## 5. 能力与 MCP 契约

### 5.1 App operations 清单（`manifest.operations`）

| op | surfaces | capability | 说明 |
|---|---|---|---|
| `gen.status` | api, mcp | ✅ | 主 venv/FFmpeg/各 runtime venv/各模型权重/下载源 + 在途任务（`activeJob`/`tasks`）；即「环境总览」 |
| `gen.catalog` | api, mcp | ✅ | **枚举本机模型**：`[{model, capability, runtime, label, formSchema, defaultParams, ready, weight:{installed,sizeGb,source}}]` + `runtimes:[{id,ready,label}]` |
| `gen.prepare` | api, mcp | | 准备代码与 runtime venv（`target: all\|diffusers`），**不下载权重**；异步返回 job/taskId |
| `gen.settings.set` | api | | 持久化下载源（`automatic\|huggingface\|modelscope`） |
| `gen.install` | api, mcp | | **仅下载权重**（`{model, source}`），不建 venv；异步、可并行 |
| `gen.generate` | api, mcp | ✅ | 提交生成 `{model, prompt, negativePrompt?, aspectRatio?, seed?, steps?, cfg?, referenceAssetIds?, ...}`；单槽 FIFO；返回 `{job, taskId, generation:{id}}` |
| `gen.generations` | api, mcp | ✅ | 已完成生成记录（私有产物 + `savedAssetId`） |
| `gen.generation.complete` | api | | UI 在任务终态后读取产物（`outputURL`/尺寸/seed/耗时/错误） |
| `gen.save` | api, mcp | ✅ | 把私有生成产物导入素材库（`kind: image\|video`），返回真实 `assetId` |
| `gen.cancel` | api, mcp | ✅ | 取消最新在途任务（queued 直接落 cancelled / running 走 shell cancel） |
| `gen.tasks.list` | api, mcp | ✅ | 任务中心主列表（来源/状态/action 过滤、分页） |
| `gen.task.get` | api, mcp | ✅ | 单任务详情（来源、状态、meta、日志路径、产物） |
| `gen.task.logs` | api, mcp | ✅ | 持久日志（`tasks/<id>.log` JSON-lines，可回看） |
| `gen.task.cancel` | api, mcp | ✅ | 按任务 id 取消 |
| `gen.job` / `gen.resolve` | api | | UI 重连跟踪 / 确认终态（与 audio 同构） |

`capability: true` 的 op 可被平台能力桥（`ctx.capabilities.invoke`）与其他 App 调用；`gen.generate` / `gen.save` 是本地生图桥依赖的两个能力。

### 5.2 异步任务模型（复用 audio-studio）

**任务账本 `gen_tasks`**（App 私有 sqlite，`ctx.sqlite`）：

```sql
create table if not exists gen_tasks (
  id text primary key,
  shell_job_id text not null default '',
  action text not null,              -- prepare | install | generate
  record_id text not null default '',-- gen_generations.id（generate 时）
  source text not null default 'manual',   -- ai | manual
  submitted_by text not null default '',
  state text not null default 'queued',    -- queued|running|completed|failed|cancelled|interrupted
  progress integer not null default 0,
  meta_json text not null default '{}',
  payload_json text not null default '',   -- 排队重放载荷（提交时解析后的输入）
  log_path text not null default '',
  error text not null default '',
  created_at text not null, started_at text not null default '', resolved_at text not null default ''
);
create index if not exists gen_tasks_created on gen_tasks(created_at desc);
create index if not exists gen_tasks_active  on gen_tasks(state);
```

**产物表 `gen_generations`**：`id, model, runtime, capability(image|video), prompt, negative_prompt, params_json, width, height, seed, reference_asset_ids, output_path, mime_type, saved_asset_id, created_at, job_id, status, error`。

**并发分类**（与 audio-studio 逐条对齐）：

| 类别 | 动作 | 并发规则 |
|---|---|---|
| 推理 | `generate` | **单槽 FIFO**（同卡多模型并行必 OOM）；依赖模型所属 runtime venv 就绪 **且** 权重已下载，否则保持 queued |
| 环境准备 | `prepare` | **单槽**，等推理（含排队）排空后自动派发（venv 重建不可与在途推理并行） |
| 权重下载 | `install` | **不限并行**（纯磁盘/网络），提交即跑 |

**队列引擎 `pumpQueue`**：`settleAllJobs`（结算 running 行）→ 守卫派发（prepare 无推理在途时派发最老 queued；generate 无推理 running、无 prepare running、且依赖权重未在下载时派发最老 queued）。由 `status` / `tasks.list` / 提交 / 取消 / UI 轮询驱动，无独立循环。

**提交永不拒绝**：`gen.generate` 先 `pumpQueue` 释放槽位，再写 `gen_tasks` 一行（`started=false` → queued），再 `pumpQueue`；空槽立即派发并返回 `job`，占槽返回 `job:null` + `taskId`（调用方用 `gen.status` / `gen.tasks.list` 观察）。**取消**：queued 直接落 `cancelled`，running 走 `ctx.shell.cancel`。

**统一观察**：shell job 经 `ctx.python.run` 创建，`recut.job.status/wait/logs/cancel` 直接可观察（`kind: shell`）；日志由 runner 的 `--task-log` tee 到 `tasks/<id>.log`，终态后仍可回看。

### 5.3 MCP 发现面：告诉外部有哪些模型/环境

分两层，职责清晰：

**(a) App 能力 op（权威「本机有什么」）**：`gen.catalog` 返回注册表的实时就绪投影，例如：

```json
{
  "runtimes": [
    { "id": "diffusers", "label": "Diffusers（通用图片）", "venv": "diffusers", "ready": true }
  ],
  "models": [
    { "model": "qwen-image", "capability": "image.generate", "runtime": "diffusers",
      "label": {"zh":"Qwen-Image（文生图）","en":"Qwen-Image (text-to-image)"},
      "ready": true,
      "weight": {"installed": true, "sizeGb": 40, "source": "huggingface", "revision": "<pinned>"},
      "formSchema": [
        {"key":"prompt","type":"textarea","required":true,"label":{"zh":"提示词","en":"Prompt"}},
        {"key":"negativePrompt","type":"textarea","label":{"zh":"负向词","en":"Negative"}},
        {"key":"aspectRatio","type":"select","options":["1:1","16:9","9:16","4:3","3:4"],"default":"1:1"},
        {"key":"steps","type":"number","default":50,"min":1,"max":100},
        {"key":"cfg","type":"number","default":4.0,"min":0,"max":20},
        {"key":"seed","type":"number","default":-1}
      ] },
    { "model": "qwen-image-edit", "capability": "image.generate", "runtime": "diffusers",
      "ready": false, "weight": {"installed": false}, "formSchema": [ /* 含 referenceImages */ ] }
  ],
  "downloadSource": "automatic"
}
```

**(b) 平台聚合 MCP（跨 provider 的统一选择面）**：新增 `recut.media.list_capability_models { capability? }`，镜像 `CapabilityVoiceGroups`：

- 遍历 `Protocol=="local"` 的 provider，按能力分组返回 `{provider, protocol, isDefaultRoute, models, localModels, error?}`；
- `localModels` 由 daemon 注入的 `localModelProvider`（调 `recut.gen-studio` 的 `gen.catalog`）提供，未安装则分组只声明平台模型、`localModels` 为空并带 `error`；
- 同时用于 `GET /v1/media/capability-models`（设置 UI 消费）。

这样：**外部 Agent/前端既能通过平台工具发现「本地生图 provider 及其模型与就绪度」，也能通过 App 的 `gen.catalog` 拿到模型/runtime/权重/表单 schema 的细节。** `recut.context.media.readiness` 与 `mediaRoutesView` 的本地分支同步泛化（§4.2），保证会话一开始就能看到「本地生图已就绪 / 未配置」。

> `recut.image.generate` 的工具描述补一句提示（纯提示，不加校验）：「若 `image.generate.default` 指向 `local-gen/*`，生成将由本机 Generation Studio 执行；可用 `recut.media.list_capability_models` 查看本机模型。」

---

## 6. 环境模型（runtime / model 分离）

### 6.1 概念：runtime（环境）vs model（权重）

| 概念 | 是什么 | 生命周期 | 目录 |
|---|---|---|---|
| **runtime** | 一套依赖闭包（venv + requirements），能加载一类模型 | `gen.prepare` 创建/重建 | `~/.recut/python/envs/recut.gen-studio/gen-studio/<fp>-<runtime>/` |
| **model** | 一组权重文件 + 表单 schema，归属某个 runtime | `gen.install` 下载/删除 | `~/.recut/models/gen-studio/<runtime>/<model>/` |

- **默认只有一个 runtime `diffusers`**，托管所有基于 diffusers 的图片模型（Qwen-Image、Qwen-Image-Edit……）；换模型只下权重，不建新环境。
- **只有依赖冲突时才加 runtime**（如某视频模型需要不同 torch/flash-attn 版本）——这与 audio-studio 因 CosyVoice/VoxCPM 依赖冲突而分 venv 同理，但默认不这么做。
- 主 venv（平台托管）只放 `gen_runner.py` 与轻量调度/下载依赖；重依赖永远在 runtime venv 里。

```text
~/.recut/python/envs/recut.gen-studio/
└── gen-studio/
    └── <fingerprint>/                 # 平台托管主 venv（RECUT_PYTHON / RECUT_VENV 指向它）
        ├── bin/python                 #   轻量：gen_runner.py + huggingface_hub/modelscope/requests
        └── <fingerprint>-diffusers/   #   默认 runtime venv：torch/diffusers/transformers/accelerate...
            # 未来若依赖冲突：<fingerprint>-video/ 等
~/.recut/models/gen-studio/
└── diffusers/
    ├── qwen-image/                    # 权重（model = qwen-image）
    └── qwen-image-edit/               # 权重（model = qwen-image-edit）
```

- 主 venv 指纹由平台按 `version + venv + tools + requirements.lock` 计算；**runtime 专属 venv 不参与主指纹**（改 runtime 依赖只重建对应 runtime venv，不触发主 venv 重建）。
- `RECUT_VENV` 指向主 venv，`bootstrap.py`/`gen_runner.py` 用 `Path(RECUT_VENV).with_name(f"{name}-{runtime}")` 解析 runtime venv python（与 `audio_runner.cosyvoice_python()` 同款）。

### 6.2 准备与下载分离

| 操作 | 做什么 | 不做什么 |
|---|---|---|
| `gen.prepare { target }` | 建主 venv 依赖、准备 runtime 代码、创建 runtime 专属 venv 并装锁定依赖、`pip check` + `diffusers_runner.py status` 自检 | **不下载权重** |
| `gen.install { model, source }` | 从 huggingface / modelscope / automatic 下载该模型权重到 `~/.recut/models/gen-studio/<runtime>/<model>/` | **不动 venv、不装依赖** |

- `target: all | diffusers`（未来 `| video ...`）：`all` = 主 venv（`ctx.python.prepare()`）+ 尽力准备全部 runtime venv（单个失败不阻断，错误经 `gen.status` 暴露）；定向 target 用 `ctx.python.run(["python/bootstrap.py", "--target", target, "--task-log", logPath])`（与 audio-studio 定向修复一致）。
- 环境准备与推理互斥（prepare 单槽等推理排空）；权重下载与推理可并行（但 generate 会等依赖权重下完再派发）。

### 6.3 权重源

- 持久化键 `gen_settings.download_source ∈ {automatic, huggingface, modelscope}`，`gen.settings.set` 写入、`gen.install` 同步写入（与 `audio.settings.set` 同构）。
- 注册表为每个模型同时声明 HF 与 MS 仓库；`automatic` 按「HF 失败回退 MS」或按平台策略回退（与 audio-studio 的 source 处理保持一致）。
- `source` 可在 `gen.install` 单次覆盖。

### 6.4 注册表（单一信息源）

`python/registry.json` 是 runtime/model/权重/表单的单一信息源（`gen.catalog`、`gen.install`、`gen.generate`、`bootstrap.py`、`gen_runner.py` 同读一份；`background.js` 只保留极简兜底清单，参照 audio-studio 的 `PRESET_BOOTSTRAP_FALLBACK` 做法由脚本再生成）：

```json
{
  "runtimes": [
    { "id": "diffusers", "label": {"zh":"Diffusers（通用图片）","en":"Diffusers (general image)"},
      "venv": "diffusers", "runner": "python/diffusers_runner.py",
      "requirements": "python/diffusers.requirements.lock" }
  ],
  "models": [
    {
      "id": "qwen-image",
      "capability": "image.generate",
      "runtime": "diffusers",
      "label": {"zh": "Qwen-Image（文生图）", "en": "Qwen-Image (text-to-image)"},
      "weights": {
        "repoHuggingFace": "Qwen/Qwen-Image-2.1",
        "repoModelScope": "Qwen/Qwen-Image-2.1",
        "revision": "<pinned-commit>",
        "sizeGb": 40,
        "files": ["transformer/*", "text_encoder/*", "vae/*", "tokenizer/*", "scheduler/*"]
      },
      "pipeline": "QwenImagePipeline",
      "formSchema": [
        {"key":"prompt","type":"textarea","required":true,"label":{"zh":"提示词","en":"Prompt"}},
        {"key":"negativePrompt","type":"textarea","label":{"zh":"负向词","en":"Negative"}},
        {"key":"aspectRatio","type":"select","options":["1:1","16:9","9:16","4:3","3:4"],"default":"1:1"},
        {"key":"steps","type":"number","default":50,"min":1,"max":100},
        {"key":"cfg","type":"number","default":4.0,"min":0,"max":20},
        {"key":"seed","type":"number","default":-1}
      ],
      "defaultParams": { "aspectRatio": "1:1", "steps": 50, "cfg": 4.0, "negativePrompt": " " }
    }
  ]
}
```

- **换模型 = 改/加 `models` 条目**（同一 runtime 内），不改编排逻辑；`revision` 固定 commit，保证可复现。
- **加视频 = 加 `models` 条目 + （必要时）加一个 runtime**；平台侧只需在 `local-gen` provider 下加一个 `local-gen/<model>` 模型——执行桥与任务协议零改动。
- **表单由 `formSchema` 驱动**：Left Tab 1 顶部切换 `models`，表单按所选模型的 `formSchema` 渲染；平台侧 `MediaModel.Parameters` 与之一致（同一份能力语义）。
- 第一版按需求兑现 `https://github.com/QwenLM/Qwen-Image-2.1`；实现时以该仓库/权重为准，锁定 revision 与依赖闭包。

### 6.5 runner 架构

- `python/gen_runner.py`（主 venv）：`status` / `catalog` / `install --model --source` / `generate --model ...`。
  - `generate` 解析模型所属 runtime 的 venv python，`subprocess` 派发 `python/diffusers_runner.py generate --model ...`，实时 stream 进度（复用 audio-studio 的 `run_worker_process` 模式），把 `[gen] ...` 进度行 tee 到 `--task-log`。
  - 权重下载在 `install` 中用 huggingface_hub / modelscope SDK，断点续传、sha/大小校验、失败可重试。
- `python/diffusers_runner.py`（runtime venv，通用）：`status`（依赖自检 + 权重探测）/ `generate`（按注册表 `pipeline` 加载对应 diffusers pipeline → 推理 → 落 PNG/JPEG 到 `RECUT_APP_FILES_DIR` 下私有路径 → 写 `<output>.meta.json` 记录尺寸/seed/耗时）。一个 runner 服务该 runtime 下的所有模型，模型差异由注册表条目（pipeline 名 + 权重 + 表单）驱动。

---

## 7. 交互设计

> 目标：与 audio-studio 的任务中心 UX 同源、更简单；**Left 负责「输入与历史」，Right 负责「结果与过程」**。

### 7.1 布局

```text
┌──────────────────────────────────┬───────────────────────────────────────────┐
│ Left                              │ Right（统一生产预览 + 进度日志）            │
│ ┌────────────┬─────────────────┐ │ ┌───────────────────────────────────────┐ │
│ │ Tab1 生成  │ Tab2 记录        │ │ │ 任务头：名称 · 状态徽标 · 进度条 ·     │ │
│ │            │                  │ │ │         [取消] [查看日志]              │ │
│ │ [模型切换] │ [环境][下载][生成]│ │ ├───────────────────────────────────────┤ │
│ │ ┌────────┐ │ ┌──────────────┐ │ │ │ 生成任务：                            │ │
│ │ │该模型的│ │ │ 统一任务列表  │ │ │ │   ┌─────────────────────────────┐     │ │
│ │ │表单    │ │ │ · 准备环境    │ │ │ │   │ 图片/视频预览                │     │ │
│ │ │(schema)│ │ │ · 下载 模型A  │ │ │ │   └─────────────────────────────┘     │ │
│ │ │        │ │ │ · 生成 xxx    │ │ │ │   参数：模型/画幅/seed/steps/耗时      │ │
│ │ │[生成]  │ │ │  （点击一行） │ │ │ │   [保存入库] [下载] [作为参考再生成]   │ │
│ │ └────────┘ │ └──────────────┘ │ │ │                                        │ │
│ │            │                  │ │ │ 环境/下载任务：                       │ │
│ │            │                  │ │ │   实时日志流 + 就绪度摘要              │ │
│ └────────────┴─────────────────┘ │ └───────────────────────────────────────┘ │
└──────────────────────────────────┴───────────────────────────────────────────┘
```

### 7.2 Left · Tab 1「生成」

- **顶部模型切换器**：数据来自 `gen.catalog` 的 `models`，按 `capability` 分组（图片 / 视频），显示就绪徽标（runtime 就绪 + 权重已下载）。未就绪的模型仍可选中，但「生成」按钮禁用并给「去准备环境 / 去下载权重」引导（点击跳 Tab 2 对应任务或直接触发 `gen.prepare` / `gen.install`）。
- **表单**：完全由所选模型的 `formSchema` 渲染（`textarea` 提示词/负向词、`select` 画幅、`number` steps/cfg/seed、`media` 参考图上传）；默认值取 `defaultParams`。
- **提交**：`gen.generate` → 返回 `{job, taskId, generation}`；无论立即派发还是排队，Right 自动切到该任务并显示进度；生成记录立即出现在 Tab 2。

### 7.3 Left · Tab 2「记录」

- **统一任务列表**：数据来自 `gen.tasks.list`，把三类任务合并为一行一类：
  - `prepare` → 「准备运行环境」
  - `install` → 「下载 <模型名>」
  - `generate` → 「生成 <模型名> · <提示词摘要>」
- **过滤**：按 action（环境/下载/生成）、状态（排队/进行/完成/失败）、来源（AI/手动）；顶部提供两个快捷动作入口：「准备环境」`gen.prepare`、「下载模型」`gen.install`（选模型 + 选下载源 `gen.settings.set`）。
- **点击一行 → Right 显示对应内容**（结果或日志），与 audio-studio 任务中心一致。

### 7.4 Right「统一生产预览 + 进度日志」

- **共享任务头**：名称、状态徽标（queued/running/completed/failed/cancelled）、进度条（`gen.task.get` 轮询 / `recut.job.*`）、`[取消]`（`gen.task.cancel`）、`[查看日志]`（`gen.task.logs`）。
- **生成任务**：预览图片/视频（`gen.generation.complete` 的 `outputURL`，经 `ctx.files.url` 私有地址）；显示参数（模型、画幅、seed、steps、耗时）；动作：`gen.save`（保存入库，成功后按钮变「已入库」并可跳素材库）、下载、以本结果为参考图再生成。
- **环境/下载任务**：实时日志流（运行中 stream，终态读持久日志）+ 就绪度摘要（`gen.status`：主 venv / runtime venv / 各权重）。
- **无选中任务**：显示环境总览与「准备环境 / 下载模型」引导。

### 7.5 实现与一致性

- React + TypeScript + Vite，`ui/dist` 单文件产物（与 audio-studio 一致）；组件拆分 `generate-tab` / `records-tab` / `preview-pane`。
- 任务列表/日志/取消复用 audio-studio 任务中心的交互与轮询节奏（参见 `apps/audio-studio/rfc/2026-08-23-task-center-ux.md`、`2026-09-03-task-queue-and-parallelism.md`）。
- i18n 走 `ctx.locale`，文案中英双语（`manifest.localized`）。
- 不做节点式连线编辑器；表单式即可（见 §1.2 非目标）。

---

## 8. 与既有生成契约的关系

- **提案（proposal）**：本地图片默认 `RequiresProposal:false`（零成本），`recut.image.generate` 直接生成；若用户把 `mode:"propose"` 或未来把本地视频设为需要确认，`ConfirmProposal` → `generateBoundToAsset` → `resolveRoute` → 本地执行桥，**同一 assetId 原位转 queued**，无需重指（既有 `proposals.go` 逻辑对本地 provider 通用）。
- **参考协议**：`<reference id kind role label />` 与 `imageAssetIds` 仍由平台解析为 `job.AssetIDs`；执行桥透传 `referenceAssetIds`，App 用 `ctx.media.materialize` 取本地文件。首版文生图忽略参考；参考图/编辑作为独立 model 条目接入。
- **交付**：生成产物先私有（App 文件区），仅 `gen.save` 后成为平台 Asset；桥在默认路由路径上自动 `gen.save` + `Attach`，与本地 TTS 一致。
- **发现**：`recut.context` 的 `media.defaultRoutes` / `media.readiness` 本地分支泛化后，会话一开始即可见「本地生图 provider / 模型 / 就绪度」。

---

## 9. 契约改动清单

| 契约 | 改动 | 类型 |
|---|---|---|
| `service/catalog.go` `Manifest.Contributes.Media` | 新增 `contributes.media`（provider + 静态模型 + operation 接线）与 `validateMediaContribution` | **manifest 契约** |
| `service/media/app_providers.go`（新） | `RegisterAppProviders` / `withAppProviders`：App 贡献 provider 合并进全局目录并在 CDN 刷新时保留 | 目录 |
| `service/media/catalog_loader.go` | `mergeCatalogProviders(...)` 外层套 `withAppProviders(...)`（CDN 刷新不丢 App provider） | 目录 |
| `service/media/service.go` | `localAppExec` map + `SetLocalAppExecutor`（通用，替代按能力加字段） | 执行桥 |
| `service/media/jobs.go` `execute()` | 本地 provider 按 provider id 分派（local-audio 保持；其余走 `localAppExec`） | 行为 |
| `service/media/catalog.go` `configuredModelFor` | 本地 `CredentialName` 由硬编码改为 `provider.Name` | 泛化 |
| `service/mcp.go` `mediaReadiness` | `local-audio` 判断泛化为 `Protocol=="local"` | 泛化 |
| `service/app_media_bridge.go`（新） | `wireAppMediaProviders`：manifest 驱动的静态目录 + 通用执行桥（generate→等 job→save→回读 Asset→Attach）+ 动态就绪面 | 新增 |
| `service/main.go` | 调用 `wireAppMediaProviders(host, media)` | 装配 |
| `service/media/capability_models.go`（新） | `CapabilityModelGroups` + `SetLocalModelProvider` | 聚合 |
| `service/mcp.go` / `media_server.go` / `server.go` | 新增 `recut.media.list_capability_models` + `GET /v1/media/capabilities/{capability}/models` | MCP/HTTP |
| `service/builtin_apps.go` | `//go:embed` + `builtinAppList` 增 `gen-studio` | 内置 |
| `Makefile` `builtin-apps` | 增 `package-builtin-app.mjs apps/gen-studio ...` | 构建 |
| `apps/gen-studio/*`（新） | 完整 App 包（manifest/background/bootstrap/python/ui/skills） | 新增 |
| `docs/app-contract.md` | 记录 `contributes.media` 契约 | 文档 |
| `rfc/README.md` | 增本 RFC 索引条目 | 文档 |

---

## 10. 里程碑

- **M0（平台接线 + 内置可安装）**：`contributes.media` 契约 + 校验；`RegisterAppProviders`/`withAppProviders`；通用执行桥 `wireAppMediaProviders`；`execute()` 按 provider id 分派；`configuredModelFor`/`mediaReadiness` 泛化；App 空壳（manifest + background 注册全部 op 返回未就绪）+ 内置打包/内嵌/启动自更新；平台模型聚合 `list_capability_models`。**（已实施）**
- **M1（Qwen 文生图端到端）**：`bootstrap.py`（主 venv + `-diffusers` runtime venv）、`gen_runner.py`/`diffusers_runner.py`、`registry.json`（runtime + qwen-image model）、`gen.prepare`/`gen.install`（HF/MS/automatic）、`gen_tasks` 队列、`gen.generate`/`gen.save`；桥 E2E：`recut.image.generate` 经 `local-gen` 路由 → 本地出图 → 平台 Asset；`gen_tasks`/`recut.job.*` 可观察、可取消、日志可回看。**（代码已实施；40GB 权重与真机推理待验证）**
- **M2（交互 + 发现面 + 设置）**：Left 两 Tab + Right 预览/日志完整交互（`gen.catalog` 驱动模型切换与表单）；`recut.media.list_capability_models` + HTTP；设置 UI 卡片（模型列表、就绪度、权重下载、下载源、一键设为生图默认）；`skills/gen-studio` 文档。**（单文件 UI 与发现面已实施；设置面板接入待做）**
- **M3（扩展点验证）**：同一 runtime 内加一个模型（如 `qwen-image-edit`，验证「加模型只改 manifest + registry」）；或加一个视频模型（`capability: video.generate` + 必要时新 runtime）验证视频确认门 + 桥的通用性。
- **M4（打磨）**：进度百分比、多产物/批量、i18n、画幅预设、错误 hint 收敛、README/skill 完善。

---

## 11. 验收

1. **内置分发**：全新安装的 Recut 启动后 `~/.recut/apps/gen-studio` 自动出现且 `id == recut.gen-studio`；`make app-link APP=apps/gen-studio` 后启动不覆盖软链接；升级二进制后 App 包被原子替换为新版。
2. **环境/下载分离**：`gen.prepare` 完成后 runtime venv 就绪但权重未下载；单独 `gen.install { model, source:"modelscope" }` 完成权重下载，`gen.status` 分别反映两项；切换 `source` 后重下可回退。
3. **一环境多模型**：同一个 `diffusers` runtime 下 `gen.catalog` 能列出多个模型（含表单 schema）；新增一个同 runtime 模型无需重建环境；`gen.prepare` 不因加模型而触发主 venv 重建。
4. **异步任务**：并发提交多个 `gen.generate` 时后到者 `job:null` + `taskId` 且 `state=queued`，前序完成后自动开始（不报错、不丢任务）；`recut.job.wait` 能观察到终态；`gen.task.cancel` 可取消 queued 与 running；任务结束后 `gen.task.logs` 仍可回看。
5. **交互**：Left Tab 1 切换模型后表单随 `formSchema` 变化；提交生成后 Right 自动显示该任务进度与预览；Left Tab 2 点击任意「环境/下载/生成」记录，Right 显示对应结果或日志。
6. **全局生图选择本地**：把 `image.generate.default` 指向 `local-gen/qwen-image` 后，`recut.image.generate { text }` 返回的 Asset 由本机生成（无云调用、无凭据）；单次 `modelId:"local-gen/qwen-image"` 直连同样生效；`recut.media.list_capability_models` 能列出该本地 provider 与模型就绪度。
7. **确认与入库**：默认路由路径下产物自动 `gen.save` 并挂到项目；`mode:"propose"` 时提案确认后仍复用同一 assetId 转 queued 并本地生成。
8. **失败可操作**：Generation Studio 未安装时，本地路由提交返回结构化错误 + hint（安装 App 或切云端）；runtime/权重缺失时任务保持 queued 或给出明确未就绪错误，绝不静默产出坏素材。

---

## 12. 风险与开放问题

- **显存与时长**：20B 级扩散模型推理可能超过平台默认等待窗口；桥的 `WaitByID` 用 30 分钟，MCP 侧仍以 `recut.job.*` 轮询为主；低显存设备需要量化/分片策略（可作为模型参数或独立 model 条目）。
- **平台抽象是否过窄**：`localAppExec` 的签名（`job, model, output`）需同时容纳参考图、尺寸、seed、steps；若视频模型需要首尾帧/时长，已通过 `job.Capability` + `output` 透传覆盖（桥按 `kind` 落 image/video），必要时再引入 typed output——M3 决策点。
- **runtime 粒度**：默认单 `diffusers` runtime 是否足够容纳所有图片模型（不同 diffusers/torch 版本兼容性）？若某模型必须锁旧版 diffusers，则需按版本再分 runtime——保留「冲突才加 runtime」原则，避免为每个模型开环境。
- **发现面命名**：`recut.media.list_capability_models` 与既有 `list_capability_voices` 是否合并为一个泛化的「本地能力聚合」工具，待 M2 依据实际调用面决定。
- **权重许可**：Qwen-Image 系列为 Apache-2.0，但第三方 LoRA/微调权重许可需在注册表逐条标注并在 UI 呈现。
- **manifest 贡献契约的推广**：`contributes.media` 是新的 App↔平台契约面；`local-audio` 未来可迁移到同一机制（manifest 声明 + 通用桥），从而彻底去掉 `local_speech_bridge.go` 的硬编码。需评估迁移成本与兼容。
