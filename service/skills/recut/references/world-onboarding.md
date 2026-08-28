# World Onboarding：完善一个世界的标准工作流

用户明确要求完善 / 填充 / 搭建某个 local 世界（详情页引导卡的「让 AI 帮我完善」、onboarding 请求、
"帮我完善这个世界"）时，按本工作流执行。它把"创建后空壳"变成"场景蓝图 → research → generate →
提案 → 确认写回"的闭环。**铁律不变**：无用户明确请求绝不写 World；本工作流的每次触发都以用户
动作为起点。

## 1. 读取工作清单

```text
recut.worlds.readiness({ worldId, scenarioId? })
```

- 返回 `level`（skeleton / draft / ready）、`score` 与按优先级排序的 `missing`（每项含 `kind`、
  `title`、`reason`、`suggestion`）。
- `scenarioId` 缺省按世界类型推荐：`fiction_world→novel-adaptation`、`creator_brand→ip-account`、
  `character_ip→style-system`、`brand→brand-guide`、`custom→blank`。用户给了素材线索时可选更贴合的
  蓝图（小说文本→novel-adaptation；账号链接→ip-account；风格图集→style-system）。
- 用户消息可能已携带 `?scenario=` 上下文（创建弹框选择后跳转），优先沿用。
- 若用户带来了素材（文件/链接/口述），先消化素材再回看 missing——素材决定内容，蓝图只决定结构。

## 2. 消化用户素材

| 素材形态 | 动作 |
| --- | --- |
| 链接（小说站、社媒账号、文章） | `recut.media.create_reference` 登记为来源（保留元数据）；宿主可抓取时读取正文。账号类归纳语气、选题域、高互动内容的语言规范 |
| 文本（章节、设定集、品牌手册摘录） | 直接消化。长文分段处理，**只依据原文**，不脑补 |
| 图片 / 音视频 | 作为证据候选呈现给用户确认；不臆断其内容 |
| 纯口述（无素材） | 按 missing 逐项提问，每次 1-3 个问题，不一次抛出全部 |

素材未覆盖的字段：在提案中标注「需要你补充」，**绝不编造 Canon 事实**。

## 3. Research 纪律

- 消化产物先对齐蓝图目标形态（如 novel-adaptation：角色卡含 appearance/personality/voice/
  invariants；story 含 premise；location 含 description）。
- 原文与产出可追溯：角色卡字段尽量保留原文依据；用户追问时能指出出处。
- 世界定位（identity）：从用户目的与素材归纳一句话定位，放入提案请用户确认。

## 4. Generate（仅在蓝图期望且用户同意时）

- 角色参考图、风格示例等候选用宿主图片生成工具（Recut 中为 `recut.image.generate`）生成。
- **产物是候选**：把 assetId 深链与画廊式清单交给用户挑选；用户勾选前不得调用
  `recut.worlds.evidence.attach` / `references.attach`。未勾选 = 未发生。
- 生成预算克制：首轮每类 2-3 张样张，确认方向后再补全。

## 5. 提案（等待用户确认）

输出一份结构化提案，包含：

1. 拟写入实体逐条完整内容（kind、title、summary、content 全文预览）；
2. 拟写入 `skillMd`（world.md）全文（蓝图骨架：定位 / 工作流 / 资源口径）；
3. 候选素材清单（assetId 深链 + 建议的 purpose/status/collection）；
4. 素材未覆盖、需要用户补充的项；
5. 用户的预期 revision（提案时 `recut.worlds.get` 的 `currentRevisionId`）。

用户可能整体采纳、逐项勾选或修改——以用户最终确认为准。

## 6. 确认后写回

- 逐条调用既有写工具：`recut.worlds.entities.upsert`、`recut.worlds.evidence.attach`（仅用户勾选的
  候选）、`recut.worlds.update(skillMd)`，全部携带 `expectedRevisionId`（提案时的 revision）。
- 任何一条返回 `WORLD_REVISION_CONFLICT`：**停止整批写回**，重读最新状态，刷新提案差异后再次请
  确认——绝不静默覆盖。
- 非 local 世界只读（`WORLD_READ_ONLY`）：说明边界并提议 `recut.worlds.fork`，在副本上走本工作流。
- 写回完成后汇报：新增/更新的实体与证据清单 + 新 revision + 更新后的 `readiness.level`。

## 边界（不变）

- 无用户明确请求绝不写 World；onboarding UI / 用户消息的确认即明确请求。
- 生成结果永不自动成为证据；候选未勾选 = 未发生。
- 蓝图只是度量和建议：用户想存蓝图之外的内容，照常写——readiness 不惩罚蓝图外的自由 Canon。
