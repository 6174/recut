<!--
 * [INPUT]: 依赖 rfc/2026-09-07-recursive-world-canvas.md（数据模型权威：entity/relation/world_canvas 开放 kind）、
 *   rfc/2026-09-09-unified-entity-model.md（media attr 唯一素材通道）、rfc/2026-09-15-media-generation-proposal.md
 *   （proposed 资产 + 配方 metadata.proposal）、rfc/2026-09-15-generation-reference-protocol.md（references[{id,kind,role}]）、
 *   rfc/2026-09-20-video-script-storyboard-sheet.md（script 类型与一图分镜表）、rfc/2026-09-15-world-canvas-sole-write-surface.md
 *   （World 即画布，内容写入经 recut.worlds.*）、docs/world-canvas-prd-v2.md；以及对 liblib.tv 真实制作画布的反推（docs/analyze-libtv）
 * [OUTPUT]: ① 先收口默认世界模型（精简、准确、可运行）：默认实体只留 work（作品）/ character（**角色**，含人物·动物·生物）/
 *   location（场景）/ prop（**道具**）/ script（视频脚本）；rule 与 style 降级为
 *   世界级属性；story 并入 script（不再单独成实体）；场/镜头不进默认类型目录——扩展交给用户；② 定义 World Canvas 的
 *   「生产层」（Production Layer）：在已有世界层之上，用「场 scene / 镜头 shot」实体 + 媒体属性产物 + 资产级
 *   references 引用，把「要生成哪些镜头、每镜用什么料、出什么活」组织成画布上可读、可确认、可追溯、可重跑的依赖图；
 *   **作品→脚本→场次→镜头 这条树由显式结构关系 has_script/has_scene/has_shot 单源表达，parentId 只是通用归属（文件夹）、
 *   不参与建树**（D8）；该图由 Agent 从「世界 + 剧本」派生（plan → 人确认 → apply），不新增写入面、不建新图库；
 *   ③ 给出配套的 Skill 层调整：提示词形状（generation-prompt）保持不动，补「链」上缺的两个环节（参考资产开发、生产计划）
 *   + 配音表演稿 + 下游重跑纪律
 * [POS]: rfc 的 World Canvas 从「设定画布」扩展到「生产画布」的产品/数据决策；是 world-canvas-prd-v2（M0–M3）之后的生产能力层
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# World Canvas 生产层（Production Layer）

- 状态：**M0 / M1 / M3 已实施（2026-10-02）**；M2 仅设计未实施；**M4 / M5 明确不做（overdesign，见 §11）**；**D8 修正（生产树改由 `has_*` link 单源，见 §15.5）已实施**；**默认集微调（`character`→「角色」、新增 `prop`「道具」，见 §15.6）已实施**；**D9（2026-10-04）生成改为「资产 + script + scene」驱动，storyboard 降级为排产/预览、不进生成；`shot` 只作预览/测试，不进生成依赖**
- 日期：2026-10-02
- 关联：[递归世界画布](./2026-09-07-recursive-world-canvas.md)、[统一 Entity 模型](./2026-09-09-unified-entity-model.md)、[媒体生成提案](./2026-09-16-media-generation-proposal.md)、[生成参考引用协议](./2026-09-15-generation-reference-protocol.md)、[视频脚本与一图分镜表](./2026-09-20-video-script-storyboard-sheet.md)、[World 唯一写入面](./2026-09-15-world-canvas-sole-write-surface.md)、`docs/world-canvas-prd-v2.md`
- 证据来源：[`docs/analyze-libtv/`](../docs/analyze-libtv/README.md)（对 liblib.tv《阿猫阿雀》真实制作画布的反推）

---

## 0. 一句话结论

> 在现有的「世界画布」之上，加一层**生产层**：把「这部片子要拍哪些镜头、每个镜头用什么料、生成出什么活」变成画布上**看得懂、能确认、能追溯、能重跑**的一组卡片和连线；**这张图不该由人手工画，而应由 Agent 从「世界 + 剧本」自动长出来，人只做确认和微调。**

---

## 1. 我们观察到了什么

我们在 liblib.tv 上打开了一部真实自制 AI 动画《阿猫阿雀》的「查看制作过程」，看到的是一张无限大的节点图：**247 个节点、697 条连线**，跨了 54000×52000 的画布范围（要缩到 10% 才看得全）。

**第一眼像流程图，但它其实不是流程图。** 我们把界面背后的数据拉出来看，规则非常简单：

- **每个节点 = 一次生成任务**。它同时带着三样东西：*用的料*（参考图/音频）、*出的活*（生成出来的图/视频/音频）、*配方*（提示词、模型、参数）。
- **每条连线 = 「这个活用了那份料」**。线不代表"先做 A 再做 B"，而是"B 用到了 A"。

### 1.1 判断的依据（不是猜的）

- 节点只有 5 种：图片 124、视频 90、音频 17、文本 2、分组（框）14。**没有"步骤""判断""开始结束"这类流程节点**——如果是流程图，不会只有这些。
- 连线的类型只有 5 种组合，最多的是：`图 → 视频` 428 条、`图 → 图` 201 条、`音频 → 视频` 55 条。**全部是"把料喂给活"，没有一条是控制流。**
- 视频节点的提示词里写着 `{{Mixed 1}}`、`{{Mixed 2}}` 这样的占位符，而每个视频节点都存了一份 `mixedListOrder`（参考源列表）。**占位符 1 对应用到的第 1 个参考。所以连线就是提示词里的"参考位"。**
- 每个节点都有一个 `isStale` 标记（上游的料换了，这个活就"过期"了）；还有一个 `分组 N 个节点` 的框，把一场戏的活打包在一起。

### 1.2 一句话概括这张图

> **料 → 活 → 更好的料。**
> 用世界里的设定（角色、场景、风格）生成关键帧；用关键帧 + 配音生成镜头；镜头再拼成成片。

### 1.3 它的实际生产流程（反推）

1. **写剧本与配音稿**（文本节点，逐句写清声线、语速、情绪、时间码）。
2. **做角色设定集**（上传 + 文生图，出的是每个角色的多视图"转面图"）。
3. **生成关键帧**（图生图，带参考图链，平均提示词 604 字）。
4. **做配音/音效**（语音合成模型）。
5. **生成镜头**（核心：平均提示词 1861 字、最长 5014 字——**每个视频节点其实就是一份写好的分镜**；90 个镜头里 64 个把音频一起喂进去，做到声画同步）。
6. **拆首尾帧**（从镜头里截首帧/尾帧，再喂回去做下一镜的衔接）。
7. **剪成片**（最终成片文件 `finalOutput` **不在图里**，是图外剪的）。

---

## 2. 判断逻辑：他们为什么这么做，我们能抄什么

### 2.1 这张图真正厉害的地方（值得学）

| 机制 | 用大白话讲 |
| --- | --- |
| **产物即配方** | 每个节点都能"重跑"——提示词、参考、模型、参数全在图里存着，随时能重做一次。 |
| **连线表达"用料角色"** | 一根线不只是"连上了"，而是"这张图在这个镜头里当**角色参考**/当**场景**/当**声线**"。 |
| **改上游自动标脏下游** | 换了角色设定，所有用到它的镜头自动变成"过期"，提醒你重做。 |
| **分组让图可读** | 90 个镜头不是散着的，按"场"打成一个个框。 |

### 2.2 它的代价（也是我们的机会）

- **全靠人手工画**：一个人花了 4 个月，在无限画布上手工摆出 247 个节点、697 条线。
- **命名靠人**：节点叫「图片节点 48 - 副本」，版本管理靠"复制一份改个名字"。
- **一致性靠肉眼**：这个镜头里的猫是不是设定的那只，只能靠人盯。
- **成片要另外剪**：图里最后一环是空的，成片在别的工具里完成。

### 2.3 关键判断

**这张图我们不该让用户手画。** 因为我们已经有了他们没有的东西：

- 一个**结构化的世界**（角色是谁、风格是什么、声线是哪一条）——他们图里最乱的部分（一堆图，谁是主角全靠人记），我们底下是干净的实体和关系；
- 一个能**读世界、能生成、有确认闸门**的 Agent；
- 一套**受控的参考角色词表**（`character / environment / style-ref / voice / storyboard`）和"未绑定就拒绝提交"的硬规则。

我们缺的只是**「把生成组织成一张可读的图」**这件事本身。

> 所以结论不是"抄一个手工画布"，而是：
> **让 Agent 从「世界 + 剧本」自动长出这张图，人只做确认和微调。**

---

## 3. 决策

七个决策，后面章节围绕它们展开：

- **D1｜分三层**：把问题拆成「世界层（料）→ 生产层（活）→ 成片层」，每层只解决一件事。（§4）
- **D2｜不新建图库，复用现有数据**：生产层不引入新的"节点表/边表"。因为底层数据其实已经在：媒体资产的配方（`metadata.proposal`）就是"活的做法"，而"用了什么料"就是**产物资产自己的 `references[{id,kind,role}]`**（`id` 即 `assetId`）。我们只需补少量新对象（场、镜头）+ 一个视图 + 一组 Agent 工具。（§6）
- **D3｜生产计划默认是草稿**：Agent 派生出的计划不花钱、不进 Canon；用户确认后才提交生成、才产 revision。完全复用现有提案闸门。（§8）
- **D4｜默认集精简、准确、可运行**：平台默认只提供一套能跑通闭环的最小实体与规则；扩展是用户/内容世界自己的事（类型目录本就开放，未知类型自动建极简类型，见 RFC 递归世界画布 §5.4）。（§5）
- **D5｜"像属性"的东西不做实体**：`rule`（约束）与 `style`（世界视觉身份）降级为**世界级属性**；叙事与生产合一，**只留 `script`、删 `story`**。（§5）
- **D6｜生产层的场 / 镜头不进默认类型目录**：`scene` / `shot` 是作品容器内部的结构化对象，不膨胀 preset。（§5、§7）
- **D7｜Skill 层补"链"、不改"提示词"**：真实案例反而验证我们的提示词形状已经到位；要补的是链上缺的两个环节（参考资产开发、生产计划）+ 配音表演稿 + 下游重跑纪律，并同步 §5 的默认集收口。（§9）
- **D8｜生产树靠 link，不靠 parentId**（2026-10-02 修正）：`作品 → 视频脚本 → 场次 → 镜头` 由显式结构关系 **`has_script` / `has_scene` / `has_shot`**（全局、父→子）**单源**表达；`parentId` 退回**通用归属**（Notion 式文档树 / 文件夹），不做类型校验、不参与建树——于是"把卡片挪到别处 / 剪切粘贴"不会断链。link 是 entity→entity 图，允许多父与环，解析端做**环安全**。给 `world_relations` 加 `is_provisional`：`plan` 写草稿链仍 **0 revision**，`apply` 一并转正。（§6.2、§7.2、§8）

---

## 4. 三层结构

```text
┌──────────────────────────────────────────────────────────────┐
│ 世界层（已有）：料                                            │
│   人物 / 场景 / 视频脚本 + 关系；规则与风格是世界级属性       │
│   产物：稳定的"锚点"（主角色参考图、风格锁、声线参考）        │
└───────────────────────────┬──────────────────────────────────┘
                            │  Agent 读世界 + 读剧本
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ 生产层（本 RFC 新增）：活                                     │
│   场次(scene) → 镜头(shot) → 每镜产物（关键帧/片段/配音）     │
│   引用 = 资产引用（角色/场景/风格/声线/分镜，底层是 asset）   │
│   状态 = 计划中 / 过期 / 生成中 / 就绪 / 失败                 │
└───────────────────────────┬──────────────────────────────────┘
                            │  按镜头顺序排列
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ 成片层（已有）：remotion-studio 时间线                        │
│   把就绪的镜头按顺序拼成片                                    │
└──────────────────────────────────────────────────────────────┘
```

每一层的"真相"位置不变，符合现有铁律：**世界层 = 实体/关系；生产层 = 实体 + 媒体属性 + 画布投影；成片 = 时间线**。画布始终是**表达能力**，不是新真相。

---

## 5. 默认集：精简、准确、可运行

**原则：平台默认只给一套"能跑通闭环"的最小集合；扩展是用户/内容世界自己的事。** 类型目录本就开放（未知类型自动建极简类型，见 RFC 递归世界画布 §5.4），所以"不默认提供"不等于"不支持"——只是不让人先理解一堆概念才能开始。

判断一个类型该不该留，只用一把尺子：**它是"世界里的一个对象"，还是"世界的一条属性"？** 是属性，就不做实体。

按这把尺子，世界内容分成**三层**（不是两层）——关键澄清：`scene`/`shot` **是实体**，只是"不是世界锚点"的实体：

| 层 | 是什么 | 进 `facts`？ | 进 preset 目录？ | 例 |
| --- | --- | --- | --- | --- |
| **锚点实体** | 世界的"谁 / 在哪 / 拿什么 / 拍什么"，驱动生成参考 | ✅ | ✅（默认 5 个） | `work`（作品，交付单位）/ `character`（**角色**，含人物/动物/生物）/ `location` / `prop`（**道具**）/ `script` |
| **生产实体** | 有身份的生产结构：可排序、可挂产物、可作容器/关系端点；`base_kind` 为空 | ❌（刻意） | ❌（用到即建，见 §5.4 / §6.1） | `scene` / `shot` |
| **属性** | 不是对象，只是字段：世界级属性，或实体上的 media 对象 | — | — | `identity.style` / `identity.constraints` / 镜头产物 |

判据是**"需不需要自己的身份"**：需要 → 实体（有 id、能当关系端点、能当容器、能挂自己的媒体属性）；不需要 → 属性。`scene`/`shot` 有镜号、要排序（`followed_by`/`precedes`）、要挂多个产物、要接时间线，所以**是实体**；镜头产物只是"这个镜头的一个素材"，所以**是属性**。

### 5.1 默认规则集（是世界级属性，不是实体）

```text
world.identity.constraints: { always: [], never: [], prefer: [] }
```

- **依据**：现有 `projectContext` 已经把 rule 实体压成 `always/never/prefer` 三个字符串数组——**消费端本来就是属性形态**；实体身份、画布卡、关系、类型 schema 全是中间开销。worlds/ 里 31 条 rule 每条只有一句文本，是"一列约束"而不是"一群对象"。
- 结构化约束写 `identity.constraints`；正文写 `world.md`（世界技能）。
- `rule` preset 退役，走 `reference` 已验证过的路（preset 归档、旧世界仍可读）。顺带修掉旧问题：`rule` preset 缺 `type` 字段，导致通过它建的规则永远只能落进 `always`。

### 5.2 默认实体集（5 个）

| 默认 | 定位 | 字段 |
| --- | --- | --- |
| **work 作品** | 交付单位（串起一切的那一层；**只放成片**，交付规格留在脚本） | 背景(media)；成片按需 media 属性（label「成片」） |
| **character 角色** | 谁（**人物 / 动物 / 生物**——所以显示名是「角色」不是「人物」） | 外貌与标志 / 性格 / 声音与说话方式 / 声线参考(media) / 不可变特征 / 背景(media) |
| **location 场景** | 在哪 | 描述 / 氛围 / 背景(media) |
| **prop 道具** | 拿什么（**现实制作必备**：关键道具要跨镜一致） | 描述 / 外观与标志 / 道具参考图(media, role=prop) / 背景(media) |
| **script 视频脚本** | 拍什么（生产入口） | logline / beats / vo / 目标时长 / 画幅 / 目标平台 / 分镜表(media) |

这五个就是可运行闭环的全部：**作品 → 脚本 → 角色 / 场景 / 道具锚点 → 场次/镜头 → 参考锚点 + 分镜 → 生成 → 成片**。

> 命名澄清：`character` 的显示名是**「角色」**（不是「人物」）——动物 / 生物 / 非人都要能装进来，`character` 本就是英语里覆盖它们的词。`object`（物件）已由 **`prop`（道具）** 取代为默认锚点（见 §5.3）。

**为什么必须有「作品」**：一个作品**可以有多个脚本**（30s/60s 两版、口播版 vs 分镜版、中英双语版），它们共享同一批角色/风格却各自有场次与镜头。没有作品这一层，多个脚本就是**几棵互不相干的树**——作品级进度 rollup 答不出来，成片也无处挂。作品与脚本职责不同：**作品 = 交付单位**（成片、总进度），**脚本 = 可生成规格**（叙事、口播、分镜表）。（决定 2026-10-02；此前把两者挤在同一个 `script` 实体里。）

### 5.3 降级 / 合并（都不再是实体）

| 原 | 去向 | 判断依据 |
| --- | --- | --- |
| **rule 规则** | 世界级属性 `identity.constraints` + `world.md` | 消费端已把它当属性（见 5.1） |
| **style 风格** | 世界级属性 `identity.style` + 一张 style 锚点图（最小实现用世界封面承载） | `styleLockFromEntities` 已把所有 style 拼成**一个** STYLE LOCK，`generation-prompt` 也要求"全片一套、逐字复用"——做成可无限添加的类型，等于邀请多个风格互相打架 |
| **story 故事** | **并入 `script`（删 `story`）** | `script` 是超集：`logline`（前提）+ `beats`（节拍 / 叙事结构）已是叙事内核，还多带生成必需的规格；留 `story` 反而丢字段。且 `script` 本就是模型里的"作品"实体。少一个类型，也少一个词表缺口——不必再补 `script_of` 关系 |
| **object 物件** | 由 **`prop`（道具）** 取代为默认锚点（object 作为退役 preset 保留旧实体可读） | 现实制作里关键道具是必备锚点（跨镜一致），不是"可选的扩展"——所以 2026-10-02 把 `prop` 收进默认集 |
| **reference 参考** | 已退役（更早） | media 属性已覆盖 |

### 5.4 场 / 镜头不进默认类型目录

`scene` / `shot`（§6）是**作品容器内部的结构化对象**，不是世界级类型。默认目录只 seed 上面 5 个实体 + 约束属性，避免 preset 随生产能力一起膨胀。

> 命名提醒：`location` 的中文是「场景」，所以剧情的"场"应叫**「场次」**、`shot` 叫「镜头」，避免与「场景」撞车。

### 5.5 "准确"必须顺手修的几处（与本次决策绑定）

- **`script` 必须在 AI 上下文里可见**：`ResolvedWorldEntities` / `projectContext` / `brief` 三处目前只认 `character/location/story/style/rule`，`object` 与 `script` 被**静默丢弃**。默认集里既然保留 `script`，这条就必须修——否则 AI 读世界时看不到脚本，闭环断在这里。自定义类型同样要靠 `base_kind` 兜底进桶，保证用户扩展的类型也可见。
- `style.guidance` 的 label 是英文 "guidance"（随 style 降级一起消失）。
- demo 的 `KINDS` 还挂着已退役的 `reference`（`web/lib/pomelo/world-canvas/index.tsx`）→ 对齐到默认集。

### 5.6 "可运行"的判据

- 新世界打开只有这 5 个实体选项 + 约束属性，空状态干净。
- `world.get` / `brief` / `resolve` 三条读路径都覆盖这 5 个（含 `base_kind` 对自定义类型的兜底）。
- guided actions 收敛到 `character.*` / `location.*` / `script.*`；`rule.*`/`style.*` 的动作挪到 World 面板；`story.*` 合并进 `script.*`。
- 迁移：worlds/ 里 31 条 rule、9 条 style、9 条 story 要转成"属性 / 合并进 script"，PGC 源格式与已发布 manifest 一起动——**这是本改动真正的工作量，不是删类型本身**。

---

## 6. 生产层到底新增什么

### 6.1 对象与落点（谁放在哪）

| 概念 | 落点 | 是否新增 | 说明 |
| --- | --- | --- | --- |
| **场次 scene** | **实体**（作品容器内的结构化对象，**不进 preset 目录**，`base_kind` 空；见 §5 / §5.4） | 新增实体（非 preset） | 一场戏；镜头的分组容器也来自它 |
| **镜头 shot** | **实体**（同上；归属靠 `has_shot` link，`parentId` 只是文件夹） | 新增实体（非 preset） | **生成的最小单位**；有身份、可排序、可复用 |
| **生产树（作品→脚本→场次→镜头）** | 关系 **`has_script` / `has_scene` / `has_shot`**（全局、父→子） | 新增受控词条（复用关系机制） | 树的**单源真源**；`parentId` 只是通用归属，不参与建树（D8） |
| **分镜表 sheet** | 已有 `script.storyboard` 媒体属性 | 复用（**D9：仅排产/预览**） | 一图 N 宫格分镜表（已有协议）；**不进生成参考** |
| **关键帧 / 片段 / 配音** | 镜头实体的 **media 属性**（唯一素材通道） | 复用，新用法 | 一次生成 = 一个媒体资产；资产的 `metadata.proposal` 就是配方 |
| **场成片 / 作品成片** | 场次 / 作品的 **media 属性**（同一条通道） | 复用 | **上层产物 = 下层产物的聚合**（拼接/合成）；这正是 liblib 图外的 `finalOutput` 所在的位置 |
| **引用（用料）** | 产物资产自己的 `references[{id,kind,role}]`（`id` = `assetId`） | 复用 | 引用的底层都是 asset；画布上是否需要连线只是它的**可选可视化**，不是数据要求 |
| **镜头顺序** | 关系 `followed_by` / `precedes` | 复用已有词表 | 时间线顺序，不用新机制 |
| **镜头/场的文字描述** | `entity.intro` / `entity.detail` | 复用 | 镜头意图、画面说明写在正文里 |
| **生成状态** | 计算得出，不落库 | 新增（派生） | 由"资产生命周期 + 上游版本"推导，避免状态写脏 |

**产物挂在"层级"上，不是平铺。** 这是同一套机制的水平延展：**任何生产节点都能挂产物** —— 镜头挂 关键帧/片段/配音，场次挂 **场成片**，作品挂 **成片**。上层产物是下层产物的**聚合**（把该场的镜头片段拼起来、把所有场拼成片）。于是链条闭合、结构完整：**料 → 镜头的活 → 场的活 → 作品的活**。这也顺手把 liblib 那个"图外的 `finalOutput`"收进模型——成片就是作品的**一条 media 属性**，不是新表。

**状态自底向上 rollup**：节点的状态 = 自身产物 ∪ 子级状态（`failed > generating > ready > planned`，单调）。所以 `recut.worlds.production` 从 **作品 → 视频脚本 → 场次 → 镜头** 给出一棵树，根节点直接回答"整部作品好了没"。它只回答"已挂上的产物都好了没"；"这个节点该有几个产物"是计划（plan）的事。

### 6.2 为什么这么放（判断依据）

- **镜头应该是"实体"，不是普通的画布卡片。** 因为镜头需要：有身份（能引用）、能排序、能跨集复用、能进版本。这些正是实体的能力；做成纯画布元素就会变成一个"查无此人"的临时方块。
- **树应该是"link"，不是"parentId"。** 归属（这张卡摆在哪个文件夹）与结构（谁的生产子节点是谁）是**两件事**。`parentId` 只回答"摆在哪"，是通用文档树（Notion 式），**不做类型校验**、也不该被当成生产结构——否则"把镜头挪到别的文件夹 / 剪切粘贴"就会撞上结构校验、被 Block。真正表达 `作品→脚本→场次→镜头` 的是显式结构关系 `has_script`/`has_scene`/`has_shot`（全局、父→子）。`world_relations` 本就是 entity→entity 图，天然允许多父与环，解析端做**环安全**即可。于是**移动卡片不断链**；只有"要跨 parent 关联同一实体"时才需要未来的 reference_node（软链接）。
- **产物应该是"媒体的属性"，不是新表。** 因为项目已有铁律：素材只有一条通道——media 属性（`unified-entity-model`）。生成出来的图/视频/音频本来就该是媒体资产，带 `proposal` 配方。
- **引用应该是资产级的，线只是可选可视化。** "这次生成用了什么料"的权威表达是产物资产自带的 `references[{id,kind,role}]`（`id` = `assetId`，`generation-reference-protocol`），它天然可追溯、可重跑。画布上画不画一根线、用什么样式，纯属展示选择，**不构成数据、也不需要新的边类型**；要画也只是把这份资产引用读出来。
- **状态应该是"算出来的"，不是"存下来的"。** 存状态一定会过期；用"上游版本 + 资产当前状态"推导，天然正确。这也正是他们对 `isStale` 的做法。

> 结论：**零新增写入面**，完全落在"World 即画布"（`world-canvas-sole-write-surface`）之上。

### 6.3 镜头（shot）的默认字段：只有描述性字段，产物按需

沿用 `entityTypes` 的字段 schema 机制（`text/textarea/number/boolean/select/media`）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| 镜号 | text | 如 `S01-03`；排序用 |
| 景别 / 角度 / 焦段 | text | 来自 `recut-director/references/shot` 的镜头语法 |
| 时长（秒） | number | 生成与拼接的预算 |
| 镜头运动 | text | 一镜只给一种主导运动（导演规则） |
| 台词 / 旁白 | textarea | 与声线参考配合 |
| 画面描述 | textarea（落到 `detail`） | 可执行的分镜正文 |
| 背景 | media | 卡片背景（通用字段） |

**产物不设固定槽位**（关键修正）：镜头**不是首尾帧模式**——生成关系至少三类（参考驱动 / 首尾帧 / 文生），实测绝大多数是参考驱动（liblib 90 镜里 89 个 `mixed2video`）。所以：

- 产物 = **镜头上的按需 media 属性**，用 `label` 标角色（关键帧 / 首帧 / 尾帧 / 片段 / 配音）；
- 生成方式与"用了哪些料、什么 role"记在**产物资产自身**的 `metadata.proposal`（`model/modeType/params/references`），不是镜头字段；
- 术语上：镜头**是实体**（有身份、可排序、可挂产物、能当容器），产物**是属性**（§5 的三层）。生成状态由产物资产生命周期**派生**（planned/generating/ready/failed），不落库。

场的默认字段：一句话概括、节拍、情绪、目标时长（对齐已有 `script` 的字段风格）。

---

## 7. 画布怎么呈现

在 World 画布内增加一个**生产视图**（可与"设定视图"切换，或作为同一画布的展开层）：

- **镜头卡**：分镜缩略图 + 镜号 + 景别/时长 + **状态点**（计划中/过期/生成中/就绪/失败）+ 产物缩略（关键帧/片段/配音）+ 参考数徽标。
- **场 = 分组框**：一眼看出这场戏包含几个镜头、进度如何（对应他们的「分组 N 个节点」，但由数据自动生成，不用人起名）。
- **引用（可选可视化）**：资料来自产物资产的 `references[]`（底层是 asset）；如果画连线，颜色按 role 区分（角色/场景/风格/声线/分镜），点开 = 看这次生成用了哪些 asset、配方是什么。**画不画线不影响数据。**
- **卡片上的直接动作**：确认生成 / 重生成 / 查看配方 / 拆首尾帧。
- **语义缩放（LOD）**：缩小看"场 + 进度"，放大看关键帧与配方。解决他们"必须缩到 10% 才能看全图"的可读性问题。

与设定视图**共用同一份世界数据**，只是投影不同——所以同一个角色，在设定视图是"设定卡"，在生产视图是"所有镜头都在引用它的锚点"。

### 7.1 富属性怎么上画布：块只吃原语，对象在投影层塌平

实体属性现在有两类：**标量**（`text/textarea/number/boolean/select`，如镜号/景别/台词）与**对象**（media `{assetId|url, name?, kind?, segment?}`，如角色外貌图、镜头产物）。画布要承载它们，但**不是靠给块加"通用文本区域"**——那会把对象形状泄漏进渲染层，且越加越胖。四条规则：

1. **块只吃原语，永不收对象。** 投影层负责把 attr 解包成块需要的扁平字段：`{label, text?, mediaSrc?, attrMedia?, status?, name?, duration?}`。"属性变成对象"这件事**在投影边界就被吸收**：今天 `mediaSrc`（URL）+ `attrMedia`（模态）已经是这么来的（`canvas-pomelo.tsx` → `resolveMediaSrc` / `mediaSource`，`free-element-block-v.ts` 只认这两个字符串）。要补的是**多传几个已解包的原语**（状态/名称/时长/segment 文案），**不是把对象传下去**。对象形状再演进（加 recipe/status），块零改动。
2. **对象值的语义是"一个素材引用"，不是一段结构化文本。** 所以画布上任何富媒体属性的呈现都是**有类型的**：图 → 真封面；视频 → 首帧 + 悬浮播放；音频 → 播放器；再加**状态角标**（生成中/失败）。**不需要文本区**。将来若真出现"结构化非 media"值（如片段区间 `{startSec,endSec}`、裁剪框 `{x,y,w,h}`），由投影层**格式化成字符串**（`00:12–00:18`）再走文本态——**块永远看不到对象**。
3. **丰富属性首先丰富"实体卡"，而不是逼人外化。** 现状 `entity-card` 只画「封面(图) + 相册(图) + 名称 + intro」——它**表达不了 shot**（镜号/景别/台词 + 图/视频/音频产物 + 状态）。所以：
   - **主承载 = 升级 `entity-card`**：卡片投影归一化为「名称 + intro + 类型化字段行(N) + 混合媒体条(图 / 视频首帧 / 音频，带状态) + 子项计数」。这是"实体略读投影"的本分，不是新块。
   - **补充承载 = 外化属性卡**（`free-element` + `elementKind:"attr"` + `attrMedia`）：保持"一个属性"语义不变，只用于把**某一个**属性单独摆到画布叙事位。
4. **细粒度信息不上卡**：`segment`、`recipe(proposal)` 只进详情面板 / 属性卡展开，不上卡片（卡片只略读，这是既定纪律）。

**命名收敛（顺手做）**：画布现有两套写法并存——`kind="attr"` + `props.media` 与 `kind="media"` + `props.assetId`。建议统一为：**属于某实体的属性 = `attr` 元素**（`elementKind="attr"` + `attrMedia`）；**不属于任何实体的游离素材 = `media` 元素**。同一个东西不要两种 id。

**不重复呈现（重要）**：同一个属性在**同一张画布上只呈现一次**。当 `script` 与 `shot` 同屏时，镜头产物**已经在镜头卡上**（封面/媒体条），就**不要再为它另放一张独立的属性卡**——否则 `shot` + `shot 的关键帧卡` + `script` 会三重表达同一件事。规则：

- **默认：产物留在实体卡上**（卡是实体的略读投影）；外化为独立属性卡是**例外**，只用于"需要在空间上单独摆位/强调某一个属性"（如作品的分镜表、场成片）。
- **投影层去重**：某 attr 已被一张独立属性卡呈现（有属性边指向它）时，卡片投影**从卡上剔除**该 attr，不重复渲染。判定在投影层（§7.1 第 1 条），不需要新数据、不需要块改动。
- **Agent 行为约定**：建图时**不要**为每个产物都外化一张卡；产物默认不画布化（它在实体卡里）。

> 一句话：**对象不画布化，引用才画布化。** 属性对象的作用是指向一个 asset；画布呈现的是那个 asset（有类型、有状态），不是那个对象。

> **本期暂缓**：第 3 条「升级 `entity-card` 承载富属性（字段行 + 混合媒体条 + 状态）」**暂不做**（决定 2026-10-02）。因此当前镜头/作品的富属性在画布上**还看不到完整呈现**（卡片仍只有 封面图 + 名称 + intro）——数据层（§6）已就绪，渲染层待排期。第 1/2/4 条与去重规则不依赖它。

### 7.2 交互：上下文即容器，`childTypes` 决定"默认建什么 / 要不要归属"

`parentId` 与 `childTypes` 一旦有声明，**交互就必须随"你在哪一层"变化**——否则它只是文档里的死数据。

**上下文 = 容器**：画布的 `contextId` 就是容器（`""` = 根，非空 = 该实体的内层画布）。所以"在当前层建卡"天然知道容器是谁。

`childTypes` 决定两件事，都按 advisory **降级、不禁止**：

1. **默认建什么**（双击空白 / `+` 菜单置顶）：
   - 根画布 → 人物 / 场景 / 视频脚本；
   - 在**视频脚本(script)** 的内层 → 默认「场次」，菜单里 `场次 / 镜头` 置顶（作品的内层默认「视频脚本」）；
   - 在**场次(scene)** 的内层 → 默认「镜头」；
   - 在没声明 `childTypes` 的容器里 → "最近使用 + 通用菜单"。
2. **要不要自动归属**（这条更关键）：
   - 建的类型**在该容器的 `childTypes` 里** → 自动 `parentId = 容器` + `contextId = 容器`（**归属 + 落卡**）= 真正的子结构；
   - 建的类型**不在 `childTypes` 里** → 只给 `contextId = 容器`（**落卡但不归属**）= 摆在这一层的参考/素材，不是子结构。
   - 于是 `childTypes` 顺便区分了**"结构 vs 装饰"**：场次/镜头是作品的结构，其他卡只是摆在这层。
   - **归属 ≠ 树**（D8）：建生产类型（`work`/`script`/`scene`/`shot`）时，服务端**额外自动补一条结构链**（`has_script`/`has_scene`/`has_shot`，父→子）。这条 link 才是生产树的真源；`parentId` 只决定卡片摆在哪个文件夹——改了它（移动 / 剪切粘贴）也**不断链**。

**从实体卡拖出（`+` 手柄）**：若该类型声明了 `childTypes`，手柄菜单直接给「新建场次 / 新建镜头」（"从 script 拖出来直接建 scene"就是它），与"建关系 / 加属性"并列；没声明则走通用菜单。

**仍然是 advisory**：不在 `childTypes` 里**不是"不能建"**，只是不置顶、不自动归属——用户/Agent 仍可显式建（并显式给 `parentId`），只是菜单把它收进"更多类型"。这也回答了"有些场景能双击建某种类型、有些不行"：**不是能不能，而是默认与归属不同**。

> 注意与 §7.1 的去重规则叠加：内层画布上，**归属型节点默认以自己的卡呈现**（场次/镜头就是卡本身），只有"要单独摆位的属性"才外化成属性卡。

> **最后阶段要补（外层看不到内层）**：`parentId` 把画布变成**树**，但**外层卡现在看不见内层信息**——一张作品/场次卡上不知道"里面有几个子项、什么状态"。外层只需**外露必要的聚合信息**（子项计数 + 子树 rollup 状态，如「2 场 · 6 镜 · 3 ready」），细节留在内层。数据**已经算好了**（§6 的 rollup 与 `production.Counts`），只差投影与卡片；与 §7.1 的 `entity-card` 升级在**最后阶段**一起做。

---

## 8. Agent 驱动（这是我们和他们的根本区别）

两个 Agent 工具，一个"计划"一个"执行"：

- **`plan`（计划，不花钱）**：Agent 读一次世界（`world.get`，拿到角色/风格/场景锚点 + 声线），结合剧本分镜，产出一份**生产计划**：
  - 拆出「场 → 镜头」；
  - 每个镜头绑定参考（按 role：主角色图、场景图、风格锁、声线）；
  - 给出建议模型、参数、时长和**成本预估**；
  - 落到画布上作为**草稿生产图**（不提交生成、不进 Canon），并写入 **`has_scene` / `has_shot` 草稿链**（`is_provisional`，仍 0 revision）。
- **`apply`（执行，在用户确认后）**：用户可在画布上直接改镜头、改参考、删掉不要的，然后确认；确认后按镜头提交生成——**图片/语音直接排队**，**视频走待确认**（复用现有提案闸门）。

**为什么这比手工图强：**

- 他们的 697 条线是**手工接线**；我们的引用由 Agent 依据 role 硬规则生成，**不会漏掉主角色参考图**（这是 `recut-worlds` 里最严重的误用），也不会起「图片节点 48 - 副本」这种名字。
- **重跑便宜**：配方在，上游换了料 → 下游自动标脏 → 一键重生成整场。他们只能"复制一份再改"。
- **成本可控**：计划阶段不花钱，用户先看整张图再决定花多少。

---

## 9. Skill 层怎么调整

Skill 是引导 Agent 的核心手段。真实案例（§1）反过来验证了一件好事：**"提示词怎么写"这一层我们已经到位，不用大改**——`generation-prompt` 已覆盖并超过他们的做法（CAMERA LOCK / STYLE LOCK / typed 参考锚点 / 用满片段时长的多镜连续段 / 画内文字逐字写死 / 声音两层）。要补的是**"链"这一层**：真实制作里最吃重的两件事，恰好是我们链里缺/弱的环节。

### 9.1 随默认集收口（§5）必改的文案

- `recut-worlds`（**已落地**）：预设枚举改成 `人物 / 场景 / 视频脚本`；删掉"风格/规则是实体"的用法，改为"**风格是世界级属性**（`identity.style`）、**规则是世界级约束**（`identity.constraints`）"；"故事"表述改为"作品 = `script`"；`facts` 明示为"角色 / 场景 / 作品 / 风格"。
- `recut-director`：**Mode 链不用改**——链里的 `story` / `script` / `shot` 是**子技能名**（叙事编排 / 作品脚本 / 分镜），与「实体类型」是两回事（已核对：director 的子技能里没有把 `story`/`style`/`rule` 当实体类型用）。只需保证 Mode 文档不出现"建 story/style/rule 实体"这类措辞。
- guided actions：`story.*` 动作随类型退役自然失效（`script.*` 已覆盖其能力）；`style.*` / `rule.*` 的新动作应挂到 **World 面板**（作用于世界属性），而不是实体面板——待随 §9.2 的资产/计划环节一起做。
- world.md 模板与既有 world.md：「规则」段改为"世界约束（always/never/prefer）+ 正文"，视觉语言段改为"世界风格属性"。

### 9.2 补两个"链"里缺的环节（最值钱的调整）

真实案例的三根支柱是：**① 先把参考锚点备齐 → ② 把一场戏规划成可连续生成的镜头 → ③ 用完整提示词生成**。我们的 ③ 很强，①② 缺/弱。

| 缺的环节 | 现状 | 建议 |
| --- | --- | --- |
| **参考资产开发（assets）** | 藏在 `cinematic-drama` Mode 的 reference-development-guide 里（人物卡三视图 / 场景图 / 色卡 / 声线 / 分镜表），**通用链里没有这一步** | 提升为 `recut-director` 的**跨 Mode 环节**（如 `references/assets`），放在 Mode 表里 `shot` **之前**；产出 = 一组锚点资产（角色卡 / 场景图 / 色卡 / 声线 / 分镜表），对应 §5 的世界锚点 |
| **生产计划（plan）** | `cinematic-drama` 已有"片段表 + 片段 × 素材矩阵"，但只在那个 Mode 内；通用链没有 | 泛化为通用环节（如 `references/plan`），规定产出形状 = 场 → 镜头 → 每镜参考绑定 → 模型 / 参数 / 时长 / 成本；**与 §8 的 `plan` 工具对齐**（技能教"怎么写计划"，工具管"怎么落计划"） |

> 判断依据：这两步正是 `recut-worlds` 里"**最严重的误用**——世界生图/生视频不带参考图"的根因——不是 Agent 不听话，而是**链里根本没有"先备锚点"这一步**。

### 9.3 补一个产物：配音表演稿

- 真实案例里，配音是**一整条表演说明**（声线 + 逐句情绪 / 语速倍率 / 气口 / 破音 / 时间码），TTS 按它演。
- 我们现在有"对白逐字 + 音色参考（`voice_reference`）+ 声音两层"，**锁了音色，没锁表演**。
- 建议：在 `script` 的 `vo` 之外明确"**配音表演稿**"的写法（逐句：情绪 / 语速 / 气口 / 破音点），或单开一小段 reference 文档；有台词的镜头按它提交。

### 9.4 补一条纪律：上游变了下游要重跑

- 真实案例用 `isStale` 表达"上游换了料，下游过期"。我们以前没有依赖图，技能里也就没有这条纪律。
- 生产层落地后，skill 需加一条：**改世界锚点（角色卡 / 场景图 / 风格 / 声线）→ 用到它的镜头标记过期 → 一键重跑**（对齐 §11 的 M4）。
- 顺带统一"版本 / 重跑"语义：用 take / revision，而不是像他们那样"复制一份改名字"。

### 9.5 不要动的部分

- `generation-prompt` 的提示词形状——**D9 修订（2026-10-04）**：真实好样本是**资产驱动的密切镜头清单**，不是「巨型 STYLE LOCK + 一镜到底」。已改为：CAMERA LOCK ≤1 行/禁品牌、STYLE LOCK ≤2 行/禁引擎词、参考锚定表每条带一句细节、每镜 1.5–4s 密切 + 前景/纵深/物理、新增《真实感与去 AI 味》；**分镜表不进生成**。
- 参考 role 词表与"不带参考不提交"的硬规则——方向正确，正是手工流程最容易出错的地方，保持。
- `recut` skill 的"生成必先导演"硬约束——保持；§9.2 只是把它细化成链上的两个明确环节。

---

## 10. 我们比他们多走的一步：成片

他们图里最后一环 `finalOutput` 是空的——成片在别的工具里剪。我们不一样：生产层的镜头直接接到 **remotion-studio 时间线**，就绪的镜头按 `followed_by` 顺序排成时间线，**生产 → 成片闭合在同一个平台里**。

---

## 11. 执行计划（MVP）

| 里程碑 | 内容 | 验收 |
| --- | --- | --- |
| **M0 世界模型收口（默认集）** | 见 §5：目录 seed `work`/`character`/`location`/`script` + 世界级 `constraints`；`rule`/`style` 降级为世界属性（`identity.constraints` / `identity.style`）；`story` 并入 `script`；修 `object`/`script` 在 `ResolvedWorldEntities`/`projectContext`/`brief` 的丢失（含 `base_kind` 兜底）；guided actions 收敛，demo `KINDS` 对齐；**同步 `recut-worlds` / `recut-director` 文案（§9.1）** | 新建世界只看到 4 个实体 + 约束属性；`world.get`/`brief`/`resolve` 都能看到 `script`；rule/style 作为世界属性在提示词里生效 |
| **M1 数据与对象** | `scene` / `shot` 结构化对象（作品容器内**实体**，**不进 preset 目录**，用到即建）；**产物 = 按需 media 属性（无固定槽位，label 标角色），且可挂在任一层**（镜头 / 场成片 / **作品成片**）；`recut.worlds.production` 返回 **作品→脚本→场次→镜头** 树 + 自底向上**派生状态** | 建出「作品→脚本→场次→镜头」，产物落媒体属性并带资产引用；`production` 读回树与状态 |
| **M2 生产视图** | ⏸ **未实施**（仅设计，见 §7.1 / §7.2）：生产视图（场分组框 + 状态点 + 引用可视化）+ 节点富属性呈现 + 外层卡外露内层 rollup | — |
| **M3 Agent plan / apply** | ✅ **已实施**：`recut.worlds.production.plan`（按类型 schema 的 `childTypes` 把「场次→镜头」草稿挂到 `parentId`——通常是**视频脚本**，零花费、不产 revision；`placeCards` 落卡）+ `.apply`（用户确认后**一次转正**，产 1 条 revision）；新增 `work` 预设（作品层）+ `childTypes` 类型声明（advisory，走 `entityTypes.list` 暴露）；新增 skill 环节 `references/assets`（参考资产开发）与 `references/plan`（生产计划），并接进 director Mode 链与 `recut-worlds` 工具图。**待补**：配音表演稿写法（§9.3） | 给一段剧本，Agent 一次产出整场镜头计划（草稿）；用户确认后转正；逐镜生成仍走媒体工具 |
| ~~**M4 过期与重跑**~~ | ❌ **不做（overdesign，2026-10-02 决定）**：失效重跑需要一整套版本溯源（资产绑定 revision vs 当前），收益不抵复杂度；改锚点后由 Agent 按 `references/qc` 自行判断重生成即可 | — |
| ~~**M5 接线成片**~~ | ❌ **不做（overdesign，2026-10-02 决定）**：接时间线是 remotion-studio 的职责，生产层只把成片作为**作品/场次的 media 属性**（已有能力），不新增编排 | — |

M0 / M1 / M3 已实施；M2 仅设计未实施；M4 / M5 明确不做。

**M0 实施记录（2026-10-02，已落地并验证）**

- 服务端：预设目录收窄为 `character`/`location`/`script`（`retiredPresetEntityTypes` 归档 `reference/object/story/style/rule` 的未用 builtin 行）；`ResolvedWorldEntities` 的 `Story`/`Stories` → `Work`/`Scripts`；`WorldSelection.StoryID` → `WorkID`；`projectContext` / `brief` 新增 `script` 桶与 `base_kind` 兜底，并合并 `identity.constraints` / `identity.style`（旧 `rule`/`style`/`story` 实体仍可读）；readiness 蓝图把 `story` 换成 `script`、`style`/`rule` 改为世界属性度量（`identityAttrPresent`）；`availableEntityKinds` 收窄。
- Web：`entityKindLabels` 与 `EntityKind` 收窄；`WorldSelection.storyId` → `workId`（client + world-detail-client）；demo `KINDS` 对齐。
- Skill：`recut-worlds` 预设枚举/属性口径/`facts` 文案更新；核对 `recut-director` 的 Mode 链里的 `story` 是**子技能名**、与实体类型无关，**无需改动**。
- 内容迁移：新增 `scripts/worlds-consolidate-defaults.mjs`（幂等，`--check` 可用），8 个世界全部收口（31 rule → constraints、9 style → identity.style、9 story → script）；`worlds-migrate-v2 --canvas` 重排、`worlds-inspect --all` 与 `worlds-publish --check` 通过。
- 验证：`go build`/`go vet` 通过；`go test` 全绿（仅 6 个缺内置 App 归档的**既有**环境失败，与本改动无关）；web `tsc`（app/lib/components 零错）+ 36 个单测通过。

**M1 实施记录（2026-10-02，已落地并验证）**

- **场次/镜头 = 用到即建的结构化对象**：新增 `productionEntityTypeFields` / `productionEntityTypeNames`，在 `ensureEntityTypeInTx` 里按需播种——**不进默认 preset 目录**（D6），但一建就带真实 schema（镜头：镜号/景别/时长/运镜/台词 + `background`）。
- **产物不设固定槽位**（关键修正）：镜头**不是首尾帧模式**——生成关系至少三类（参考驱动 / 首尾帧 / 文生），实测绝大多数是参考驱动（liblib 90 镜里 89 个 `mixed2video`）。因此产物是**按需的普通 media 属性**，用 `label` 标角色；生成方式与"用了哪些料/什么 role"记在产物资产自身的 `metadata.proposal`（`model/modeType/params/references`），**不是镜头字段**。
- **状态派生**（`service/worlds_production.go`，纯函数、不落库）：**作品(work) → 视频脚本(script) → 场次(scene) → 镜头(shot)** 树；**产物可挂在任一层**（镜头产物 / 场成片 / **作品成片**——liblib 图外的 `finalOutput` 在此归位）；节点状态 = 自身产物 ∪ 子级状态，自底向上 rollup（`failed > generating > ready > planned`）。只回答"已挂上的产物都好了没"，"该有几个产物"留给计划（M3）。新增只读工具 `recut.worlds.production`（已登记进 tool inventory 合约测试）。
- **不重复呈现**（设计规则，见 §7.1）：同一属性同屏只呈现一次；产物默认留在实体卡上，外化为独立属性卡是例外，投影层对"已被外化"的 attr 从卡上剔除。**`entity-card` 富属性升级本期暂缓**——数据层已就绪，渲染层待排期。
- **修两个对象值引出的真 bug**：① `syncAttrElementValue` 用 `==` 比较属性旧值，属性变对象后 Go 比较 map 会 **panic** → 改 `reflect.DeepEqual`；② 画布回写按需 key 时 `patchEntityAttr` 一律当成 `text`，media 对象校验必失败 → 新增 `inferAttrType`（`{assetId|url}` → media，bool → boolean，number → float64，否则 text）。
- 验证：`go build` / `go vet` 通过；`go test` 全绿（同样只余既有环境失败）。

**M3 实施记录（2026-10-02，已落地并验证）**

- **`childTypes`（类型 schema 的树形声明）**：`entityTypeChildTypes` 常量（`script→[scene,shot]`、`scene→[shot]`、`shot→[]`），经 `entityTypes.list` / `entityTypes.get` 暴露。**advisory 不是硬门**（只喂"默认建什么 / 默认连哪条链"；树的真源是下面的 `has_*` 结构链，任何实体都能当容器）；按 `worldRelationTypes` 的先例做成常量，零迁移。
- **`production.plan`**：按 `scenes:[{name,shots:[…]}]` 一次派生整棵树，全部 `isProvisional`——**零花费、不产 revision**（测试断言）；`placeCards` 在作品内层画布落卡。**只建结构、不生成素材**；树由 **`has_scene` / `has_shot` 结构链**表达（草稿 `is_provisional`），`parentId` 只是落位。
- **`production.apply`**：把 `workId` 子树（或全库）的草稿在**一条事务**里转正，**产 1 条 revision**；`expectedRevisionId` 走乐观并发。
- **交互含义（§7.2）**：`contextId` 即容器 → 在作品内层默认建「场次」、在场次内层默认建「镜头」；**在 `childTypes` 里 → 自动 `parentId`（归属），不在 → 只落卡（装饰）**。
- **Skill**：新增 `recut-director/references/{assets,plan}/SKILL.md`，并把两个环节接进 Mode 链（`… → assets → plan → shot …`）；`recut-worlds` 工具图补三个生产工具与"生产层"说明。
- **合约**：新工具登记进 tool inventory 与 `worldMutatingTools`（广播 `world.changed`）。
- 验证：`go build` / `go vet` 通过；`go test` 全绿（只余 6 个既有环境失败 + 2 个已知 flaky 的临时目录清理用例，单独跑均通过）。

---

## 12. 验收标准

> 只列 **M0 / M1 / M3**（已实施）。M2 未实施、M4/M5 不做，其验收项不在此列。标 ✅ 的由自动化测试覆盖，标 ⚠️ 的需人工或待补测试。

- ✅ 新世界的 entity type 目录**恰好 5 个**：`work` / `character` / `location` / `prop` / `script`（退役类型不在其中；`character` 显示名为「角色」、`prop` 为「道具」），且 `work.childTypes=[script]`、`script.childTypes=[scene,shot]`、`scene.childTypes=[shot]`（`TestWorldsMCPProductionChain` / `TestEntityTypeChildTypesDeclared` / `TestPresetEntityTypesAreSeeded`）。
- ✅ 整条生产链 **作品(work) → 视频脚本(script) → 场次(scene) → 镜头(shot)** 可建、可读、可转正（一个作品可有多个脚本）（`TestWorldsMCPProductionChain`）。
- ✅ 生产树由 **`has_script` / `has_scene` / `has_shot`** link 单源解析（**不靠 `parentId`**；不设 `parentId`、纯手连链也能成树），且**环安全**（`TestProductionTreeResolvesFromLinksNotParentId`）。
- ✅ `world.get` / `brief` / `resolve` 都能看到 `script`（不再被静默丢弃）；`identity.constraints` / `identity.style` 合并进约束与风格（`TestWorldBriefMissingMatchesReadiness` / readiness 测试）。
- ✅ 能建出「作品 → 视频脚本 → 场次 → 镜头」的树；产物（关键帧 / 片段 / 配音…）是**按需 media 属性**，用 label 标角色；状态**派生**（planned/generating/ready/failed）且**自底向上 rollup**（`TestProductionStatusTree` / `TestRollupProductionStatus`）。
- ✅ `production.plan` 落**草稿**：**零花费、不产 revision**（含 `has_scene`/`has_shot` 草稿链）；`apply` **一次转正、产 1 条 revision**（实体与结构链一并转正）（`TestPlanThenApply` / `TestWorldsMCPProductionChain`）。
- ✅ 产物可挂在**任一层**（镜头 / 场成片 / 作品成片），上层 = 下层聚合（`TestProductionStatusTree`）。
- ✅ 旧世界兼容：`rule` / `style` / `story` 实体仍可读（作为约束 / 风格 / 作品），退役预设只归档**未使用**的行（`TestPresetEntityTypesAreSeeded`）。
- ✅ 对象值属性不回退：`==` 比较不 panic、按需 key 推断 `media`（`TestAttrElementObjectValueSyncIsIdempotent`）。
- ⚠️ **未覆盖（人工 / 待补）**：① web 的 STYLE LOCK 仍只读 `style` 实体（R1）；② `identity.style` / `constraints` 无 UI 编辑入口（R2）；③ "每次引用可追到 asset 与配方"依赖 `metadata.proposal`，仅间接覆盖。
- ➖ 已移出：改上游自动标脏重跑（M4，不做）；镜头排进时间线（M5，不做）。

---

## 13. 非目标

- **不做通用节点图编辑器**（不是给用户画流程图的工具）。
- **不让 Agent 自动写 Canon、自动确认视频**（沿用现有闸门）。
- **不新建"生产图"数据库**：生产层复用实体/关系/媒体属性/画布投影。
- **不默认提供 `rule` / `style` / `story` 实体**：偏属性的降为世界属性，叙事并入 `script`；要更多类型是用户自己的事（目录开放、未知类型自动建极简类型）。
- **不把场 / 镜头塞进默认类型目录**：它们是作品容器内部的结构化对象。
- 不做"手动画 700 条连线"这种体验——那是我们要替代的对象。
- 本期不做多人协同、不做跨世界镜头复用。

---

## 14. 开放问题

| # | 问题 | 倾向 |
| --- | --- | --- |
| Q1 | 镜头是否一律做成实体（会撑大实体列表），还是允许"轻量镜头"只存在于某一层画布？ | 先做成作品容器内的结构化对象；若实体数失控，再引入"项目级镜头"作用域 |
| Q2 | 生产层归 World 还是归 Project？镜头更像"项目产物"而非"世界设定" | 倾向：镜头挂在作品（`script` 实体）之下，仍是 World 内实体，避免两套模型 |
| Q3 | 状态派生函数放在前端还是服务端？ | 倾向服务端算（一份真相），前端只渲染 |
| Q4 | 成本预估由谁给？ | 先按模型单价 × 时长/张数粗算；精确化后置 |
| Q5 | 一图分镜表（sheet）与逐格镜头的关系：sheet 是一个镜头还是一批镜头？ | 一个 sheet = 一组镜头的来源；逐格展开成镜头（对齐 `video-script-storyboard-sheet`） |
| Q6 | 与现有 `script.storyboard` 属性的边界 | sheet 仍存 `script.storyboard`；镜头是 sheet 的**展开**，不重复存图 |
| Q7 | `style` / `rule` 降级后，世界级属性怎么承载一张 style 锚点图？ | 最小实现复用世界封面（`coverAssetId`）；若不足再给 World 一个通用属性面 |

---

## 15. 实施 Review（M0–M3）

对已落地的 M0 / M1 / M3 做了完整 diff review（含已提交的 `79bceaa` 与未提交清理），结论如下。

### 15.1 已修

- **新增「作品」层（用户提出，2026-10-02）**：原先 `script` 既当作品又当脚本 → **一个作品有多个脚本时是几棵互不相干的树**（rollup 答不出、成片无处挂）。已加预设 `work`（作品，交付单位），链变为 **作品(work) → 视频脚本(script) → 场次(scene) → 镜头(shot)**；`work.childTypes=[script]`；`productionNodeTypes` 含 `work`；默认集 3 → 4；web（labels/`entityKinds`/图标）同步；`production.plan` 入参由 `workId` 改为中性的 **`parentId`**（场次通常挂脚本）；作品**只放成片**，交付规格留在脚本（用户决定）。测试把整链（作品→脚本→场→镜）跑通并断言 4 个预设。
- **§7.2 的容器子类型入口未实现（用户发现）**：进入 `script` 的 sub-world 后，`+` 菜单里**没有「场次」入口**。两个根因：① `scene`/`shot` **不是预设**（用到即建，目录里还没有行），菜单遍历目录时看不到；② 菜单**没读当前容器的 `childTypes`**。已修：`canvas-create-menu` 新增**置顶组「此容器可容纳」**——读当前容器类型的 `childTypes`，直接按声明 id 给出入口（`scene`/`shot` 的显示名/图标走 `productionKindLabels`/`productionKindIcons`），建出即由 `createEntity` 自动 `parentId = 容器`（归属 + 落卡一并完成）；`+` 手柄对声明了 `childTypes` 的实体也直接给「新建<子类型>」，且**不补关系**（树 ≠ 关系箭头）；生产类型从通用"设定"组与手柄通用组中**排除**，只在容器子类型组出现。
- **新建入口漏改（用户发现）**：`entityKinds()` 仍硬编码老 7 类 → **设置视图 tab 与画布"新建"菜单还在列退役预设**（物件/规则/故事/风格）。已修：`entityKinds()` 收窄为 3；新增 `RETIRED_ENTITY_KINDS` + `isRetiredEntityKind`；三个新建入口统一过滤（`canvas-create-menu` 预设组、`+` 手柄的实体组、`readLastKind` 的"最近使用"兜底）；设置视图 tab 改为「默认集 ∪ **实际有实体的类型** ∪ 空自定义类型」——否则旧世界的退役类型实体会从设置视图消失。
- **死代码**：删除未被引用的 `worldStyleLock`（投影只用 `worldStyleView`）。
- **常量语义**：`object` / `story` / `style` / `rule` 四个 id 加注 "retired preset" ——它们保留**只为让旧世界的实体继续可解析**，生产代码不应再把它们当预设创建。
- **契约措辞**：`production.apply` 的实际行为是"确认 `workId` **子树下的所有**草稿"（不只场次/镜头），中英描述已对齐。
- **两个对象值 bug**（属性变对象引出）：`==` 比较 map 会 panic → `reflect.DeepEqual`；按需 key 一律当 `text` → `inferAttrType`。均有回归测试。

### 15.2 未修（需排期 / 决策）

| # | 问题 | 影响 | 建议 |
| --- | --- | --- | --- |
| **R1** | **web 仍在从 `style` 实体取 STYLE LOCK**（`styleLockFromEntities`，4 处调用），**没有消费 `identity.style`**；画布 store 也不暴露 world identity | M0 之后新世界没有 `style` 实体 → **STYLE LOCK 为空**（提示词少一块） | 把 world identity 透传进画布 store，`styleLock*` 改为"`identity.style` 优先、实体兜底" |
| **R2** | `identity.style` / `identity.constraints` **没有 UI 编辑入口** | 只有 Agent/API 能写，用户设不了世界风格/约束 | 在世界设置面板补两个编辑区（与 R1 同批） |
| **R3** | `promoteNoteToEntity` 默认 `typeId=object`，但 `object` 已不是预设 | 便签提升出的实体只剩 `description`（以前 object 有 5 个锁定字段） | 默认改到更合适的最小类型，或明确"提升即自定义类型"是预期 |

### 15.3 已确认无问题

- `briefMissingFromCanonical` 与 readiness 端点**都传 `world.Identity`**，两处 `missing` 一致（不会一边报缺风格、一边不报）。
- `childTypes` 是常量、不落库、不进 bundle → 导入导出后由常量**重新派生，不会漂移**。
- 退役预设的归档幂等，且只归档**未使用**的行；旧世界仍在用的 `style`/`rule`/`story` 行保留可读。
- `recut-director` Mode 链里的 `story` 是**子技能名**，与实体类型无关，未受影响（已核对）。
- 内容迁移脚本幂等；`worlds-inspect --all`、`worlds-publish --check` 通过。

### 15.4 已知取舍（记录，非缺陷）

- `recut.worlds.production` **包含草稿**（未过滤 `is_provisional`）——"看计划/看树"的刻意选择；`Counts` 因此也含草稿。
- `apply` 会确认子树下**所有**草稿（含作品本身），不只是场次/镜头。
- `childTypes` 对**自定义类型**为空（常量只声明平台类型）；自定义类型声明子类型留待 P1。

### 15.5 2026-10-02 修正：生产树改由 link 单源（D8）

- **误判更正**：此前把 `parentId` 当作生产树的真源（并要求"树 ≠ 关系箭头"）。实际这不成立：`parentId` 应是**通用归属（Notion 式文件夹）**——自由画布下"任意类型挂任意父"，且一旦把它当结构，**移动 / 剪切粘贴卡片就会撞结构校验**。已改为：树的真源是显式结构关系 **`has_script` / `has_scene` / `has_shot`**（全局、父→子）；`parentId` 只决定落位。
- **数据模型**：`world_relations` / `world_relation_tombstones` 加 `is_provisional`（`project.go` DDL + alter 迁移，幂等）；`WorldEntityRelation` / `WorldManifestRelation` 增 `isProvisional`；canonical 关系快照（`commitRevision`）排除草稿链。
- **写入**：`UpsertEntity` 在"父子都是生产类型"时**自动物化结构链**（provisional 跟随实体）——`plan`（scene.parentId=script、shot.parentId=scene）因此自动产出草稿链，仍 **0 revision**；`CreateRelation` 支持 `IsProvisional`（跳过 revision）。
- **解析**：`production.status` 沿结构链建树、`production.apply` 沿结构链 BFS；两者都**环安全**（visited + 环成员兜底为 root）。`apply` 在同一 revision 里把草稿链一并转正。
- **回滚 / 导出 / fork**：relation tombstone 与重建、bundle 导出导入、world fork 重映射都保留 `is_provisional` 列。
- **词表**：`worldRelationTypes` 新增 `has_script` / `has_scene` / `has_shot`（新分组 `production`）；web 关系候选表补 `work`/`script`/`scene`/`shot` 行。
- **迁移**：新增 `scripts/worlds-materialize-production-links.mjs`（幂等、`--check`），把既有 parentId 生产树物化出 `has_*`；当前世界生产内容为空，为 no-op。
- **验证**：新增 `TestProductionTreeResolvesFromLinksNotParentId`（不设 parentId、纯手连链成树 + 反向环不丢节点）；`TestPlanThenApply` 增断言草稿链 `is_provisional=1`（plan）→ 0（apply，5 条转正）。`go build`/`go vet`/`go test` 通过（仅余既有环境失败）。

### 15.6 2026-10-02 修正：默认集加「角色」语义与「道具」（D4 微调）

- **`character` 显示名 人物 → 角色**：`character` 本是英语里覆盖人物 / 动物 / 生物的词，默认集只叫「人物」会把动物/非人题材挡在外面。**只改显示名，id 仍为 `character`**（零迁移）：`presetEntityTypeNames` 与 web `entityKindLabels` 同步；生成 role `character` 的展示标签也随之为「角色」。
- **新增默认锚点 `prop`（道具）**：现实制作里关键道具是**必备锚点**（跨镜一致），不是"可选扩展"。加入默认集（5 个），字段 `描述 / 外观与标志 / 道具参考图(prop_reference, media, declared role=prop) / 背景`；`object`（物件）退役，由 `prop` 取代（旧实体仍可读）。
- **打通道具的生成链路**（道具参考图真的能作为生成参考）：世界素材引用 role 加 `prop_reference`；`declaredMediaFieldRoles` 加 `prop_reference → prop`；`inferMediaAttrRole` 的 baseKind 分支加 `prop → prop`（生成受控 role 词表本就含 `prop`，无需改协议）。
- **读路径全量覆盖 prop**：`availableEntityKinds`（各世界类型 +prop）、`ResolvedWorldEntities.Props`、`WorldBriefFacts.Props`（`world.get` / `brief` / `resolve` 三处）、`requiredFieldsByKind`（readiness 实质性判据 `description`/`appearance`）。
- **Web**：`EntityKind` union + `entityKindLabels`（角色 / 道具）+ `entityKinds()`（5 个）+ `DEFAULT_ENTITY_TITLES`（新角色 / 新道具）+ 参考角色表（`prop_reference` 道具参考）；`PROPOSAL_ROLES` 的 `character` 标签改「角色」。
- **MCP 文案**：`worlds.get` 的 facts 列表加「道具」；`entityTypes.list` 的 `childTypes`/树真源说明从 `parentId` 更正为 `has_*` link（与 D8 对齐）；`production.plan` 说明补"同时写 `has_scene`/`has_shot` 草稿链"；`entity` 的预设类型枚举更新为 `work/character/location/prop/script`。
- **测试**：`TestPresetEntityTypesAreSeeded` / `TestWorldsMCPProductionChain` 断言 5 个预设、`character.name=角色`、`prop.name=道具` 与 prop locked 字段。

## 附录 A · 证据摘要（反推数据）

来自《阿猫阿雀》`GET /api/community/project/template/detail?projectTemplateUuid=d6e06a451e9642efa7f92b2af7896f8f` 的 `data.detail.snapshotData`（React Flow 图，247 节点 / 697 边）：

- **节点类型**：image 124 · video 90 · audio 17 · text 2 · group 14
- **动作**：image_generate 100 · video_generate 90 · image_resource 23 · audio_generate 11 · audio_resource 6 · text_resource 2 · image_edit 1
- **连线组合**：image→video 428 · image→image 201 · audio→video 55 · video→image 9 · audio→audio 4
- **模型**：图 `doubao-seedream-5-0-pro`(55) / `nebula-ultra`(42) / `lib-image-2`(3) / `nebula-2-flash`(3) / `mj-v8.1`(1)；视频 `star-video2`(84) / `kling-v3-omni`(6)；音频 `seed-audio-1.0`(11)
- **生成模式**：mixed2video 89 · image2image 75 · text2image 29 · text2audio 7 · audio2audio 4 · frames2video 1
- **视频参数**：720p，时长 15s(74) / 5–12s，`enableSound` 开；64/90 个视频节点带音频输入
- **提示词**：视频平均 1861 字（最长 5014），图片平均 604 字；视频提示词用 `{{Mixed N}}` 绑定参考
- **其他**：每节点有 `isStale`；`分组 N 个节点` 框 14 个；单个用户、约 4 个月；25 个离群节点；成片 `finalOutput` 不在图内

完整反推与可复现的分析脚本见 [`docs/analyze-libtv/`](../docs/analyze-libtv/README.md)。

## 附录 B · 术语对照

| 他们的说法 | 我们的说法 |
| --- | --- |
| 节点（图片/视频/音频节点） | 镜头产物（媒体属性）/ 生成任务 |
| 连线（可选可视化） | 资产引用（底层是 asset） |
| 分组 N 个节点 | 场（scene） |
| `isStale` | 过期（下游失效） |
| `{{Mixed N}}` | `references` 的参考位（role 绑定） |
| 复制一份改名字 | take / revision（版本） |
| finalOutput（图外） | remotion-studio 时间线 |

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
