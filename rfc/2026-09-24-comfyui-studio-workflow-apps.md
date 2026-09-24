<!--
 * [INPUT]: 依赖刚落地的本地生成 App 范式 apps/gen-studio（manifest.json 的 runtime.python/contributes.media、
 *          background.js 的 gen_tasks 账本 + pumpQueue 单槽 FIFO + 能力 op、python/gen_runner.py 主 venv
 *          调度、python/comfyui_runner.py 里写死的 t2i_workflow/edit_workflow、python/registry.json 的
 *          runtimes+models 注册表、python/comfyui.requirements.lock、bootstrap.py 派生 comfyui 专属 venv +
 *          固定 commit 浅克隆 ComfyUI 源码、service/builtin_apps.go 的 //go:embed tar.gz + 启动原子替换、
 *          scripts/package-builtin-app.mjs、service/gen_studio_test.go、service/media/app_providers.go +
 *          app_media_bridge.go 的通用执行桥、service/catalog.go 的 contributes.media 契约、
 *          docs/app-contract.md）；同族先例 rfc/2026-09-23-local-generation-studio.md（一个 runtime 多模型）与
 *          rfc/2026-09-24-modal-functions.md（一个 App 多自包含 modalapp 目录，每目录 manifest.json +
 *          modal_app.py + bootstrap.py + publish_registry.py 生成注册表）。
 * [OUTPUT]: 设计一次 **gen-studio → comfyui-studio 的重构**：把「切换的单位」从**模型**改为**一个 ComfyUI
 *           工作流（workflow app）**；确立自包含扩展目录 `comfyuiapps/<id>/`（`manifest.json` = app meta +
 *           form json + weights + customNodes + output；`workflow.py` = 由表单参数**动态构建** ComfyUI API
 *           格式图的纯函数；`bootstrap.py` = 该 app 的依赖准备：额外 pip / 固定 commit 克隆 custom_nodes）；
 *           核心运行环境（ComfyUI venv + 源码）**全 app 共享**，加能力 = 加一个目录 + 重跑 publish_registry，
 *           不改核心；`python/publish_registry.py` 扫描 comfyuiapps 生成 `registry.json` / `index.json` 并同步
 *           `manifest.contributes.media`；运行器拆为通用执行器 `comfyui_runner.py` + 稳定作者 SDK
 *           `comfyui_sdk.py`；`gen.*` op / `gen_tasks` 账本 / UI 切换器 / catalog 形状 / 平台 provider 展示的
 *           同步改名与泛化（generate 接受任意 `params` 对象而非固定 prompt/steps/cfg）。**并把「App 依赖
 *           service 层」重构为「service 层提供通用 hook 注册表、App 经统一 API 注册」**——退役
 *           `local_speech_bridge.go` 这类 per-app 桥、`execute()` 的 `local-audio` 分支与三个专用注入点，
 *           让 comfyui-studio 成为 100% 标准 App（service 零 per-app 常量/分支/测试）；并明确 **ComfyUI
 *           引擎随 `comfy.prepare` 启动（非后置懒启动）**，UI 与 background（AI）双入口均可触发、经探活 +
 *           文件锁幂等，互不冲突。含迁移对照表、契约改动清单、M0–M5 里程碑与验收。不新增渲染引擎、不改平台
 *           路由/提案门禁、不做节点式图形编辑器。
 * [POS]: rfc 的「本地 ComfyUI 工作流工作台」重构稿；把 gen-studio 的「一个 runtime 多模型」升级为「一个
 *        ComfyUI runtime 多 workflow app」——模型只是 workflow app 的一个子集（weights 声明），扩展单位从
 *        注册表条目变成自包含目录；与 modal-studio 的 modalapps 结构互为姊妹（modalapp↔comfyuiapp、
 *        modal_app.py↔workflow.py、Image↔runtime venv、Volume↔weights）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 rfc/README.md
 -->

# RFC：ComfyUI 工作台（comfyui-studio）——从「切模型」到「切 comfyui workflow app」

- 状态：Proposal
- 作者：Recut
- 日期：2026-09-24
- 决策范围：`apps/gen-studio` 更名为 `apps/comfyui-studio`（App id `recut.comfyui-studio`）的整体重构；**扩展单位从 model 改为 comfyui workflow app**；`comfyuiapps/<id>/` 自包含目录契约（`manifest.json` / `workflow.py` / `bootstrap.py`）；注册表生成器 `publish_registry.py`；运行器拆分与作者 SDK `comfyui_sdk.py`；`gen.*` → `comfy.*` op / `gen_tasks` → `comfy_tasks` 账本 / catalog 形状 / UI 切换器 / 平台 `contributes.media` 的同步泛化
- 关联：[本地模型本地生成（gen-studio 前身）](./2026-09-23-local-generation-studio.md)、[Modal 云函数（modalapps 姊妹结构）](./2026-09-24-modal-functions.md)、[生成提示词参考引用协议](./2026-09-15-generation-reference-protocol.md)、[媒体生成提案](./2026-09-16-media-generation-proposal.md)、[平台通讯 Op 总线契约](../docs/platform-comms-contract.md)、[App 契约](../docs/app-contract.md)

## 0.0 实施状态（2026-09-24）

- **M0 已完成**：`apps/gen-studio` → `apps/comfyui-studio`；App id `recut.comfyui-studio`；venv `comfyui-studio`；op `gen.*` → `comfy.*`；账本 `comfy_tasks`/`comfy_generations`；内置归档 `comfyui-studio.tar.gz`；skill/README；`service/builtin_apps.go`、`Makefile`、测试同步。**provider id 与平台模型 id 保持 `local-gen` / `local-gen/qwen-image`**（已持久化路由不迁移）。
- **M1 已完成**：新增 `python/comfyui_sdk.py`（`BuildContext` / `BootstrapContext` / `load_app` / `load_workflow`）、`python/publish_registry.py`（生成 `registry.json` / `index.json` 并同步 `contributes.media`）、`python/runtimes.json`；`python/gen_runner.py` → `python/studio_runner.py`；`comfyui_runner.py` 泛化为通用执行器；`comfyuiapps/qwen-image-2.1/{manifest.json,workflow.py,bootstrap.py}`；核心 `bootstrap.py` 逐 app bootstrap + 收尾 `ensure_server`；`generate` 只做幂等 ensure。删除 stale `diffusers_runner.py` / `diffusers.requirements.lock`。
- **M2 已完成**：`comfy.generate { app, params, referenceAssetIds }`（任意 params、`media` 字段、image/video/audio 输出）；UI 工作流切换器（`WorkflowTab.tsx`）、通用表单、`comfy.*` op、store key `comfyui-studio.workflow.form`。
- **M3 已完成**：`publish_registry.py` 生成 `contributes.media`（parameters / referenceFields / exposeModel）；`comfy.generate` 支持 `model`（exposeModel）回退，**兼容既有通用执行桥 `app_media_bridge.go`（无需改桥）**。`service/comfyui_studio_test.go` 通过。
- **M5 已完成（含 audio-studio 子模块）**：service 层不再有任何 per-app 常量/分支——
  - `ContributedMediaProvider` 扩展 `voices`（preset/character 枚举 op）与 `executor`（`inputMap` / `resultIdPath` / `saveKind`），通用执行桥 `app_media_bridge.go` 据此把**图片/视频/语音统一**为一条路径（`runAppProvider`）。
  - **删除 `service/local_speech_bridge.go`**；删除 `media/jobs.go` 的 `provider.ID == "local-audio"` 分支与 `local-audio` 语音默认判断（改为 `Protocol == "local"`）；`MediaService` 退役 `localSpeechExec` / `localVoiceProvider` 专用注入点，改为通用 `localAppExec` + 按 provider 的 `SetLocalVoiceProvider(providerID, …)`。
  - **`apps/audio-studio`（submodule）改为 manifest 声明式**：新增 `contributes.media`（provider `local-audio` + `voices` + `executor`，capability `speech.generate`），`audio.synthesize` 接受原始 `voiceId` 并内部解码 `preset:`/`character:`/`__cosyvoice_default__`。
  - 修复 `media.RegisterAppProviders` 的全局目录污染：维护一份「不含 App 贡献」的基准目录（seed+CDN），注册/注销 App provider 不再丢失同名的种子 provider（如 `local-audio`）。
  - 验证：`go test ./service/...` 全绿（含 `TestLocalAudioRouteConfiguredReadinessAndDefaultVoice`、`TestLocalSpeechDirectRouteRunsWithoutCredential`、`TestComfyUIStudioContributesLocalMediaProvider`）。
- **动态层 `contributes[]` 开放列表 / `ctx.platform.register` 未实施**：manifest `contributes.media` 的静态声明已足以让 service 对 App 零知识（本次目标已达成）；动态注册需新的 App 生命周期（goja 每次调用重跑 background），留作后续 RFC。
- **验证**：`npm run build` + `tsc --noEmit` 零错；`go build ./...` / `go vet ./...` 通过；`go test ./service/...` 仅 `TestRecutJobMCPToolsSupportBatch` 出现与本改动无关的 TempDir 清理偶发失败（单独重跑通过）。

## 0. 白话总结（先看这个）**这件事是：** 现在的「本地生成」App 虽然能跑 ComfyUI，但它的**切换单位是「模型」**——`registry.json` 里一个个 model 条目，而且所有模型共用 `comfyui_runner.py` 里**写死的两个工作流**（`t2i_workflow` / `edit_workflow`）。这既不通用（新工作流必须改核心代码），也不符合 ComfyUI 的本质：**ComfyUI 的价值是「工作流」，不是「模型」**。

**要改成什么：** 把 App 改名 **comfyui-studio**，切换单位改成 **一个 comfyui workflow app**——每个 app 是一个自包含目录 `comfyuiapps/<id>/`，里面三样东西：

```text
comfyuiapps/qwen-image-2.1/
├── manifest.json   # app 元信息 + 表单(form json) + 权重清单 + custom_nodes + 输出类型
├── workflow.py     # 用表单参数动态构建 ComfyUI API 格式工作流（纯函数）
└── bootstrap.py    # 这个 app 的依赖准备（额外 pip / 克隆 custom_nodes）
```

**核心运行环境（ComfyUI 的 venv + 源码）所有 app 共享**；**加一个新能力 = 加一个目录 + 重跑一次注册表生成**，核心代码一行不用改。这跟刚设计的 modal-studio 的 `modalapps/` 是同一套思路（modalapp ↔ comfyuiapp、`modal_app.py` ↔ `workflow.py`、Modal Image ↔ runtime venv、Modal Volume ↔ weights）。

**它长什么样（交互不变，切换器变了）：**

```text
┌───────────────────────────────┬──────────────────────────────────────────┐
│  Left                          │  Right                                    │
│  ┌───────────┬──────────────┐  │   统一的生产预览 + 进度/日志              │
│  │  工作流    │   记录        │  │   ┌────────────────────────────────────┐ │
│  │ ───────── │ ──────────── │  │   │ 任务状态 · 进度条 · 取消 · 查看日志  │ │
│  │ [workflow  │ 环境/下载/生成│  │   ├────────────────────────────────────┤ │
│  │  切换器]   │ 统一任务列表  │  │   │ 生成：图片/视频/音频预览 + 参数      │ │
│  │ ┌───────┐ │ 点击一行 →    │  │   │       [保存入库]                     │ │
│  │ │该工作流│ │ Right 显示    │  │   │ 环境/下载：实时日志 + 就绪度          │ │
│  │ │的表单  │ │ 结果/日志     │  │   └────────────────────────────────────┘ │
│  │ └───────┘ │               │  │                                          │
│  └───────────┴──────────────┘  │                                          │
└───────────────────────────────┴──────────────────────────────────────────┘
```

**几个关键决定：**

1. **切换单位 = workflow app**：顶部不再是「模型切换器」，而是「工作流切换器」；每个工作流自带表单（`manifest.formSchema`）与输出类型（图片/视频/音频）。
2. **扩展 = 加目录**：新增工作流只写 `comfyuiapps/<id>/{manifest.json,workflow.py,bootstrap.py}` + 重跑 `publish_registry.py`；核心运行器不认识任何具体工作流。
3. **一个共享环境**：ComfyUI 的 venv 与源码仍是**一个**（`comfyui` runtime），所有 app 共用；app 的额外依赖由它自己的 `bootstrap.py` 装进这个环境或克隆 custom_nodes。
4. **表单驱动一切**：`generate` 不再有固定字段（prompt/steps/cfg…），而是接受任意 `params` 对象；`workflow.py` 从 `params` 构建图，`manifest.formSchema` 是表单真相。
5. **权重是 app 的子集**：`manifest.weights` 按 `role`（unet/clip/vae/…）声明文件，`workflow.py` 用 `ctx.weight("unet")` 拿到 ComfyUI 认的文件名——不再靠目录前缀猜。
6. **注册表是生成的**：`python/publish_registry.py` 扫 `comfyuiapps/*/manifest.json`，产出 `registry.json` + `comfyuiapps/index.json`，并同步根 `manifest.json` 的 `contributes.media`（与 modal 的 publish_registry 同构）。
7. **行为等价迁移**：M0 先只改名、保持现有 Qwen-Image 功能不变；M1 再把写死的工作流抽成第一个 `comfyuiapp`，验证「抽目录后行为不变」。
8. **引擎随 prepare 起**：`comfy.prepare` 成功 = 环境就绪 **且 ComfyUI 常驻服务已在监听**（不再等第一次生成才懒启动）；进 App 即可直接出图。
9. **UI 与 background 双入口、幂等**：`comfy.engine.start`（UI）与 `comfy.engine.ensure`（background/AI）走同一 `ensure_server`，经探活 + 文件锁保证至多一个实例、并发触发不冲突——**AI 要能操作引擎，不依赖 UI 在场**。
10. **100% 标准 App**：comfyui-studio 不引入任何 service 层专属代码；平台只提供**通用 hook 注册表**，App 经统一 API 注册（详见 §12）——`local_speech_bridge.go` 这类 per-app 桥退役。

**一句话：** 把「本地生成」从「一个 App 切模型」重构为「一个 ComfyUI 工作台切 workflow app」——工作流是自包含目录，核心只做「发现 → 渲染表单 → 构建图 → 提交 → 取回产物」的通用编排，引擎随准备就绪、UI/AI 都能操作。

---

## 0.1 技术摘要

本文设计 `recut.comfyui-studio`（目录 `apps/comfyui-studio`，名称「ComfyUI 工作台 · ComfyUI Studio」）——gen-studio 的重构版本。

- **扩展单位**：`comfyuiapps/<id>/` 自包含目录。`manifest.json`（app meta + `formSchema` + `weights`（按 role）+ `customNodes` + `output` + `exposeModel`）、`workflow.py`（`build(ctx) -> dict`，返回 ComfyUI API 格式图）、`bootstrap.py`（`prepare(ctx)`，额外 pip / 克隆 custom_nodes）。
- **共享运行环境**：仍是一个 `comfyui` runtime venv + 固定 commit 浅克隆的 ComfyUI 源码（`~/.recut/models/comfyui-studio/comfyui/repository`）；app 只是声明与代码，不各自建环境。
- **注册表生成**：`python/publish_registry.py` 扫描 `comfyuiapps/*/manifest.json` → 写 `python/registry.json`（`runtimes` + `apps`）、`comfyuiapps/index.json`（id 列表）、并同步根 `manifest.json` 的 `contributes.media.models[]`（`parameters`/`referenceFields`/`exposeModel`）。
- **运行器拆分**：`python/studio_runner.py`（主 venv 调度：status/catalog/install/generate，把 app 派发到所属 runtime）+ `python/comfyui_runner.py`（通用执行器：status/serve/generate，加载 app manifest、导入 workflow.py、解析权重、提交图、按 output.kind 取回产物）+ `python/comfyui_sdk.py`（稳定作者 SDK：`BuildContext` / `BootstrapContext` / 节点助手）。
- **表单通用化**：`comfy.generate { app, params, referenceAssetIds }`；`params` 是任意表单值对象，落 `comfy_generations.params_json`；`workflow.py` 的 `meta()` 回填尺寸/seed/耗时。UI 表单按 `formSchema` 渲染（含 `media` 字段），预览按 `output.kind` 支持 image/video/audio。
- **平台接线声明式（终态：通用 hook 注册表）**：`contributes.media` 的 provider/模型由 `publish_registry.py` 从 app `exposeModel` 生成；provider id 建议**保持 `local-gen`**（平台级「本地生成」家族，避免已持久化路由迁移），App 展示名改为「ComfyUI 工作台（本机）」。**终态（§12）**：service 不再有 per-app 桥与专用注入点，改为通用 `ContributionRegistry` + hook 种类（`media.provider/executor/readiness/voices/route`），App 经 manifest `contributes[]`（静态）+ `recut.platform.register`（动态）注册；`local_speech_bridge.go` 与 `execute()` 的 `local-audio` 分支退役。
- **引擎生命周期**：`comfy.prepare` 收尾即 `ensure_server`（起或复用 ComfyUI 常驻服务并等就绪）；UI `comfy.engine.start` 与 background/AI `comfy.engine.ensure` 双入口、探活 + 文件锁幂等，`generate` 只做幂等 ensure（详见 §5.5）。
- **改名范围**：目录、App id、venv、op 命名空间（`gen.*` → `comfy.*`）、任务账本（`gen_tasks`/`gen_generations` → `comfy_tasks`/`comfy_generations`）、内置归档嵌入名、skills 目录、模型根目录。
- **第一版兑现**：把现有 Qwen-Image-2.1 文生图/编辑抽成 `comfyuiapps/qwen-image-2.1/`，行为与 gen-studio 等价；随后以「新增一个 app 目录」验证扩展性。

**边界（非目标）**：不新增渲染引擎、不引入 XML/DSL 中间语言、不做节点式/连线式图形编辑器（仍是表单 + workflow.py）、不改平台路由与视频提案门禁、不把产物默认入库、不做多机/分布式、不强制 per-app venv（共享 runtime venv 是默认，冲突问题在风险节讨论）。

---

## 1. 目标与非目标

### 1.1 目标

1. 把 `apps/gen-studio` 更名为 `apps/comfyui-studio`（App id `recut.comfyui-studio`），名称与身份反映「本地 ComfyUI 工作台」。
2. **切换单位从 model 改为 comfyui workflow app**：`comfy.catalog` 返回 apps（工作流），UI 顶部是工作流切换器，每个工作流自带表单。
3. 确立 `comfyuiapps/<id>/` 自包含目录契约：`manifest.json` + `workflow.py` + `bootstrap.py`，**加能力 = 加目录**。
4. **核心与工作流解耦**：`comfyui_runner.py` 不再认识任何具体工作流；`workflow.py` 是唯一的图构建处。
5. **共享 runtime**：一个 `comfyui` venv/源码服务所有 app；app 依赖经各自 `bootstrap.py` 落到共享环境。
6. **注册表生成化**：`publish_registry.py` 从 app manifest 生成注册表与平台 `contributes.media`，人工不再手改注册表。
7. **表单通用化**：`generate` 接受任意 `params`；支持 `media` 字段与 image/video/audio 输出。
8. **行为等价迁移**：M0 改名不改功能；M1 抽出第一个 app 后与旧版逐项等价。
9. **平台接线最小改动**：保持 manifest 驱动的通用执行桥；provider id 稳定（`local-gen`），仅泛化输入透传与展示名。
10. **可扩展验证**：新增第二个 app 只需目录 + 重跑生成器，零核心改动。
11. **引擎随准备就绪**：`comfy.prepare` 成功即 ComfyUI 常驻服务已监听；UI 与 background（AI）双入口幂等启动，互不冲突。
12. **App 100% 标准**：service 只提供通用 hook 注册表，App 经统一 API 注册贡献；无 per-app 常量/分支/测试（§12）。

### 1.2 非目标

- 不做节点式图形编辑器（可视化连图）；作者写 `workflow.py`，用户填表单。
- 不做多 workflow/单 app（一个 app = 一个 `workflow.py` = 一个表单 = 一个平台模型）；多工作流留作后续（可再拆目录）。
- 不强制 per-app 隔离 venv（共享 runtime venv 默认；依赖冲突留待未来「多 runtime」条目）。
- 不改平台路由语义、提案/确认门禁；`contributes.media` 演进为通用 `contributes[]` 时保留一个版本的兼容映射（§12），不改变 `protocol`（`local`/`app`）语义。
- 不改既有生成提示词参考引用协议、能力桥授权/审计契约。
- 不迁移历史数据（本地生成产物/记录；重命名后视为全新账本，旧目录不清理但不再读取）。

---

## 2. 总体架构（前后对比）

### 2.1 现在（gen-studio：切模型，工作流写死）

```text
comfy.catalog ──► registry.models[]（qwen-image, …）
                      │  每个 model 有 formSchema，但——
                      ▼
comfy.generate { model: "qwen-image", prompt, steps, cfg, … }  ← 固定字段
                      ▼
python/gen_runner.py generate --model qwen-image …
                      ▼  派发到 comfyui runtime venv
python/comfyui_runner.py  ← 写死 t2i_workflow() / edit_workflow()
                      ▼
                  ComfyUI /prompt
```

痛点：`workflow.py` 不存在——工作流写死在 `comfyui_runner.py`；新增工作流必须改核心；`generate` 字段写死；模型文件名靠目录前缀猜。

### 2.2 目标（comfyui-studio：切 workflow app，工作流在目录里）

```text
comfy.catalog ──► registry.apps[]（qwen-image-2.1, …，由 publish_registry 生成）
                      │  每个 app 有 formSchema + output.kind
                      ▼
comfy.generate { app: "qwen-image-2.1", params: {...}, referenceAssetIds: [...] }  ← 通用
                      ▼
python/studio_runner.py generate --app qwen-image-2.1 --params params.json
                      ▼  派发到共享 comfyui runtime venv
python/comfyui_runner.py  ← 通用执行器，不认识任何工作流
        │  load_app(comfyuiapps/qwen-image-2.1)
        │  import workflow.py ; graph = workflow.build(ctx)
        ▼
    ComfyUI /prompt  ──►  按 manifest.output.kind 取回 image/video/audio
```

与 gen-studio 的映射关系：

| gen-studio | comfyui-studio | 说明 |
|---|---|---|
| `registry.models[].id` | `comfyuiapps/<id>/` 目录 | 扩展单位从条目变目录 |
| model（权重） | app 的 `manifest.weights` | 权重是 app 的子集 |
| `comfyui_runner.t2i_workflow/edit_workflow` | `comfyuiapps/<id>/workflow.py` | 工作流从核心移入 app |
| —（无） | `comfyuiapps/<id>/bootstrap.py` | app 级依赖准备 |
| `comfy.prepare` 只建 runtime | `comfy.prepare` 建 runtime + 跑各 app bootstrap | 新增 app 依赖准备 |
| `gen.catalog.models[]` | `comfy.catalog.apps[]` | 切换单位改名 |
| `gen.generate {model, 固定字段}` | `comfy.generate {app, params}` | 输入通用化 |
| `gen_tasks` / `gen_generations` | `comfy_tasks` / `comfy_generations` | 账本改名 |
| provider `local-gen` | provider `local-gen`（展示名改「ComfyUI 工作台」） | provider id 稳定 |
| runtime `comfyui` | runtime `comfyui`（不变） | 共享环境不变 |

> **与 modal-studio 的姊妹关系**：modalapp ↔ comfyuiapp、`modal_app.py` ↔ `workflow.py`、Modal Image ↔ comfyui runtime venv、Modal Volume ↔ weights、`publish_registry.py` 两边同构。差异：comfyui-studio 的 runtime 在**本机且共享**（一个 ComfyUI 服务多工作流），modal-studio 的每个 modalapp 有自己的云端 Image/Volume。

---

## 3. 重命名与迁移（gen-studio → comfyui-studio）

### 3.1 命名对照表

| 维度 | 旧 | 新 | 迁移动作 |
|---|---|---|---|
| 目录 | `apps/gen-studio` | `apps/comfyui-studio` | `git mv` |
| App id | `recut.gen-studio` | `recut.comfyui-studio` | manifest + `builtin_apps.go` + 测试 |
| 展示名 | 本地生成 · Generation Studio | ComfyUI 工作台 · ComfyUI Studio | manifest `name`/`localized` |
| 主 venv | `gen-studio` | `comfyui-studio` | manifest `runtime.python.venv` |
| runtime venv | `<fp>-comfyui` | 不变 | — |
| 模型根目录 | `~/.recut/models/gen-studio/` | `~/.recut/models/comfyui-studio/` | 代码常量（旧目录不清理） |
| op 命名空间 | `gen.*` | `comfy.*` | background/UI/manifest/SKILL |
| 任务账本 | `gen_tasks` / `gen_generations` | `comfy_tasks` / `comfy_generations` | background SQL |
| 内置归档 | `builtin_apps/gen-studio.tar.gz` | `builtin_apps/comfyui-studio.tar.gz` | Makefile + `builtin_apps.go` |
| 打包变量 | `embeddedGenStudio` | `embeddedComfyUIStudio` | `builtin_apps.go` |
| skill | `skills/gen-studio/` | `skills/comfyui-studio/` | `git mv` |
| provider id | `local-gen` | `local-gen`（**保持**） | 仅展示名改「ComfyUI 工作台（本机）」 |
| 平台模型 id | `local-gen/qwen-image` | `local-gen/qwen-image`（**保持**） | `exposeModel` 不变，路由不迁移 |

### 3.2 决策：provider id 与平台模型 id 保持 `local-gen`

**理由**：`local-gen` 是平台层「本地生成 provider 家族」的槽位（`Protocol=="local"`），不是某个实现的私有名；已持久化的 `image.generate.default = local-gen/<model>` 路由不应因 App 改名而失效。App 改名后，实现该 provider 的 App 变为 `recut.comfyui-studio`，展示名更新即可。若未来引入第二种本地后端（如 MLX），它们可各自贡献 provider 或共用 `local-gen`（届时另议）。

> 备选（不推荐）：把 provider 改为 `local-comfyui`。需要平台侧迁移所有 `local-gen/*` 持久化路由，收益仅为命名清晰，风险不对称。

### 3.3 op 命名空间 `gen.*` → `comfy.*`

op 名只影响 App 内部（background/UI/SKILL）与 manifest 里 `contributes.media.operations` 的映射值；平台执行桥按 manifest 读取，无 per-app Go 代码，故改名安全。

| 旧 op | 新 op |
|---|---|
| `gen.status` | `comfy.status` |
| `gen.catalog` | `comfy.catalog` |
| `gen.prepare` | `comfy.prepare` |
| `gen.engine.status/start/stop` | `comfy.engine.status/start/stop` |
| `gen.settings.set` | `comfy.settings.set` |
| `gen.install` | `comfy.install` |
| `gen.generate` | `comfy.generate` |
| `gen.generations` / `gen.generation.complete` / `gen.save` | `comfy.generations` / `comfy.generation.complete` / `comfy.save` |
| `gen.cancel` / `gen.job` / `gen.resolve` | `comfy.cancel` / `comfy.job` / `comfy.resolve` |
| `gen.tasks.list` / `gen.task.get` / `gen.task.params` / `gen.task.logs` / `gen.task.cancel` | `comfy.tasks.list` / `comfy.task.get` / `comfy.task.params` / `comfy.task.logs` / `comfy.task.cancel` |

### 3.4 MCP 工具名

平台的 MCP 工具面（`recut.*`）不变；App 的 capability op 只是被桥调用。`SKILL.md` 里的 `gen.catalog` 引用改为 `comfy.catalog`。

---

## 4. comfyuiapp 包模型（核心）

### 4.1 目录结构

```text
apps/comfyui-studio/
├── manifest.json                    # 身份/入口/权限/runtime.python/contributes.media(生成)/operations
├── background.js                    # 唯一业务后端：comfy_tasks 账本 + 队列 + 能力 op
├── bootstrap.py                     # 主环境准备：comfyui runtime venv + 克隆 ComfyUI + 逐 app 调 bootstrap.py
├── python/
│   ├── studio_runner.py             # 主 venv 调度器：status/catalog/install/generate（按 app 派发 runtime）
│   ├── comfyui_runner.py            # 通用执行器：status/serve/generate（加载 app、构建图、提交、取回）
│   ├── comfyui_sdk.py               # 作者 SDK：BuildContext / BootstrapContext / 节点助手（稳定契约）
│   ├── publish_registry.py          # 扫描 comfyuiapps/*/manifest.json → registry.json / index.json / contributes.media
│   ├── requirements.lock            # 主 venv 锁定依赖（轻量：huggingface_hub / modelscope 等）
│   ├── comfyui.requirements.lock    # comfyui runtime 锁定依赖（torch/ComfyUI 等）
│   └── registry.json                # 【生成物】runtimes + apps
├── comfyuiapps/
│   ├── index.json                   # 【生成物】app id 列表（供 background 无需目录遍历即可枚举）
│   ├── qwen-image-2.1/
│   │   ├── manifest.json            # app meta + form json + weights(role) + customNodes + output
│   │   ├── workflow.py              # build(ctx) -> ComfyUI API graph
│   │   └── bootstrap.py             # prepare(ctx)（本 app 无额外依赖时可为空实现）
│   └── <new-app>/                   # 加能力 = 加这个目录 + 重跑 publish_registry
├── ui/                              # React + Vite：Left 两 Tab + Right 统一预览/日志
│   └── src/components/WorkflowTab.tsx  # 工作流切换器 + 表单（formSchema 驱动）
├── skills/comfyui-studio/SKILL.md
├── README.md / README.en.md
└── rfc/                             # App 自身演进 RFC（可选）
```

### 4.2 `comfyuiapps/<id>/manifest.json`（单一信息源）

```json
{
  "id": "qwen-image-2.1",
  "name": { "zh": "Qwen-Image-2.1 文生图/编辑", "en": "Qwen-Image-2.1 t2i/edit" },
  "capability": "image.generate",
  "runtime": "comfyui",
  "exposeModel": "qwen-image",
  "output": { "kind": "image", "mimeType": "image/png", "ext": "png" },
  "weights": {
    "huggingFace": "Comfy-Org/Qwen-Image-2.1",
    "modelScope": "Comfy-Org/Qwen-Image-2.1",
    "revision": "main",
    "sizeGb": 17,
    "files": [
      { "role": "unet", "path": "diffusion_models/qwen_image_2.1_int8_convrot.safetensors" },
      { "role": "clip", "path": "text_encoders/qwen3vl_8b_int8_convrot.safetensors" },
      { "role": "vae",  "path": "vae/qwen_image_2.1_vae_bf16.safetensors" }
    ]
  },
  "customNodes": [],
  "formSchema": [
    { "key": "prompt", "type": "textarea", "required": true, "label": { "zh": "提示词", "en": "Prompt" } },
    { "key": "negativePrompt", "type": "textarea", "label": { "zh": "负向词", "en": "Negative prompt" } },
    { "key": "references", "type": "media", "kind": "image", "multiple": true, "label": { "zh": "参考图", "en": "References" } },
    { "key": "aspectRatio", "type": "select", "options": ["1:1", "16:9", "9:16", "4:3", "3:4"], "default": "1:1" },
    { "key": "steps", "type": "number", "default": 10, "min": 1, "max": 100 },
    { "key": "cfg", "type": "number", "default": 1.0, "min": 0, "max": 20 },
    { "key": "seed", "type": "number", "default": -1 }
  ],
  "defaultParams": { "aspectRatio": "1:1", "steps": 10, "cfg": 1.0, "negativePrompt": " " }
}
```

字段说明：

- **`id`**：简单名，目录名一致，也是 App 内 `app` 参数值。
- **`name`**：双语展示名（复用既有 `LocalLabel` 形状）。
- **`capability`**：平台媒体能力（`image.generate` / `video.generate` / …）。
- **`runtime`**：缺省 `comfyui`；预留未来多 runtime（当前所有 app 共享 comfyui）。
- **`exposeModel`**：接入平台路由时的模型简单名 → 平台 id `local-gen/<exposeModel>`；不写则仅 App UI 可用。
- **`output`**：`kind` ∈ `image|video|audio`，决定取回方式与预览类型、`comfy.save` 的 `kind`。
- **`weights.files[].role`**：`workflow.py` 用 `ctx.weight("unet")` 取 ComfyUI 文件名；不再靠目录前缀猜。`path` 同时是下载白名单与 ComfyUI `models/` 下的相对路径。
- **`customNodes`**：`[{ "repository": "...", "revision": "<sha>" }]`，由 `bootstrap.py` 或核心统一克隆到 `ComfyUI/custom_nodes/`（也可在 `bootstrap.py` 里自行 `ctx.clone_custom_node`）。
- **`formSchema`**：表单真相；类型 `textarea|text|number|select|boolean|media`。`media` 字段对应参考素材（走 `referenceAssetIds`，见 §6.2）。
- **`defaultParams`**：表单默认值（`formSchema[].default` 亦可）。

### 4.3 `comfyuiapps/<id>/workflow.py`（动态构建工作流）

`workflow.py` 必须定义 `build(ctx) -> dict`（ComfyUI **API 格式** prompt 图：`node_id -> {class_type, inputs}`），可选 `meta(ctx, graph) -> dict`。它是**纯函数**：输入 `ctx`，输出图，无副作用、可单测。

```python
# comfyuiapps/qwen-image-2.1/workflow.py
from comfyui_sdk import BuildContext


def build(ctx: BuildContext) -> dict:
    unet = ctx.weight("unet")     # 已校验存在的 ComfyUI 文件名
    clip = ctx.weight("clip")
    vae = ctx.weight("vae")
    width, height = ctx.size(default=(1024, 1024))   # 由 aspectRatio 推导
    refs = ctx.references()      # 已复制进 ComfyUI/input 的图片文件名列表

    graph = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": unet, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": clip, "type": "qwen_image", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": vae}},
        "4": {"class_type": "TextEncodeQwenImage21", "inputs": {
            "clip": ["2", 0], "vae": ["3", 0],
            "prompt": ctx.param("prompt", ""), "negative_prompt": ctx.param("negativePrompt", " "),
            "resolution": 1024}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "6": {"class_type": "KSampler", "inputs": {
            "model": ["1", 0], "positive": ["4", 0], "negative": ["4", 1], "latent_image": ["5", 0],
            "seed": ctx.seed(), "steps": ctx.param("steps", 10), "cfg": ctx.param("cfg", 1.0),
            "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "7": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["3", 0]}},
        "8": {"class_type": "SaveImage", "inputs": {"images": ["7", 0], "filename_prefix": "qwen_image_2.1"}},
    }
    # 编辑模式：把参考图接进 TextEncodeQwenImage21，并用其 latent 输出
    for index, name in enumerate(refs, start=1):
        node_id = str(100 + index)
        graph[node_id] = {"class_type": "LoadImage", "inputs": {"image": name, "upload": "image"}}
        graph["4"]["inputs"][f"images.image_{index}"] = [node_id, 0]
    if refs:
        graph["6"]["inputs"]["latent_image"] = ["4", 2]
    return graph


def meta(ctx: BuildContext, graph: dict) -> dict:
    width, height = ctx.size(default=(1024, 1024))
    return {"width": width, "height": height, "seed": ctx.seed(), "steps": ctx.param("steps", 10)}
```

**`BuildContext`（`comfyui_sdk.py` 提供）**：

| 成员 | 说明 |
|---|---|
| `ctx.params` | 表单值字典（已按 `formSchema` 类型转换：number→float/int、boolean→bool） |
| `ctx.param(key, default=None)` | 带默认值的取值 |
| `ctx.weights` / `ctx.weight(role)` | role → ComfyUI 文件名；缺角色时 `ctx.weight` 抛结构化错误（缺权重提示） |
| `ctx.references()` | 已复制进 `ComfyUI/input/` 的参考图文件名列表（顺序同 `referenceAssetIds`） |
| `ctx.size(default)` | 由 `aspectRatio` 参数推导 `(w, h)`（32 倍数；缺省走 `default`） |
| `ctx.seed()` | `seed` 参数：`-1`/空 → 随机；否则整数 |
| `ctx.output` | 输出路径（不含扩展名）；由 runner 注入 |
| `ctx.node(class_type, **inputs)` | 便捷构造 `{"class_type":..., "inputs":...}`（可选糖） |

### 4.4 `comfyuiapps/<id>/bootstrap.py`（app 级依赖准备）

`bootstrap.py` 必须定义 `prepare(ctx) -> None`（可为空实现）。它在 **comfyui runtime venv** 语境下执行（由核心 `bootstrap.py` 在 runtime 就绪后逐 app 调用），用于装额外 pip 依赖、克隆 custom_nodes、生成 app 需要的资源。

```python
# comfyuiapps/<id>/bootstrap.py
from comfyui_sdk import BootstrapContext


def prepare(ctx: BootstrapContext) -> None:
    # 额外 pip 依赖（装进 comfyui runtime venv）
    # ctx.pip_install(["sageattention==2.*"])
    # 固定 commit 克隆 custom_nodes
    # ctx.clone_custom_node("https://github.com/kijai/ComfyUI-KJNodes", "<pinned-sha>")
    return None
```

**`BootstrapContext`（`comfyui_sdk.py` 提供）**：

| 成员 | 说明 |
|---|---|
| `ctx.pip_install(requirements: list[str])` | 在 runtime venv 里 `pip install`（幂等，带任务日志 tee） |
| `ctx.clone_custom_node(repo, revision)` | 按固定 commit 浅克隆到 `ComfyUI/custom_nodes/<name>`（已存在则 fetch/checkout） |
| `ctx.comfyui_dir` / `ctx.models_dir` / `ctx.python` | 路径与解释器 |
| `ctx.task_log(msg)` | 写任务日志（`tasks/<id>.log`） |

> **权重不由 bootstrap 下载**：权重是 `comfy.install { app, source }` 的职责（逐文件断点续传 + 完成标记）。`bootstrap.py` 只处理**代码/依赖**，与 gen-studio 的「prepare 建环境、install 下权重」分离原则一致。
>
> **引擎不归 app bootstrap 管**：app 的 `prepare(ctx)` 只在 runtime venv 内准备代码/依赖（可假定 runtime 已就绪）；ComfyUI 常驻服务的启动由**核心** `bootstrap.py` 在全部 app bootstrap 之后统一 `ensure_server`（见 §5.4 / §5.5），保证「进入 App 即引擎可用」。

---

## 5. 注册表生成与运行器

### 5.1 `python/publish_registry.py`（生成物）

单一信息源是 `comfyuiapps/*/manifest.json`；生成器产出三样：

1. **`python/registry.json`**：
   ```json
   {
     "runtimes": [{ "id": "comfyui", "label": {...}, "venv": "comfyui",
                    "runner": "python/comfyui_runner.py",
                    "requirements": "python/comfyui.requirements.lock",
                    "repository": "https://github.com/comfyanonymous/ComfyUI",
                    "revision": "<pinned-sha>" }],
     "apps": [{ "id": "qwen-image-2.1", "name": {...}, "capability": "image.generate",
                "runtime": "comfyui", "exposeModel": "qwen-image",
                "output": {...}, "formSchema": [...], "defaultParams": {...},
                "weights": { "sizeGb": 17 } }]
   }
   ```
2. **`comfyuiapps/index.json`**：`["qwen-image-2.1", ...]`（background 只读文件、不遍历目录）。
3. **根 `manifest.json` 的 `contributes.media.models[]`**：按 `exposeModel` 生成，`parameters` 由非 `media` 字段映射（§6.3），`referenceFields` 由 `media` 字段映射。

**运行时机**：`make builtin-apps` 前先跑（与 modal-studio 同构）；开发期软链接需手动或经 make 目标重跑。`background.js` 保留极简 `REGISTRY_FALLBACK`（照 gen-studio 做法），供生成物缺失时兜底。

### 5.2 `python/studio_runner.py`（主 venv 调度，替代 gen_runner.py）

职责不变，只是对象从 model 变 app：

```text
status                       # 各 runtime venv 就绪度 + 各 app 权重就绪度（扫 registry.apps）
catalog                      # 同 status 的 app 面
install --app <id> --source  # 按 manifest.weights 白名单下载（role/path 不再是前缀猜测）
generate --app <id> --params params.json --output ... --reference ...
                             # 解析 app.runtime → 派发到该 runtime venv 的 comfyui_runner.py
```

### 5.3 `python/comfyui_runner.py`（通用执行器，不再认识具体工作流）

```text
status                       # torch + ComfyUI 源码自检
serve --port                 # 启动/复用 ComfyUI 常驻服务
generate --app <id> --params <file> --output <path> [--reference ...]
    1. load_app(app_dir)           # 读 manifest.json
    2. resolve_weights(manifest)   # role -> 文件名；校验存在
    3. copy_references(...)        # 参考图复制进 ComfyUI/input
    4. import workflow.py ; graph = workflow.build(ctx)
    5. ensure_server(port) ; queue_and_wait(graph)
    6. harvest by manifest.output.kind  → <output>.<ext>
    7. write <output>.meta.json（workflow.meta() ∪ 运行元数据）
```

- **工作流加载**：`comfyui_sdk.load_app(app_dir)` 用 `importlib` 把 `workflow.py` 以稳定模块名导入（同进程，故可用 runtime venv 里的依赖）。
- **产物取回**：按 `manifest.output.kind` 从 ComfyUI `outputs` 里选对应产物（`images` / `gifs` / `audio` / `videos`，或 manifest 指定输出节点）；`image` → `/view` 取 PNG；视频/音频同理。`output.ext` 决定落盘扩展名。
- **meta**：`workflow.meta()` 的返回与 runner 的 `duration`/`references` 合并，写 `<output>.meta.json`，供 `comfy.generation.complete` 回填（同 gen-studio `applyGenerationMeta`）。

### 5.4 `python/bootstrap.py`（核心，替代原 bootstrap.py）

```text
1. 为 runtime 建专属 venv（comfyui-studio-<runtime>）+ 克隆固定 commit 源码 + 装 comfyui.requirements.lock
2. 逐 app 调用 comfyuiapps/<id>/bootstrap.py 的 prepare(ctx)（额外 pip / custom_nodes）
3. 逐 app 调用其 runner status 自检
4. ensure_server(port)：启动或复用 ComfyUI 常驻服务并等待 /system_stats 就绪，写 server.pid
--target all | comfyui | <appId>
```

`--target <appId>` 时只跑该 app 的 `bootstrap.py`（runtime 已就绪则跳过重装）。**第 4 步是硬约定**：`comfy.prepare` 的终态 = 环境就绪 + 引擎在监听（见 §5.5）。

### 5.5 ComfyUI 引擎生命周期：随 prepare 起、UI/background 双入口、幂等

> **决策：`comfy.prepare` 成功即代表 ComfyUI 常驻服务已就绪**（不是等到第一次 generate 才懒启动）；引擎启动与 UI 解耦，UI 与 background（AI）都能触发，且并发触发互不冲突——**AI 必须能操作引擎，不依赖 UI 在场**。

- **prepare 收尾 ensure**：核心 `bootstrap.py` 在第 4 步调用 `ensure_server(port)` 起/复用服务并等就绪；UI 的 Setup 门因此从「装环境」升级为「装环境 + 起引擎」，进入 App 即可直接生成。
- **幂等（单实例）**：`ensure_server` 先探活 `http://127.0.0.1:<port>/system_stats`；已在监听 → 直接复用，不拉起第二个进程。`server.pid` + 探活 + `server.lock`（文件锁）共同保证「至多一个常驻实例」。
- **双入口，同一实现**：
  - **UI**：`comfy.engine.start`（异步 shell job，返回 `{job, taskId}`，UI 观察）。
  - **background / AI**：`comfy.engine.ensure`（capability op，`api+mcp+capability`，语义同步：已在监听 → 立即返回 `{running:true, reused:true}`；否则内部提交启动任务并等待就绪后返回）。AI 经能力桥或直接 `recut` 工具调用即可操作引擎。
  - 两者都调用同一 `ensure_server`；并发时由 `server.lock` 串行化，后到者探活命中即复用。
- **generate 只做幂等 ensure**：`comfyui_runner.py generate` 第 5 步的 `ensure_server` 通常直接命中 prepare 起的实例；即使用户手动 stop 过，也会就地 ensure，保持健壮。
- **stop 语义**：`comfy.engine.stop` 仍按 PID 终止进程组；引擎是「按需常驻」而非永久守护——手动 stop 后，下一次 prepare 或 generate 会重新 ensure。
- **平台无感**：引擎是 App 私有能力（App 的 shell job + HTTP 探活），不进入平台 provider 契约；`comfy.engine.status` 仍返回 `{running, port, pid}`。

---

## 6. 表单、生成与平台映射

### 6.1 表单 schema（`formSchema`）

沿用 gen-studio/ modal 的字段类型，新增 `media`/`boolean`：

| type | UI 控件 | 平台 `MediaParameter` | 说明 |
|---|---|---|---|
| `textarea` / `text` | 文本/多行 | `{name, type:"string"}` | 提示词等 |
| `number` | 数字 | `{name, type:"number", min, max, default}` | steps/seed/cfg |
| `select` | 下拉 | `{name, type:"string", enum:[...]}` | 画幅/采样器 |
| `boolean` | 开关 | `{name, type:"boolean"}` | 开关 |
| `media` | 素材选择器 | 不进 `parameters`，进 `referenceFields` | 参考图/视频/音频 |

### 6.2 `comfy.generate` 输入通用化

```json
{
  "app": "qwen-image-2.1",
  "params": { "prompt": "a cat", "aspectRatio": "1:1", "steps": 10, "cfg": 1.0, "seed": -1 },
  "referenceAssetIds": ["<assetId>", "..."],
  "origin": "ai",
  "submittedBy": "..."
}
```

- `params` 是**任意**表单值对象；background 按 `manifest.formSchema` 做类型转换后透传给 runner。
- `media` 字段的值不放在 `params`，统一经 `referenceAssetIds`（顺序即字段在 `formSchema` 中的顺序）；background 在提交前 `ctx.media.materialize` 得到本地路径。
- **平台桥兼容**：桥仍按固定 output 键（`aspectRatio/seed/...`）调用时，background 把顶层已知键**归并进 `params`**（兼容层），并对新键（如 `durationSec`）直通；同时桥侧按 §6.3 生成的 `parameters` 泛化透传。

### 6.3 `contributes.media` 生成（平台模型面）

`publish_registry.py` 为每个带 `exposeModel` 的 app 生成：

```json
{
  "id": "qwen-image", "name": "Qwen-Image-2.1 · 本机", "capability": "image.generate",
  "runtime": "comfyui", "sizeGb": 17, "inputModes": ["text", "image"],
  "parameters": [ /* formSchema 非 media 字段映射 */ ],
  "referenceFields": [{ "field": "references", "role": "image", "multiple": true }],
  "weights": { "huggingFace": "...", "modelScope": "...", "revision": "main" }
}
```

- 平台模型 id 仍为 `local-gen/<exposeModel>`（provider 保持 `local-gen`）。
- **终态（§12）**：`contributes.media` 收敛为通用 hook 注册表的一种 kind（`media.provider` + `media.executor` + `media.readiness`）；`service/app_media_bridge.go` 的固定输入键枚举改为 App 声明的 `inputMap`，`local_speech_bridge.go` 与 `execute()` 的 `local-audio` 分支退役。M3 先做「固定键 + `params` 归并」的兼容层，M5 切到 hook 注册表。
- **不再有 per-app 测试**：`service/gen_studio_test.go` 退化为通用契约测试（fixture App 验证「注册 provider → 目录可解析 → 执行 → 落 Asset」），不绑定 `recut.comfyui-studio` 或 `local-gen` 常量（详见 §12.6）。

---

## 7. UI 改动

| 组件/文件 | 改动 |
|---|---|
| `App.tsx` | `APP_ID = "recut.comfyui-studio"`；op 名 `gen.*`→`comfy.*`；`catalog.models`→`catalog.apps`；默认路由写入仍用 `local-gen/${exposeModel}` |
| `GenerateTab.tsx` → `WorkflowTab.tsx` | 顶部「工作流切换器」（app 列表）；表单按 `formSchema` 渲染（新增 `media`/`boolean`）；依赖块用 `app.weights`/`runtime`；提交 `{app, params, referenceAssetIds}` |
| `state/generate.ts` | `modelId`→`appId`；persist key `comfyui-studio.workflow.form` |
| `PreviewPane.tsx` | 按 `output.kind` 渲染 image/video/audio；`comfy.save { kind }` |
| `Setup.tsx` | 文案从「模型」改「工作流/依赖」；自动 `comfy.prepare { target:"all" }`，终态含「引擎已就绪」（§5.5） |
| `EngineControl.tsx` | 引擎随 `comfy.prepare` 自动起，UI 改为「状态 + 停止/重启」；`comfy.engine.start` 与 AI 的 `comfy.engine.ensure` 共用幂等实现（§5.5） |
| `types.ts` | `CatalogModel`→`CatalogApp`（+`output`/`exposeModel`）；`Generation` 支持视频/音频字段 |
| `i18n.ts` | 键名与文案（`generate.model`→`workflow.select` 等） |

---

## 8. 契约改动清单（文件级）

| 文件 | 改动 |
|---|---|
| `apps/gen-studio/**` → `apps/comfyui-studio/**` | 目录改名；新增 `comfyuiapps/`、`python/{studio_runner,comfyui_sdk,publish_registry}.py`；`comfyui_runner.py` 去具体工作流化 |
| `apps/comfyui-studio/manifest.json` | id/name/venv/operations(`comfy.*`)/contributes.media（生成物）；内置打包规则在 `service/builtin_apps/apps.json` |
| `apps/comfyui-studio/background.js` | 读 registry.apps；`comfy_*` 表；catalog 形状；generate 通用 params；install/prepare 按 app |
| `apps/comfyui-studio/python/comfyui_sdk.py` | **新增**：`BuildContext`/`BootstrapContext`/`load_app`（稳定作者契约） |
| `apps/comfyui-studio/python/publish_registry.py` | **新增**：扫描生成 registry/index/contributes.media |
| `apps/comfyui-studio/comfyuiapps/qwen-image-2.1/{manifest.json,workflow.py,bootstrap.py}` | **新增**：把写死工作流迁入 |
| `apps/comfyui-studio/skills/comfyui-studio/SKILL.md` | 改名 + op/概念更新 |
| `apps/comfyui-studio/README.md` | 改名 + 目录/工作流作者指南 |
| `service/builtin_apps/apps.json` | 加一条 `{package:"comfyui-studio", source, appId, include, exclude, prep}`（唯一内置清单，Go 侧目录 embed 自动生效） |
| `Makefile` | 无需改动：`builtin-apps` 读 apps.json，`prep` 字段自动跑 `publish_registry.py` |
| `apps/comfyui-studio/python/{studio_runner,comfyui_runner}.py` | `generate` 只做幂等 `ensure_server`；核心 `bootstrap.py` 收尾 `ensure_server`（§5.5） |
| `apps/comfyui-studio/manifest.json`（operations） | 新增 `comfy.engine.ensure`（`api+mcp+capability`，AI/background 入口） |
| `service/builtin_apps/apps.json` | 加一条 `{package:"comfyui-studio", source, appId, include, exclude, prep}`（唯一内置清单，Go 侧目录 embed 自动生效） |
| `Makefile` | 无需改动：`builtin-apps` 读 apps.json，`prep` 字段自动跑 `publish_registry.py` |
| `service/gen_studio_test.go` → `comfyui_studio_test.go` | 退化为通用契约测试（fixture App，不绑定真实 App id） |
| `service/app_media_bridge.go` | 输入映射改由 App `inputMap` 声明；M5 并入通用 hook 注册表 |
| **`service/media/service.go`** | 退役 `localSpeechExec`/`localVoiceProvider`/`localModelProvider` 三个专用注入点（§12） |
| **`service/local_speech_bridge.go`** | **删除**（per-app 桥）；audio-studio 经新 API 注册 `media.executor`/`media.voices`（§12） |
| **`service/media/jobs.go` `execute()`** | 删除 `provider.ID == "local-audio"` 分支；统一走注册表 executor（§12） |
| **新增 `service/contributions.go`** | 通用 `ContributionRegistry` + hook 种类 + `wireAppContributions`（§12） |
| **`service/media/{app_providers,capability_models,catalog}.go`** | 读注册表（provider/readiness/route hook），去掉单一 `localModelProvider` 与 `local-audio`/`local-gen` 硬编码（§12） |
| **`service/runtime.go`** | 新增 `recut.platform.register`（background 动态注册 hook 描述符）（§12） |
| `docs/app-contract.md` | 新增 `contributes[]` 开放列表 + `recut.platform.register` + hook 种类权威定义；`contributes.media` 标注为兼容映射 |
| `rfc/README.md` | 新增本 RFC 条目 |

---

## 9. 里程碑

### M0 — 纯改名（行为等价）
- `git mv apps/gen-studio apps/comfyui-studio`；改 App id、venv、`comfy.*` op、`comfy_*` 账本、内置归档嵌入名、skill/README 文案。
- 保持 `registry.json`（旧 runtimes+models）与写死工作流不动，功能与旧版逐项等价。
- 验收：App 安装、catalog、prepare、install、generate、save 全链路通过；`service/comfyui_studio_test.go` 绿。

### M1 — 抽出第一个 comfyuiapp（核心解耦 + 引擎随 prepare 起）
- 新增 `comfyui_sdk.py`、`publish_registry.py`；新增 `comfyuiapps/qwen-image-2.1/{manifest.json,workflow.py,bootstrap.py}`；`comfyui_runner.py` 改为通用执行器。
- `registry.json` 改由生成器产出；background 读 `apps`。
- 核心 `bootstrap.py` 收尾 `ensure_server`；新增 `comfy.engine.ensure` op；`generate` 只做幂等 ensure。
- 验收：Qwen-Image 文生图与参考图编辑结果与 M0 一致；**prepare 完成后 `comfy.engine.status.running == true`**，UI 与 `comfy.engine.ensure` 并发触发只产生一个实例；删除 `comfyuiapps/qwen-image-2.1/` 后 catalog 不再出现该 app，核心无需改动。

### M2 — 表单通用化与 UI
- `comfy.generate { app, params }`；`media` 字段；image/video/audio 输出与预览；工作流切换器与 store 改名。
- 验收：任意 `formSchema`（含 media/boolean）可渲染并提交；params 落库与 meta 回填正确。

### M3 — 平台接线泛化
- `publish_registry.py` 同步 `contributes.media`（parameters/referenceFields/exposeModel）；桥泛化 params 透传；provider 展示名改「ComfyUI 工作台（本机）」；`docs/app-contract.md` 同步。
- 验收：`recut.image.generate { modelId:"local-gen/qwen-image" }` 端到端出图；`recut.media.list_capability_models` 聚合本地 app；默认路由不迁移仍有效。

### M4 — 扩展性验证 + 作者指南
- 新增第二个 app（建议一个视频工作流或一个图片编辑工作流）仅加目录 + 重跑生成器。
- 写 `comfyuiapps/README.md`（作者指南：manifest/workflow.py/bootstrap.py/SDK/调试）。
- 验收：新增 app 零核心改动即可在 UI 出现、准备依赖、下载权重、生成入库。

### M5 — 平台插件/钩子契约（去 per-app service 代码）
- 新增 `service/contributions.go`（`ContributionRegistry` + hook 种类）与 `ctx.platform.register`；`contributes[]` 开放列表上线。
- audio-studio 与 comfyui-studio 改为经 hook 注册 `media.executor`/`readiness`/`voices`；删除 `local_speech_bridge.go`、`execute()` 的 `local-audio` 分支与三个专用 setter；per-app 测试退化为通用契约测试。
- 验收：service 全量 grep 无 `audioStudioAppID`/`local-audio`/`local-gen`/`gen-studio` 硬编码；卸载 comfyui-studio 后 service 行为不变（仅目录少 provider）；`go test ./service/...` 全绿。

---

## 10. 验收口径

- **行为等价**：M0/M1 后，同一 prompt/参数在旧版与新版产出**同一张图**（seed 固定时逐像素一致，或结构一致 + 参数一致）。
- **扩展零改核心**：新增/删除一个 `comfyuiapps/<id>/` 目录，核心文件 diff 为空，catalog 随之增减。
- **表单通用**：新增字段类型（media/boolean）无需改核心表单渲染分支以外的逻辑（类型表驱动）。
- **共享环境**：多个 app 复用同一 `comfyui` runtime venv 与同一常驻 ComfyUI 服务；`comfy.engine.status` 仍报告一个实例。
- **引擎随 prepare 就绪**：`comfy.prepare` 终态 `comfy.engine.status.running == true`；UI `comfy.engine.start` 与 `comfy.engine.ensure`（AI）并发触发只产生一个进程（探活 + `server.lock` 幂等）。
- **平台面稳定**：provider 仍 `local-gen`、模型仍 `local-gen/qwen-image`；已持久化默认路由无需迁移即继续生效。
- **App 100% 标准**：service 层无任何 `comfyui`/`local-gen`/`local-audio` 常量、分支或 per-app 测试；App 仅经 `contributes[]` + `recut.platform.register` 与平台交互（§12）。
- **可诊断**：workflow.py 抛错 → 任务 `failed` + 结构化日志（节点/异常摘要）；缺权重 → 明确提示「先下载 <app> 权重」。

---

## 11. 风险与开放问题

### 11.1 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 共享 runtime venv 依赖冲突 | 两个 app 的 `pip_install` 装同包不同版本会互相覆盖 | 文档约定 + `pip check` 自检；未来支持 app 声明独立 runtime（多 runtime 条目） |
| custom_nodes 供应链 | 克隆第三方节点执行任意代码 | 固定 commit 浅克隆 + 仅随内置 App 分发（第一方审查）；作者指南强调 pin |
| 生成物类型扩展 | 视频/音频取回逻辑比图片复杂（输出节点不统一） | manifest `output` + 可选指定输出节点；先支持 image，video/audio 在 M4 随第二个 app 落地 |
| 注册表生成时机 | 忘记重跑 `publish_registry.py` 会漏 app | 绑进 `make builtin-apps` 前置；background `REGISTRY_FALLBACK` 兜底；启动时校验 index 与目录一致性 |
| 表单值类型转换 | number/boolean 从 UI/桥传来可能是字符串 | background 统一按 `formSchema` 转换；workflow.py 只读已转换的 `ctx.params` |
| 改名波及测试/文档 | op/表/嵌入名/目录多处引用 | M0 一次性机械改名 + 全量 grep + 测试固化 |
| 引擎随 prepare 起的副作用 | prepare 变慢（等引擎就绪）；用户可能不想常驻占显存 | 端口可配（`RECUT_COMFYUI_PORT`）；`ensure_server` 复用已在监听实例；stop 后可再次按需起；UI 明确展示引擎状态 |
| 双入口并发启动竞态 | UI 与 AI 同时触发可能拉起两个进程 | 探活 + `server.lock` 文件锁串行化；PID 文件单一权威 |
| 旧数据残留 | `~/.recut/models/gen-studio`、旧 sqlite 账本 | 不迁移、不读取；README 说明可手动清理 |

### 11.2 开放问题

1. **provider id**：保持 `local-gen`（本文推荐）还是改 `local-comfyui`？取决于是否愿意迁移持久化路由。
2. **一个 app 多工作流**：是否允许 `comfyuiapps/<id>/` 下多个 `workflow.py`（共享 weights/custom_nodes）？本文按「一 app 一工作流」设计，多工作流可通过多目录或后续扩展。
3. **per-app runtime**：依赖冲突出现后，是引入「多 runtime」还是「per-app venv」？本文先共享。
4. **op 命名空间**：`gen.*`→`comfy.*` 是否值得（纯 App 内改动，但有测试/文档成本）？可在 M0 决定是否推迟。
5. **`output` 节点选择**：视频/音频工作流的产物节点如何声明（manifest 字段 vs workflow.py 返回选择器）？M4 定。
6. **引擎端口与外部实例**：若用户已有自建 ComfyUI 在 8188，`ensure_server` 直接复用（不接管）；是否需要「只复用不接管」与「独立端口」两种模式？M1 定。
7. **prepare 是否强制起引擎**：无 GPU / 用户只想下权重的场景，是否允许 `comfy.prepare { ensureEngine:false }` 跳过引擎？本文默认强制起（进入 App 即可用），M1 依反馈决定。

---

## 12. 平台插件/钩子契约：让 comfyui-studio 成为 100% 标准 App

> **核心决策：service 层不再为任何具体 App（或具体能力）写桥接代码；service 只提供「通用 hook 注册表 + 通用分派器」，App 经统一 API 注册自己的贡献。** `local_speech_bridge.go` 这类 per-app 桥退役，`local-audio` 硬编码消失——comfyui-studio 与 audio-studio 都只是「注册了 hook 的普通 App」。

### 12.1 现状：service 层的耦合点（重构对象）

| 位置 | 耦合 | 性质 |
|---|---|---|
| `service/local_speech_bridge.go` | 硬编码 `recut.audio-studio` + `audio.synthesize/save/presets/characters` | per-app |
| `service/media/jobs.go` `execute()` | `if provider.ID == "local-audio"` 专用分支 | per-provider |
| `service/media/service.go` | 4 个专用注入点：`localSpeechExec` / `localVoiceProvider` / `localModelProvider` / `localAppExec` | per-capability |
| `service/app_media_bridge.go` | 固定输入键 `aspectRatio/seed/negativePrompt/...`；单一 `localModelProvider` | per-capability 假设 |
| `service/catalog.go` | `contributes.media` 专用封闭 schema（新增贡献类型要改 Go） | 封闭 schema |
| `service/gen_studio_test.go` | 断言具体 App id / provider / model | per-app 测试 |

目标：以上全部替换为「通用 hook 注册表」，service 对 App 与能力**零知识**。

### 12.2 两段式贡献模型（尊重 goja「每次调用重跑 background」的现状）

goja App 的 background **不是常驻进程**（`runtime.go` 每次 operation 调用都新建 runtime 并重跑 background）。因此「在 background 里注册」产出的必须是**可持久描述、可再次调用**的描述符，而不是内存闭包。

- **静态层（manifest，加载期）**：`contributes[]` 开放 typed 列表；承载身份、provider/model 目录、路由可用性。**加载即可用，不执行 App 代码**（保留现有「静态目录、启动即可解析路由」的优点）。
- **动态层（background，daemon 启动收集一次）**：App 可选声明一个 `register` operation；daemon 在 AppHost 就绪后**best-effort 调用一次**，把返回的 hook 描述符并入注册表。描述符只存 `{ appId, op, kind, id, meta }`——**不存函数**；执行时经 `InvokeMCP(appId, op)` 重新跑 background（与今天完全一致）。
- **分派**：hook 被触发 → 注册表查描述符 → `InvokeMCP` → 结果回填。无 per-app 分支。

> 静态层解决「路由/目录必须在启动期可用」；动态层解决「就绪度/声音/执行语义随本机状态变化」。二者合并为同一注册表视图（`Static` 标记来源）。

### 12.3 hook 种类（extension points）与通用处理

service 为每种 kind 实现**一个通用 handler**（不是 per-app）；未知 kind **fail closed**（拒绝注册并记录）。

| kind | App 贡献什么 | service 通用处理 | 取代 |
|---|---|---|---|
| `media.provider` | provider 身份 + model 目录 + `generate`/`save` op | 合入媒体目录，按 `<provider>/<model>` 命名 | `contributes.media.providers` |
| `media.executor` | 如何把 `MediaJob` 变成 op input（声明式 `inputMap`） | 触发时按 `inputMap` 组装并 `InvokeMCP` | `localAppExec` + 固定键枚举 |
| `media.readiness` | 模型就绪投影（`catalog`/`status` op） | 聚合进 `CapabilityModelGroups` | `localModelProvider` |
| `media.voices` | 声音枚举（`presets`/`characters` op） | 聚合进 `CapabilityVoiceGroups` | `localVoiceProvider` |
| `media.route` | 路由可用性 / 默认标记 | 供 `configuredModelFor` / `mediaReadiness` 读取 | per-provider 判断 |

> **引擎不是 hook**：ComfyUI 引擎是 comfyui-studio 的**私有能力**（App 的 shell job + HTTP 探活），不进平台 provider 契约；AI 经 `comfy.engine.ensure` op 操作它（§5.5）。

### 12.4 注册 API

**manifest（静态层，开放列表）**：

```json
"contributes": [
  {
    "kind": "media.provider",
    "id": "local-gen",
    "protocol": "local",
    "operations": { "generate": "comfy.generate", "save": "comfy.save",
                    "catalog": "comfy.catalog", "status": "comfy.status" },
    "models": [ { "id": "qwen-image", "capability": "image.generate", "exposeModel": "qwen-image" } ]
  },
  {
    "kind": "media.executor",
    "id": "local-gen",
    "inputMap": { "app": "model.appModelId", "params": "job.params",
                  "referenceAssetIds": "job.referenceIds" }
  }
]
```

**background（动态层）**：

```js
// 可选：daemon 启动时调用一次，返回 hook 描述符（不返回值即只有静态层）
recut.operation.register("comfy.register", function () {
  return { contributions: [
    { kind: "media.readiness", id: "local-gen", op: "comfy.catalog" }
  ] };
});
```

**service（通用层）**：

```go
type Contribution struct { Kind, ID, AppID, Op string; Meta map[string]any; Static bool }

type ContributionRegistry interface {
    Register(Contribution) error          // 未知 kind → fail closed
    List(kind string) []Contribution
    Get(kind, id string) (Contribution, bool)
}
```

`wireAppContributions(host, registry)`：加载期把各 App manifest 的 `contributes[]` 注册进 registry；启动后 best-effort 调用各 App 的 `register` op 并入动态层。位置与今天 `wireAppMediaProviders` 相同，但**内容与 App 解耦**。

### 12.5 media 服务泛化（去硬编码）

- `execute()`：删 `if provider.ID == "local-audio"`；统一 `exec := registry.Executor(provider.ID)`，按 `media.executor` 描述符组装输入 → `InvokeMCP` → `CompleteGenerationFromImport`。本地语音与本地生成走**同一条**路径。
- **输入映射**：由 App 在 `media.executor.inputMap` **声明**（`job.*` / `output.*` / `model.*` → op 键），service 不再枚举 `aspectRatio/seed/...`。
- `localSpeechExec` / `localVoiceProvider` / `localModelProvider` 三个字段退役；`audio-studio` 与 `comfyui-studio` 各自注册 `media.executor` / `media.voices` / `media.readiness`。
- `configuredModelFor` / `mediaReadiness` 的 `local-audio`/`local-gen` 判断改为读 `media.route` / `media.readiness` 注册项。
- `capability_models.go` 不再持有单一 `localModelProvider`；按 provider 从 registry 取各自 readiness。

### 12.6 comfyui-studio 是 100% 标准 App

- service 无任何 `comfyui` / `local-gen` 常量、分支或专用测试。
- `service/gen_studio_test.go` 退化为**通用契约测试**：用 fixture App（临时目录 + manifest + background）验证「注册 `media.provider` → 目录可解析 → 触发 executor → 落 Asset」，不绑定任何真实 App id。
- comfyui-studio 只经 `contributes[]`（静态）+ 可选 `comfy.register`（动态）与平台交互；删掉它，service 行为不变（只是目录少了 provider）。

### 12.7 迁移

- **A（兼容层，随 M3）**：保留 `contributes.media` 旧字段，内部映射为 `media.provider` / `media.readiness`；`local-audio` 桥改为 `audio-studio` 经新 API 注册 executor（行为不变）。
- **B（开放 + 动态，随 M5）**：`contributes[]` 开放列表上线 + `recut.platform.register` 动态收集；新增 `media.executor` / `voices` / `route` kind。
- **C（清理，随 M5）**：删除 `local_speech_bridge.go` 的 per-app 常量、`execute()` 的 `local-audio` 分支、三个专用 setter 与 per-app 测试。

### 12.8 风险与开放问题

| 风险 | 缓解 |
|---|---|
| 动态注册失败 / 顺序 | 静态层兜底；动态层 best-effort + 记日志；路由/目录不依赖动态层 |
| 开放 kind schema 漂移 | 每种 kind 注册 schema；未知 kind fail closed；`docs/app-contract.md` 为权威 |
| 执行器描述符表达力 | `inputMap` 覆盖常见映射；复杂场景仍可用 App 的 `generate` op 自行解释 input |
| 权限 / 信任 | 注册只暴露平台已知 kind；background 仍受 manifest 权限；不引入新权限 |
| 兼容期双轨 | `contributes.media` 保留一个版本并映射，C 阶段删除 |

**开放问题**：① 动态 `register` op 的调用时机（daemon 启动 vs 首次使用 lazy）；② `inputMap` 的表达力边界（声明式 vs 允许 App 自带映射 op）；③ `media.provider` 是否直接合并 `executor`（减少 kind 数）；④ 是否允许第三方 App 贡献全新 kind（需平台先实现 handler，否则 fail closed）。

---

## 13. 与既有 RFC 的关系

- **取代** `2026-09-23-local-generation-studio.md` 中「切换单位 = 模型」的注册表模型（`registry.models[]` 手维护）与「工作流写死在 `comfyui_runner.py`」的局部设计；其余（内置分发、`comfy_tasks` 账本/pumpQueue、能力桥、`contributes.media` 声明式 provider、环境/权重分离、Left/Right 交互）**全部沿用**。
- **与** `2026-09-24-modal-functions.md` **互为姊妹**：`comfyuiapps/` 与 `modalapps/` 同构（自包含目录 + 生成器 + 每目录一个入口脚本 + 一个 bootstrap）；差异仅在运行时位置（本机共享 vs 云端各自）。
- **推进** `2026-09-23-local-generation-studio.md` §4.3/§4.4 的「App 声明式 provider + 通用执行桥」到终态：把 `app_media_bridge.go` 的固定输入键与 `local_speech_bridge.go` 的 per-app 桥，统一收敛为 §12 的**通用 hook 注册表**（App 经 `contributes[]` + `recut.platform.register` 注册）。
- 不改变生成提示词参考引用协议、媒体生成提案、平台 Op 总线契约。

---

[返回 rfc 索引](./README.md)
