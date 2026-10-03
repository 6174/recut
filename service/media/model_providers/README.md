# model_providers/

> L3 | 父级: /service/media/README.md

成员清单
provider.go: 按 Provider ID 分派的图片生成策略接口、注册表与请求/结果 DTO；策略只持有线协议，不接触工作区 SQLite、密钥存储或 Asset 持久化。
atlas.go: Atlas Cloud 原生图片策略——`SubmitImage` 提交 `/api/v1/model/generateImage`，轮询 prediction，下载 `outputs[0]` 为最终图片字节；有参考图时由任务层切换到 `…/edit` 模型变体。轮询按调用方给定的 `PollBudget`（墙钟预算，未设置时默认 30 分钟）收敛，预算耗尽返回超时错误并保留已 checkpoint 的 prediction 供重试复取，不按次数截断。状态查询的**瞬时传输错误**（如复用 keep-alive 被服务端关闭的 `unexpected EOF`、超时、截断的响应体）不代表远端任务失败：在预算内按短退避重试，绝不误判为 provider 终态，从而保持 Asset 与远端 prediction 的关联；只有 provider 显式返回的 HTTP 状态错误或 unrecoverable 响应才终止。
openai.go: OpenAI 兼容图片策略（openai / openai-compatible）——无引用走 JSON `/images/generations`，有引用走 multipart `/images/edits`。

模型变体：Atlas 图片的文本生成（`…/text-to-image`）与基于参考图的编辑（`…/edit`）是两个模型 ID。目录中的 `EditModelID` 声明编辑变体；`jobs.go` 在 job 带参考图时自动切换，无参考图时保持 text-to-image。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
