# Depth Anything - 本地图片与视频深度图 App

Depth Anything 是 Recut 的独立应用：选择一张素材库图片或视频，在本机运行官方 Depth Anything V2，获得可预览的 PNG 或 MP4 深度图。输出先保留在 App 私有文件区，用户点击保存后才创建素材库 Asset。

## 使用流程

1. 在 **Apps** 中从 [recut-depth-anything-v2](https://github.com/6174/recut-depth-anything-v2) 安装并打开“Depth Anything”。首次进入会检查 Python、FFmpeg、运行环境和模型，并由平台异步创建 manifest 声明的 venv、安装锁定依赖与执行 App bootstrap。
2. 运行环境就绪后，从下拉框选择 Small、Base 或 Large；按需下载多个模型。模型权重统一保存到 `~/.recut/models/depth-anything-v2/`，venv 由平台保存到 `~/.recut/python/envs/recut.depth-anything/depth-anything-v2/<fingerprint>/`。
3. 选择图片或视频素材，再选择伪彩或灰度输出。
4. 生成后先查看私有预览；满意时点击“保存到素材库”。

Small 适合快速预览；Base 是默认平衡；Large 有更细的细节，对逐帧视频也更稳定。官方模型的许可证不同：Small 为 Apache-2.0，Base 与 Large 为 CC-BY-NC-4.0，使用前应确认用途匹配。

## 本地依赖

`manifest.json` 的 `runtime.python` 是唯一的环境声明：平台创建 venv、按 `python/requirements.lock` 安装 PyTorch、TorchVision、OpenCV 和 timm；`bootstrap.sh` 是不受产品约束的兜底脚本，本 App 用它浅克隆 [Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2)。视频与图片路径都要求本机 `ffmpeg` 已可执行；视频逐帧推理先写入中间文件，再经 FFmpeg 转为浏览器可播放的 H.264/yuv420p MP4；安装、下载和推理均作为可取消任务运行，实时 stdout/stderr 与逐帧进度会显示在界面和项目事件流中，错误可直接交给右侧 Codex 处理。

## 数据边界

| 数据 | 保存位置 |
| --- | --- |
| 官方代码、模型权重 | `~/.recut/models/depth-anything-v2/` |
| 平台 Python venv | `~/.recut/python/envs/recut.depth-anything/depth-anything-v2/<fingerprint>/` |
| 输入副本和未保存预览 | 当前独立 App 的私有文件沙箱 |
| 用户明确保存的深度图 | Recut 素材库，取得真实 `assetId` |
| 输出记录 | 当前 App 的隔离 SQLite；只保存输入 Asset、模型、样式、私有预览路径与可选保存 Asset |

## 架构

```text
ui/ -> background.js -> ctx.python / ctx.shell -> ShellJobManager -> python/depth_runner.py
                         |                         |                     |
                         |                         +-> project events       +-> ~/.recut/models/depth-anything-v2/
                         +-> App files/inputs and files/outputs

素材库 Asset -> ctx.media.materialize -> 私有输入副本 -> Depth 预览
用户点击保存 -> ctx.media.importFile -> 素材库 Asset
```

`background.js` 是唯一业务入口。它把素材库输入 materialize 到私有目录、提交 Python Job、保存输出记录；它绝不在生成成功时导入素材库。`python/depth_runner.py` 不管理 venv、pip 或官方仓库，不了解 App SQLite 或素材库，只负责模型状态、下载与推理。

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
bootstrap.sh            App 自由执行的官方仓库准备兜底脚本；不拥有 venv 或 pip 生命周期
manifest.json           独立 App 身份、权限和 operation 契约
python/                 平台 venv 的 lockfile、模型下载和图片/视频推理 launcher
ui/                     React/Vite 运行环境、模型管理、输入选择、预览与保存工作台
```

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
