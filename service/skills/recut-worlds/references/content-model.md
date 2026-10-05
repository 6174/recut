# 内容模型：封面、属性、显示与关联

> `recut-worlds` 的二级参考。入口与使用流程见 `SKILL.md`。本文件回答「封面 / 属性 / 类型字段 / 素材通道 / 属性显示与关联 / 提升」的完整规则。

## 封面 `cover`：一等基础字段，不是 attr

`cover` 是实体的一等基础字段（与 `name` / `intro` / `detail` 同级），形状与 media 值一致 `{assetId|url, name?, kind?}`（`assetId` 允许未就绪 `proposed` / `queued` / `running`）。显式设置后卡片封面锁定为它；缺省时**动态回落**到 attrs 里第一条 image 媒体属性（其次 video）。因为是一等字段，用户**不能改名 / 删除**，只能换值——这与可删可改名的动态 attr 是本质区别。**不要为封面另设 attr**：`background` 只是普通 unlocked attr，平台不识别其封面 / 生成语义，历史也不迁移。

## 属性两种粒度

- **类型级字段（schema）**：定义在 entityType 上，该类型所有实例共享。预设字段 `locked`（label/type/删除被锁，值可改）；`+ 添加字段` 追加的是 unlocked 共享字段，对既有实例「缺失即空」，不回填。
- **实例级属性**：只属于某个实体（key 形如 `a_xxx`），可自由增删改 label / 值。

**属性类型**：`text / textarea / number / boolean / select / media`。

## 预设类型字段（locked）

| 类型 | 预设字段 |
|---|---|
| `work`（作品） | 无默认字段——内容全在正文 `detail` |
| `character`（**角色**） | 外貌与标志 / 性格 / 声音与说话方式 / **声线参考 `voice_reference`（media/audio）** / **角色卡 `character_reference`（media/image）** / 不可变特征 |
| `location`（场景） | 描述 / 氛围 / **场景卡 `location_reference`（media/image）** |
| `prop`（**道具**） | 描述 / 外观与标志 / **道具卡 `prop_reference`（media/image）** |
| `script`（视频脚本） | 一句话概括 / 目标时长 / 画幅 / 目标平台 / 整片分镜（可选，仅预览） |

locked 字段只放**真 meta 与一句话摘要**；正文细节写 `detail`。**每个锚点实体的核心参考写进它自己的语义卡字段**：`character_reference`（role `character`）/ `location_reference`（role `environment`）/ `prop_reference`（role `prop`），`voice_reference` 是角色的**声线参考**（role `voice`）——`references[]` 直接按字段声明 role（`roleInferred=false`），其余 media 字段才靠推断。

## 世界级属性（不是实体）

**风格**写 `world.identity.style`（一个世界一个 STYLE LOCK），**规则**写 `world.identity.constraints`（`{ always, never, prefer }`）。它们是世界的属性，不是对象——做成可无限添加的实体类型反而制造冲突（多个风格互相打架、规则散成卡片）。需要更多实体类型用 `recut.worlds.entityType` 自建；但**关键道具不用自建，`prop` 已是默认预设**。

## 素材 = media 属性（唯一通道）

实体挂图片 / 视频 / 音频，就是一条 `type:"media"` 的 attr，值为 `{assetId, name?, kind?, segment?}`。不复制二进制，只引用素材库 `assetId`；`segment` 保留「只引用某一段」的能力。

## 属性怎么显示：三层分工

| 层 | 职责 | 显示什么 |
|---|---|---|
| **实体卡**（画布，略读） | 一眼识人 | 封面（显式 `cover` 优先，否则第一条 image 属性）、相册（全部 image 属性）、名称、简介（2 行）、至多 2 条已填 primitive 字段、子设定 / 素材计数徽标 |
| **详情面板 EntityEditor**（精读 / 编辑） | 改内容 | 身份区（名称 / 简介 / 正文）+ 字段区（schema 字段 + schema 外属性续排同一渲染路径，media 与普通属性同一路径）+ 关系区；先读后写、blur 即存 |
| **画布属性卡**（空间表达） | 把某个属性摆到画布上 | 一张 `kind="attr"` 元素卡，通过一条**属性边**关联到实体；编辑卡片正文即回写实体 |

规则：**卡片只略读，不承载编辑**（编辑走面板或属性卡）；**长文不进卡片**；封面用一等字段 `cover`，相册 / 背景都从 media 属性派生。

## 属性怎么关联：边即关联，值不复制

**单一数据源**：`entity.attrs / intro / detail`。画布上的属性卡只持**引用投影**，不是副本。

**属性关联 = 一条 arrow 边**（`edgeType="attr"`）：`fromElementId` 是实体元素、`toElementId` 是 attr 元素。**不要在画布上复制值，只连边。**

- **画布 → 实体**：编辑属性卡正文，按 label 映射回实体——`简介/介绍/intro → intro`、`正文/内容/detail → detail`，否则写同名 attr key（无则新建）。空值不回写；删除属性只在右侧面板做。
- **实体 → 画布**：面板改字段后，绑定该字段的属性卡投影值自动刷新；字段被删则投影清空。

## 提升（`recut.worlds.promote`）决定边的语义

- `entity → entity` = **关系**（写 `world_relations`）。
- `entity → 自由元素` = **属性绑定**（`field` 绑定到实体属性；自由元素转为引用投影，并生成一个 attr 锚点元素，与右侧属性面板共享同一数据源）。
- 便签 / 文本提升 = 变成**草稿实体**（`isProvisional`），原元素保留为投影。

画布元素**永不产 revision**；只有 `recut.worlds.promote` 与 Canon 写才产。
