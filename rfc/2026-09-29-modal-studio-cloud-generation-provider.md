<!--
 * [INPUT]: 依赖 apps/modal-studio（既有 modalapps 三件套、modal_tasks 账本、modal.generate/save/catalog/status/task.get）、
 *          comfyui-studio 的成熟做法（manifest contributes.media provider + publish_registry.py 从 app manifest 生成模型 +
 *          App 内 model 别名解析 + catalog models[] 就绪投影 + shadcn 设计体系）、docs/app-contract.md（contributes.media 契约）、
 *          service/{catalog.go,media/app_providers.go,app_media_bridge.go}（平台侧通用接入，已实现，无改动）
 * [OUTPUT]: 把 modal-studio 从「v1 不接平台」改为**经既有 contributes.media 接入平台生图/生视频能力**：manifest 新增
 *           provider `modal-cloud`（protocol local + executor inputMap），每个声明 `expose` 的 modalapp → 一个平台模型
 *           （`publish_registry.py` 生成 contributes.media.models；模型 id 必须简单名，无点号）；modal.catalog 增 `models[]`
 *           就绪投影（deployed && volumeReady → ready），modal.generate 兼容平台执行桥的 `model` 入参（按 expose.model 解析
 *           modalapp+expose.function，跳过 confirmCost 门，视频走平台提案门）；UI 复用 shadcn 组件层与平台设计 token。
 *           零 `service/` 改动。
 * [POS]: rfc 的「modal-studio 平台接入」设计稿；把 comfyui-studio 的「App 声明式本地 provider」范式（manifest 静态
 *        声明 + 生成器同步 + 通用执行桥 + 动态就绪面）原样套用到云端 modalapp，并复用同一套 shadcn 设计体系。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC：Modal 云函数接入平台生图/生视频能力（contributes.media）

- 状态：Accepted（已实施）
- 作者：Recut
- 日期：2026-09-29
- 决策范围：`apps/modal-studio` 经 `contributes.media` 的**平台接入**（provider `modal-cloud`、`expose` 约定、生成器同步、执行桥兼容、就绪面）与 **UI shadcn 设计体系复用**；不改 `service/`、不改 `async_ops`/Op 总线、不改平台提案门
- 关联：[Modal 云函数](./2026-09-24-modal-functions.md)（本文取代其「v1 不接平台」边界）、[本地模型本地生成（gen-studio）](./2026-09-23-local-generation-studio.md)、[ComfyUI 工作台](./2026-09-24-comfyui-studio-workflow-apps.md)、[App 契约](../docs/app-contract.md)

## 0. 白话总结

modal-studio 之前**有意不接平台**（不写 `contributes.media`、不占默认生图/生视频路由），只能经自己的 `modal.*` operation 显式调用。

本 RFC 把它改为**经既有 `contributes.media` 契约接入平台**，完全照搬 comfyui-studio 已验证的做法（**零 `service/` 改动**）：

1. **每个 modalapp 自己声明要不要上平台**：在 `modalapps/<id>/manifest.json` 加 `expose: { model, function }`。
2. **生成器同步**：`python/publish_registry.py` 扫描 `expose`，把模型清单写进根 `manifest.json` 的 `contributes.media.providers[0].models`。
3. **平台合并目录**：平台 `media.RegisterAppProviders` 把它并进全局生图/生视频目录，默认路由可选到 `modal-cloud/<model>`，生成经通用执行桥调用 `modal.generate`。
4. **一旦就绪即可用**：模型清单是静态的（哪些能跑由 App 声明）；是否可用由 `modal.catalog` 的 `models[]` 动态上报——**只有 `deployed && volumeReady` 才 `ready`**。

交互单位仍是「预设包」；**一个 modalapp = 一个平台模型**（路由到它的 `expose.function`，通常是文生视频/文生图），其余函数继续在 App 内可选。

同时 UI 复用 comfyui-studio 的 shadcn 组件层与平台设计 token，视觉与平台同源。

## 1. 决策

| 项 | 决策 |
|---|---|
| 是否接平台 | **接**（取代 2026-09-24 的「v1 不接平台」） |
| 接入方式 | 复用既有 `contributes.media`（App 声明式），**零 `service/` 改动** |
| provider | `id: modal-cloud`、`protocol: local`（契约强制）、`localized` 名称「Modal Functions (cloud GPU)」 |
| 模型粒度 | **每个 modalapp 一个平台模型**（`expose.model` → `expose.function`） |
| 能力范围 | `image.generate` 与 `video.generate` 都注册；视频由平台 proposal 门兜底成本 |
| 注册声明 | 每个 modalapp 的 `manifest.json` 用 `expose` 自己声明（opt-in；用户 scaffold 默认不带） |
| 执行 | 通用执行桥 → `modal.generate`（单槽 FIFO）→ 等 `modal.task.get` 终态 → `modal.save` 入库 |
| 就绪 | 静态清单 + `modal.catalog.models[]` 动态就绪（`deployed && volumeReady`） |
| UI | 复用 shadcn（`components/ui/*` + `cn` + `components.json`）与平台 `web/app/globals.css` 语义 token |

## 2. `expose` 约定（每个 modalapp 自己的配置文件）

```jsonc
"expose": {
  "model": "qwen-image",          // 平台模型简单名，必须匹配 ^[a-z0-9][a-z0-9_-]*$（不能含 . ）
  "function": "text-to-image",    // 平台路由到的函数；缺省取 functions[0]
  "capability": "image.generate"  // 可选；缺省按该函数 output.kind 推导(image/video/speech)
}
```

内置 modalapp：`sd-turbo`→`sd-turbo`、`qwen-image-2.1`→`qwen-image`（id 含 `.`，模型名去点）、
`minimax-h3`/`minimax-h3-one`/`minimax-h3-turbo`→各同名（`text-to-video`）。用户 scaffold 的 modalapp 不带 `expose`。

> 平台模型 id 必须简单名（`validRuntimeName`：仅 `a-z0-9-_`），所以 `qwen-image-2.1` 这种含点的 id 必须显式给一个干净 `model`。

## 3. provider 与执行桥契约（根 manifest.json）

```jsonc
"contributes": { "media": { "providers": [{
  "id": "modal-cloud", "protocol": "local",
  "operations": { "generate": "modal.generate", "save": "modal.save",
                  "catalog": "modal.catalog", "status": "modal.status", "task": "modal.task.get" },
  "executor": { "resultIdPath": "generation.id",
                "inputMap": { "model": "model.apiModelId", "prompt": "job.prompt",
                              "referenceAssetIds": "job.referenceIds", "params": "job.output" } },
  "models": [ /* publish_registry.py 生成 */ ]
}]}}
```

- `protocol` 必须是 `local`（契约限制），语义上是「App 代为执行的生成来源」，实际计算在 modal.com —— 文档如实说明。
- `resultIdPath` 默认即 `generation.id`；`task` 提供 `modal.task.get`（返回 `state`），平台据此轮询 App 自有队列；`saveKind` 缺省按能力推导（video→video / image→image）。
- `modal.catalog` 返回 `models[]`（`{ model, capability, runtime:"modal", label, ready, weight:{installed,sizeGb,revision} }`），供平台 `appLocalModels` 把就绪并入能力模型聚合；`ready = deployed && volumeReady`。

## 4. `modal.generate` 兼容平台入参

平台执行桥按 `inputMap` 发送 `{ model, prompt, params, referenceAssetIds }`（不传 `modalapp/function`）。因此：

- 新增 `resolveTarget(registry, input)`：显式 `modalapp` 优先（App 内调用不变）；否则按 `expose.model` 命中 modalapp 并用其 `expose.function`（缺省首函数）——即 comfy 的 `model` 别名解析同构。
- `prompt` 合并进 `params`（桥把提示词与表单参数分开传）。
- **成本门调整**：经平台路由（存在 `model`）时跳过 App 的 `confirmCost` 门（平台侧视频已走 proposal 确认；图片为显式选择默认路由）；直接 `modal.*` 调用保持 `confirmCost` 门。

## 5. UI 复用 shadcn 与平台设计体系

镜像 `apps/comfyui-studio/ui`：`components.json`（style `radix-mira`、css `src/style.css`、zinc、cssVariables）、
`lib/utils.ts` 的 `cn`、`components/ui/*` 11 个 shadcn 原子（badge/button/card/dialog/input/label/progress/select/separator/tabs/textarea）、
`style.css` 采用平台 `web/app/globals.css` 的语义 token（深色 canvas + 绿色主色 + 低圆角 + 细滚动条 + `data-*` 变体对齐 radix + `tw-animate-css`）。
废弃手写原子 `ui/src/ui.tsx`；`App.tsx`/`RunTab`/`RecordsTab`/`PreviewPane`/`Setup`/`AccountDialog`/`ConnectionControl` 迁移到 shadcn 原子
（Badge 用 `variant="outline"` + tone className；Button variant 用 `default/outline/ghost`；账号面板改用 shadcn Dialog）。

## 6. 改动清单（全部在 `apps/modal-studio/` + 一处测试 + 文档）

| 位置 | 改动 |
|---|---|
| `modalapps/*/manifest.json` | 5 个内置包新增 `expose` |
| `python/publish_registry.py` | 生成 `contributes.media.models`；`registry_modalapp` 增 `expose` |
| `manifest.json` | 新增 `contributes.media.providers[0]`（modal-cloud + executor） |
| `background.js` | `normalizeManifest` 透传 `expose`；`modal.catalog` 增 `models[]`；`modal.generate` 增 `resolveTarget` + prompt 合并 + 成本门调整；头部注释 |
| `ui/*` | shadcn 设计体系迁移（见 §5）；重建 `ui/dist` |
| `skills/modal-studio/SKILL.md`、`README.md`、`README.en.md` | 更新平台接入说明 |
| `service/modal_studio_test.go`（新） | 标准 App 安装 → contributes 映射为 `modal-cloud/<model>` + 执行桥 + 能力聚合 |
| `apps/README.md` | 新增 modal-studio 成员条目 |
| `service/**` | **无任何改动** |

## 7. 验收

1. `python3 apps/modal-studio/python/publish_registry.py` 后 `manifest.json` 的 `contributes.media.models` 含 5 个模型（2 图 3 视频）。
2. `cd service && go test -run ModalStudio` 通过：`modal-cloud/<model>` 解析、执行桥注册、`CapabilityModelGroups(image/video)` 列出 `modal-cloud` 分组及其平台模型。
3. `cd apps/modal-studio/ui && npm install && npm run build` 通过；`ui/dist` 更新；界面外观与 comfyui-studio/平台一致。
4. 平台「生图/生视频默认路由」可选到 `modal-cloud/*`；未 `deployed`/未下权重时模型 `ready=false`，提交给出引导错误。

## 8. 风险

- **语义**：平台把 `modal-cloud` 当作 `protocol:"local"` 的 provider（契约限制），实际为云端；README/RFC 如实说明，并以 Modal 账号额度归属用户。
- **成本**：云端图片经平台 `image.generate` 无提案门（仅显式选默认路由才命中，且 `ready` 需已部署）；视频由平台 proposal 门兜底。若需更强门禁，后续可给模型加 `requiresProposal` 标记（属平台侧，另行 RFC）。
- **参数透传**：平台当前不把 contributed `parameters` 映射进 `MediaModel`（comfy 同样如此）；平台路由按通用 output（prompt/aspectRatio/seed…）透传，函数表单仍以 App 内 `formSchema` 为准。
- **hook 机制**：2026-09-24 设想等平台 hook；本 RFC 直接用已落地的 `contributes.media`，hook 机制就绪后无需迁移。
