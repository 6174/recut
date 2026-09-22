# 克隆工作流：S0–S4

配套技能 `recut-clone`；锚点契约见 `anchors.md`。**目标：最少步骤、最少文档。**

## S0 立项

1. 无目标项目：`recut.editor.project.create` 建可编辑剪辑项目；有 project target 直接用。
2. `recut.editor.workflow_context` 取 `paths.projectFilesRoot`。
3. 建 `clone.md`（分节：Reference / Decisions / Script / Plan / Assembly），此后每步都在这里更新。

## S1 读参考（recut-reference）

1. 入库：`recut.media.import({ path })`（本地文件）或 `recut.media.import({ url })`（直链媒体）；网页用 `recut.media.import({ link })`。**不要传 `projectId`**——参考是 workspace 级全局素材，不是项目素材。
2. 标为参考：`recut.media.asset.update({ assetId, attrPatch: [{ key:"role", value:"reference" }, { key:"url", value: sourceUrl }] })`。
3. 读：`recut.media.probe` → `recut.media.contactSheet`（带时间码）→ 按需 `recut.media.frames`；转写经 `recut.audio-studio.audio.transcribe`。这些读取产物都是 workspace 级分析物，同样不进项目素材库。
4. 理解写回素材：`recut.media.asset.update({ assetId, content, attrPatch: [ref.*] })`（只写 content/attributes，无 metadata.reference）。
5. 分析写参考素材 `content`/`attributes`（跨目标复用）；**本目标要用的带源时间读法写 `clone.md → Reference`**。

**自检**：证据可定位到源时间；参考分析已落素材。

## S2 定目标

1. 载入 `recut-director（references/remix）`：反推公式，产出 `keep`/`replace`，每条定位到第几拍 → `clone.md → Decisions`。
2. 定目标 A-roll 脚本：能生成就 `recut.speech.generate` 出声；有实拍就入库并 `script.attach` 转写。脚本落 `clone.md → Script`。

**自检**：keep/replace 可定位；Script 有可转写基准。

## S3 做完（计划 → 生成 → 落轨）

1. 写 `clone.md → Plan`：每行 `role | anchor | spec | refs`；有口播用 `speech@<目标转写assetId>#起-止`，否则 `clock@起-止`。
2. **付费门（一次性）**：呈报 Plan + 预算，获批后连续执行到落轨；不再中途反复确认。用户说「开始 / 继续」即视为批准。
3. 生成：
   - 图片 `recut.image.generate`（参考放 `imageAssetIds`；先出样图验收再批量）；
   - 视频 `recut.video.generate`（默认待用户确认，AI 不代确认；`aspectRatio`/`durationSec` 与画布一致）；
   - 图形 `recut.motion-graphic.create`（等 `verified`）；
   - 语音 `recut.speech.generate`。
   - 拿到稳定 assetId 立即回填 `Plan.assetId`；仅当下一步依赖产物内容时才 `recut.job.status/wait`。
4. 落轨：目标 A-roll `script.attach` + `script.read`；按 `anchors.md` 把每个 anchor 算成 `[tlStart, tlEnd]`，`timeline.command` / `placeAudio` / `placeComponents` 落轨，回填 `Plan.tlWindow`；字幕 `subtitle.import`。
5. **自检**：`timeline.validate` 零违规 + `preview.frame` 抽检受影响场景。

## S4 交付

1. `export.start` → `recut.job.wait` 到 `completed`。
2. **实际观看/试听**再报告；queued/running/failed/`editor-not-open` 都不算完成。
3. 留档：`clone.md`（含 Plan、assetId、tlWindow、recipe hash），便于只重做改动项。

## 中断与回滚

- 用户纠正：停止未提交队列；未入库的生成 job 用 `recut.job.cancel`；已提交的时间线改动按 `timeline-editor` 的 `work.cancel`。
- 已 verified 未落轨的素材保留并在 `clone.md` 标注。

## 零花费路径（最早验证）

只做「换语言 + 换图形文案」：S0→S1→S2→S3（仅字幕/图形，不调生成）→S4，可完整跑通并导出。
