> 来源: recut/recut — apps/remotion-studio/skills/remotion-studio/references/directing.md (Recut 自有，内部复用)

# 导演语言与提示词模板

> 本文件是全片动效取舍的速查。完整资料直接位于本目录：制作流程见 `production-workflow.md`，镜头配方见 `shot-recipes/`，桥段见 `sequence-patterns/`，审美与声音见 `aesthetic-rules.md`、`sound-design.md` 和 `music-beat-sync.md`，共同创作与终检分别见 `collaborative-creation.md`、`final-review.md`。

## 一、先定“动效嗓音”：品牌 → 动效参数

不凭手感挑 easing/时长，先判断品牌在哪两根轴上，再从预设起步，tokens 写进每个 scene 的实现：

- **能量轴**：低（沉稳/premium）↔ 高（运动/startup/娱乐）——决定时长、过冲、squash 幅度；
- **调性轴**：严肃（金融/医疗/enterprise）↔ 活泼（消费/社交/儿童）——决定路径曲直、次级动作多寡。

| 预设（品类） | 主时长@30fps | 入场 easing | 过冲 | squash |
|---|---|---|---|---|
| 专业信赖（fintech/enterprise/B2B） | ~21f | bezier(0,0,0.2,1) | 1.0 不弹 | 0 |
| 精致高端（奢侈品/时尚） | ~48f | bezier(0.4,0,0.6,1) | ≤1.02 | 0 |
| 活力大胆（体育/游戏/startup） | ~18f | bezier(0.16,1,0.3,1) | 1.12 | 0.25 |
| 活泼愉悦（消费/社交） | ~27f | bezier(0.34,1.56,0.64,1) | 1.08 | 0.18 |
| 平静关怀（健康/教育） | ~42f | ease-in-out 对称 | 1.0 | ≤0.04 |
| 亲和友好（小微/社区） | ~26f | bezier(0.25,0.46,0.45,0.94) | 1.04 | 0.08 |

用法：定预设 → 按两轴微调 → 一套 tokens 同时管入场/转场/hold 节奏。一个品牌一种动效嗓音，混用两套读作拼盘。判例：落地要弹的场合 y1 必须 >1；“专业信赖不弹”指无落地隐喻的淡入/推移类动作。

## 二、结构：5 秒一个节拍，一镜一动作

- **5 秒是默认节拍单位**：一个 scene 只承载约 5 秒和一个信息变化；长视频增加 scene，绝不让一个 scene 覆盖 10 秒以上。
- 开场三秒内给钩子（结果承诺 / 反常识 / 直接问题 / 痛点警示），绝不从背景介绍开场。
- 前一段提出的问题必须由后续段落回应；结尾回收核心论点。
- **每个 scene 只讲一个主要动效**；一种动画手法（飞入/堆叠/翻页）全片只当一次主角。
- **落定后必须呼吸**：品牌字标落定 hold ≥ 1s（30f），批量动效收尾 ≥ 0.5s 静止；动效排满每一帧必返工，放慢从未被否。

## 三、镜头表达：景别沿信息推进变化

- 需要 Three、3D 视角、页面/设备入镜、曲面、焦点或透镜时，先读 `shot-recipes/camera/README.md` 的 Shot Language v3。先写意图和空间基底，再选 `catalog.json` 的 `three-camera` preset；不要从 CSS transform 或 shader 名称开始设计。
- 一个镜头用 `shell → pose → geometry → surface → attention → grade` 组合：camera 是观看者，surface 是被拍物。单张页面也可借由真实 PerspectiveCamera、斜入/翻转/落位、bend 或 corner curl 呈现空间感；不需要虚构多层才能“有 3D 感”。
- 每镜只选一个主 camera 动词（locked/drift/push-in/pull-out/truck/crane/orbit/dolly-zoom）和一个强光学主角；`magnify`、`glass`、`bubble` 互斥，`flip`/`peel`/`cross-zoom` 是两镜头的 A/B 转场。
- 相邻 scene 不要重复同一种镜头语法。先建立关系 → 解释主体 → 近景/特写落在论点、证据或结果。默认约 24--32f 完成空间动作，之后留可读 hold；需要解释的信息不使用 orbit、dolly-zoom 或持续 cloth。
- 标题、说明、HUD 是否留在 screen layer，由镜头意图决定；机制同时提供 world surface 与 screen layer，不能默认替叙事做决定。字幕始终最高层。

## 四、提示词模板（改写代码时的自检清单）

设计每个 scene 时，在心里按以下提示词段落过一遍：

1. **目标**：这个 scene 要让观众看见什么、理解什么、感受到什么情绪。
2. **镜头**：只选一个连续镜头运动，不塞多个。
3. **元素运动**：元素如何进入/移动/落定；低振幅、缓慢、连续、ease-in-out 是默认。
4. **稳定锚点**：关键信息/标题安全区不重绘、不漂移；有用户提供的人脸、产品或标签时，必须保持其形状稳定，只重构周围世界。
5. **镜头收束**：非循环镜头必须说明最后如何稳定落位；复杂节奏用多个短 scene 剪辑，不塞进一个视频。

## 五、确定性渲染（硬性）

- 禁 `Math.random()` / `Date.now()` / 无参 `new Date()`；一切伪随机用固定种子（mulberry32/哈希，seed 从 index 派生）。
- 字幕时间轴由 frame 派生（`buildCaptionsData` 已保证），预览与成片逐帧一致。
- 改动只动目标 scene，改完交给用户逐帧评审，不重做未指出的段落。

## 六、来自流水线的经验（简化版）

- 方向性问题（风格/结构）在写代码前定案；不要写了三层动画才发现叙事方向错。
- 素材方向必须在 scene 实现前定案：`composition.assets` 登记的画面素材若缺失，导出会是空画面。
- 装饰性 glint/泛光群发 = 廉价；批量元素入场靠运动本身，单点高质量光效可做。
- 手搓 UI 只用于非复刻场景，且质量与表达明确性是硬门槛；本项目以 `resolveMediaUrl` 引用的真实素材为主。

完整镜头卡、桥段与制作流程均随本 skill 分发；实现时以 `@recut/remotion-kit` 的实际源码和 `catalog.json` 为唯一组件真相源。
