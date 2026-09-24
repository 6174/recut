# 本地生成 · Generation Studio

**在本机用一个运行环境托管多个开源模型，生成图片与视频**

Recut 的本地生成工作台 — 先准备环境、再下载模型，一个 App 切换不同模型。

## 这是什么

本地生成是 Recut 的**独立生成 App**（`standalone` 类型，内置分发）。它把「运行环境」与「模型」解耦：一个 runtime（依赖闭包 + 专属 venv，默认 `comfyui`）能加载很多个模型权重，在一个 App 里切换模型。

- **本机运行**：用用户自己的显卡（NVIDIA / Apple MPS / CPU）跑开源扩散模型，不联网、不花钱。
- **一个环境多模型**：换模型只下权重，不重建环境；只有依赖冲突时才新增 runtime。
- **准备与下载分离**：`gen.prepare` 建环境（建 runtime venv + 按固定 commit 浅克隆 ComfyUI 源码）、`gen.install` 下权重（按 `registry.weights.files` 白名单只拉需要的文件，逐文件断点续传），各自独立可重试；权重源可选 Hugging Face / ModelScope / 自动回退。
- **接入全局生图**：平台把本地生成作为 `local-gen` provider；把生图默认路由指向 `local-gen/qwen-image`，或单次显式选择即可。
- **结果先私有**：生成产物留在 App 私有区，确认后 `gen.save` 进入素材库。

## 交互

```text
┌───────────────────────────────┬──────────────────────────────────────┐
│ Left                          │ Right                                │
│ [生成] [记录]                  │ 统一生产预览 + 进度/日志              │
│  · 生成：顶部切换模型，         │  · 生成：图片预览 + 参数 + 保存入库    │
│    每个模型有自己的表单         │  · 环境/下载：实时日志 + 就绪度        │
│  · 记录：环境/下载/生成统一列表 │  · 顶部：状态 / 取消                   │
└───────────────────────────────┴──────────────────────────────────────┘
```

## 快速开始

1. 安装并启动 Recut（见主仓库 [README](../../README.md#安装-recut)）。
2. 本地生成为**内置 App**，随客户端发布，无需单独安装。
3. 首次进入：先「准备环境」（创建 `comfyui` runtime 专属 venv 并克隆 ComfyUI 源码），再「下载模型」（默认 Qwen-Image-2.1 int8 权重集，约 17GB），随后即可生成。
4. 在「设置 · 模型」把生图默认路由指向 `local-gen/qwen-image`，即可让 `recut.image.generate` 走本机。

## 能力

| 能力 | 操作 |
| --- | --- |
| 环境/模型总览 | `gen.status` · `gen.catalog` |
| 准备环境 / 下载权重 | `gen.prepare` · `gen.install` · `gen.settings.set` |
| 生成 / 历史 / 入库 | `gen.generate` · `gen.generations` · `gen.generation.complete` · `gen.save` |
| 任务中心 | `gen.tasks.list` · `gen.task.get` · `gen.task.logs` · `gen.task.cancel` · `gen.cancel` |

## 面向开发者

```sh
make app-link APP=apps/gen-studio   # 开发期软链接（启动不覆盖）
cd apps/gen-studio/ui && npm install && npm run build   # 构建 ui/dist
make builtin-apps                   # 重新打包内置归档
```

- UI 源码在 `ui/src`（React + TypeScript + Vite），运行时消费构建产物 `ui/dist/index.html`（已构建入库，`make builtin-apps` 直接打包）；`node_modules` 不入库。
- 主 venv 在 `~/.recut/python/envs/recut.gen-studio/`（轻量调度/下载依赖），runtime 专属 venv 为其兄弟目录 `<fp>-comfyui`。
- ComfyUI 源码按 `registry.json` 的 `runtime.repository/revision` **固定 commit** 浅克隆到 `~/.recut/models/gen-studio/comfyui/repository/`；权重按白名单落到其 `models/` 下（`diffusion_models/`、`text_encoders/`、`vae/`）。
- 引擎/模型注册表：`python/registry.json`（单一信息源）；新增模型只改注册表 + 平台 `contributes.media`。

[返回主 README](../../README.md)
