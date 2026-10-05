# 生产层：作品 → 视频脚本 → 场次 → 镜头

> `recut-worlds` 的二级参考。四层职责是硬契约，不要串层。正文骨架见 `content-templates.md`。

| 层 | 类型 | 是什么 | 关键字段 / 产物 |
|---|---|---|---|
| 作品 | `work` | **交付单位**（挂成片与总进度；一个作品可有多个脚本） | 成片（按需 media，label「成片」）；交付规格留在脚本 |
| 视频脚本 | `script` | **完整脚本 + 可生成规格**（生成依赖之一；**一集一个 script**） | **正文 `detail` = 完整脚本细节**（故事脚本 / 旁白·台词 / 场景初步规划，一次写全）；attr 只放真 meta：一句话概括 / 时长 / 画幅 / 平台 |
| 场次 | `scene` | **一次视频生成的单位**（生成依赖之一）——**一次生成 ⇒ `durationSec` 必须 ≤ 模型单次上限（默认 ≈15s）**；更长就拆成多个场次，不拉长单场 | **正文 `detail` = 本场的拍摄设计**（空间·美术 / 表演调度 / 摄影 / 灯光 / 声音 / 视效 + 旁白台词；含逐镜镜头序列）——**生成提示词几乎全取自这里**；attr 只放：总时长 `durationSec`、场成片 `video`、一句话概括 |
| 镜头 | `shot` | **画面细节 / 预览**（**不进生成依赖**；不是每镜一次视频生成） | **正文 `detail` = 单镜细节**（空间 / 构图 / 机位 / 灯光 / 动作 / 表演 / 连续性 / 台词）——供预览 / 测试；attr 只放真 meta：镜号 `no`、景别角度焦段 `shotSize`、时长 `durationSec`、镜头运动 `camera`、关键帧 `keyframe` |

## 生成只认资产 + script + scene

视频生成的实际输入是**世界锚点资产**（`character` / `location` / `prop` / `voice`，按 role）+ **`script` 的叙事与规格** + **`scene.detail` 的本场分镜正文**。**分镜表（storyboard sheet）不是生成参考**——它能帮排产与人工预览，但 ref2video 吃不动一张宫格图，不要把它当 `role="storyboard"` 提交给视频模型。需要逐镜画面时，把镜头写进 `scene.detail` 的镜头序列（文本），或作为 `shot` 做**预览 / 测试**，而不是靠分镜图驱动生成。

## 结构：树的真源是 `has_*` 链

`scene` / `shot` 是**容器内的实体**（`typeId=scene/shot`，**不进默认预设目录、不进 facts**，用到即建、自带 schema）。**树的真源是显式结构关系 `has_script` / `has_scene` / `has_shot`（全局、父→子），不是 `parentId`**——`parentId` 只是通用归属（Notion 式文件夹），改它 / 移动卡片不断链。

建生产节点时，服务端按「父子都是生产类型」**自动补这条链**（实体与结构链同一事务）。类型目录的 **`childTypes`** 声明容许的子类型（`work.childTypes=[script]`、`script.childTypes=[scene,shot]`、`scene.childTypes=[shot]`，advisory，只喂「默认建什么 / 默认连哪条链」）。

## 视频脚本与分集

`script` 是**一集的可生成规格**，前置是 `work.detail` 已写出该作品完整内容——**内容没写全不拆集，不压缩表达**。每集脚本正文（本集结构 + 旁白/台词 + 场景初步规划）写 `script.detail`；locked 字段只是真 meta 与摘要。**交付单位是 `work`**，一个作品可挂多个脚本＝多集。

## 产物：任一层按需的 media 属性

产物不设固定槽位、不预设生成方式，用 label 标角色：镜头挂关键帧 / 片段 / 配音，场次挂场成片，**作品挂成片**——`finalOutput` 就在作品层。

## 工具

- **排产**：`recut.worlds.production.create`（挂到 `parentId`，通常是脚本；**一次调用直接建出正式实体、一条 revision**，无草稿 / 转正；会写入 `has_scene` / `has_shot`）。
- **读回**：`recut.worlds.production`（沿结构链解析、环安全，带回派生状态 planned / generating / ready / failed）。
- **生成**：视频按场次生成（逐场走 `recut.video.generate`，场成片落回 `scene.video`），图片 / 语音走 `recut.image/speech.generate`。详见 `media-generation.md`。
