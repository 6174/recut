---
name: recut-clone
appId: recut.platform
description: 用一支参考跑出一条新片：先立 editor 项目并把一切写进项目内的 clone.md（参考读法、keep/replace、计划+语义锚点、组装记录），图片直接生成、视频先落待确认素材，最后用 timeline-editor（recut.editor.*）按锚点组装、校验与交付。
---

# 克隆执行技能（recut-clone）

本技能是 Recut 平台无关的全局技能，只回答一个问题：**给定一支参考与一个目标（换主体/产品/语言/CTA），怎么把它跑成一条可编辑、可交付的新片？**

它不重复理解方法、不重复迁移判断、不定义素材协议、不教时间线 op 语法——它把这些**串成一条最短路径并设两个硬门**。

规范与契约：`rfc/2026-09-17-reference-understanding.md`。**本技能已精简**：不再使用 content-first 占位素材，不再有独立的 analysis/clone-plan 文档，不再做锚点升级往返。

## 0. 最短路径

```text
S0 立项   editor 项目 + 项目内 clone.md（唯一文档，一切写这里）
S1 读参考  recut-reference：证据写参考素材，读法写 clone.md
S2 定目标  keep/replace + 目标 A-roll 脚本 → clone.md
S3 做完    计划表（含 anchor）→ 生成 → 按 anchor 落轨 → 校验
S4 交付    实际观看 → 报告
```

**只有一个文档：`clone.md`**，落在 `workflow.context.paths.projectFilesRoot`，分节：

```markdown
# Clone: <目标一句话>
## Reference   # 参考是什么 + 带源时间的读法（跨目标可复用的分析仍在参考素材上，这里只留本目标要用的）
## Decisions   # keep/replace，每条定位到第几拍
## Script      # 目标 A-roll 文稿（或目标口播的转写基准）
## Plan        # 计划表：item | role | anchor | spec(提示词/文案) | refs | assetId | tlWindow
## Assembly    # 落轨、校验、导出记录
```

计划表就是「装配脚本」：**anchor 权威在这里**（不再写进素材 attr），生成后把 `assetId`、落轨后把 `tlWindow` 回填同一行。

## 1. 两个硬门（其余都是自检清单）

- **花钱门**：S3 触发任何付费生成前，把 Plan 与预算呈报用户并获批。未批准不提交。
- **交付门**：Done means watched。导出后实际观看/试听再报告；queued/running/failed/`editor-not-open` 都不算完成。

G1 理解齐、G2 决策可定位、G4 落轨零违规是**自检**，不设停等；不通过就继续做，不打断用户。

## 2. 边界声明

| 谁 | 负责 | 不负责 |
|---|---|---|
| `recut-reference` | 看懂、留证据、参考分析（写参考素材） | 不决定换什么 |
| `recut-director（references/remix）` | 反推公式、保留/替换判断 | 不教工具用法、不落轨 |
| `timeline-editor`（`recut.editor.*`） | 时间线组装、字幕/图形、预览、校验、导出 | 不决定 clone 流程 |
| **`recut-clone`（本技能）** | 编排 S0–S4、两个硬门、计划表 + anchor、生成与落轨 | 不重复上述三者内容 |

## 3. 分步

### S0 立项
- 无目标项目：`recut.editor.project.create` 一步建可编辑剪辑项目（带默认场景/主轨）；用户已给 project target 就直接用。
- `recut.editor.workflow_context` 取 `paths.projectFilesRoot`；建 `clone.md`，随后每步都在里面追加/更新。

### S1 读参考
- 载入 `recut-reference`：引入（`recut.media.import`）→ 标为参考（`recut.media.asset.update` 写 `role`）→ 读（`probe` / `contactSheet` / 按需 `frames`）→ 把理解写回素材 `content`/`attributes`。
- 分析写参考素材的 `content`/`attributes`（跨目标复用）；**本目标要用的带源时间读法写进 `clone.md → Reference`**。

### S2 定目标
- 载入 `recut-director（references/remix）`：反推公式，产出 `keep`/`replace`，每条定位到第几拍 → 写 `clone.md → Decisions`。
- 同时定目标 A-roll 脚本（换词/换语言后的新文稿）：能生成就先 `recut.speech.generate` 出声；有实拍 A-roll 就入库并 `script.attach` 转写。脚本落 `clone.md → Script`。

### S3 做完（计划 → 生成 → 落轨）
1. **计划表**：`clone.md → Plan` 每行 = 一个镜头/素材：
   - `role`（a-roll / b-roll / mg / caption / voice / music / sfx）
   - `anchor`（**必有**）：`speech@<目标转写assetId>#起-止`（跟着某句话）或 `clock@起-止`（无口播/纯图形）。token 见 `references/anchors.md`。
   - `spec`：生成提示词 / 字幕文案 / 图形 brief。
   - `refs`：参考素材 assetId（角色/风格/关键帧）。
2. **付费门**：呈报 Plan 与预算，获批。
3. **生成**（§4 政策）：`recut.image.generate` / `recut.video.generate` / `recut.speech.generate` / `recut.motion-graphic.create`；拿到稳定 assetId 立即回填 `Plan.assetId`；只有下一步依赖产物内容时才用 `recut.job.status/wait`。
4. **落轨**：目标 A-roll 先 `script.attach` + `script.read` 定基准；按 `anchors.md` 把每个 anchor 映射成 `[tlStart, tlEnd]`，用 `timeline.command` / `placeAudio` / `placeComponents` 落轨，回填 `Plan.tlWindow`。字幕走 `subtitle.import`。
5. **自检**：`timeline.validate` 零违规 + `preview.frame` 抽检受影响场景。

### S4 交付
- `export.start` → `recut.job.wait` 到 `completed` → **实际观看** → 报告（含 Plan/assetId/recipe hash，便于只重做改动项）。

## 4. 生成政策（对 AI 而言所有素材都是「直接生成」）

- 统一入口：`recut.image.generate` / `recut.video.generate` / `recut.speech.generate` / `recut.motion-graphic.create`。提交即返回稳定 assetId，**立刻回填 Plan 并继续**；没有 `mode`，也不向用户说「提案」。
- **图片**：`text`=spec；**角色/世界/风格参考一律放 `imageAssetIds`**（image 能力只读该字段）。先出样图、读图验收再批量。
- **视频**：平台默认先落为**待用户确认**的素材（全局设置可关闭该门禁）；**AI 只提交与落位，绝不代确认**。参考关键帧放 `imageAssetIds`；`aspectRatio`/`durationSec` 显式且与项目 `canvasSize` 一致。
- **图形**：`recut.motion-graphic.create` → 等 `verified` 才落轨。
- **语音**：`recut.speech.generate`（`text`=Script 行）。

## 5. 硬规则

- **一个文档**：所有目标侧内容只写 `clone.md`；参考的跨目标分析才写参考素材。不建 analysis/plan/reading 多份文档。
- **计划表必有 `anchor`**；不做「按顺序估时长」的手铺。改稿后按 anchor 重排（`references/placement.md`）。
- **无占位素材**：计划只在 `clone.md`；生成直接产出真实 assetId，回填 Plan。不要为空计划建无字节 asset。
- **不复制源台词/构图/肖像**（remix 红线）；只迁移可复用结构。
- **不代用户确认视频生成**；付费前必须获批。
- 所有素材以真实 `assetId` 引用；不臆造 id、不复制二进制。

## 参考文档

- `references/anchors.md`：anchor token、计划表写法、锚点→时间线窗口映射与改稿重排。
- `references/workflow.md`：S0–S4 的完整步骤与自检清单。
- `references/placement.md`：用 `timeline-editor` 按 anchor 组装。
