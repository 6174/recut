<!--
 [INPUT]: 依赖 recut.video.generate、recut.media.wait_for_job、已有 image/video assetId 与 Editor timeline.place/preview 能力。
 [OUTPUT]: generated-video 的 shot list、anchor、串行生成、修改与落轨规则。
 [POS]: 生成媒体到 Editor 可编辑时间线的交接层；不把生成 job 自动当成 timeline placement。
 [PROTOCOL]: 变更时更新此头部，然后检查 README.md
-->

# Generated Video 工作流（recut.editor）

生成视频是“生产 shot asset，再编排成片”，不是让模型用一条长 prompt 自己补完整叙事。每个 shot 必须有视觉职能、输入参考、结束状态和可回滚的 asset 结果。

## 概念判断：世界还是关系

视频模型擅长把“世界”变成有空间、动作、材质和摄影连续性的 shot；Motion Graphic 擅长把“关系”变成可读、可控、可编辑的视觉结构。不要把模型当作丰富度开关，而要看 concept 的价值落在哪里：

- 如果 viewer job 依赖人物表演、真实环境、物理运动、镜头语言或材质氛围，`generated-video` 通常更贴合；
- 如果 viewer job 是标题、数据、比较、流程、抽象关系或精确可读的文字，`motion-graphics` 通常更贴合；
- 如果场景需要情绪底片，同时需要精确解释，`hybrid` 让两种媒介各自服务一层 concept。

实现上可以探索 React SVG、R3F Shape/Path 或其他合适的图形语言；它们是把 concept 落地的手段，不是先验限制。生成模型未就绪时必须报告 readiness，不得静默用文字卡冒充同等结果。

## 先定 shot 结构

用户已明确“一条 clip / N 个镜头 / 多条独立 clip”时遵守原话；否则说明 trade-off：一条多 shot clip 更容易保持同一角色/光线/风格，多条 clip 更容易独立重做但需要 anchor。不要宣布拆分后直接提交。

每个 shot 至少记录：subject、action、scene、lighting/color、camera、style、duration、aspect ratio、motion endpoint 和 viewer job。多个 shot 复用角色、物体或场景时，先决定 anchor：优先用户提供或已经批准的 asset；没有合适 anchor 才建议生成一个并等待确认。

## 参考与连续性

- `imageAssetIds`、`videoAssetIds`、`audioAssetIds` 必须来自 `recut.media.list_assets` 或已完成 job；不接受外部 URL、base64 或猜测的 ID。
- 同一 recurring subject/style 的每个 shot 都传同一个 anchor，并在 prompt 里用外观属性说明它；不要只写“和上一镜一样”。
- 多角色为每个角色建立独立 anchor；在同框 prompt 中写明左右位置、服装/颜色/特征，必要时写显式 negation，避免属性串位。
- 依赖前一镜输出的 shot 必须等前一 job 到终态后再提交；默认一镜一 job，除非用户明确要求并行。

## 生成循环

1. 写 shot list 与 continuity notes，确认总时长、镜头数、画幅和视觉方向。
2. 选择生成 route/model；读取当前 `recut.context.media.readiness.video`，不把未配置能力静默替换成文字卡。
3. 为每个 shot 写描述性 name 和可执行 prompt，必要时带真实 reference asset IDs。
4. 调用 `recut.video.generate({ text, imageAssetIds?, videoAssetIds?, audioAssetIds?, output?, route? })`，保存返回 `jobId` 与 queued `assetIds`。
5. 用 `recut.job.wait` 观察终态；完成后先回读 asset，再用 `preview.frame` 或目标帧检查主体、动作、画幅和 continuity。
6. 用户要求入片时，才将完成 asset 传给 `timeline.command insert` 或批量 placement；生成工具本身不改变时间线。

## 修改与失败升级

用户反馈“改黄色/删角落文字/保留其他不变”属于局部修改，优先沿用原 asset 的 edit/continue route（若当前平台 route 支持）；如果要求改变镜头运动、摄影机、时长或整体风格，则重新生成并明确“会重新推理整镜”。

同一 continuity 问题经过两次纯文字 prompt 调整仍未解决时，停止堆 prompt，改用 anchor、reference asset 或编辑 route。不要第三次提交同类 text-only retry。

生成成功不等于镜头成立：必须有 shot asset ready、settled frame proof、timeline placement readback 和最终 `timeline.validate`。任何 queued/running/failed 状态都不能伪装成可用素材。
