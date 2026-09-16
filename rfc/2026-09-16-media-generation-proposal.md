<!--
 * [INPUT]: 依赖 2026-09-15-generation-reference-protocol（references/role 绑定、referenceIds 顺序）、
 *   现有 service/media（Asset 生命周期、media_assets.media_jobs、/v1/media/* 与 recut.*.generate MCP）、
 *   web/app/media（素材库 UI）、web/app/worlds/[worldID]/canvas（画布提案 gate，canvas-proposal.ts）、
 *   apps/editor（recut-editor video-generation）
 * [OUTPUT]: 定义「生成提案作为全局媒体资产状态」的产品与技术方案：proposed 生命周期、proposal 元数据契约、
 *   propose/confirm/update/reject 接口（HTTP + MCP）、按能力的提案门禁、三个消费者（素材库/画布/编辑器）的统一、
 *   迁移与兼容
 * [POS]: rfc 的「生成提案」决策；把画布私有的 props.proposal 收敛为全局素材能力，任何 App 自动同策略
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 * -->

# 媒体生成提案（Media Generation Proposal）

- 状态：已实施（2026-09-16；见 §6 与 §8 的落地文件）
- 日期：2026-09-16
- 关联：[生成提示词参考引用协议](./2026-09-15-generation-reference-protocol.md)、[统一实体模型](./2026-09-09-unified-entity-model.md)、[World Canvas PRD](../docs/world-canvas-prd-v2.md)
- 非目标：Cover Studio 不需要提案门禁（图片直生成本低），保持直接生成，不纳入本方案。

## 0. 摘要

目前「先生成提案、用户确认后才花钱」只存在于 World Canvas：提案写在画布元素 `props.proposal` 里，确认由前端直接调 `/v1/media/jobs`，与全局素材库、编辑器、封面工坊互不相通。本 RFC 把提案提升为**全局媒体资产的一个生命周期状态**：

- 新增 `media_assets.status = 'proposed'`：有意向、无字节、无 job、**不花钱**。
- `recut.video.generate` 默认只 **propose**（产出 proposed 资产落素材库），显式 `mode:"generate"` 才是直生。
- 确认后**复用同一 assetId** 原地转为 `queued`，引用它的画布元素/时间线片段无感续上。
- AI 可在确认前 `update_proposal` 原地改配方；用户确认是唯一花钱动作。

这样素材库、World Canvas、Editor 自动共享同一策略。Cover Studio 等低成本图片路径保持直生，不纳入。

## 1. 背景与问题

- World Canvas 的 `props.proposal` 是一套私有协议：只存在于画布元素，`recut.worlds.proposals.list` 只能扫画布，且确认路径绑定画布 UI。
- Editor 的 AI 视频创作（`apps/editor` 的 generated-video 路由）直接调 `recut.video.generate` 立即花钱，没有确认门禁。
- 同一份「生成规则」在画布、素材库、编辑器各存一份，真相分裂；canvas 确认后还会更换 assetId（`setMediaElementAsset`），引用需要重指。
- 用户诉求：AI 创作视频素材应先落提案到素材库，用户确认后再生；AI 可迭代提案；三个消费方同策略。

## 2. 生命周期

```
proposed ──confirm──> queued ──> running ──> completed
   │
   ├── update (AI 原地改 prompt/参考/模型/参数)
   └── reject (软删墓碑，保留记录)
   failed ──confirm──> queued   (重试同一 assetId)
```

- `proposed` 不写 `media_jobs`，`jobs_scheduler` 天然忽略（它只认 job 绑定）。
- `scanAssetRow` 现有归一化（`queued/running` 无 job → `completed`）不覆盖 `proposed`。
- 确认复用 assetId：画布元素、时间线片段、`referenceIds` 全部无需重指。

## 3. 元数据契约

proposed 资产的 `metadata`（hoist 与已完成素材同形的字段，使配方继承走同一条路）：

```jsonc
{
  "prompt": "...",
  "modelId": "...",
  "provider": "atlas-cloud",
  "capability": "video.generate",
  "output": { ... },              // catalog parameter.name 命名
  "referenceIds": ["asset_a1"],   // 扁平顺序 = references 顺序
  "proposal": {
    "references": [{ "id": "asset_a1", "kind": "image", "role": "character", "label": "林小满" }],
    "aspectRatio": "9:16",
    "durationSec": 5,
    "note": "...",
    "proposedBy": "agent",        // agent | user
    "proposedAt": "2026-09-16T…",
    "batchId": "...",             // 同一场戏分镜归组
    "origin": { "appId": "...", "projectId": "...", "worldId": "...", "entityId": "..." },
    "confirmedAt": ""             // 确认时写入
  }
}
```

- `referenceIds` 是提交顺序的权威；`proposal.references` 是 role 绑定记录，二者按出现顺序一一对应（对齐 09-15 RFC）。
- role↔kind 自检在 propose 与 confirm 两处都做，fail closed。
- 确认后 `proposal` 保留，供回溯；`origin` 记录发起方。

## 4. 接口面

### HTTP（UI 用）

| 方法 | 路径 | 语义 |
|---|---|---|
| `POST` | `/v1/media/proposals` | 创建提案（不花钱） |
| `GET` | `/v1/media/proposals` | 列出提案（可按 projectId 过滤） |
| `PATCH` | `/v1/media/assets/{id}/proposal` | 原地改配方 |
| `POST` | `/v1/media/assets/{id}/confirm` | 用户确认 → 转 queued 并提交 job |
| `POST` | `/v1/media/assets/{id}/reject` | 放弃（软删） |

### MCP

| 工具 | 语义 | 谁调 |
|---|---|---|
| `recut.video.generate`（默认 `mode:"propose"`） | 创建提案 | Agent |
| `recut.media.propose` | 通用提案入口（任意 capability） | Agent |
| `recut.media.list_proposals` | 列提案 | Agent |
| `recut.media.update_proposal` | 改配方 | Agent |
| `recut.media.confirm_proposal` | 确认 | UI/App（skill 禁止 Agent 代确认） |
| `recut.media.reject_proposal` | 放弃 | UI/App |

- `recut.image.generate` / `recut.speech.generate` 默认仍直生；`mode:"propose"` 可显式走提案。
- `recut.media.generate` 保持直生低层语义。
- 确认权只属于用户：平台无法区分调用者，靠 skill 门禁约束 Agent。

## 5. 提案门禁（哪些能力需要提案）

- **`video.generate`**：全部强制提案（视频成本高）。
- **其它 capability**：由模型目录的 `requiresProposal` 声明（云端高价模型）。`MediaModel.RequiresProposal` 随 CDN catalog 下发。
- 判定：`requiresProposal(capability, modelId) = capability==video || model.requiresProposal`。

## 6. 三个消费者

- **素材库 UI**：`AssetStatus` 增 `proposed`；`normalizeAsset` 不再把未知态吃掉。提案卡显示「待确认生成」+ prompt + 参考，提供确认/编辑/放弃。`CreateAssetDialog` 视频路径创建提案。
- **World Canvas**：**直接改为适配新模式**——视频提案不再写 `props.proposal`，而是 `kind="media"` 元素引用一个全局 proposed 资产（`assetId`），状态读资产（复用图片既有的 `assetStatus` 机制：`proposed→generating→ready`）。确认按钮调资产 confirm；`recut.worlds.proposals.list` 转发资产提案查询。
- **Editor**：`recut.video.generate` 返回 proposed assetIds；AI 可 `update_proposal` 迭代；用户确认（或 completed）后再落时间线。proposed 资产允许先占位，确认后原位填充（assetId 不变）。

`canvas-proposal.ts` 的 role/自检/referenceIds 纯函数上移为 `web/lib/media/proposal.ts`，三处共用。

## 7. 迁移与兼容

1. `recut.video.generate` 默认值从「直生」变为「提案」是行为变更；显式 `mode:"generate"` 保留直生，供测试/低层使用。
2. 旧画布元素 `props.proposal`：改为读资产；对无 assetId 的旧 pending 元素，确认时先创建并绑定全局提案资产（一次性回填）。旧元素仍可只读展示。
3. 存量已完成/生成中资产的状态语义不变；`assetListWhere` 默认仍排除 `deleted` 与 `rejected`。
4. 回滚：`requiresProposal` 与默认模式是集中判定，可加开关恢复直生。

## 8. 可测试点

- propose 不产生 media_jobs、不消耗 provider；返回 proposed 资产。
- confirm 复用同一 assetId，status 转 queued 且 job 绑定；重复 confirm 幂等。
- `update_proposal` 仅对 proposed 生效，非 proposed fail closed。
- role↔kind 不匹配在 propose/confirm 均被拒。
- `recut.video.generate` 默认 propose；`mode:"generate"` 直生。
- 素材库列出 `status=proposed`；SSE 广播 proposed/queued 变更。

## 9. 未决问题

1. reject 是否用独立 `rejected` 状态（保留可复活）而非软删——当前取软删以复用现有墓碑语义。
2. 提案是否消耗「默认 route」的当前快照（确认时模型下线如何处理）——当前 confirm 重新 resolveRoute，失败则返回可操作错误。
3. 是否给提案配去重键（同 project+prompt+refs 合并）——当前一提案一资产，不做去重。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
