# python/

> L2 | 父级: /apps/depth-anything/README.md

成员清单
depth_runner.py: 本机 Python 执行入口；检查 FFmpeg 与官方仓库、下载选择的权重，并将图片或视频转换为 App 私有深度预览；不管理 venv 或依赖安装。
requirements.lock: 平台 Python runtime 的锁定依赖清单；其内容参与 venv 指纹，变更会得到新的隔离环境。

依赖关系

`background.js -> ctx.python.run -> depth_runner.py`；平台先从 `manifest.runtime.python` 创建/激活 venv，再把 App 文件根、模型根和 `RECUT_VENV` 注入脚本。脚本绝不读取 SQLite、调用 Recut HTTP API 或写入素材库。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
