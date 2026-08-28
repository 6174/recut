# 小黑怪诞正文配图

## 核心定位

为中文文章设计和生成 16:9 横版正文配图。目标不是做商业插画、PPT 信息图或可爱卡通，而是把文章里的关键判断、流程、结构、状态或隐喻，变成一张清爽、怪诞、有创意、可读但不说明书的手绘解释图。

默认视觉 IP 是「小黑」：黑色实心、白点眼、细腿、空表情，认真做一件荒诞但成立的事。小黑必须参与画面的核心动作，不能只是站在旁边当装饰。完整角色设定见「小黑」角色（含 body 全文），风格规则见「风格 DNA」（含 body 全文）与规则实体。

## 工作流

### 1. 消化正文

先读用户给的正文、链接、页面、Markdown 文件或截图内容。提炼：

- 核心观点是什么
- 哪些段落承担认知转折
- 哪些内容适合用图解释
- 哪些地方只适合文字，不需要图

不要平均配图。优先选择「认知锚点」，例如：核心判断、两个断点、输入输出闭环、分流、前后对比、一鱼多吃、承接路径、常见坑、角色状态变化。

### 2. 先出配图策略（shot list）

如果用户只是说「分析怎么配图 / 思考哪些地方需要配图」，先给 shot list。每张图写清楚：

- 放在哪个段落后
- 图的主题
- 核心意思
- 结构类型
- 小黑在图里做什么
- 建议元素
- 建议中文标注词

默认 4-8 张。文章很短时 1-3 张；长文也不要轻易超过 9 张。够用就好，避免把正文做成画册。

### 3. 单张生成

如果用户明确要求「生成 / 输出 / 做图 / 帮我生成」，不要停下来等确认；用当前宿主的图片生成工具（在 Recut 中为 `recut.image.generate`）每张单独生成。不要把多张图拼在一张里。

每张图只讲一个核心结构。提示词必须包含：

- 16:9 横版中文正文配图
- 纯白背景
- 黑色手绘线稿
- 少量红色/橙色/蓝色中文手写批注
- 大量留白
- 小黑作为核心动作主体
- 禁止 PPT、商业插画、幼稚可爱、复杂架构、左上角类型标题

不要复刻过往案例。案例只提供风格密度和小黑参与方式，不能直接复用「传送带断点 / 小黑拉线 / 素材鱼 / 盖章工具箱 / 常见坑路径」等已有构图，除非用户明确要求复刻某张图。每次都要从当前文章重新发明一个奇怪但成立的隐喻。

### 4. 检查与迭代

按下方「生成后检查」口径复核。发现问题优先重生成或局部编辑，不要把问题图直接交付。

### 5. 交付

生成结果入库 Recut 素材库（在 Recut 中经 `recut.image.generate` 产物自动入库，或把图交给素材库导入）。交付说明要短而准：

- 生成了几张
- 每张图的用途
- 哪些图最稳，哪些图是可选

不要长篇解释风格理论；让图自己说话。

## 生图提示词模板

每张图单独生成。根据正文内容替换变量，不要把多张图拼在一起。

```text
Generate one standalone 16:9 horizontal Chinese article illustration.

Visual DNA:
Pure white background. Minimalist black hand-drawn line art. Slightly wobbly pen lines. Lots of empty white space. Sparse red/orange/blue handwritten Chinese annotations. Clean absurd product-sketch feeling. No gradients, no shadows, no paper texture, no complex background, no commercial vector style, no PPT infographic look, no cute mascot poster, no children's illustration, no realistic UI.

Recurring IP character required:
小黑, a small solid-black absurd creature with white dot eyes, tiny thin legs, blank serious expression, slightly uneven hand-drawn body shape. 小黑 must perform the core conceptual action, not decorate the scene. Make 小黑 serious, deadpan, and slightly bizarre, not cute.

Theme:
{正文配图主题}

Structure type:
{结构类型：Workflow / 系统局部 / 前后对比 / 角色状态 / 概念隐喻 / 方法分层 / 地图路线 / 小漫画分镜}

Core idea:
{这张图要表达的核心意思}

Composition:
{具体画面：小黑在哪里、正在做什么、主要物件是什么、信息如何流动}

Suggested elements:
{元素1} / {元素2} / {元素3} / {元素4}

Chinese handwritten labels:
{标注词1} / {标注词2} / {标注词3} / {标注词4} / {可选标注词5}

Color use:
Black for main line art and 小黑. Orange for main flow/path/arrows. Red only for key warnings/problems/results. Blue only for secondary notes or feedback/system state.

Constraints:
One image explains only one core structure. Keep the main subject around 40%-60% of the canvas. Preserve at least 35% blank white space. Use at most 5-8 short handwritten Chinese labels. Do not write a title in the top-left corner. Do not write the structure type on the image. Do not make it a formal diagram, course slide, or dense explainer. Do not copy prior examples or reuse known case compositions unless explicitly requested; invent a fresh visual metaphor for this specific article. It should be clear but not instructional, interesting but not childish, strange but clean.
```

## 结构类型与隐喻方法

选择一种结构即可，不要混太多：

- **Workflow 流程**：输入 → 处理 → 输出。左侧输入，中间小黑或怪机器处理，右侧输出，橙色箭头表达主流向。
- **系统局部**：只画 3-5 个核心模块，小黑参与其中一个关键动作。
- **前后对比**：左混乱，右稳定，中间橙色箭头。角色可以更夸张。
- **角色状态**：2-4 个小状态，每个状态一个短标注。
- **概念隐喻**：一个大的怪物件或机器，少量输入，一个输出。要有记忆点。
- **方法分层**：一层层盒子，不要正式金字塔；小黑在旁边搬砖或搭建。
- **地图路线**：一条弯曲路径，少量节点，小黑牵线或走路。
- **小漫画分镜**：2-4 个小场景，每格只表达一个动作。

原创隐喻三步法（每次都从当前文章重新发明隐喻，不能照搬旧图）：

1. 把抽象概念换成一个物理动作：卡住、漏掉、变重、分拣、沉淀、发酵、开门、折叠、拆包、回流。
2. 把系统结构换成一个低科技物件：坏掉的机器、纸箱、抽屉、水管、邮筒、怪表盘、秤、井、梯子、奇怪工位。用时只选 1-2 个，不要堆满。
3. 让小黑承担动作：不是站旁边，而是卡在机器里、拉错线、守门、搬运、修补、称重、扶梯子、记录、把东西塞进某个怪装置。动作要服务核心意思，不要为了怪而怪。

## 生成后检查

必过项：16:9 横版；干净白底；有小黑且承担核心动作；没有复刻旧案例构图；怪诞、有创意；简洁清爽（主体 ≤ 约 60%）；一图一核心结构；中文标注少、短、能读；橙色只用于主路径/箭头，红色只用于重点/问题/结果，蓝色只用于补充说明/系统状态。

出现以下问题优先重生成或局部编辑：左上角出现「常见坑/流程图/系统架构图/路线图」等标题；小黑像吉祥物或可爱卡通；画面像 PPT、课件、正式流程图；元素/箭头/节点太多；文字变成大段解释；背景有纸纹、阴影、渐变、米色、噪点；真实 UI 截图；中文错字严重；画面太死板没有荒诞隐喻；与示例图构图过于相似。

迭代口径：太普通 → 让小黑成为动作主体，加入奇怪但成立的隐喻；太复杂 → 删节点，只保留一个动作和 3-5 个短标注；太可爱 → 强调 deadpan、not cute、not mascot；太 PPT → 去掉标题、边框、整齐网格和过多箭头，改成手绘场景；太像旧案例 → 保留核心意思，换掉主物件和小黑动作；文字错 → 优先局部编辑，错得多就重生成并减少标注数量。

高质量图应该让读者先觉得「有点怪」，然后 1 秒内看懂结构。如果第一眼像教程页而不是白纸上的怪诞产品草图，就不合格。

## 资源口径

- 「风格示例」证据集（examples/ 镜像）仅作**低频视觉校准**：线条密度、留白比例、颜色克制、小黑气质。**不进入默认生成路径**，不复刻其中任何案例的构图、物件或标注。
- 角色外形与职责以「小黑」角色实体（含 body 全文）为准；风格规则以「风格 DNA」实体（含 body 全文）与规则实体（16:9 横版 / 禁止 PPT 感 / 颜色克制）为准。
- 需要参考本地文件时，把示例图 URL 交给宿主文件工具或导入素材库；不要把示例图直接作为生成参考图喂给图片模型。
