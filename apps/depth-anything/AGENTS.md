# Depth Anything 执行约束

此 App 只使用 `depth.status`、`depth.install`、`depth.generate` 和 `depth.save` 的公开契约。

- 应用进入时先自动调用 `depth.status -> depth.prepare`；运行依赖未就绪时不能开放工作台。生成前再确认用户选择的模型已经下载。
- 图片和视频输入都必须是已完成的 Recut Media Asset；`depth.generate` 只将其复制到 App 私有文件目录。
- 输出 PNG 或 MP4 先作为私有预览。只有用户明确点击保存后，才允许调用 `depth.save` 创建素材库 Asset。
- 依赖、模型下载或推理失败时，保留原始错误。不要编造生成结果、假设模型已安装，或绕开 App 直接写入 `.recut/models`。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
