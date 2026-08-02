# Depth Anything - 本地图片与视频深度图 App

Depth Anything 是 Recut 的独立应用：选择一张素材库图片或视频，在本机运行官方 Depth Anything V2，获得可预览的 PNG 或 MP4 深度图。输出先保留在 App 私有文件区，用户点击保存后才创建素材库 Asset。

## 使用流程

1. 在 **Apps** 打开“Depth Anything”。首次进入会检查 Python、FFmpeg、运行环境和模型，并自动创建 venv、安装 Python 包和拉取官方代码。
2. 运行环境就绪后，从下拉框选择 Small、Base 或 Large；按需下载多个模型。运行环境、官方仓库与权重统一保存到 `~/.recut/models/depth-anything-v2/`。
3. 选择图片或视频素材，再选择伪彩或灰度输出。
4. 生成后先查看私有预览；满意时点击“保存到素材库”。

Small 适合快速预览；Base 是默认平衡；Large 有更细的细节，对逐帧视频也更稳定。官方模型的许可证不同：Small 为 Apache-2.0，Base 与 Large 为 CC-BY-NC-4.0，使用前应确认用途匹配。

## 本地依赖

安装操作会创建专属 Python venv，安装 PyTorch、TorchVision、OpenCV、timm，并浅克隆 [Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2)。视频与图片路径都要求本机 `ffmpeg` 已可执行；缺失或安装失败时，界面保留错误文本，可直接交给右侧 Codex 处理。

## 数据边界

| 数据 | 保存位置 |
| --- | --- |
| 官方代码、Python venv、模型权重 | `~/.recut/models/depth-anything-v2/` |
| 输入副本和未保存预览 | 当前独立 App 的私有文件沙箱 |
| 用户明确保存的深度图 | Recut 素材库，取得真实 `assetId` |
| 输出记录 | 当前 App 的隔离 SQLite；只保存输入 Asset、模型、样式、私有预览路径与可选保存 Asset |

## 架构

```text
ui/ -> background.js -> ctx.shell.run -> python/depth_runner.py
                         |                   |
                         |                   +-> ~/.recut/models/depth-anything-v2/
                         +-> App files/inputs and files/outputs

素材库 Asset -> ctx.media.materialize -> 私有输入副本 -> Depth 预览
用户点击保存 -> ctx.media.importFile -> 素材库 Asset
```

`background.js` 是唯一业务入口。它把素材库输入 materialize 到私有目录、调用 Python、保存输出记录；它绝不在生成成功时导入素材库。`python/depth_runner.py` 不了解 App SQLite 或素材库，只负责环境、模型与推理。

## 开发

```sh
make app-link APP=apps/depth-anything
cd apps/depth-anything/ui
npm install
npm run build
```

构建后的 `ui/dist/` 是 `manifest.json` 的运行时入口。模型下载、Python 依赖安装和实际推理由服务进程触发，不应在 UI 打包流程中执行。

## 目录结构

```text
AGENTS.md               Agent 执行边界与生成/保存规则
background.js           App SQLite、素材复制、Python 调用与显式导入素材库的 operation
manifest.json           独立 App 身份、权限和 operation 契约
python/                 官方模型的安装、下载和图片/视频推理 launcher
ui/                     React/Vite 运行环境、模型管理、输入选择、预览与保存工作台
```

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
