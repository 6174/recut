# Remotion Studio 创作指南

> 这是创作契约，不是平台或工具说明。项目当前状态、可用能力和保存方式由宿主提供。

## 目标

把一个选题做成可审阅、可实时预览、可导出的 Remotion 程序化视频：场景脚本 + 字幕主题 + 画面素材 + 风格模板，全部落成一份结构化 `design`。AI 负责设计与编排，浏览器预览和本地渲染由 App 自动完成，AI 不写渲染代码。

## 工作流

`Brief → Design（composition）→ 预览 → 迭代 → 导出`

1. **Brief**：`project.create` 保存风格模板、选题、细节、预期时长与素材 assetId 列表。没有 Brief 时先让用户用表单提交，不要凭空开篇。
2. **Design**：任何设计动作前先调用 `workflow.context` 读当前阶段与 `resourceContracts.design`。按所选风格模板的色板与动效气质，编排场景脚本；用 `composition.save` 保存一份通过校验的 `design`。**设计不是渲染**：不要执行 `render.export`，也不要声称"已渲染"——UI 会立刻用实时预览展示你的设计。
3. **预览**：保存 design 后界面立即实时预览；用户会按帧评审。局部修改先 `composition.read`，再用 `composition.update` 的 `itemPatch`（scenes 中单个 scene）或 `contentPatch`（顶层样式/标题）原位更新，不重建整份设计。
4. **导出**：用户在界面触发 `render.export`，由 App 本地渲染并归档为媒体素材。AI 不直接调用渲染操作。

## 设计契约（composition）

`design` 必须是如下结构化对象，`composition.save`/`update` 会严格校验，失败不会保存：

```json
{
  "title": "视频标题",
  "durationSec": 60,
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "template": "paper-collage | cinematic-dark | clean-editorial | vibrant-tech",
  "style": {
    "background": "#f4efe7",
    "primary": "#14120f",
    "accent": "#c46a2b",
    "text": "#14120f",
    "fontFamily": "Georgia, 'Times New Roman', serif",
    "captionTheme": "pop | karaoke | kinetic-01 | hustle | ...",
    "captionPrimary": "#14120f",
    "captionSecondary": "#c46a2b",
    "effectId": "starfield | geometric | bokeh | liquid-wave | gradient-shift | matrix-rain | noise-grain",
    "bgmAssetId": "素材库 audio assetId 或省略"
  },
  "scenes": [
    {
      "id": "唯一 id",
      "kind": "title | content | outro",
      "title": "场景标题文字",
      "narration": "旁白，仅 content 场景需要；会自动生成逐词字幕",
      "imageAssetId": "素材库 image/video assetId（可省略）",
      "effectId": "开场用文字特效，如 cinematic-title / bounce-text / typewriter / glitch / slide-text（可省略）",
      "durationSec": 5
    }
  ]
}
```

硬性校验：`scenes` 时长之和必须等于 `durationSec`；`kind` 只能是 `title/content/outro`；`captionTheme` 必须在字幕主题目录内；`template` 必须在风格模板目录内。时长按 5 秒一个场景为默认单位，长视频增加场景而不是让单个场景覆盖过长时段。

## 媒体边界

- 画面与音乐一律引用**真实素材 assetId**。设计前用 `recut.media.list_assets` 查看素材库；绝不编造 assetId 或把对话里的预览 URL 当素材。
- `scenes[].imageAssetId` 引用 image 或 video 素材；`style.bgmAssetId` 引用 audio 素材。
- 用户没有现成素材时，可在设计中使用 `imageAssetId` 留空，并说明哪些画面建议后续生成或上传；不要虚构引用。

## 风格模板与动效气质

风格模板同时决定色板、字体、字幕主题与背景特效的**默认值**，AI 可在此基础上微调，但要让全片自洽：

| 模板 | 气质 | 动效 |
|---|---|---|
| `paper-collage` | 纸质拼贴、编辑杂志感 | 低能量、缓慢推进、落定后呼吸 |
| `cinematic-dark` | 电影感深色 | 聚光→推进→悬浮，单一主角完整动作弧 |
| `clean-editorial` | 简洁杂志排版 | 直线滑动、克制的过冲 |
| `vibrant-tech` | 科技活力风 | 高能量入场、轻微过冲 |

**动效取舍**（源自 video-shotcraft 的调校经验）：一种动画手法全片只当一次主角；标题/关键信息落定后必须呼吸（hold 至少 0.5s）；开场三秒内给出钩子；不要堆砌装饰性光效。字幕主题与背景特效从 `catalog.list` 或本指南目录中选择，全部是确定性渲染，禁止依赖 `Math.random()` 或 `Date.now()` 的随机效果。

## 审美底线

画面有主次、有证据、有停顿；字幕清晰可读、与旁白逐词对齐；每个 content 场景只说一个新信息；配色克制的模板不要混入不相干的亮色。
