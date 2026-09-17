<!--
 * [INPUT]: 依赖 rfc/2026-09-17-reference-understanding（全局理解工具 + recut-reference skill）、rfc/2026-09-17-editor-native-migration（timeline 下沉 Go / 去 iframe / Render Host / 素材平台化）、
 *   rfc/2026-08-29-global-directing-skills（唯一性原则与全局 skill 形态）、recut-director/references/remix（迁移决策）、
 *   service/media（媒体生成提案）、recut.editor.* op（时间线读写与落轨）、docs/platform-comms-contract、docs/app-contract
 * [OUTPUT]: 定义「克隆」的执行层 skill：形态与位置、与 reference/remix/timeline 技能的分工、分阶段工作流与门禁、产物与项目文件、
 *   每步 MCP 工具用法、验收（含零花费路径）、非目标、风险与未决问题
 * [POS]: rfc 的「clone 执行」决策；四条迁移/能力路线（宿主迁移 → 视频理解 → 素材 attrs 协议层 → clone skill）的最后一步
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 * -->

# Clone Skill：参考视频 → 新片的执行工作流

- 状态：提案（待评审）
- 日期：2026-09-17
- 关联：[参考视频理解](./2026-09-17-reference-understanding.md)、[Editor 迁移](./2026-09-17-editor-native-migration.md)、
  [全局导演技能库](./2026-08-29-global-directing-skills.md)、[媒体生成提案](./2026-09-16-media-generation-proposal.md)、
  [Editor AI 成片质量](./2026-08-19-editor-ai-video-authoring-quality.md)
- 前置依赖：① [Editor 迁移](./2026-09-17-editor-native-migration.md)（决定 timeline 域与 skill 的寄宿）；② [参考视频理解](./2026-09-17-reference-understanding.md)（证据与 `recut-reference`）；③ [素材属性能力](./2026-09-17-asset-attributes.md)（`attributes` / `facets` 与真实内容参考接口）。
- 外部对照：Hypit（`/tmp/hypit`）。只借「参考真相与目标真相分离、先理解再生成、素材可复用、Done means watched」四条判断，不引入语法与包生态。
- 非目标：不定义素材属性协议（属素材 attrs 协议层 RFC）；不定义时间线数据模型；不引入 XML/DSL；首版不做语义锚点与一变多。

## 0. 摘要

克隆的执行本质是四步：**看懂参考 → 决定换什么 → 计划素材 → 生成并落轨**。每一层都已经（或即将）有独立归属：

```text
recut-reference（全局 skill）      看懂 + 留证据
        │  参考素材 facet（证据，跨目标复用）
recut-director/references/remix   决定保留/替换（迁移判断）
        │  analysis.md（keep / replace）
素材属性能力（attributes/recipe）   计划素材元素（先计划不花钱）
        │  clone-plan.md
本 RFC：recut-clone（全局 skill） 编排执行 + 门禁 + 落轨 + 交付
```

本 RFC 只定义**执行层的编排与门禁**：不重复理解方法、不重复迁移判断、不定义素材协议，而是把三者串成一条有门禁、可审阅、可交付的工作流。

## 1. 定位与边界

**唯一决策问题**：给定一支参考与一个目标（换主体/产品/语言/CTA），**怎么把它跑成一条可编辑、可交付的新片？**

| 谁 | 负责 | 不负责 |
|---|---|---|
| `recut-reference` | 怎么看懂、留什么证据 | 不决定换什么 |
| `recut-director/references/remix` | 反推公式、保留/替换的判断 | 不教工具用法、不落轨 |
| 时间线/编辑器技能 | 时间线 op 的介质用法 | 不决定 clone 流程 |
| **`recut-clone`（本 RFC）** | 编排四步、把判断译成计划、门禁与交付 | 不重复上述三者的内容 |

## 2. 技能形态与位置

**推荐**：全局 skill `service/skills/recut-clone/`（`SKILL.md` + `references/`），与 `recut-reference`、`recut-director` 并列。

理由：

- clone 编排**跨域**（理解 / 素材计划 / 生成提案 / 时间线落轨），不应绑在单个 App/模块；
- 与 `recut-reference` 对称：一个管「看懂」，一个管「跑通」；
- 时间线编辑技能保持薄，只被引用（`recut-clone/references/placement.md` 指向它）。

**替代方案（未决）**：作为 `recut-director/references/clone/` 子技能（与 `remix` 同级，强调「唯一入口在 director」）。若选此案，本 RFC 的工作流与门禁不变，只改寄宿位置。

**前置未决（来自迁移 RFC）**：编辑器不再是 App，原 `apps/editor/skills/recut-editor/` 需**重新寄宿**（全局 `recut-*` 或平台模块技能）。`recut-clone` 的时间线用法引用它；在该技能定址前，`placement.md` 暂以 `recut.editor.*` op 契约为准。

## 3. 工作流（阶段 + 门禁）

```text
S1 理解 ──G1──> S2 决定 ──G2──> S3 计划 ──G3──> S4 生成 ──G4──> S5 交付 ──G5──>
```

### S1 理解（把证据写到参考素材）

- 载入 `recut-reference` 与其 `tools.md`，按读法调用 `recut.media.probe / frames / contactSheet / boundaries / clip`（`words` 默认关闭）。
- 证据写入**参考素材**的 `facets.reference`（`recut.media.reference.attach`，幂等）；参考本身是真实媒体素材，经 `recut.media.reference.create({ assetId, sourceUrl? })` 标记（链接类无内容可下载时才用 `create_reference`）。
- Agent 的整片理解写目标项目的 `analysis.md`，带源时间的细节写 `timeline.md`（观察挂素材，解释留项目）。
- **G1 理解门**：facet 至少含 probe + 一组证据帧/接触表；未通过不进入 S2。

### S2 决定（保留/替换）

- 载入 `recut-director/references/remix`，产出 `analysis.md` 的 `keep`/`replace` 结论（换主体/产品/语言/CTA、保留的机制与节拍）。
- **不**在此步写素材计划；结论只写「什么角色要留、什么表面要换」。
- **G2 计划门（前置）**：`keep/replace` 必须有可定位的结论（落在第几拍/哪个角色）；无定位视为未定义。

### S3 计划（素材元素，先不花钱）

- 依素材 attrs 协议层，产出**计划态素材元素**清单：role / attrs / content / recipe / 来源片段（`refSource`）。
- 写 `clone-plan.md`：每个元素的角色、理由、配方、来源，供人审阅。
- **G3 付费门**：计划必须经用户批准（账号/范围/预算）；未批准不触发任何生成。video 一律先提案（`recut.video.generate` 默认 propose）。

### S4 生成与落轨

- 逐元素物化：图形走 `component.create`（免费）；媒体走 `recut.media.propose → confirm`（用户确认）；配音走 `recut.speech.generate`。
- 落轨：`timeline.placeComponents` / `timeline.placeAudio` / `timeline.command insert`（经素材 attrs 协议的引用）。
- 时间排布：首版按「源片段秒数 / 计划时长」顺序铺，支持多场景与来源对齐（复用 `film.package.import` 的 cursor 思路，但多场景）。
- **G4 落轨门**：`timeline.validate` 零违规 + 受影响 scene 的 settled frame 抽检通过。

### S5 交付

- `export.start` → `recut.job.wait` 到终态 → 取最终 video Asset；**实际观看/试听**后报告。
- **G5 交付门**：Done means watched。队列中/失败/`editor-not-open` 都不得声称已交付。
- 留档：`clone-plan.md` + 各元素 `recipeHash`，后续可只重生成改动的元素。

## 4. 产物与存放

```text
参考素材（全局） facets.reference    # 观察层：probe / transcript / frames / sheets / boundaries / clips（指针）
─ 目标项目 ─
  analysis.md                        # 解释层：整片理解 + keep/replace
  timeline.md                        # 解释层：带源时间的细节与含义
  clone-plan.md                      # 执行层：计划态素材元素清单
```

- **观察挂素材**（跨目标复用，理解一次可服务多个目标）；**解释与执行留项目**（目标相关，避免污染全局）。
- 项目侧可选保留 `references/<refId>/pack.json` 作为人读**投影**，但真相在素材 facet。
- 所有素材仍以 `assetId` / 素材元素引用表达；不复制二进制与源码。

## 5. 明确不借用的东西

- **不引入 SVML/SVS 或任何 XML/DSL 中间语言**；计划用项目文件（md/json）+ 素材元素表达。
- **不复制源台词/构图/肖像**（remix 红线）；只迁移可复用的结构。
- **不做语义锚点与一变多**（后续 RFC）。

## 6. 验收

| 场景 | 预期 |
|---|---|
| **零花费路径** | 一支含字幕/图形的参考，只做「换语言 + 换图形文案」，全程不触发生成，产出可导出成片。用于证明分层成立、clone 不必等于花钱 |
| **标准路径** | 30s 参考 + 「换主体/产品」→ 参考素材 facet + keep/replace + 计划（planned，零花费）→ 批准后物化 → validate 零违规 + settled frame 通过 → 导出并观看 |
| **门禁** | 未过 G1 不进 S2；未过 G3 不 confirm；未过 G4 不导出；未过 G5 不声称交付 |
| **复用** | 同一参考素材 facet 支撑 ≥2 个目标版本（不同主体），不重复理解参考 |
| **等价性** | 迁移后 `recut.editor.*` op 名与读模型不变；技能不因寄宿位置变化而改流程 |

## 7. 非目标

- 不定义素材 attrs/content/recipe 协议（属另一份 RFC）。
- 不定义 remix 的迁移方法（属 `recut-director/references/remix`）。
- 不定义时间线 op 语法（属时间线/编辑器技能）。
- 不做变体批量渲染、不做语义锚点、不做组件市场。
- 不新造 App 或一等对象。

## 8. 风险与未决问题

1. **寄宿位置未定**：全局 `recut-clone` vs `recut-director/references/clone` vs 编辑器技能内的 route。**本 RFC 推荐全局独立 skill**，待确认。
2. **编辑器技能重寄宿**：迁移 RFC 未定 `apps/editor/skills/recut-editor/` 的去向；clone 的时间线用法依赖它。需在迁移 RFC 收口时一并定。
3. **素材 attrs 协议未定**：S3/S4 依赖计划态素材元素的字段。在协议定稿前，`clone-plan.md` 可先以「角色 + 配方 + 来源」的自由结构先行，字段待协议对齐。
4. **改一句重生成的粒度**：`recipeHash` 复用未变素材是目标，但需要素材协议定义稳定 hash；否则退化为全量重生成。
5. **排布语义**：首版「按源片段顺序铺」是妥协；真正的「按词/动作对齐」需要锚点（后续 RFC）。需向用户明示首版的时间对齐能力边界。
6. **成本透明**：G3 必须给出计划中的付费项与预估（复用提案报价），否则用户无法在批准前判断。

## 9. 排期

本 RFC 是四步路线的最后一步：

1. [Editor 迁移](./2026-09-17-editor-native-migration.md)（宿主/逻辑/Render Host/素材平台化）
2. [参考视频理解](./2026-09-17-reference-understanding.md)（工具 + `recut-reference`）
3. [素材属性能力](./2026-09-17-asset-attributes.md)
4. 本 RFC（`recut-clone` skill）

可先行的部分：`recut-clone` 的**零花费路径**（S1→S2→S3→S4 仅字幕/图形）只依赖 2 与 3，可在迁移完成前先跑通，作为分层正确性的最早期验证。
