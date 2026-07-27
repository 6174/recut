# media/

> L2 | 父级: /service/README.md

成员清单
types.go: 媒体能力、模型、路由、资产、任务与生成输入的稳定 JSON 契约。
service.go: Workspace 端口、MediaService 组合根、超时配置与少量跨层诊断入口。
catalog.go: Provider/模型目录、默认输出字段、参考素材能力及模型限制校验。
config.go: BYOK 凭据加密、模型路由、MiniMax/ElevenLabs 音色目录和配置查询。
assets.go: 图片、视频、音频 Asset 查询与导入、内容哈希去重、受控落盘和项目关联。
jobs.go: 异步任务创建、幂等、执行、恢复、结果落库和 Provider 调度。
providers/: 第三方媒体协议适配器；只负责请求、轮询和供应商响应归一化，不接触工作区 SQLite、密钥存储或 Asset 持久化。

依赖边界

`service/media` 持有媒体任务与 Asset 真相，`media/providers/*` 只接收已解密的短生命周期凭据和引用数据，并返回供应商结果。Seedance 的本地视频参考先由 Atlas provider 上传并取得 Atlas URL，图片与音频按模型 Schema 使用 data URL；新增平台必须新增独立 provider 子目录，不能把协议分支塞回任务层；根 `service` 只通过 `media_adapter.go` 提供 Store 端口。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
