# python/

> L2 | 父级: /apps/depth-anything/README.md

成员清单
depth_runner.py: 本机 Python 执行入口；检查 FFmpeg、创建专属 venv、安装官方依赖、下载选择的权重，并将图片或视频转换为 App 私有深度预览。

依赖关系

`background.js -> ctx.shell.run -> depth_runner.py`；脚本从环境变量取得 App 文件根和模型根，绝不读取 SQLite、调用 Recut HTTP API 或写入素材库。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
