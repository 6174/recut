# recut-editor skill/

> L2 | 父级: [/apps/editor/README.md](/Users/chenxuejia/ws/recut/apps/editor/README.md)

Editor Agent 的导演契约与 treatment 参考。`SKILL.md` 只定义统一创作链和工具边界；`references/` 按编辑问题分派细节，避免把 talking-head、motion graphics、voice 和 generated-video 混成一套浅规则。

成员清单

- `SKILL.md`: intent/scope → route/scene-concept → design system → visual assets → timeline → proof/export 的主契约，并规定 graphics-first 的概念引导。
- `references/speech-editing.md`（薄适配层，决策见 `service/skills/recut-directing-a-roll`）: `script.*` 工具语义与 `timeline.command` 落地、操作↔全局判断对应表；语义决策指向全局 a-roll。
- `references/motion-graphics.md`: motion graphic style gate、从 concept 到 SVG/Shape Path 的表达探索、代表性组件、目标帧摆放、复用和批量验证。
- `references/subject-protection.md`（薄适配层，决策见 `service/skills/recut-directing-b-roll`）: `param`/`preview.frame` 的介质映射与验证步骤；主体/安全区/cover-contain 决策指向全局 b-roll。
- `references/voiceover.md`: visual-first narration sync map、TTS duration、音轨角色和 SFX。
- `references/voice-assets.md`: 声音资产总览——ASR 转写与 TTS 配音的能力/就绪门/本地环境缺失时引导与就绪时直接使用。
- `references/video-generation.md`: 以“世界/关系”概念判断生成视频与 Motion Graphic、shot list、anchor、串行生成、continuity 和失败升级。
- `references/verification.md`: 结构、像素、交付三层证据与失败分类。
- `references/components.md` / `references/component-authoring.md`: 组件工具、surface、SDK、构建和确定性动画契约。
- `references/captions.md`（薄适配层，决策见 `service/skills/recut-directing-captions`）/ `references/music-beat-sync.md`（薄适配层，决策见 `service/skills/recut-directing-editing`）: 前者保留 `subtitle.*` 与 `timeline.command` 字幕轨实现，后者保留拍号获取与 `track.role`/`audio.smooth` 落拍实现；纪律规则均指向全局。
- `references/data-model.md` / `references/timeline-workflow.md` / `references/params.md` / `references/keyframes.md`: Editor 数据、op、参数和关键帧语义。
- `references/preview-export.md` / `references/errors.md`: 预览、导出、封面和恢复路径。

依赖方向：intent/scope 先决定是新片还是二次编辑 → route + scene concept 引导生成视频、Motion Graphic 或 hybrid → reference 读取项目/素材证据 → `component.create` 或媒体生成产出 asset → `timeline.command`/`timeline.placeComponents` 落轨 → `verification.md` 统一验收。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
