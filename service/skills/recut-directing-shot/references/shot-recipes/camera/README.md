> 来源: recut/apps/remotion-studio/skills/remotion-studio/references/shot-recipes/（自有存量，去介质化，原文语言保留）

# camera/

> L2 | 父级: /apps/remotion-studio/skills/remotion-studio/references/shot-recipes/README.md

成员清单
README.md: Shot Language v3 的镜头句法、camera/surface/attention 三轴、preset 选择、实现路由与组合禁令；所有镜头表达任务先读本文件。
crash-zoom-punch.md: 全景急推到目标特写的高能冲击镜头。
depth-layer-moves.md: 多层视差滑轨与主体钉屏的伪 dolly-zoom。
graze-face-tour.md: 贴 UI 表面低飞巡礼与元素错峰贴落。
overhead-camera-moves.md: 俯拍抬正揭示与桌面卡阵横滑骤降。
space-camera-moves.md: 爆炸分解与无人机俯冲降落的大空间镜头。
steep-tilt-glide.md: 固定相机下强透视页面自行侧掠的巡览镜头。
tension-camera-moves.md: 子弹时间、Dutch roll、拉远孤立与慢推的情绪镜头。

## Shot Language v3

镜头不是 `scale`、`rotateY` 和 `blur` 的参数堆，也不只有 camera。先写出观众如何被带到哪里、内容以什么姿态进入、注意力何时锁定，再选择实现。每个镜头必须完整回答下面八项：

```text
意图 -> 空间基底 -> camera -> surface pose/curve -> 主体 -> attention -> 节奏 -> 排他项
```

```text
导出设置页从左后方带轻弯落入镜头；single-plane；push-in；surface 落位+flatten；右下导出按钮；lens inspect；28f 动作+阅读 hold；不叠 crash zoom。
```

| 字段 | 允许表达 | 禁止表达 |
| --- | --- | --- |
| 意图 | 建立、比较、点名、检查、释放、压迫、交棒。 | “看起来酷”。 |
| 空间基底 | `single-plane`、`depth-layers`、`card-array`、`object`。 | 没有层关系却声称真实景深。 |
| camera | `locked`、`drift`、`push-in`、`pull-out`、`truck`、`crane`、`orbit`、`dolly-zoom`。 | 同一段并列两个主运镜。 |
| surface pose/curve | `position`、`rotation`、`scale`、`bend` 与 `shell`；单平面可从斜后方、俯倾或轻弯姿态快速落位，当前 `browser` shell 有厚度，手机模型将沿同一边界接入。 | 用 CSS 假透视，或让曲面持续抖动妨碍阅读。 |
| 主体 | 一个语义目标和其 composition 归一化 anchor。 | 分散的 `cx/cy`、`lookAt`、lens center。 |
| attention | `none`、`rack-focus`、`lens-inspect`。 | 空白处放大镜，或模糊阅读落点。 |
| 节奏 | 动作帧、落位 hold、速度峰值。首期默认动作约 24--32f（约 1 秒），其余时间阅读。 | 全程同速、没有停顿。 |
| 排他项 | 本段不能叠的强镜头或 effect。 | 默认叠加所有能用的效果。 |

## 动词与实现路由

| 动词 | 空间要求 | 当前实现 | 后续演进 |
| --- | --- | --- | --- |
| `drift` | single-plane 即可。 | `CameraMoveDescriptor` 的轻量 Three drift。 | 多层时增加真实视差。 |
| `push-in` / `pull-out` | single-plane 即可。 | Three camera 沿视线 dolly + FOV；终点必须是高清纹理。 | 动态 focus track。 |
| `truck` | 多层时才有可感视差。 | Three camera 横移；平面只作轻微视角变化。 | depth layer 产生真实视差。 |
| `crane` | 有地板/背景参照时更成立。 | Three camera 上升/下降并保持 subject。 | 多层地板与深度遮挡。 |
| `orbit` | 仅 `depth-layers`、card-array 或 object。 | Three camera 围绕 subject 的 position path。 | 真实 rack focus。 |
| `dolly-zoom` | 主体与环境必须可分层。 | `depth-layer-moves` 的主体钉屏版本。 | camera distance 与 FOV 的受控联动。 |
| `rack-focus` | single-plane 是屏幕空间近似；多层才是真景深。 | `text-focus` 材质。 | focus track；多层时读取 depth。 |
| `lens-inspect` | 有清晰、可读的具体细节。 | `push-in`/`drift` + 同 subject 的 `magnify`。 | 有序 post chain。 |

`flip`、`peel`、`cross-zoom` 是两镜头之间的 A/B transition，不是动词。它们必须拿到前后两张镜头纹理；不能在单一页面上伪装成 camera move。

## 组合管线

镜头按下面顺序写入 descriptor；不要把 `bend`、`cloth`、`displacement` 误当成互斥的整屏特效。

```text
shell -> pose -> geometry -> surface -> attention -> grade
browser   transform  bend/corner/cloth  displacement  focus/lens  vintage
```

- `surface.keyframes` 承担 `position`、`rotation`、`scale`、`bend` 与单角 `cornerCurl`；它们发生在真实 Three 网格上。
- `surface.cloth` 是低幅几何波动，可以与 bend、corner curl 和 `effect: "displacement"` 组合；密集正文不启用 cloth。
- `displacement` 是纹理面扰动，应在 12--20f 的入场窗口内减弱或关闭，不能持续污染阅读。
- `text-focus`、`magnify`、`glass`、`bubble` 是 attention/optics；同段最多一个强主角。

## 主体和坐标

主体采用一个 `Subject`：`{ anchor: [x, y], depth?: z }`。`anchor` 的坐标是 composition 设计空间归一化值，左上为 `[0, 0]`、右下为 `[1, 1]`。同一个 Subject 同时喂给 camera target、focus 和 magnifier；Y 轴转换仅在运行时 adapter 做一次。

`ShotGraph` 当前已把 `CameraMoveDescriptor.subject` 映射为 Three camera 的 `lookAt` 目标，并将 `SurfaceMoveDescriptor.keyframes` 映射为同一张 HtmlSurface mesh 的真实 position / rotation / scale / bend；`surface.shell="browser"` 则会让该页面进入有厚度的 Chrome 式外框。手机、平板和自定义 GLTF 设备会只扩展 shell，不改镜头三轴。现有 `PageCam` 的 `cx/cy`、`Rig` 的 `look` 仍只服务旧模板；任何同镜 lens 的 `center` 必须由同一份场景目标数据派生，禁止各自手填。

## 已有配方映射

| 既有配方 | v2 语义 | 首选时机 | 不可叠加 |
| --- | --- | --- | --- |
| `crash-zoom-punch` | `push-in` 的 impact 变体。 | 单个高价值功能点。 | lens-inspect、第二次大运镜。 |
| `depth-layer-moves` | `truck` 或 `dolly-zoom`。 | 比较层次、积压情绪。 | 无分层的 orbit。 |
| `graze-face-tour` | `truck`/`crane` + content 的贴落。 | 功能巡礼。 | 全体齐落和另一种大相机动作。 |
| `overhead-camera-moves` | `crane` 后 `push-in`。 | 开场揭示、多页选择。 | 同段 drone dive。 |
| `space-camera-moves` | `orbit`、`push-in`、depth-layers。 | 架构展示或章节启动。 | 同屏另一个大空间动作。 |
| `steep-tilt-glide` | `locked`；是世界移动，不是 camera 移动。 | 侧掠型 UI 巡览。 | graze-face-tour。 |
| `tension-camera-moves` | 有控制的 `push-in`/`pull-out`/`orbit`。 | 情绪节点。 | 需要解释信息的阅读镜头。 |

## 光学组合纪律

```text
scene geometry -> focus blur -> magnify/glass -> color/grain
```

- 每个镜头至多一个强光学主角：`magnify` 与 `glass` 互斥；`bubble`、全屏 glitch、重型 page transition 不和 lens/focus 混用。
- `rack-focus` 先让主体清晰，再让 `lens-inspect` 放大；lens 不能在焦点到达前出现。
- `CameraMotionBlur` 只包速度峰值，动作落位、HUD 与阅读 hold 保持清晰。
- 单平面中的 blur 是注意力处理，不是三维景深；没有 `depth-layers` 时不得写“真实 bokeh”。

## 工作步骤

1. 工作台的「镜头层特效」弹框可直接选择 `Camera Drift`、`Push In`、`Pull Out`、`Camera Truck`、`Camera Crane` 或 `Lens Inspect`；卡片预览走真实 Three `CameraDirector`，不是 CSS 假动画。
2. 按意图选择一个动词，必要时阅读上表对应的旧配方。
3. 明确空间基底和唯一 Subject；先确认目标在最终画幅中可读。
4. 设定动作、落位 hold 与排他项，再决定 focus/lens/motion blur。
5. 当前 Three-first 场景优先写 `ShotDescriptor.camera` / `CameraMoveDescriptor`；旧模板才读取 `PageCam`、`Rig`。只调用已发布的字段，不能编造多平面景深或 post chain API。
6. 使用真实素材预览开始、中段、落位三帧；确认推近后纹理仍清晰、没有无意义的畸变或叠效。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
