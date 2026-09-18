# 克隆工作流：S1–S5 与门禁

配套技能 `recut-clone`；RFC `rfc/2026-09-17-reference-understanding.md` §5。

## S1 理解（写参考素材）

1. 参考素材就绪：真实内容（本地/直链入库）经 `recut.media.reference.create({ assetId, sourceUrl? })` 标记。
2. 载入 `recut-reference` 及其 `tools.md`：`probe` → `frames` / `contactSheet`（有转写则叠词）→ `boundaries` → 需要时 `clip`；`words` 默认不开。
3. `recut.media.reference.attach` 幂等写 `metadata.reference`（观察）。
4. 按 `recut-reference` 的写回规范写 `attributes`（`ref.*`）与 `content`（可 @ 证据）。
5. **G1 理解门**：观察 + 参考分析齐全，且证据可定位到源时间。

## S2 决定（写目标项目）

1. 载入 `recut-director（references/remix）`：反推公式，产出本目标的 `keep`/`replace`。
2. 落到项目 `analysis.md`：换主体/产品/语言/CTA、保留哪些机制与节拍、每个改动的落位。
3. **G2 计划门**：结论可定位（第几拍/哪个角色）；无定位视为未定义。
4. 不在此步写素材计划。

## S3 计划（占位素材 + content，不花钱）

1. 逐项 `recut.media.asset.create` 建占位素材（无字节、`status=proposed`）。
2. 写 `content`（规格，@ 锚定参考证据/角色/产品/World）+ 必要 `attributes`（role/shotKind/transferable/`refSource`）。
3. 写 `clone-plan.md`：每个占位素材的角色、理由、来源、预估时长。
4. **G3 付费门**：向用户呈报计划与预算；批准前**不触发任何生成**。video 一律先提案。

## S4 生成（读 content 生成）

1. 读占位素材 `content`（+ attrs）作提示词；把 @ 引用解析为生成参考绑定。
2. 补 `metadata.proposal`（capability/model/output）。
3. 逐元素物化：
   - **媒体**：`recut.video.generate`（默认 propose）→ 用户 `confirm` → 终态；图片/语音按路由。
   - **MG/图形**：`recut.motion-graphic.create`（免费）→ 等 `verified`。
   - **字幕/文本**：交给 `timeline-editor` 的字幕能力，不生成媒体。
4. 产物**原位填回同一 assetId**；按配方稳定 hash 复用未变素材，避免重复计费。

## S5 组装与交付（用 timeline-editor）

1. 载入 `timeline-editor`（见 `placement.md`）。
2. 落轨：`timeline.placeComponents`（图形）/ `timeline.placeAudio`（配音/配乐）/ `timeline.command`（媒体）。
3. 对齐：首版按「源片段秒数 / 计划时长」顺序铺；多场景与来源对齐。
4. **G4 落轨门**：`timeline.validate` 零违规 + 受影响 scene 的 settled frame 抽检（`preview.frame`/`preview.batch`）。
5. `export.start` → `recut.job.wait` 到 `completed` 取最终 video Asset；**实际观看/试听**。
6. **G5 交付门**：Done means watched。留档 `clone-plan.md` + 各元素 recipe hash。

## 中断与回滚

- 用户纠正时：停止未提交队列；未入库的 motion-graphic/media job 用 `recut.job.cancel`；已提交的时间线改动用 `timeline-editor` 的 `work.cancel`（按其技能凭据要求）。
- 已 verified 未落轨的素材保留，在项目里标 superseded。

## 零花费路径（最早验证）

只做「换语言 + 换图形文案」：S1→S2→S3→S4（仅字幕/图形/文案，不调生成），可完整跑通并导出，用来验证分层正确、clone 不必等于花钱。
