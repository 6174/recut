# 用 timeline-editor 按锚点组装

clone 的**组装、字幕/图形、预览、校验、导出**全部交给 `timeline-editor`（`recut.editor.*` op + 它的技能 references）。本页只说明「clone 怎么把 `PLAN.md` 的锚点变成落轨」。锚点契约见 `anchors.md`；核心主张与门见 `SKILL.md`。

## 1. 先读 timeline-editor 的技能

| 需要解决 | 读它的 |
|---|---|
| 数据模型、element/track/scene、op 入口 | `timeline-workflow.md`、`data-model.md` |
| 落组件/媒体/音频 | `timeline-workflow.md`；组件放置契约见全局技能 `recut-motion-graphic/references/material.md` |
| 图形/MG 的视觉与动效（全局） | `recut-motion-graphic`、`directing.md`、`keyframes.md`、`params.md` |
| 字幕 | `captions.md` |
| 文稿（口播 A-roll 的留删、`script.read/apply`） | `speech-editing.md` |
| 预览与证据 | `verification.md`、`preview-export.md` |
| 报错与排错 | `errors.md` |

## 2. 会话与写入纪律

- `recut.editor.workflow_context`（读一次，**显式带 projectId**）→ `timeline.read` 看现状。
- 多步写入：`project.lock` 拿 `owner/token` → `work.checkpoint` → 写入带最新 `baseVersion` → `project.unlock`。
- 冲突：重读后重放，不整份重载。
- 落轨即把媒体素材自动加入项目素材库（无需额外登记）。

## 3. 锚点 → 时间线窗口

1. **目标 A-roll 先定稿**：`script.attach` 绑转写 → `script.read` 物化 `scripts/timeline.md` → 确认文稿。（纯生成式 VO 见 `anchors.md` §2 分支。）
2. **算窗口**：按 `anchors.md` 把 `PLAN.md` 里每条 `speech@` / `clock@` 映射为 `[tlStart, tlEnd]`。
3. **按媒介落轨**：

| PLAN 项媒介 / 产物 | 落到 timeline-editor |
|---|---|
| `generate` 媒体（已 `completed`） | `timeline.command` insert（video/image element，`assetId`），窗口取锚点映射；一段多镜生成落为**一个** video 元素 |
| `component`（MG，已 `verified`） | `timeline.placeComponents`，窗口取锚点映射 |
| `typography` / `caption` | `subtitle.import`（样式走 `caption-style`）/ text 元素 |
| `voice` / `music` / `sfx` | `timeline.placeAudio` |
| 封面 | `cover.*`（若用户要求） |

- **不做手填秒数的顺序铺**：窗口一律来自锚点映射；无口播用 `clock@` 显式给区间。
- 同一 `speech@` 可落多条（分屏/图文叠加），按轨道避碰。
- 落轨后把实际窗口回填 `PLAN.md`。

## 4. 落轨前校验（段的完整性与连续性）

- **媒体完成态**：只有 `completed`（媒体）与 `verified`（组件）才能进落轨；`proposed`/`planned` 视为未完成，导出前必须拒绝。
- **连续性合同**：相邻两段的「上一段结束状态 = 下一段起始状态」；同一世界/角色/光位跨段一致。若验收发现跳变，回 `PLAN.md`/`TREATMENT.md` 修正，不靠时间线掩盖。

## 5. 校验与交付

- **自检 G4**：`timeline.validate` 零违规；受影响 settled frame 用 `preview.frame` 抽检构图/可读性/连续性。
- **交付 G5**：`export.start` → `recut.job.wait` 到 `completed` → **实际观看**后报告。`editor-not-open` / headless 不可用时只能报告草稿。

## 6. 改稿重排

用户改 `scripts/timeline.md` → `script.apply` 后，元素 id 与时间线整体位移都会变，但 `speech@` 锚点是源时间，不失效：

1. 重新 `script.read` + `timeline.read`。
2. 对每条 `speech@` 按 `anchors.md` 重算窗口。
3. `timeline.command { trim }`（或 delete+insert）把锚定元素移到新窗口。
4. `timeline.validate` + `preview.frame` 抽检；新窗口回填 `PLAN.md`。
