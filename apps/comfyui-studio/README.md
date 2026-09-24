# ComfyUI 工作台 · ComfyUI Studio

**在本机用 ComfyUI 工作流生成图片、视频与音频**

Recut 的本地 ComfyUI 工作台 — 先准备环境、再下载权重，一个 App 切换不同工作流。

## 这是什么

ComfyUI 工作台是 Recut 的**独立生成 App**（`standalone` 类型，内置分发）。它把「运行环境」与「工作流」解耦：一个共享 runtime（ComfyUI 依赖闭包 + 专属 venv + 固定 commit 源码）托管很多个 **comfyui workflow app**，在一个 App 里切换工作流。

- **本机运行**：用用户自己的显卡（NVIDIA / Apple MPS / CPU）跑 ComfyUI 工作流，不联网、不花钱。
- **切换单位是工作流**：每个工作流是自包含目录 `comfyuiapps/<id>/`（`manifest.json` 表单/权重/输出 + `workflow.py` 动态构图 + `bootstrap.py` 依赖）；**加能力 = 加目录 + 重跑注册表生成**，核心代码一行不用改。
- **准备与下载分离**：`comfy.prepare` 建环境（runtime venv + 克隆 ComfyUI 源码 + 逐工作流 bootstrap + 起引擎）、`comfy.install` 下权重（按 `manifest.weights.files` 白名单只拉需要的文件，逐文件断点续传），各自独立可重试；权重源可选 Hugging Face / ModelScope / 自动回退。
- **引擎随准备就绪**：`comfy.prepare` 成功即 ComfyUI 常驻服务在监听；`comfy.engine.ensure` 幂等，UI 与 AI 都能操作引擎。
- **接入全局生图**：平台把本地生成作为 `local-gen` provider；把生图默认路由指向 `local-gen/qwen-image`，或单次显式选择即可。
- **结果先私有**：生成产物留在 App 私有区，确认后 `comfy.save` 进入素材库。

## 交互

```text
┌───────────────────────────────┬──────────────────────────────────────┐
│ Left                          │ Right                                │
│ [生成] [记录]                  │ 统一生产预览 + 进度/日志              │
│  · 生成：顶部切换工作流，       │  · 生成：图片/视频/音频预览 + 参数    │
│    每个工作流有自己的表单       │    + 保存入库                        │
│  · 记录：环境/下载/生成统一列表 │  · 环境/下载：实时日志 + 就绪度        │
│                               │  · 顶部：引擎状态 / 状态 / 取消       │
└───────────────────────────────┴──────────────────────────────────────┘
```

## 快速开始

1. 安装并启动 Recut（见主仓库 [README](../../README.md#安装-recut)）。
2. ComfyUI 工作台为**内置 App**，随客户端发布，无需单独安装。
3. 首次进入：先「准备环境」（创建 `comfyui` runtime 专属 venv、克隆 ComfyUI 源码、起引擎），再「下载模型」（默认 Qwen-Image-2.1 int8 权重集，约 17GB），随后即可生成。
4. 在「设置 · 模型」把生图默认路由指向 `local-gen/qwen-image`，即可让 `recut.image.generate` 走本机。

## 能力

| 能力 | 操作 |
| --- | --- |
| 环境/工作流总览 | `comfy.status` · `comfy.catalog` |
| 准备环境 / 下载权重 | `comfy.prepare` · `comfy.install` · `comfy.settings.set` |
| 引擎控制 | `comfy.engine.status` · `comfy.engine.start` · `comfy.engine.ensure` · `comfy.engine.stop` |
| 生成 / 历史 / 入库 | `comfy.generate` · `comfy.generations` · `comfy.generation.complete` · `comfy.save` |
| 任务中心 | `comfy.tasks.list` · `comfy.task.get` · `comfy.task.logs` · `comfy.task.cancel` · `comfy.cancel` |

## 扩展一个新工作流

在 `comfyuiapps/` 下新增一个目录即可：

```text
comfyuiapps/my-workflow/
├── manifest.json   # app meta + form json + weights(role) + customNodes + output
├── workflow.py     # build(ctx) -> ComfyUI API 格式工作流（纯函数）
└── bootstrap.py    # prepare(ctx)（额外 pip / 克隆 custom_nodes）
```

然后重跑 `python3 python/publish_registry.py`（生成 `python/registry.json` / `comfyuiapps/index.json` 并同步 `manifest.contributes.media`）。作者契约见 `python/comfyui_sdk.py`。

## 面向开发者

```sh
make app-link APP=apps/comfyui-studio   # 开发期软链接（启动不覆盖）
cd apps/comfyui-studio/ui && npm install && npm run build   # 构建 ui/dist
make builtin-apps                   # 重新打包内置归档
```

- UI 源码在 `ui/src`（React + TypeScript + Vite），运行时消费构建产物 `ui/dist/index.html`；`node_modules` 不入库。
- 主 venv 在 `~/.recut/python/envs/recut.comfyui-studio/`（轻量调度/下载依赖），runtime 专属 venv 为其兄弟目录 `<fp>-comfyui`。
- ComfyUI 源码按 `python/runtimes.json` 的 `repository/revision` **固定 commit** 浅克隆到 `~/.recut/models/comfyui-studio/comfyui/repository/`；权重按 `manifest.weights.files` 落到其 `models/` 下。
- 注册表由 `python/publish_registry.py` 从 `comfyuiapps/*/manifest.json` 生成（`python/registry.json`），人工不再手改。

[返回主 README](../../README.md)
