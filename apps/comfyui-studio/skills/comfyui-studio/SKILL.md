# ComfyUI Studio（ComfyUI 工作台）Skill

ComfyUI 工作台是 Recut 的**本地 ComfyUI 工作流 App**：一个共享运行环境（runtime）托管多个 ComfyUI 工作流，用用户本机显卡跑开源模型，不联网、不花钱。

## 何时使用

- 用户想**在本机跑 ComfyUI 工作流**（第一版：Qwen-Image-2.1 文生图/编辑），或想把平台生图默认路由切到本地。
- 需要查看本机有哪些工作流/环境、是否就绪、是否已下载权重，或需要操作 ComfyUI 引擎。

## 核心概念

- **workflow app（工作流）**：`comfyuiapps/<id>/` 自包含目录（`manifest.json` 表单/权重/输出 + `workflow.py` 动态构图 + `bootstrap.py` 依赖）。切换单位是工作流，不是模型。
- **runtime（环境）**：一套依赖闭包 + 专属 venv（`comfyui`，源码按固定 commit 克隆）。所有工作流共享同一个 runtime 与同一个常驻 ComfyUI 服务。
- **准备与下载分离**：`comfy.prepare` 建 runtime + 逐工作流 bootstrap + 起引擎；`comfy.install` 下权重。
- **引擎随 prepare 就绪**：`comfy.prepare` 成功即 ComfyUI 服务在监听；`comfy.engine.ensure` 幂等，UI 与 AI 都可触发。

## 操作顺序（务必按此收敛）

1. `comfy.status` / `comfy.catalog` 看本机工作流与就绪度（runtime venv、权重、输出类型）。
2. 未就绪时：`comfy.prepare { target: "all" }` 准备运行环境并起引擎；`comfy.install { app, source }` 下载权重（可并行）。
3. `comfy.generate { app, params, referenceAssetIds? }` 提交生成；`params` 是工作流表单值对象（字段见 `comfy.catalog` 的 `formSchema`）。单槽 FIFO，占槽时返回 `taskId`（`job=null`）→ 用 `comfy.tasks.list` / `recut.job.wait` 观察。带参考图时传 `referenceAssetIds: string[]`（按顺序接进工作流）。
4. `comfy.generation.complete { id }` 读取产物；`comfy.save { id, kind: "image"|"video"|"audio" }` 入库（平台默认路由路径会自动入库）。
5. 引擎未起或需重启：`comfy.engine.ensure`（幂等，AI 用）/ `comfy.engine.status` / `comfy.engine.stop`。

## 平台集成

- `manifest.contributes.media` 声明 `local-gen` provider 与静态工作流清单（由 `publish_registry.py` 从 `comfyuiapps/*/manifest.json` 生成）；平台据此把 `local-gen/<exposeModel>` 合入生图目录。
- 把生图默认路由指向本地：`image.generate.default` → `local-gen/qwen-image`（或单次 `recut.image.generate { modelId: "local-gen/qwen-image" }`）。
- 发现本机工作流：`recut.media.list_capability_models { capability: "image.generate" }`。

## 扩展新工作流

新增 `comfyuiapps/<id>/{manifest.json,workflow.py,bootstrap.py}` + 重跑 `python/publish_registry.py`；核心代码无需改动。作者契约见 `python/comfyui_sdk.py`（`BuildContext` / `BootstrapContext`）。

## 纪律

- 生成是**本地零成本**，图片默认直生、不提案；视频沿用平台既有确认门。
- 产物先私有，只有 `comfy.save`（或默认路由自动保存）后才进入素材库。
- 不要绕过 `comfy.prepare` / `comfy.install` 直接生成；未就绪时任务会排队或明确报错。
