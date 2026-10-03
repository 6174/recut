---
name: recut-worlds
appId: recut.platform
description: 操作 World 与 World Canvas 工具集的通用技能：属性/关系/类型的建模与关联、画布元素的显示与提升，以及世界语境里的媒体生成（先提案、后确认）。
---

# World 与 World Canvas 操作技能（recut-worlds）

World Canvas 是平台把「一个 App」第一公民化的产物：没有独立安装包，却有自己的画布界面、工具面（`recut.worlds.*`）与元数据。本技能是它的**通用操作技能**，只回答一个问题：**怎么调用 World / World Canvas 的工具，才能把脑中的世界变成 AI 可消费的结构化设定？**

它不描述任何具体世界的内容——那属于 `world.md`（经 `recut.worlds.get` 的 `skillMd` 内联）。内容归世界，操作归本技能；生成提示词的形状归 `recut-director（references/generation-prompt）`。

## 核心模型：先懂这个，再调工具

**Entity = 身份（name / intro / detail）+ 类型（typeId）+ 属性列表（attrs）+ 关系（edges）。**

| 概念 | 真相位置 | 说明 |
|---|---|---|
| 身份 | `name` / `intro` / `detail` | 名称、一句话简介、正文长文（`detail` 是一等字段，不是普通属性） |
| 类型 | `world_entity_types` | 预设 **作品 / 角色 / 场景 / 道具 / 视频脚本** + 自定义（默认集精简可运行，其余按需自建）；决定默认字段 schema。`character` 是**角色**（人物/动物/生物），`prop` 是**道具**（关键道具锚点） |
| 属性 | `entity.attrs`（有序 `{key,label,type,value}`） | 数组顺序即 UI 顺序，可排序 |
| 关系 | `world_relations`（双向语义） | 受控词表 + 自定义 relationType |
| 画布元素 | `world_canvas`（投影 / 表达） | 不产 revision、可重建 |

**属性两种粒度：**

- **类型级字段（schema）**：定义在 entityType 上，该类型的所有实例共享。预设字段 `locked`（label/type/删除被锁，值可改）；`+ 添加字段` 追加 unlocked 共享字段，对既有实例「缺失即空」，不回填。
- **实例级属性**：只属于某个实体（key 形如 `a_xxx`），可自由增删改 label/值。

**属性类型**：`text / textarea / number / boolean / select / media`。

**素材 = media 属性（唯一通道）**：实体挂图片/视频/音频，就是一条 `type:"media"` 的 attr，值为 `{assetId, name?, kind?, segment?}`。不复制二进制，只引用素材库 `assetId`，`segment` 保留「只引用某一段」的能力。

**预设类型字段（locked）**：`work`（作品，交付单位）背景 media（成片是按需 media 属性）；`character`（**角色**）外貌与标志/性格/声音与说话方式/**声线参考（`voice_reference`，media/audio）**/**角色卡（`character_reference`，media/image）**/不可变特征；`location`（场景）描述/氛围/**场景卡（`location_reference`，media/image）**；`prop`（**道具**）描述/外观与标志/**道具卡（`prop_reference`，media/image）**；`script`（视频脚本）一句话概括/节拍/口播/目标时长/画幅/目标平台/分镜表。每类另带一个 **unlocked `background`（media）** 字段——它只是实体卡的**装饰背景**（封面轮播的覆盖项），**不是生成参考**，别把角色卡/场景卡塞进它。**每个锚点实体的核心参考写进它自己的语义卡字段**：`character_reference`（role `character`）/ `location_reference`（role `environment`）/ `prop_reference`（role `prop`），`voice_reference` 是角色的**声线参考**（role `voice`）——`references[]` 直接按字段声明 role（`roleInferred=false`），其余 media 字段才靠推断。

**默认集之外的是「世界级属性」，不是实体**：**风格**写 `world.identity.style`（一个世界一个 STYLE LOCK），**规则**写 `world.identity.constraints`（`{ always, never, prefer }`）。它们是世界的属性，不是对象——做成可无限添加的实体类型反而制造冲突（多个风格互相打架、规则散成卡片）。需要更多类型用 `recut.worlds.entityType` 自建即可——但**关键道具不用自建，`prop` 已是默认预设**。

**视频脚本与分镜**：`script`（视频脚本）是**可生成规格**——既承载叙事内核（一句话概括/节拍），又承载生成规格（口播/时长/画幅/平台/分镜表）；**交付单位是 `work`（作品）**，一个作品可挂多个脚本（见下）。分镜以**一张 N 宫格分镜表（storyboard sheet）**压缩生成（默认 5×5=25 格，每格标 `R{r}C{c}` 坐标与镜号），**默认整张直接作 `role="storyboard"` 参考驱动视频生成**（参考名额有限，整张只占一个），由模型据此展开分镜；仅当升级条件（模型吃 storyboard 参考弱/分辨率不足、需精确首尾帧端点、代表镜 proof 不过）才用 `recut.media.gridSlice` 按 rows×cols 等分切格、逐格细化关键帧。宫格图与单格都作 `role="storyboard"` 锚点。分镜表写回 `script.storyboard` 这条 locked media 属性。

**生产层（作品 → 视频脚本 → 场次 → 镜头）**：`scene` / `shot` 是**容器内的实体**（`typeId=scene/shot`，**不进默认预设目录、不进 facts**，用到即建、自带 schema）。**树的真源是显式结构关系 `has_script` / `has_scene` / `has_shot`（全局、父→子），不是 `parentId`**——`parentId` 只是通用归属（Notion 式文件夹），改它 / 移动卡片不断链；建生产节点时服务端按"父子都是生产类型"**自动补这条链**（草稿实体 → 草稿链）。类型目录的 **`childTypes`** 声明容许的子类型（`work.childTypes=[script]`、`script.childTypes=[scene,shot]`、`scene.childTypes=[shot]`，advisory，只喂"默认建什么 / 默认连哪条链"；容器内新建入口就按它给）。**产物可挂在任一层**（镜头挂 关键帧/片段/配音，场次挂 场成片，**作品挂 成片**——`finalOutput` 就在这里），是**按需的 media 属性**（不设固定槽位、不预设生成方式，用 label 标角色）。整体排产用 `recut.worlds.production.create`（挂到 `parentId`，通常是脚本；**一次调用直接建出正式实体、一条 revision**，无草稿/转正），读回用 `recut.worlds.production`（沿结构链解析、环安全）；逐镜生成仍走 `recut.image/video/speech.generate`。

## 画布层级纪律：无限画布 ≠ 文件夹（建任何实体前先读）

World Canvas 的价值是**无限画布**——内容摊在一层上，一眼看全、随手连线。把实体一层层塞进彼此的**内层画布**（sub-world），就等于把画布退化成文件夹树：每多一层就多下钻一次，"看全"的价值归零。**默认层级最多两层：世界根层 + 作品层。**

两条硬约束：

1. **锚点实体放世界根层**：`character` / `location` / `prop` / `work`（角色 / 场景 / 道具 / 作品）——即"谁 / 在哪 / 拿什么 / 交付什么"——直接建在**根画布**（`contextId: ""`），**归属留空**（不给 `parentId`）。世界级锚点是全库共享的，不要为了"归类"另造中间容器实体（如「作品 - 1」「竖屏版」这类空目录）。
2. **生产实体在作品层平铺**：`script` / `scene` / `shot`（脚本 / 场次 / 镜头）全部建在**作品的内层画布**（`contextId: <workId>`），**归属也停在作品**（`parentId: <workId>`），彼此**同级**；不要 script 套 scene、scene 再套 shot 地逐级下钻。

```text
✗ 太深：把画布当文件夹                ✓ 平铺：最多两层
世界                                  世界
└ 作品 - 1                            ├ 角色 · 阿蛋
  └ 画中哑女                           ├ 道具 · 铜镜
    └ 画中哑女·竖屏3分半版              └ 画中哑女（work）
      └ 临河观音堂·雨夜                    ├ 脚本 · 竖屏3分半版
        └ #15 画褪 …                       ├ 场次 · 临河观音堂·雨夜
                                           └ 镜头 · #15 画褪 …
```

**结构不靠层级、靠关系**：生产树（谁属于谁）由 `has_script` / `has_scene` / `has_shot` 结构链单源表达（`recut.worlds.production*` 会写），`parentId` 只是"摆在哪个文件夹"。把卡片摊到作品层**不会让 `recut.worlds.production` 读不到树**——层级只是表达，别拿它当文件夹。

**唯一的加深例外**：一个作品**确实有多个脚本、且需要按脚本归组场次 / 镜头**时，才把该脚本的场次 / 镜头放进这个脚本的内层（再深一层）；其余一律平铺在作品层。判断依据：`parentId` 的语义是通用归属（Notion 式文件夹），不是生产结构（生产结构的真源永远是 `has_*` 链）。

**工具提醒**：`recut.worlds.production.create` 会按 `作品 → 脚本 → 场次 → 镜头` **依次落 `parentId`**（scene 挂 script、shot 挂 scene），产出的是**深层级文件夹**——它对应上面的"加深例外"（多脚本按脚本归组）。要平铺时**逐层用 `recut.worlds.entity` 建**，把 `parentId` 与 `contextId` 统一给作品 id（层级是创建时定的，事后 `update` 改不了归属，要浅必须一开始就浅）。

## 建一个作品：容器 + 子实体（最常见）

**作品 = `work` 实体（交付单位）。** 放进作品内部有两件互相独立的事：**归属**（`parentId`，通用文件夹，进 Canon）+ **落卡**（`contextId = 该实体 id`，纯表达的内层画布）。**关键：`parentId` 只是"放在哪个文件夹"，生产树 `作品 → 脚本 → 场次 → 镜头` 由结构关系 `has_script`/`has_scene`/`has_shot` 表达**——建子实体时服务端按"父子都是生产类型"自动补链（见上），所以移动卡片/改 `parentId` 不断链。任何实体都能当容器，没有「容器类型」；`containerRole` 只是子实体的角色标签（自由文本、不校验），不是容器标记。**一个作品可有多个「视频脚本」**（30s/60s、口播版 vs 分镜版…）——所以作品与脚本是**两层**：作品挂成片与总进度，脚本挂叙事/口播/分镜表（交付规格）。`childTypes` 声明各层的默认子类型：`work→[script]`、`script→[scene,shot]`、`scene→[shot]`（advisory，只决定"默认建什么"）；**实际摆放按上节《画布层级纪律》平铺在作品层，不逐级下钻**。

标准流程（作品建在哪一层 → 内部放什么）：

1. **选层**：作品落在**根画布**（`contextId: ""`）——作品是顶层交付单位。仅当**用户明确要求**把作品归到某个容器内层时，才给 `contextId: <容器实体 id>`。
2. **建作品**：`recut.worlds.entity` op=`create`，给 `typeId` + `name` + `intro` + `detail`（作品简介/正文写 `detail`，不要拆成 attr）。`typeId` 用与对象性质相符的预设（**作品用 `work`、脚本用 `script`**，角色 `character`，场景 `location`，道具 `prop`）；**没有合适的就先用 `recut.worlds.entityType` 定义自定义类型，不要临时编一个 id**——未知 id 会被静默当成新类型自动建一个空类型。要它落在某层就带 `contextId`（根画布也要显式给 `""`，省略则只建实体、不落卡）；要它归属某容器再加 `parentId: <容器 id>`。
3. **内部组织子实体**：每个子实体 `recut.worlds.entity` op=`create`，**同一调用里同时给两件**——`parentId: <容器 id>`（归属，可被 `entities.list {parentId}` 列出）+ `contextId: <容器 id>`（卡片落到容器内层画布，可双击进入）。只给 `parentId` = 有归属、画布上没卡；只给 `contextId` = 有卡、没归属。**生产链**：在作品下建 `script`/`scene`/`shot`（**同级平铺**，不再逐级下钻）时，服务端会同时写入 `has_script`/`has_scene`/`has_shot` 结构链——那才是树的真源（`parentId` 只是文件夹）。
4. **读回**：作品内层画布用 `recut.worlds.doc {contextId: <作品 id>}`；有哪些画布层用 `recut.worlds.docs`；作品有哪些子设定用 `recut.worlds.entities.get`（返回 `children`）或 `recut.worlds.entities.list {parentId: <作品 id>}`。

```jsonc
// ① 建作品（work，交付单位）：作品是顶层交付单位 → 建在根画布，只给 contextId:""，不给 parentId
// recut.worlds.entity({ worldId, op: "create", typeId: "work", name: "《想找个人说话》",
//   intro: "深夜独处切片 01", detail: "<作品正文 / 大纲>", contextId: "" }) → { id: "<workId>", … }
//   （例外：用户明确要求归到容器 c1 内层时，才 contextId 与 parentId 都给 c1）

// ② 锚点实体（角色 / 场景 / 道具）建在世界根层：只给 contextId:""，不给 parentId
// recut.worlds.entity({ worldId, op: "create", typeId: "character", name: "阿蛋", contextId: "" })
// recut.worlds.entity({ worldId, op: "create", typeId: "location",  name: "深夜客厅", contextId: "" })

// ③ 生产实体（脚本 / 场次 / 镜头）平铺在作品内层：parentId 与 contextId 都给作品 id，彼此同级
// recut.worlds.entity({ worldId, op: "create", typeId: "script", name: "口播版 45s",
//   attrs: [{ key: "aspectRatio", value: "9:16" }, { key: "durationSec", value: 45 }],
//   parentId: "<workId>", contextId: "<workId>" }) → { id: "<scriptId>", … }
// recut.worlds.entity({ worldId, op: "create", typeId: "scene", name: "临河观音堂·雨夜", parentId: "<workId>", contextId: "<workId>" })
// recut.worlds.entity({ worldId, op: "create", typeId: "shot",  name: "#15 画褪", parentId: "<workId>", contextId: "<workId>" })
```

边界：

- **归属只在创建时定**：op=`update` 的 `parentId` / `containerRole` 不被采纳——要归属就在 create 时给；已经建好的实体改不了归属（要换就重建）。
- **归档作品 = 归档整棵子图**：op=`archive` 级联归档作品与其全部子实体（同一条 revision、同一恢复批次），op=`restore` 按批次原位恢复；内层画布与其上的卡保留。
- **作品可再嵌作品**（容器递归），但那是**例外不是默认**——作品默认建在根层，别用嵌套当组织手段（见《画布层级纪律》）；`parentId` 必须同 world——实体从不跨 World。
- 内层画布只是表达层：子实体的真相仍在 `entity`（`attrs` / `intro` / `detail`），画布元素不产 revision。

## 属性怎么显示：三层分工

不要让一处承担所有信息。三层各司其职：

| 层 | 职责 | 显示什么 |
|---|---|---|
| **实体卡**（画布，略读） | 一眼识人 | 封面（第一条 image 属性）、相册（全部 image 属性）、背景（image/video 属性轮播；`background` 属性有值则锁定为它）、名称、简介（2 行）、至多 2 条已填 primitive 字段（`label: value`）、子设定/素材计数徽标 |
| **详情面板 EntityEditor**（精读 / 编辑） | 改内容 | 身份区（名称/简介/正文）+ 字段区（schema 字段 + schema 外属性**续排同一渲染路径**，media 属性与普通属性同一路径）+ 关系区；先读后写、blur 即存、行内「已保存」 |
| **画布属性卡**（空间表达） | 把某个属性摆到画布上 | 一张 `kind="attr"` 元素卡，通过一条**属性边**关联到实体；编辑卡片正文即回写实体 |

规则：**卡片只略读，不承载编辑**（编辑走面板或属性卡）；**长文不进卡片**；封面/相册/背景都从 media 属性派生，不要单独维护素材字段。

## 属性怎么关联：边即关联，值不复制

**单一数据源**：`entity.attrs / intro / detail`。画布上的属性卡只持**引用投影**（`props.value`），不是副本。

**属性关联 = 一条 arrow 边**（`edgeType="attr"`）：`fromElementId` 是实体元素、`toElementId` 是 attr 元素。**不要在画布上复制值，只连边。**

两条同步方向：

- **画布 → 实体**：编辑属性卡正文，按 label 映射回实体——`简介/介绍/intro → intro`、`正文/内容/detail → detail`，否则写同名 attr key（无则新建）。空值不回写；删除属性只在右侧面板做。
- **实体 → 画布**：面板改字段后，绑定该字段的属性卡投影值自动刷新；字段被删则投影清空，不留陈旧副本。

**提升（`recut.worlds.promote`）决定边的语义**：

- `entity → entity` = **关系**（`relationType`，写 `world_relations`）。
- `entity → 自由元素` = **属性绑定**（`field` 绑定到实体属性；自由元素转为引用投影，并生成一个 attr 锚点元素，与右侧属性面板共享同一数据源）。
- 便签/文本提升 = 变成**草稿实体**（`isProvisional`），原元素保留为投影。

画布元素**永不产 revision**；只有 `recut.worlds.promote` 与 Canon 写才产。

## 工具地图（意图 → 工具）

**内容写入收口在画布接口（方案 A，World 即画布）**：实体 / 关系 / 类型都经下列接口写入。

| 意图 | 工具 | 说明 |
|---|---|---|
| 发现 / 读取世界 | `recut.worlds.list` / `recut.worlds.get` | `get` 是**单一入口**：一次返回概览 + world.md（`skillMd`）+ **实体图**（entities 带 media 锚点 + relations）+ **生产上下文**（`facts` 角色/场景/道具/作品/脚本/风格 + `constraints` + `references[]`）+ 就绪缺失 `readiness.missing`；不传 `selection` 即整库。 |
| 读取内容 | `recut.worlds.entities.list` / `recut.worlds.entities.get` / `recut.worlds.entityTypes.list` | 只读；`entities.list` 支持 `typeId` / `parentId`（子设定）/ `text` 与 `includeProvisional`（草稿）；单个实体的 `relations` 由 `entities.get` 带出。 |
| 读画布 | `recut.worlds.doc`（某层）/ `recut.worlds.docs`（层索引） | `contextId=""` 为根画布 |
| 读生产层 | `recut.worlds.production` | **作品(work) → 视频脚本(script) → 场次(scene) → 镜头(shot)** 的树 + 派生状态（planned/generating/ready/failed）；产物可挂任一层（镜头产物 / 场成片 / 作品成片） |
| 排产 | `recut.worlds.production.create` | 按「场次→镜头」**一次建出**并写入 `has_scene`/`has_shot` 结构链（**正式实体，无草稿/转正**，一条事务一条 revision）。**不生成素材**。树的真源是结构链，不是 `parentId` |
| 写内容（画布接口） | `recut.worlds.entity` | op：`create`（可带 `contextId` 自动落投影卡）/ `update`（只覆盖显式字段）/ `archive` / `restore` / `confirm`（草稿转正） |
| | `recut.worlds.relation` | op：`create` / `update` / `archive` / `restore`；`scopeEntityId` 非空为局部关系 |
| | `recut.worlds.entityType` | 定义/覆盖类型 schema（不产 revision） |
| 写画布布局（不产 revision） | `recut.worlds.doc.update` | 元素级 ops：insert / update / remove；自由元素含 `note` / `text` / `shape` / `arrow` / `link` / `attr` / `media` |
| 提升草稿为 Canon | `recut.worlds.promote` | 便签/文本→草稿实体；箭头→关系 / 属性绑定 |
| 多步会话 | `recut.worlds.lock` / `recut.worlds.unlock` | 多步画布编辑前上 advisory 锁，结束务必释放 |
| World 生命周期 | `recut.worlds.create` / `update`（world.md/identity）/ `fork` / `delete` / `revert` / `import` | 世界级操作，不是内容编辑 |

## 门禁（违反会被拒绝或造成事故）

1. **非 local 世界只读**：任何写工具返回 `WORLD_READ_ONLY` 是边界不是失败——说明并提议 `recut.worlds.fork`，经用户确认在副本上继续。
2. **写 Canon 需要用户明确授权**：onboarding/画布 UI 的确认动作即明确授权；无用户请求绝不主动写。
3. **乐观并发**：所有 Canon 写携带 `expectedRevisionId`；`WORLD_REVISION_CONFLICT` 时停止整批、重读、刷新提案，绝不静默覆盖。
4. **草稿免费**：`isProvisional: true` 的实体是探索草稿，不产 revision、不进 Canon、不计入 readiness；用 `recut.worlds.entity` op=`confirm` 转正。
5. **删除是软删除**：`recut.worlds.entity` op=`archive` / `relation` op=`archive` = 归档（`archived_at` + 墓碑 + changeLog，可 `restore` 恢复），画布元素删除 = 本地移除。`recut.worlds.delete` 是永久操作，只在用户明确要求并确认世界名称时调用；**底层 media asset 永不因世界内容删除而删除**。
6. **生成产物默认不进 Canon**：见下。
7. **视频默认待用户确认，图片/语音直接生成**：`recut.video.generate` 会按平台策略落一个**待用户确认**的全局素材（不花钱），把该 `assetId` 写进画布媒体元素，由用户在画布确认后才真正生成；**Agent 只提交与落位，不代确认**。图片/语音成本低，拿到 `assetId` 就落「图片节点 + 属性边」（`assetStatus:"generating"`），不等生成完成。图片/语音虽可直接生成，但**同样必须先过上面的「生图硬规则」**：先读 `references[]`、带对 role 的参考图，再提交。
8. **资产一创建就落位，不等生成成功**（无限画布的第二优势）：图片 / 视频 / 音频只要拿到 `assetId`——哪怕是 `proposed` / `queued` / `running`——就**立刻**在**它所属的画布层**落「节点 + 属性边」并标 `assetStatus:"generating"`，让用户在画布上实时看到进展。**"等生成成功才挂到实体"是最要修的反模式**：用户会在等待里失去耐心。落位**不依赖生成终态**（Canon media 属性也接受未就绪 `assetId`），所以随时可以先落位、后台生成，就绪后画布自动切换。理由与《画布层级纪律》同源：**画布是让人"当下就看见"的表达层**，不是只在完工后才更新一次的存储。

## 读世界的顺序（生成 / 编辑前必做）

World 本身就是 **entities + relations**。只看计数、或只读目标那一个实体都不够——那样会不知道主角色是谁、它的参考图是什么，于是「生成环境就只生成环境」。进入任何世界级任务（尤其生成媒体）前，按顺序建立上下文：

1. **`recut.worlds.get({ worldId })`（单一入口，缺省整库）** —— 一次拿到：身份、**world.md（`skillMd`）**、**实体图**（`entities` 带 media 锚点 + `relations`）、**整库事实**（`facts`：角色/场景/道具/作品/脚本/风格字段与 body）、`constraints`、全部 `references[]` 与就绪缺口 `missing`。据此知道「有哪些角色/场景/道具/作品/风格、谁是主角色、每个实体有哪些参考图、它们怎么关联」。**不要习惯性传 `selection` 只取目标实体**：那会丢掉主角色与风格锚点；只有世界很大、确实要聚焦时才用 selection。
2. **按需深读** —— 某实体完整字段/正文用 `recut.worlds.entities.get`；大世界用 `recut.worlds.entities.list`（`typeId`/`parentId`/`text` 分页）；`world.get` 返回 `graphTruncated=true` 时必须分页补读，不要假装世界只有返回的那些。

**硬规则（生图 / 生视频 / 配音通用，未过不提交）**：任何世界语境下的 `recut.image.generate` / `recut.video.generate` / `recut.speech.generate`，提交前必须先取参考，不许「纯文本直出」：

1. 先 `recut.worlds.get({ worldId })` 读 `references[]`（或 `world.get` 的实体 media 锚点），逐条对照本次画面/声音。
2. 画面会出现主角色 → 必须带该角色参考图，`role="character"`（取实体 **`character_reference` 角色卡** 字段，`references[]` 已声明其 role）。
3. 画面出现**关键道具**（反复出现 / 承担关键动作）→ 必须带该道具参考图，`role="prop"`（取实体 **`prop_reference` 道具卡** 字段，`references[]` 已声明其 role）。
4. 世界已有场景 / 风格 / 色卡锚点 → 按 `role="environment" / "style-ref" / "color-card"` 传入（场景图取实体 **`location_reference` 场景卡** 字段），不堆无关图。`background` 不是参考，不要把它当场景/角色锚点传入。
5. **角色有台词 / 内心独白** → 必须带该角色**声线参考**，`role="voice"`（取实体 `voice_reference` 字段，`references[]` 已声明其 role）。角色不说话的纯环境/静默镜头不必带 voice。
6. **视频提交口径**：用 `references:[{id,kind,role,label}]` 传参考（含 audio role），需要模型发声时传 `audioAssetIds`，并让 `generateAudio` 与「本段是否说话」一致；**不要**只传 `imageAssetIds` 而丢掉 role 与声线。
7. 只有**明确不出现任何角色**的纯空场景，才允许不带任何参考；缺任一应有锚点（角色/场景/道具/声线）即停下补齐，「我忘了读」不是理由。
8. world.md 的「资源口径」优先（例如示例图只作 `style-ref` 低频校准）。

**统一口径**：世界已有声线参考时，角色台词/旁白**必须用该声线**（参考音 → 声音角色 → 合成），不静默换成默认音色；生成以「段/场景」为单位（一段连续动作优先一次多镜连续生成），不逐帧、逐段 5s 硬拼。

**自查（不过即停）**：这次生成引用了哪些 `references`？每条 role 是什么？画面里的主角色对应哪一条？答不上来就从 `references[]` 补齐再提交。

## 世界内的媒体生成：读世界 → 生成 → 落位（视频待用户确认）

在世界/画布语境里生成媒体：**调 generate → 拿 assetId → 落位**；视频由平台落为待用户确认态，用户在画布确认后才生成。

1. **读**：先按上一节《读世界的顺序》——`recut.worlds.get({ worldId })` 一次拿到 world.md + 实体图 + 整库事实 + `references[]`（先不传 selection）。`references[]` 是从实体 media 属性派生的可引用项（`{id,label,kind,role,source,assetId/url,entityId}`，`role` 是建议值）：世界风格（`world.identity.style` 或 world.md 的视觉语言）就是 **STYLE LOCK 来源**；主角色参考图就是**角色一致性锚点**。
2. **写提示词**：用 `recut-director（references/generation-prompt）` 的骨架——STYLE LOCK 逐字冻结；参考用受控 role 声明（词表权威见该技能《参考锚点表达规则》），引用世界的角色、风格、示例图与音色。
3. **解析绑定**：把参考导出为 `references: [{id, kind, role, label}]`（`id` = assetId），按**出现顺序**得到 `referenceIds`；任一 role 与 kind 不匹配、或 prompt/model 缺失即拒绝提交（fail closed）。
4. **执行**：
   - **视频**：调用 `recut.video.generate` 得到**待用户确认**的 `assetId`，把它写进画布媒体元素；由用户在画布上确认后才真正生成（见下）。
   - **图片 / 语音**：直接调用 `recut.image.generate` / `recut.speech.generate`。返回的 `assetIds` **立即可用**，务必**提交即落位**（见下「生成中节点 + 属性边」），不要用 `recut.job.wait` 把落位堵在终态之后。
5. **落位**：图片 / 语音拿到 `assetId` 就**立即**在画布上落一个**图片节点**，并用**属性边**把它连到目标实体——「节点 + 边」才是实体的一条**可见属性**（核心参考写进「角色卡」/「场景卡」/「道具卡」对应字段）；只写实体 attrs 不会在画布上出现节点。`assetStatus:"generating"` 让画布先显示等待态。
6. **可追溯**：`references` 就是「这次生成引用了什么、各自什么 role」的绑定记录，随节点保存，可重生成、可回溯 Canon。

### 图片 / 语音：拿到 assetId 就落位（生成中节点 + 属性边）

`recut.image.generate` / `recut.speech.generate` 返回的 `assetIds` 在**排队/生成中**就已稳定可引用。**不要等图片/语音生成完成**——拿到 `assetId` 立刻用 `recut.worlds.doc.update` 按下面两步把「节点 + 属性边」放上画布（图片用 `media:"image"`，语音用 `media:"audio"`），`props.assetStatus="generating"` 让画布立即显示蓝边「生成中」等待态，素材就绪后**平台自动切换**成真实素材（失败则显示失败态）。

**① 确保实体元素在画布上**（属性边只能从实体元素出发）。先用 `recut.worlds.doc` 读目标层，确认是否已有 `shape:<entityId>` 的实体元素；没有才放（服务端会自动补该 id、名称与默认几何）：

```json
{ "op": "insert", "element": { "kind": "entity", "refKind": "entity", "refId": "<entityId>" } }
```

**② 落图片节点（属性卡）+ 属性边**。图片节点 = `kind="attr"` 且 `props.media="image"`；属性边 = `kind="arrow"`，`fromElementId` 指向实体元素、`toElementId` 指向图片节点、`edgeType="attr"`。两笔放进同一个 `recut.worlds.doc.update` 的 `ops` 数组：

```json
{
  "ops": [
    {
      "op": "insert",
      "element": {
        "id": "shape:attr-<唯一后缀>",
        "kind": "attr",
        "name": "属性 · 场景卡",
        "props": {
          "media": "image",
          "label": "场景卡",
          "assetId": "<recut.image.generate 返回的 assetId>",
          "assetStatus": "generating"
        },
        "geometry": { "x": 200, "y": 120, "width": 260, "height": 140 }
      }
    },
    {
      "op": "insert",
      "element": {
        "id": "shape:arrow-<唯一后缀>",
        "kind": "arrow",
        "name": "属性边 · 场景卡",
        "props": {
          "fromElementId": "shape:<entityId>",
          "toElementId": "shape:attr-<唯一后缀>",
          "attrMedia": "image",
          "edgeType": "attr"
        }
      }
    }
  ]
}
```

规则：

- **摆位贴着要连的对象**：落节点前先用 `recut.worlds.doc` 读该层已有元素的 `geometry`，把新节点显式放在**它要连的那个元素旁边**（如实体卡右侧 320px、纵向对齐），给出 `geometry.x/y`。不传 x/y 时服务端只会把元素贴到已有内容的右侧兜底，仍可能离目标对象很远——那就是画布上「内容飞很远、边拉很长」的成因。
- **节点 + 边缺一不可**：只有 `kind="attr"` 图片节点、没有属性边，它只是画布上的孤立图片；只有边、没有节点，边无所指。二者一起才把图片接成实体的属性。
- 三笔都在**同一个 `contextId` 层**：属性边只能连同层实体元素；根画布用 `contextId:""`，实体容器用该实体 id。不确定先用 `recut.worlds.doc`/`docs` 读该层已有元素与 id。
- `props.label` 就是属性名（这里「场景卡」）。边标签会显示「属性 · 场景卡」；`name` 建议写成 `属性 · <label>`。
- `props.assetStatus` 只写 `"generating"` 表示「落位时素材未就绪」；`"ready"` / `"failed"` 由平台按素材真实状态流转，**不要手写**，也不要为了切到结果态而回写节点。
- 语音（`props.media="audio"`）与图片同策略：拿到 `assetId` 立即落节点、`assetStatus:"generating"`，不等终态。
- 加载态由素材状态自动驱动：**Agent 不轮询、不回写、不等 `recut.job.wait`**；只有在下一步依赖产物内容（要读图/听声再决策）时才等待。落位即可在结尾如实告诉用户「已放上节点，素材就绪后会自动显示」。
- **这条属性属于实体时，画布与 Canon 都要写**：用 `recut.worlds.entity` op=`update` + `attrPatch` 写同名 media 属性，让设置视图 / 实体卡封面 / readiness 也认这条属性。**核心参考用语义字段 key**（角色→`character_reference`、场景→`location_reference`、道具→`prop_reference`；这些 key 命中类型 schema 的 locked 字段，`references[]` 据此声明 role），其它补充素材才用自建 key（`a_<唯一后缀>`）：
  ```json
  { "op": "update", "entityId": "<entityId>", "expectedRevisionId": "<当前 revision>",
    "attrPatch": [{ "key": "location_reference", "label": "场景卡", "type": "media", "value": { "assetId": "<assetId>", "kind": "image" } }] }
  ```
  只写 Canon 不落节点 = 用户看不到节点（本次要修的反例）；只落节点不写 Canon = 设置视图看不到它。Canon 写需用户授权，`label` 与节点 `props.label` 必须一致；**不要把核心参考写成 `background`**（那只是卡片装饰背景，不声明 role）。
- **Canon media 属性接受未就绪的 `assetId`**：`proposed` / `queued` / `running` 都能写进 media 属性（只有 `failed` / `deleted` 会被拒绝）。所以「画布节点 + 属性边」与「实体 media 属性」可以**一起落位、不必等终态**；assetId 稳定不变，产物就绪后画布/设置视图自动显示。
- 若用户只要「画布上先看着」、暂不沉淀为设定，则只落「节点 + 边」，Canon 留待用户确认。

### 参考集配方与自查（按产物类型）

不同产物的参考集不同；提交前按产物类型核对 `references`（`id` 取自 `recut.worlds.get` 的 `references[]` 或实体的 media 锚点）：

| 产物 | 参考集（role） |
|---|---|
| 场景 / 场景卡 / establishing 全景 | 目标场景 media（`environment`，取 `location_reference`）+ **主角色参考图（`character`，画面出现主角色时必带）** + 风格或版式范例（`style-ref`） |
| 关键道具 / 道具特写 | 该道具参考图（`prop`，跨镜一致）+ 场景（`environment`）+ 主角色（`character`，画面出现时）+ 风格（`style-ref`） |
| 角色设定 / 表情版 / 情绪九宫格 | 该角色参考图（`character`）+ 风格（`style-ref`） |
| 分镜关键帧 | 该镜场景（`environment`）+ 主角色（`character`）+ 风格（`style-ref`） |
| 一图分镜表（storyboard sheet） | 世界风格（`style-ref`）+ 出场角色（`character`）+ 场景（`environment`）；产出 role=`storyboard` |
| 逐格细化关键帧（按需升级） | 该格分镜（`storyboard`）+ 主角色（`character`）+ 场景（`environment`）+ 风格（`style-ref`） |
| 分镜直驱的场景视频（默认） | 整张分镜表（`storyboard`）+ 主角色（`character`）+ 场景（`environment`）+ 风格（`style-ref`）+ **声线参考（`voice`，角色说话时必带）** |
| 出镜表演 / 有台词的视频镜头 | 主角色（`character`）+ 场景（`environment`）+ 风格（`style-ref`）+ **声线参考（`voice`，角色说话时必带）** |
| 音色 / 配音 | 音色参考（`voice`） |

**提交前自查（未过不提交）**：这次**生图 / 生视频**引用了几条参考、各是什么 role？画面里会出现主角色，却没有任何 `role="character"` 的参考图 → 停下，从 `recut.worlds.get` 的 `references[]` / 实体 media 锚点补上再提交（关键道具缺 `role="prop"` 同理）。世界已有场景 / 风格 / 色卡锚点时同样要带入。world.md 里「涉及主角色必须传角色设定图」是硬约束，不是建议。只想生成纯空场景（明确不出现任何角色）时才可省略 `character`；「这次忘了先读 `references[]`」不是省略理由。

### 视频默认待用户确认（全局资产，平台策略）

视频（及其它高价生成）由平台落为**全局素材库里的一个待确认资产**（不是画布私有字段）：它带着完整配方（prompt/参考+role/模型/参数/画幅/时长/备注）落进素材库，画布只引用它的 `assetId`。确认后**复用同一 `assetId`** 转成生成中→完成，画布元素无需重指。

**Agent 只做两步**：① 调 `recut.video.generate`；② 用 `recut.worlds.doc.update` 把返回的 `assetId` 写进媒体元素，然后停下等用户确认。

```jsonc
// ① 提交（references 是绑定记录，顺序即提交顺序）
// recut.video.generate({ text, modelId?, credentialId?, imageAssetIds?/videoAssetIds?/audioAssetIds?,
//   references:[{id,kind,role,label}], aspectRatio?, durationSec?, note?, batchId? })
// → { assetId, referenceIds:[...] }

// ② 画布只引资产：媒体元素 props.assetId + assetStatus（画布据此渲染「待确认」态）
{
  "op": "insert",
  "element": {
    "id": "shape:media-<唯一后缀>",
    "kind": "media",
    "name": "镜头 3 · 雨夜电台",
    "props": { "modality": "video", "assetId": "<recut.video.generate 返回的 assetId>", "assetStatus": "generating" },
    "geometry": { "x": 200, "y": 120, "width": 220, "height": 150 }
  }
}
```

规则：

- **提交即落位**：`recut.video.generate` 一返回 `assetId`，就**立刻**把媒体元素放上**它所属的画布层**（待确认 / 生成中态）——不要等用户确认、更不要等生成成功再挂。用户要先在画布上看见"已提交、待确认"，再决定是否确认（见门禁 8）。
- **内容与状态都在资产**：画布不写 `props.proposal`（旧元素仍可只读回退）。
- `references` 是这次生成的**绑定记录**（`id`=assetId、`kind`、`role`、`label`），也是模型提交顺序依据；role 必须与 kind 匹配（`voice/sfx/music` 只能 audio，`color-card` 只能 image），否则会被拒绝。
- `modelId` 留空则由用户在确认时选；不确定当前可用模型时先留空，不要编造。`aspectRatio` / `durationSec` 按世界或分镜口径填。
- **改配方不用重提**：待确认资产还是 `proposed` 时，用 `recut.media.asset.update({ assetId, prompt?, references?, referenceIds?, modelId?, output?, aspectRatio?, durationSec?, note? })` **原地**改配方——同一条 `assetId`，画布元素无需重指；确认后配方冻结，才需要新建提案。素材的 `name`/`content`/`attributes` 任何时候都可改。
- **正文标签必须绑定**：`prompt` 正文里出现的每个参考 token 都必须在 `references[]` 里有绑定，未绑定的 id 会在创建/更新时被拒（`code:"unbound_prompt_reference"`）——把 id 补进 `references[]` 或删掉该标签再试，不要带着未绑定标签提交。
- 一次可提交多条（同一场戏的分镜，`batchId` 归组），用户逐条确认或放弃。
- **Agent 的正确结尾**：提交并放上画布后，告诉用户「已提交 N 条视频，请在画布上确认生成」并停下。**不要**替用户确认、也不要自己轮询采纳。

**资源口径优先**：world.md 的「资源口径」章节决定哪些属性/素材可作生成参考。例如小黑世界规定示例图只作低频视觉校准（`role="style-ref"`）、不进入默认生成路径——必须遵守。

## 何时用本技能

- 用户要搭建、编辑、整理某个世界：建实体、填属性、连关系、建类型、摆画布。
- 用户要在世界语境里生成媒体：先读 world.md，再走 `recut-director（references/generation-prompt）`；**视频待用户确认**。
- 不用于：描述某个具体世界的内容（读 world.md）、写生成提示词本身（用生成提示词技能）。

## 常见误用

- **把 world.md 当操作手册**：它是内容/生产工作流；工具怎么调看本技能。
- **还在用「证据」概念**：素材唯一表示是 **media 属性**；不要创建独立素材层或 A 挂接线。
- **在画布上复制属性值**：属性卡只连边、持投影；真相在 `entity.attrs`。
- **把长文/编辑控件塞进实体卡**：卡片只略读，编辑走面板或属性卡。
- **写 Canon 不等授权**：无用户明确请求就 upsert/promote 是越权。
- **忘记 `expectedRevisionId`**：并发写会静默覆盖，必须带乐观锁。
- **替用户确认视频生成**：视频由平台落为待确认资产；自行确认、把直生当默认、或自行轮询采纳都是越权；确认只属于用户。
- **世界生图/生视频不带参考图**：不先读 `references[]` 就纯文本直出，是最严重的误用——主角色会漂、场景/风格会串。画面可能出现主角色而没有 `role="character"` 参考图时**必须停下补齐**，只有明确无角色的纯空场景才可省略。
- **把核心参考塞进 `background`**：`background`（背景）只是实体卡的装饰背景/封面覆盖项，**不声明任何生成 role**；角色卡/场景卡/道具卡要写进 `character_reference` / `location_reference` / `prop_reference` 语义字段，`references[]` 才会带正确 role 派发。
- **角色说话却不带声线参考**：只传 `imageAssetIds`、丢掉 `references`/`audioAssetIds`，或让 VO 走默认音色——角色的声音会与 Canon 不一致；有台词的镜头必须带 `role="voice"`。
- **等生成成功才落位**：图片 / 视频 / 音频拿到 `assetId` 就应**立刻**落节点（`assetStatus:"generating"`；视频含待确认态）；用 `recut.job.wait` 把落位堵在终态之后、或轮询后回写节点，都会让用户干等、失去耐心——违背无限画布的即时反馈（门禁 8）。
- **只写实体属性、不落画布节点**：用户要的是画布上的「图片节点 + 属性边」（实体的一条可见属性）；只写实体 attrs 不会在画布上出现节点。两者都要做时，节点与边的 `label` 保持一致。
- **在画布元素上写语义真相**：语义只存实体/关系；画布只承载投影与表达。
- **把画布当文件夹**：用 `parentId` 一层层套内层画布（作品 > 脚本 > 场次 > 镜头…），每多一层就多下钻一次，丢掉无限画布"一眼看全"的价值。锚点放根层、生产实体平铺在作品层，最多两层（见《画布层级纪律》）。
- **为"归类"造空容器实体**：为了分组新建「作品 - 1」「竖屏版」这类中间实体——分组用类型 / 关系 / 位置表达，不要造空目录。

## References 路由表

| 问题 | 读什么 | 用途 |
|---|---|---|
| 某个世界的内容与生产工作流 | `recut.worlds.get` 的 `skill`（world.md） | 该世界的定位、工作流、资源口径 |
| 完善一个世界的标准工作流 | platform `recut` skill 的 `references/world-onboarding.md` | readiness → research → generate → 确认写回 |
| 生成提示词形状与参考锚定 | `recut-director（references/generation-prompt）` | STYLE LOCK、role 锚定、多镜连续段 |
| 属性/画布数据模型与产品行为 | 仓库设计文档 `rfc/2026-09-09-unified-entity-model.md`、`docs/world-canvas-prd-v2.md` | 属性模型、卡片/面板/属性卡、提升规则 |
| 待确认生成资产的模型与接口 | 仓库设计文档 `rfc/2026-09-16-media-generation-proposal.md` | 待确认生命周期、metadata.generation、平台策略与 UI 确认 |
| 世界源格式与发布 | 仓库设计文档 `rfc/2026-09-13-world-content-format-v2.md` | world.json/canvas.json/world.md 物化 |

## 介质声明

本技能是**操作层**，显式引用 `recut.worlds.*` 与媒体生成工具；它不定义任何业务内容，内容永远来自世界自身（world.md + 实体属性）。

**面与消费者**：`recut.worlds.*` 的 **MCP 面是面向 AI 的唯一接口**（本技能描述的就是它）；App 内部的 `ctx.worlds.*` capability 是已安装 App 的便路，不由 AI 调用、也不在本技能范围。

**模型权威**：属性/画布语义以 `rfc/2026-09-09-unified-entity-model.md` 与画布实现 README（`web/app/worlds/[worldID]/canvas/README.md`）为准；本技能只是操作摘要，冲突时以上述为准。

## 版本与来源

- 工具权威：`service/agent.go` 的 `mcpToolLabels` 中 `recut.worlds.*` 清单（2026-09-15 实测）。
- 属性/画布模型：`rfc/2026-09-09-unified-entity-model.md`（attrs 统一）与 `web/app/worlds/[worldID]/canvas/README.md`（画布实现现状）。
- 生成提案实现：`rfc/2026-09-16-media-generation-proposal.md`（proposed 资产、`service/media/proposals.go`、`web/lib/media/proposal.ts`、`rfc/2026-09-15-generation-reference-protocol.md`）。
- 产品：`docs/world-canvas-prd-v2.md`。
- 层级纪律（2026-10-03）：新增《画布层级纪律》，约束 `parentId` 深度——锚点实体在根层、生产实体平铺在作品层（最多两层）；依据 `rfc/2026-10-02-world-canvas-production-layer.md`（`parentId` 只是文件夹，生产树真源是 `has_*` 链）。
- 即时落位（2026-10-03）：门禁 8——图片/视频/音频一拿到 `assetId`（含 proposed/queued/running）立即落在所属画布层，不等生成成功；视频待确认态同样先落位。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
