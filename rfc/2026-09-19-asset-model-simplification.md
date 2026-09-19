<!--
 * [INPUT]: 依赖 service/media（media_assets 生命周期/kind/metadata、recut.media.* 工具面）、service/skills（recut / recut-reference / recut-clone / recut-editor / recut-worlds / recut-director）、service/prompts/core-agents.md.tmpl、
 *   web/components/asset-preview-dialog.tsx、web/app/worlds/**（canvas-proposal / media-editor）、web/lib/media/proposal.ts、apps/ai-short-film（skill/manifest/background/ui）、
 *   既有 rfc/2026-09-17-reference-understanding.md、rfc/2026-09-17-asset-attributes.md、rfc/2026-09-16-media-generation-proposal.md
 * [OUTPUT]: 「Asset 模型简化」的单一决策入口：把 Asset 收敛为 kind + status + content + attributes（+ 只读系统事实），
 *   把 reference / proposal / evidence 三个概念分别溶解为「属性值 / 状态 / 普通资产」，并给出工具面收敛、内容（agent core + skills）同步与分步迁移
 * [POS]: rfc 的素材模型收口决策；取代 reference-understanding 的 evidence 流程、asset-attributes 的 metadata.reference、media-generation-proposal 的 metadata.proposal 命名空间
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 * -->

# Asset 模型简化：kind + status + content + attributes

- 状态：已定案（2026-09-19），执行中
- 日期：2026-09-19
- 取代：[参考理解](./2026-09-17-reference-understanding.md) 的 evidence 流程、[素材属性](./2026-09-17-asset-attributes.md) 的 `metadata.reference` 命名空间、[媒体生成提案](./2026-09-16-media-generation-proposal.md) 的 `metadata.proposal` 命名空间
- 非目标：不引入派生/血缘（derivedFrom）、不引入 evidence 命名空间、不为 Asset 造类型目录

## 0. 摘要

当前复杂度不在字段多，而在**「谁拥有、谁可写」没分层**：可编辑的理解内容（`content`/`attributes`）与系统记账（`metadata.reference`/`metadata.proposal`/generation/parts）混在同一个 `metadata` 口袋里；「reference」一词同时指工具、资产 kind、metadata 命名空间与业务概念，AI 无法判断该用哪个。

本 RFC 把 Asset 收敛为：

```text
Asset {
  id
  kind:       image | video | audio | document | transcript | code
  status:     proposed | queued | running | completed | failed | deleted
  backing:    bytes | code
  content                       // 长正文（理解）
  attributes: [ { key, type, value, source, provenance, locked? } ]
  // 系统事实（只读）：尺寸 / 时长 / fps / hash / size / createdAt
}
```

三个概念的归宿：

| 概念 | 归宿 |
|---|---|
| **proposal** | `status = proposed`；配方是系统 locked attributes，不是特殊字段 |
| **reference** | asset 的一个属性（`role`/`usage` + `url`）；没有 `kind=reference`、没有 `metadata.reference` |
| **evidence** | **没有这个流程**；读取产物就是普通 asset，不留派生关系、不回写协议 |

**一句话**：一个结构化面（attributes）、一个生命周期（status）、一段正文（content），加媒体客观事实。没有命名空间、没有派生、没有 evidence 协议。

## 1. 工具面收敛

| 工具 | 处置 |
|---|---|
| `recut.media.import` | **新增**：`{ path? \| url? \| link?, name?, projectId?, sourceKind?, content?, imageData?, … }` 一个入口；`path`=本地媒体、`url`=直链媒体、`link`=网页/文章（落 `kind=document`） |
| `recut.media.import_media` / `import_url` / `import_image` / `reference.link` | 降为**未列出的兼容 alias**，分别映射到 import 的 path/url/path/link 分支 |
| `recut.media.asset.create` | 从工具面移除（不再有占位素材）；Go 方法可留 |
| `recut.media.reference.mark` / `reference.attach` | 从工具面移除（evidence 流程取消）；Go 方法可留作兼容 alias |
| `recut.media.asset.get` | 只回 `kind/status + content + attributes`；不再暴露 facets |
| `recut.media.asset.update` | 保留：写 content/attributes（含 `role`、`url`、指针型 `media`/`ref`），是唯一的理解写入口 |

简化后 AI 侧 media 工具：`import` / `probe` / `contactSheet` / `frames` / `image.generate` / `video.generate` / `speech.generate` / `list_assets` / `asset.get` / `asset.update` / `understand.status` / `understand.prepare`。

## 2. 数据模型迁移

| 现在 | 新 |
|---|---|
| `kind="reference"`（链接研究） | `kind="document"`；`url` 是它的一个属性；正文=content、图片=parts |
| `metadata.reference`（观察组/研究引文） | 删除；参考身份 = `attributes.role`；正文/理解进 content/attributes |
| `metadata.proposal`（配方） | 删除；`status=proposed` + 系统 locked attributes（capability/model/output/references/note） |
| `metadata.attributes` / `content` / `contentMeta` | 保留（唯一可写层） |
| `parts` | 保留为 document 的内容承载 |

兼容：写入侧先切新形态；读取侧在过渡期同时识别旧 `kind=reference` 与旧 `metadata.proposal`，避免 web/app 立即崩。

## 3. 内容同步（agent core + skills）

- `service/prompts/core-agents.md.tmpl`：`wait_for_job`/`get_job`→`recut.job.*`、`import_image`→`import`(path)、`create_reference`→`import`(link)、`import_url`→`import`(url)。
- `service/skills/recut/SKILL.md` + `references/world-onboarding.md`、`service/skills/README.md`。
- `recut-reference`：整块重写——只做「读 + 把理解写进 assets 的 content/attributes」，删 evidence 流程与 `metadata.reference`（`references/evidence.md` 作废）。
- `recut-clone`：S1 用 `import` + `asset.update(role=reference)`；去掉 `reference.mark`/`attach`。
- `recut-editor`（video-generation.md 的 metadata.proposal）、`recut-worlds`（proposal 措辞）、`recut-director`（generation-prompt 的 PROPOSAL_ROLES 表述）。
- `apps/ai-short-film`：skill/manifest/background/ui i18n 的旧工具名与旧语义。

## 4. 分步

1. **Step 1 工具面 + 内容**：新增 `import`、下架 `asset.create`/`reference.mark`/`reference.attach`、`asset.get` 去 facets；同步 core-agents 与 skills。旧名保留未列出 alias，web/app 不炸。
2. **Step 2 数据模型**：`kind=reference`→`document`、`metadata.reference`/`proposal` 停写并迁到 attributes/status；同步 web（asset-preview-dialog、worlds canvas、lib/media/proposal）与 apps/ai-short-film；读取侧过渡兼容。
3. **Step 3 清死代码**：`media/reference.go`、`media/placeholder.go`、proposals 元数据路径；旧 RFC 标 superseded。

## 5. 验收

- AI 侧 media 工具 ≤ 12；「reference/proposal/evidence」不再作为工具或命名空间出现。
- `recut.media.import` 三个 source 分支都能落 asset 并返回稳定 assetId。
- 旧工具名（alias）仍可调用，apps/ai-short-film 不报错。
- Go 全绿；skills 与 core-agents 无旧词残留。

## 6. 实施状态（2026-09-19）

已落地（无兼容、干净切换）：

- **工具面**：新增唯一入口 `recut.media.import({ path|url|link })`；**彻底移除** `import_media`/`import_url`/`import_image`/`reference.link`/`create_reference` 与 `asset.create`/`reference.mark`/`reference.attach`（工具、dispatch、兼容 alias 全部删除）。
- **代码删除**：`service/media/placeholder.go`、`service/media/reference.go`（evidence 层）整文件删除；`mcp.go` 的 referenceAttach 映射、`media_adapter.go` 的占位/参考类型别名删除。
- **kind**：链接研究资产 `kind: "reference"` → `"document"`，mimeType → `application/vnd.recut.document+json`。
- **内容同步**：`service/prompts/core-agents.md.tmpl`、`recut-reference`（整块重写，删 evidence）、`recut-clone`、`recut/SKILL.md`、`skills/README.md` 已更新；工具标签同步。
- **测试**：删除 evidence/占位测试，工具面测试改为断言旧工具已下线；`go test ./...` 全绿。

待落地：

- （无）本 RFC 已按「无兼容、直接到最新」全部落地。

## 7. 落地记录

- **工具面**：`recut.media.import({ path|url|link })` 为唯一入口；`import_media`/`import_url`/`import_image`/`reference.link`/`create_reference`/`asset.create`/`reference.mark`/`reference.attach`/`get_job`/`wait_for_job` 全部删除（工具、dispatch、兼容 alias、标签）。
- **代码删除**：`media/placeholder.go`、`media/reference.go`（evidence 层）。
- **数据键**：`metadata.reference` → `metadata.document`；`metadata.proposal` → `metadata.generation`（proposal 是 `status`，配方是系统生成事实）；`kind: "reference"` → `"document"`。
- **消费方**：`mcp.go`（view）、`worlds_mcp.go`（proposals.list 去掉旧 props 回退）、`web/app/media/media-types.ts`（AssetKind/metadata 类型）、`web/lib/media/proposal.ts`、`web/components/asset-preview-dialog.tsx`、`web/app/media/*`、`web/app/page.tsx`、worlds 画布类型联合、`apps/ai-short-film`（skill/manifest/background/ui 工具名）全部改到新模型。
- **内容**：`core-agents.md.tmpl`、`recut-reference`（整块重写，删 evidence）、`recut-clone`、`recut/SKILL.md`、`skills/README.md`。
- **项目素材挂载**：`recut.media.attach` 删除，改为 editor 的 `recut.editor.asset.add`（导入到项目素材库）；**`recut.editor.timeline.assets` 与整个 `registeredAssets` 缓存删除**——前端从未读取它，只有 `timeline.validate` 用它做一次对缓存的弱校验；落轨/导入/字幕提交改为自动把素材加入项目素材库，`timeline.validate` 不再做 `asset-exists`（它本就只对比缓存、不代表真实存在）。
- **验证**：`go build/vet/test ./...` 全绿；`web` 改动文件 `tsc` 无新增错误（仅 timeline-editor 既有报错）。

## 8. 验收

- AI 侧 media 工具 ≤ 12；「reference/proposal/evidence」不再作为工具或命名空间出现。
- `recut.media.import` 三个 source 分支都能落 asset 并返回稳定 assetId。
- Go 全绿；skills 与 core-agents 无旧词残留。
- web/apps 消费方在 `kind=document` 与新配方形状下正常。
