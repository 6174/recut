# Generation Studio（生成工坊）Skill

生成工坊是 Recut 的**本地图片/视频生成 App**：一个运行环境（runtime）托管多个模型，用用户本机显卡跑开源模型，不联网、不花钱。

## 何时使用

- 用户想**在本机生成图片**（第一版：Qwen-Image 文生图），或想把平台生图默认路由切到本地模型。
- 需要查看本机有哪些生成模型/环境、是否就绪、是否已下载权重。

## 核心概念

- **runtime（环境）**：一套依赖闭包 + 专属 venv（默认 `comfyui`，源码按固定 commit 克隆）。一个 runtime 可加载多个模型。
- **model（模型）**：权重 + 表单 schema，归属某个 runtime。换模型只下权重、不换环境。默认模型 Qwen-Image-2.1（int8 权重集，约 17GB），支持文生图与参考图编辑。
- **准备与下载分离**：`gen.prepare` 建 runtime；`gen.install` 下权重。

## 操作顺序（务必按此收敛）

1. `gen.status` / `gen.catalog` 看本机模型与就绪度（runtime venv 是否就绪、权重是否已下载）。
2. 未就绪时：`gen.prepare { target: "all" }` 准备运行环境；`gen.install { model, source }` 下载权重（可并行）。
3. `gen.generate { model, prompt, ... }` 提交生成；单槽 FIFO，占槽时返回 `taskId`（`job=null`）→ 用 `gen.tasks.list` / `recut.job.wait` 观察。带参考图编辑时传 `referenceAssetIds: string[]`（可多张，按顺序接进工作流）；界面用全局素材选择器多选。
4. `gen.generation.complete { id }` 读取产物；`gen.save { id, kind: "image" }` 入库（平台默认路由路径会自动入库）。

## 平台集成

- `manifest.contributes.media` 声明 `local-gen` provider 与静态模型清单；平台据此把 `local-gen/<model>` 合入生图目录。
- 把生图默认路由指向本地：`image.generate.default` → `local-gen/qwen-image`（或单次 `recut.image.generate { modelId: "local-gen/qwen-image" }`）。
- 发现本机模型：`recut.media.list_capability_models { capability: "image.generate" }`。

## 纪律

- 生成是**本地零成本**，图片默认直生、不提案；视频沿用平台既有确认门。
- 产物先私有，只有 `gen.save`（或默认路由自动保存）后才进入素材库。
- 不要绕过 `gen.prepare` / `gen.install` 直接生成；未就绪时任务会排队或明确报错。
