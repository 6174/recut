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
- **Look（视觉风格）** — 3–4 个主题适配的候选风格板。每个候选必须先生成一张 16:9 风格参考图，并把 `assetId` 和逐字生成 `prompt` 一起持久化；二者共同定义视觉风格，纸张技法、色板、排版、纹理和情绪仅是辅助元数据。图片/关键画面决定拼贴质感，动效不能挽救一张孱弱的海报。
- **Keyframes（关键画面）** — 每镜一张海报式画面规格：分层剪纸、撕纸、胶带、网点/新闻纸纹理、平面色块与标题位置。若已有参考图则保存 `imageAssetId` 并在界面显示图片；没有图时以镜头构图卡审阅。真实人物和品牌标记必须保留为受保护的参考资产，不得凭空替换。
- **Motion（动效设计）** — 每镜一个连续镜头运动加纸张原生元素运动；界面以镜头动效卡审阅。若生成预览片段，保存 `videoAssetId` 并直接播放。保持图形平面、文字和布局稳定，以短宽景/细节镜头的剪辑取得节奏，不要在一镜塞入多种运动。
- **Audio（音频方案）** — 旁白方向、音乐方向、字幕意图和混音约束；界面以音频方案卡审阅，生成并引用音频时保存 `audioAssetId` 并直接播放。
- **Delivery（交付规格）** — 最终时间线、画幅、导出规格与验证清单；界面以交付字段和清单审阅。它在适当的渲染 App 发布实际媒体前仅是计划。

## Human decision gates

1. Draft the **Beats** resource, then stop for user approval before creating downstream creative resources.
2. Draft the **Look** candidates by generating one reference image per candidate; persist each image `assetId` with its exact prompt, then stop for the user to choose a style before keyframes or motion.

If the user supplies an already-approved beat map or look, persist it as the relevant resource and continue. Do not silently replace an approved decision.

## Legacy resources

Look 缺少 `assetId` 或原始 `prompt` 即为旧格式错误资源，不得作为后续关键画面或动效的依赖。App 会在首次读取时一次性清理历史旧格式 Look；正常资源可通过 `delete_resource` 永久删除，但被下游资源引用时必须先处理依赖关系。

## Available actions

1. Call `generate_brief` first with a non-empty `topic`. It persists the brief and returns the immutable `recut.vox.brief@1` Artifact.
2. Call `create_resource` to persist every non-Brief stage. Always provide `kind`, `title`, and structured `content`; include all consumed resource IDs in `dependencies`.
3. In the UI flow, use `brief.create`, `brief.latest`, `resource.prepare`, and `resource.list`. `resource.prepare` creates the correct Agent request; completing the work still requires `create_resource`.

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
