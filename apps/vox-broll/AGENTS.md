# Vox B-roll Agent Guide

> App-local operating contract | Parent map: /apps/vox-broll/README.md

This guide adapts the creative workflow of [vox-director](https://github.com/Alisa0808/vox-director) to Recut's App model. It is not runtime configuration: `manifest.json` remains the only runtime declaration, and this App does not itself render media or require Atlas Cloud, ffmpeg, or local output files.

## Goal

Turn a topic into a reviewable Vox-style paper-collage B-roll production plan. Persist every approved stage as an App resource so later stages consume explicit IDs rather than chat memory.

## Production graph

`Brief → Beats → Look → Keyframes → Motion → Audio → Delivery`

Create resources in that order. A later resource must list the IDs of the earlier resources it uses in `dependencies`.

- **Brief（创作简报）** — 文字决策：主题、受众、论点、核心张力与编辑方向；界面以短文本字段审阅。
- **Beats（叙事节拍）** — 文字叙事：一个已选的叙事弧、≤3 秒钩子与精炼节拍表。30 秒作品通常有 6–8 个节拍，每项包含宽景标题镜头与细节镜头，各 3–6 秒；界面以节拍列表审阅。
- **Look（视觉风格）** —  风格版是是为了定义整个视频内容的整体风格元素，将视频中可能展示的元素整体放到一张图中，这样每个场景的结果
- **Keyframes（关键画面）** — 每镜一张海报式画面规格：分层剪纸、撕纸、胶带、网点/新闻纸纹理、平面色块与标题位置。若已有参考图则保存 `imageAssetId` 并在界面显示图片；没有图时以镜头构图卡审阅。真实人物和品牌标记必须保留为受保护的参考资产，不得凭空替换。
- **Audio（音频方案）** — 每个场景对应的音频内容
- **Motion（动效设计）** — 结合音频内容 + 叙事上下文 + 风格生成的一段一段的 scenes 动画
- **Delivery（交付规格）** — 最终时间线、画幅、导出规格与验证清单；界面以交付字段和清单审阅。它在适当的渲染 App 发布实际媒体前仅是计划。

## Human decision gates

1. Draft the **Beats** resource, then stop for user approval before creating downstream creative resources.
2. Draft the **Look** candidates by generating one reference image per candidate synchronously; persist each image `assetId` with its exact prompt, then stop for the user to choose a style before keyframes or motion.

If the user supplies an already-approved beat map or look, persist it as the relevant resource and continue. Do not silently replace an approved decision.

## Legacy resources

Look 缺少 `assetId` 或原始 `prompt` 即为旧格式错误资源，不得作为后续关键画面或动效的依赖。App 会在首次读取时一次性清理历史旧格式 Look；正常资源可通过 `delete_resource` 永久删除，但被下游资源引用时必须先处理依赖关系。

## Available actions

1. Call `workflow_context` before every creative action. Its current resources, gates and `allowedActions` override chat history and old Artifacts.
2. Call `generate_brief` first with a non-empty `topic`. It persists the brief and returns the immutable `recut.vox.brief@1` Artifact.
3. Call `create_resource` to persist every non-Brief stage. Always provide `kind`, `title`, and structured `content`; include all consumed resource IDs in `dependencies`.
4. In the UI flow, use `brief.create`, `brief.latest`, `workflow.context`, `resource.prepare`, and `resource.list`. `resource.prepare` creates a short task packet; completing the work still requires `create_resource`.

## Boundaries

- Do not write briefs, plans, or resources directly to files. This App owns SQLite state and publishes Artifacts itself.
- Do not inspect another App's database or filesystem. Cross-App input must arrive through a public API or Artifact reference.
- Text drafted in chat is not App state. A stage exists only after `create_resource` succeeds.
- Keep dependencies explicit IDs; never infer hidden provenance from prose.
- Do not claim that a keyframe, clip, soundtrack, or final video exists unless a producing App has published it as a resource or Artifact.

## Change protocol

- When the manifest's tools, API names, permissions, data model, stage graph, or approval gates change, update this guide and `/apps/vox-broll/README.md` in the same change.
- When changing `background.js`, keep its INPUT/OUTPUT/POS header accurate.

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
