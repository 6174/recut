# 生产结构：作品 → 视频脚本（+ 视频节点）

> `recut-worlds` 的二级参考。两层职责是硬契约，不要串层。正文骨架见 `content-templates.md`。

| 层 | 类型 | 是什么 | 关键字段 / 产物 |
|---|---|---|---|
| 作品 | `work` | **交付单位**（挂成片与总进度；一个作品可有多个脚本） | 成片（按需 media，label「成片」）；交付规格留在脚本 |
| 视频脚本 | `script` | **完整脚本 + 可生成规格**（**一集一个 script**） | **正文 `detail` = 完整脚本细节**（故事脚本 / 旁白·台词 / 场景初步规划 + 每段视频的拍摄设计，一次写全）；attr 只放真 meta：一句话概括 / 时长 / 画幅 / 平台 / 整片分镜（可选，仅预览） |
| 视频节点 | 画布**媒体元素**（不是实体） | **一次视频生成的单位** | `kind:"media"` + `props.modality:"video"`；只引用生成出的 `assetId` |

## 一次视频生成的单位是「视频节点」，不是实体

场次不再是一类实体：要生成一段视频，就在作品层落一个**视频节点**（媒体元素），把这一段的拍摄设计（空间·美术 / 表演调度 / 摄影 / 灯光 / 声音 / 旁白台词 / 逐镜镜头序列）写进 `script.detail`，再提交 `recut.video.generate`。**一次生成 ⇒ 时长 ≤ 模型单次上限（默认 ≈15s）**；更长就拆成多个视频节点，不拉长单个。一段连续动作优先一次多镜连续生成。镜头也不再是一类实体——需要逐镜画面时，把它写进 `script.detail` 的镜头序列（文本），或先出关键帧做预览 / 测试。

## 生成只认资产 + script

视频生成的实际输入是**世界锚点资产**（`character` / `location` / `prop` / `voice`，按 role）+ **`script` 的叙事与规格 + 该段拍摄设计（写在 `script.detail`）**。**分镜表（storyboard sheet）不是生成参考**——它能帮排产与人工预览，但 ref2video 吃不动一张宫格图，不要把它当 `role="storyboard"` 提交给视频模型。

## 结构：树的真源是 `has_script` 链

层级只有 `work → script`。**结构真源是显式结构关系 `has_script`（全局、父→子），不是 `parentId`**——`parentId` 只是通用归属（Notion 式文件夹），改它 / 移动卡片不断链。建脚本时服务端按「父是生产容器」**自动补这条链**（实体与结构链同一事务）。类型目录的 **`childTypes`** 声明容许的子类型（`work.childTypes=["script"]`，script 是叶子，advisory，只喂「默认建什么 / 默认连哪条链」）。

## 视频脚本与分集

`script` 是**一集的可生成规格**，前置是 `work.detail` 已写出该作品完整内容——**内容没写全不拆集，不压缩表达**。每集脚本正文（本集结构 + 旁白/台词 + 场景初步规划 + 每段视频的拍摄设计）写 `script.detail`；locked 字段只是真 meta 与摘要。**交付单位是 `work`**，一个作品可挂多个脚本＝多集。

## 产物：按需的 media 属性 / 视频节点

产物不设固定槽位、不预设生成方式，用 label 标角色：关键帧 / 配音挂相关实体，视频节点直接引用 `assetId`，**作品挂成片**——`finalOutput` 就在作品层。

## 工具

- **建结构**：`recut.worlds.entity` 建 `work` / `script`（脚本创建时自动写 `has_script`）。
- **生成**：每段视频提交 `recut.video.generate`（待用户确认），`assetId` 落进视频节点；图片 / 语音走 `recut.image/speech.generate`。详见 `media-generation.md`。
