# 克隆工作流：S0–S4

配套技能 `recut-clone`；锚点契约见 `anchors.md`，组装见 `placement.md`，核心主张与门见 `SKILL.md`。

**核心主张**：克隆 = 读懂参考 → 重新导演一支新片 → 用连续生成兑现。素材单位是「段/场景」，不是一帧。

## S0 立项

1. 无目标项目：`recut.editor.project.create` 建可编辑剪辑项目；有 project target 直接用。
2. `recut.editor.workflow_context` 取 `paths.projectFilesRoot`。
3. 建工作档：`BRIEF.md` / `reference.md` / `TREATMENT.md` / `PLAN.md` / `PROGRESS.md`，此后每步更新。
4. **续跑**：先读项目 markdown 与参考素材 `content`/`attributes`，并**校验参考身份**——用户本次来源（URL/描述）与参考资产 `url`/内容不一致时，重新 `recut.media.import` 并作废旧 Reference / Treatment / Plan。不读取宿主 session 数据库。

## S1 读参考（recut-reference）

1. 入库：`recut.media.import({ path|url|link })`；**不要传 `projectId`**（workspace 级全局素材）。
2. 标为参考：`recut.media.asset.update({ assetId, attrPatch: [{ key:"role", value:"reference" }, { key:"url", value: sourceUrl }] })`。
3. 读：`recut.media.probe` → `recut.media.contactSheet`（带时间码）→ 按需 `recut.media.frames`；转写经 `recut.audio-studio.audio.transcribe`。读取产物同样是 workspace 级分析物，不进项目素材库。
4. 理解写回素材 `content`/`attributes`（跨目标复用）；**本目标要用的带源时间读法写 `reference.md`**，含：
   - 整片机制（为什么有效）；
   - 带源时间的节拍；
   - **上屏文案系统**：句子、层级（字幕/强调/独立书写）、位置、强调纪律、结尾卡/数据卡形态；
   - 可迁移（公式）/ 不可复制（肖像/台词/构图/品牌）。

**自检 G1**：机制可定位到源时间；有可读 `speech@` 转写或明确用 `clock@`；上屏文案已记录。

## S2 导演（clone 的核心，产出 Treatment + Plan）

1. 载入 `recut-director（references/remix）`：反推公式，产出 keep/replace，每条定位到第几拍 → 写 `TREATMENT.md` 的决策基础。
2. 写 `TREATMENT.md`（导演的答案，用导演语言）：
   - 创意前提与观众体验；
   - 情绪走向、hook/reveal/payoff；
   - 逐拍意图（这一拍要观众感到什么）；
   - **逐场景媒介**（`generate` / `component` / `typography` / `hybrid` / `supplied`，判定见 `SKILL.md` §5）；
   - 连续性（人物/道具/光位/空间在段间怎么保持）；
   - 声音（独白只在哪、BGM 情绪、SFX）；
   - 上屏文字系统（全片字级、强调纪律、每屏一信息）。
3. 载入 `recut-director（references/shot）` + `references/generation-prompt`，写 `PLAN.md`：
   - 每条是一个**生成任务（段/场景）**，内部可含多个 shot；
   - 必含：意图 / 镜头（景别·机位·运动）/ **起止状态（下一段起＝上一段止）** / 媒介 / 参考锚点 / `anchor` / directing brief；
   - 需要**多镜连续段**时明确合并哪几拍进一个 request；
   - 信息/数据/排版场景走 `component`，并写明是 MG brief 还是字幕/typography。
   - **禁止**只有一句画面描述的「一图一行」。

**自检 G2 计划门**：`TREATMENT.md` + `PLAN.md` 完整、媒介已定、连续性合同闭合、锚点齐全、预算清楚；呈报用户可审可改。

## S3 做完（计划 → 生成 → 落轨）

1. **G3 花钱门**：呈报 Plan + 预算；获批后连续执行到落轨（视频确认是第二个人工门，不承诺无中断）。
2. 生成（政策见 `SKILL.md` §6）：
   - 逐段/场景提交；一段连续动作优先一次多镜生成；
   - 参考按能力提交：图片 `imageAssetIds`；视频 `references`（含 `role:voice`）+ 必要时 `audioAssetIds`；锚定表取自 `recut.worlds.get.references[]`；
   - 信息/数据/排版走 `recut.motion-graphic.create`（等 `verified`）；
   - 角色台词/独白用 World 声线参考合成；
   - 拿到稳定 assetId **立即回填 `PLAN.md`**；仅当下一步依赖产物内容时等待终态；代表段先 proof 再批量。
3. 落轨：目标 A-roll `script.attach` + `script.read`；按 `anchors.md` 把 anchor 算成 `[tlStart, tlEnd]`，`timeline.command` / `placeAudio` / `placeComponents` 落轨，回填窗口；字幕 `subtitle.import`。
4. **自检 G4**：`timeline.validate` 零违规 + 受影响 settled frame 抽检；段的媒体必须 `completed`/`verified`，未完成的 `proposed` 不得进入导出。

## S4 交付

1. `export.start` → `recut.job.wait` 到 `completed`。
2. **实际观看/试听**再报告；queued/running/failed/`editor-not-open`/`headless-unavailable` 都不算完成。
3. 留档：`PLAN.md`（含 assetId、窗口）、`TREATMENT.md`，便于只重做改动项。

## 中断与回滚

- 用户纠正：停止未提交队列；未入库的生成 job 用 `recut.job.cancel`；已提交的时间线改动按 `timeline-editor` 的 `work.cancel`。
- 已 `verified`/`completed` 未落轨的素材保留并在 `PLAN.md`/`PROGRESS.md` 标注。

## 零花费路径（最早验证）

只做「换语言 + 换图形文案」：S0→S1→S2→S3（仅字幕/图形，不调生成）→S4，可完整跑通并导出。
