# media/

> L2 | 父级: /service/README.md

成员清单
types.go: 媒体能力、含输入/输出参数能力的模型、路由、资产、任务、生成输入与固定两轨合成的稳定 JSON 契约。
service.go: Workspace 端口、MediaService 组合根、图片等同步生成 5 分钟长请求与短状态查询分离的 HTTP 超时配置及少量跨层诊断入口；同一凭据的一次请求生成在进程内有界串行，避免调度批次突发压垮上游。
catalog.go: Provider/模型目录、无需 Provider 凭据的 Codex 原生图片路由、默认输出字段、参考素材能力及模型限制校验。
config.go: BYOK 凭据加密、模型路由（含无凭据的 Codex 图片路由）、MiniMax/ElevenLabs 音色目录和配置查询。
assets.go: 图片、视频、音频 Asset 查询与流式导入、Codex 原生图片的项目关联归档、内容哈希去重、受控落盘、异步任务的起止时间/耗时/诊断原位回写及 SQLite durable 更新事件账本；远程成功/失败终态以 job/asset 身份记入 service 日志；合成导出可绕过记录去重以保证每次交付都有新的 Asset。
compose.go: 平台本地 FFmpeg 合成器；校验连续的视频/音频两轨、尺寸/帧率/质量设置和本地 Asset 文件，将视频原声按顺序保留并与可选音频轨混合，成片与可追溯时间线 metadata 作为新的 video Asset 保存；缺失时优先通过 Homebrew 安装 FFmpeg，失败则返回可执行诊断。
jobs.go: 任务创建、幂等、同步图片/语音执行、终态等待与 Provider 调度；按模型输出契约固化默认值（Seedance 同步音频默认开启），保留 MiniMax 明确状态码或空音频诊断，记录不含 prompt/凭据的 job 创建和状态审计，不持有常驻循环。
jobs_atlas.go: Atlas 视频 prediction 提交、短超时轮询、输出回收、重试及 Seedance/Gemini 参考素材编码；只由已获租约的 Daemon 调用。
jobs_scheduler.go: 常驻 Daemon 的 durable job 扫描、SQLite lease、外部调用 checkpoint、重启恢复、凭据诊断及 queued Asset 的原子 claim；one-request Provider 将提交检查点与 `running` 状态一次事务写入，杜绝本地事务竞争被伪装为供应商未知结果；未知提交失败以 job/asset 身份记入 service 日志，MCP 不启动此循环。
providers/: 第三方媒体协议适配器；只负责请求、轮询和供应商响应归一化，不接触工作区 SQLite、密钥存储或 Asset 持久化。

依赖边界

`service/media` 持有媒体任务与 Asset 真相，`media/providers/*` 只接收已解密的短生命周期凭据和引用数据，并返回供应商结果。异步提交先原子持久化 `job -> queued asset`；常驻 Host 用 SQLite lease 推进任务，并让同一凭据的一次请求 Provider 依次执行，避免一个调度批次并发冲击上游。对于同步返回最终字节的 Provider，提交检查点与 job/asset 的 `running` 状态必须同一事务提交，事务失败则保持可安全重试的 `queued`，绝不制造“已提交但未运行”的本地假故障；Atlas 则在外部接受 prediction 后原子绑定其远端 ID。`compose.go` 是独立的本地、确定性出口：只读取已完成 Asset 的服务私有路径，使用受验证的 FFmpeg 参数产生新的交付 Asset，绝不调用 Provider 或模型。同步图片生成、成片下载和提交均保留 5 分钟上限；状态查询固定使用 12 秒短超时，避免慢轮询占住 lease。任一 Provider 在 checkpoint 与结果持久化之间中断，任务明确失败而不重发收费请求，直到该 Provider 显式声明幂等契约。每次 Asset 改变与 SQLite `media_asset_events` 同事务提交，服务端通过 snapshot/replay SSE 传播当前完整 Asset；前端只读取本地 Asset，不能轮询 Provider。Seedance 的 `generateAudio` 是模型输出能力：创建任务时默认固化为 `true`，用户可显式关闭；Gemini 不声明该开关，绝不发送无效参数。Seedance 的本地视频参考先由 Atlas provider 上传并取得 Atlas URL，图片与音频按模型 Schema 使用 data URL；新增平台必须新增独立 provider 子目录并接入通用协调器，不能把协议分支塞回任务层；根 `service` 只通过 `media_adapter.go` 提供 Store 端口。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
