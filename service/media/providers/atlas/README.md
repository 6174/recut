# atlas/

> L2 | 父级: /service/media/providers/README.md

成员清单
atlas.go: Atlas Cloud 默认地址、媒体上传、视频/图片提交、预测轮询与 Seedance/Gemini 请求映射；将 Seedance 的图/视频/音频引用和 Gemini 的纯图片引用归一化；图片经 `/api/v1/model/generateImage` 提交并复用同一 prediction 轮询生命周期。
atlas_test.go: 锁定 Atlas 默认地址、multipart 上传、completed/succeeded 终态和两个模型的参数边界。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
