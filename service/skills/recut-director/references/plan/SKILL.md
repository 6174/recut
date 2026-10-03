---
name: plan
appId: recut.platform
description: 决定「这部片子怎么排产」——备齐锚点、把戏拆成可生成的镜头、定每镜用料与参数，落成一份可执行的生产计划。
---

# Recut 生产计划技能（references/plan）

本技能只回答一个决策问题：**这部片子怎么排产？** 输入是已确认的世界（角色/场景/风格/声线）与剧本（`script`），输出一份**生产计划**：场次 → 镜头 → 每镜的用料与参数 + 成本预估。

**它不写提示词**（归 `references/generation-prompt`），**不决定单个镜头怎么拍**（归 `references/shot`），**不落轨**（归 timeline-editor）。

## 边界

| 归属 | 内容 |
|---|---|
| **本技能** | 排产：备锚点 → 拆场/镜 → 定用料 → 定参数与成本 → 落生产计划 |
| `references/assets` | 把参考锚点真的做出来（角色卡/场景图/道具图/色卡/声线/分镜表）——**本技能的前置** |
| `references/shot` | 单个镜头/一场怎么拍（景别/角度/焦段/运动/调度/连续性） |
| `references/generation-prompt` | 一条提示词怎么写（CAMERA LOCK / STYLE LOCK / 参考锚定 / 多镜连续段 / 声音两层 / 画内文字） |

## 一、先备锚点（缺一不排产）

镜头要生成，先得有锚点：主角色参考图、场景图、道具图（关键道具）、风格锚点、声线参考、（可选）分镜表。
- 世界已有 → 直接引用（`recut.worlds.get` 的 `references[]`，按 role：`character` / `environment` / `prop` / `style-ref` / `voice` / `storyboard`）。
- 世界没有 → **先做**（见 `references/assets`），不要"纯文本直出"。

> 判断依据：**这是"世界生图/生视频不带参考图"这条最严重误用的根因**——不是 Agent 不听话，是链里根本没有"先备锚点"这一步。

## 二、把它排成树（本技能主体）

一部片子 = **作品(`work`) → 视频脚本(`script`) → 场次(`scene`) → 镜头(`shot`)**。作品是**交付单位**（挂成片与总进度），脚本是**可生成规格**（叙事/口播/分镜表）——**一个作品可以有多个脚本**（30s/60s、口播版 vs 分镜版、中英双语），它们共享同一批角色/风格。**树靠结构 link `has_script` / `has_scene` / `has_shot`（全局、父→子），不是 `parentId`**——`parentId` 只是通用归属（文件夹），改它不断链；建生产节点时服务端会自动补这条链。类型目录的 `childTypes` 是这件事的机器可读声明（`work.childTypes=[script]`、`script.childTypes=[scene,shot]`、`scene.childTypes=[shot]`，advisory）。

每个镜头写清五件：

1. **意图**：这一拍让观众感到什么（为什么存在）；
2. **镜头**：景别 / 运动 / 时长（怎么拍归 `references/shot`，这里只记结论）；
3. **用料**：带哪些 role 的锚点（角色 / 场景 / 道具 / 风格 / 声线 / 分镜表）；
4. **参数**：模型 / 画幅 / 时长；
5. **产物**：这一镜要出什么（关键帧 / 片段 / 配音）+ 生成关系（参考驱动 / 首尾帧 / 文生）。

> **产物不设固定槽位**：镜头**不是首尾帧模式**——生成关系至少三类，实测绝大多数是参考驱动（liblib《阿猫阿雀》90 镜里 89 个 `mixed2video`）。计划里写"要出什么 + 什么关系"，具体提示词由 `references/generation-prompt` 决定。

**成本预估**：按"镜头数 ×（模型单价 × 时长/张数）"粗算；贵的（视频）标注**待用户确认**。

## 三、落地（工具）

1. `recut.worlds.production.create({ worldId, parentId, scenes:[{ name, shots:[{ name, attrs? }] }] })`
   —— **一次把树建成**：场次/镜头**直接以正式实体写入**（无草稿态、无转正步骤），**一条事务产一条 revision**；同时写入结构关系 **`has_scene` / `has_shot`**（这才是生产树的真源）。`parentId` 只是卡片落位（通常是**视频脚本**；无脚本短片可直接给作品），`placeCards`（默认 true）在该节点内层画布落卡。**只建结构，不生成任何素材**。
2. 用户可改（用 `recut.worlds.production` 读回树与派生状态）。
3. 逐镜生成：走 `recut.image/video/speech.generate`（**视频待用户确认**），产物落成镜头的 **media 属性**（`label` 标角色，如「关键帧」/「片段」/「配音」）。

## 四、纪律

- **建树不花钱、生成才花钱**：`production.create` 只建结构（正式实体），不提交任何生成；花钱的闸门只在下游生成（媒体提案门）。
- **树 = 结构链，不是 `parentId`**：`has_script`/`has_scene`/`has_shot` 表达生产归属（单源、可环）；`parentId` 只是文件夹；`followed_by`/`precedes` 表达镜头顺序；别混。
- **产物挂在任一层**：镜头产物、场成片、作品成片；上层是下层的聚合（作品成片 = liblib 图外的 `finalOutput`）。
- **生成才要人确认**：结构直接落；视频走生成提案门（不是实体转正）。
- **改了锚点要重跑下游**：换角色卡 → 用到它的镜头标记过期 → 重跑（见 `references/qc`）。
- **可生成性预算**：高风险镜（多人交手、复杂运镜）先写拆分预案（见 `references/shot`）。

## 使用时机

用户要"把这部片子排出来 / 拆成可生产的镜头 / 排个计划"时加载。单镜优化用 `references/shot`，不加载本技能。
