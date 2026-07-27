# media/

> L2 | 父级: /service/README.md

成员清单
types.go: 媒体能力、含输入/输出参数能力的模型、路由、资产、任务与生成输入的稳定 JSON 契约。
service.go: Workspace 端口、MediaService 组合根、超时配置与少量跨层诊断入口。
catalog.go: Provider/模型目录、默认输出字段、参考素材能力及模型限制校验。
config.go: BYOK 凭据加密、模型路由、MiniMax/ElevenLabs 音色目录和配置查询。
assets.go: 图片、视频、音频 Asset 查询与导入、内容哈希去重、受控落盘、项目关联、异步任务的起止时间/耗时/诊断原位回写及 SQLite durable 更新事件账本。
jobs.go: 任务创建、幂等、同步图片/语音执行与 Provider 调度；按模型输出契约固化默认值（Seedance 同步音频默认开启），不持有常驻循环。
jobs_atlas.go: Atlas 视频 prediction 提交、轮询、输出回收、重试及 Seedance/Gemini 参考素材编码；只由已获租约的 Daemon 调用。
jobs_scheduler.go: 常驻 Daemon 的 durable job 扫描、SQLite lease、外部调用 checkpoint、重启恢复、凭据诊断及 queued Asset 的原子 claim；MCP 不启动此循环。
providers/: 第三方媒体协议适配器；只负责请求、轮询和供应商响应归一化，不接触工作区 SQLite、密钥存储或 Asset 持久化。

依赖边界

`service/media` 持有媒体任务与 Asset 真相，`media/providers/*` 只接收已解密的短生命周期凭据和引用数据，并返回供应商结果。异步提交先原子持久化 `job -> queued asset`；常驻 Host 用 SQLite lease 写入外部调用 checkpoint、提交远端 prediction 并在同一 Asset 上回收终态。只有已落库的 prediction 可安全重试轮询；任一 Provider 在 checkpoint 与结果持久化之间中断，任务明确失败而不重发收费请求，直到该 Provider 显式声明幂等契约。每次 Asset 改变与 `media_asset_events` 在同一 SQLite 事务提交，服务端通过 snapshot/replay SSE 传播当前完整 Asset；前端只读取本地 Asset，不能轮询 Provider。Seedance 的 `generateAudio` 是模型输出能力：创建任务时默认固化为 `true`，用户可显式关闭；Gemini 不声明该开关，绝不发送无效参数。Seedance 的本地视频参考先由 Atlas provider 上传并取得 Atlas URL，图片与音频按模型 Schema 使用 data URL；新增平台必须新增独立 provider 子目录并接入通用协调器，不能把协议分支塞回任务层；根 `service` 只通过 `media_adapter.go` 提供 Store 端口。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
