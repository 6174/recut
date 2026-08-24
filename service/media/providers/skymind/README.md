# skymind/

> L2 | 父级: /service/media/providers/README.md

成员清单
skymind.go: Skymind Token API 适配器（provider ID `skymind-token`，默认 base `https://token-api.skymind.pro`）：图片 `POST /v1/images/generations`（OpenAI 兼容、同步、b64_json）；视频统一任务协议 `POST /openapi/v1/video/generations`（Seedance 2.0/2.5，支持 text/image/video/audio 公网 URL 参考、`metadata.generate_audio`、`metadata.seed`、`duration:-1` 自适应）+ `GET {task_id}` 状态轮询 + `GET {task_id}/content` 字节回收（回退 `video_url`）；两种上游错误信封（`{code,message}` / `{error:{…}}`）归一化为 `ProviderError`（含友好中文），提交/轮询/下载方法按端点族拆分以便未来扩展 TTS 与图片编辑端点。
skymind_test.go: 锁定统一任务协议 wire 形态（queued 提交、running/succeeded/failed 轮询、`/content` 与 `video_url` 回收、嵌套 error 对象与 pointer 字段）、OpenAI 兼容图片 b64 解析与两种错误信封的归一化边界。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
