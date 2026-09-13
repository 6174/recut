# worlds/[worldID]/canvas/

> L3 | 父级: ../README.md

Recursive World Canvas（RFC 2026-09-07）的全屏画布模式：pomelo（pixi + 插件机制）为交互底座，zustand store 为唯一数据源。语义真相只在 `world_entities` + `world_relations`；pomelo 文档是 `world_canvas` 的内存投影（可重建），画布变更永不产出 revision。

成员清单

canvas-store.ts: 画布 zustand 状态层；会话配置（open）、当前上下文（全局/实体容器）的实体/画布元素/关系/类型目录、视图状态（缩放/选中/连线草稿/对话框）与全部写动作；语义写带 revision 冲突重试，附几何工具函数与尺寸常量。
canvas-top-bar.tsx: 世界画布顶层工具栏行（渲染进 Workspace 全局 Header）：useWorldCanvasTopBarStore 以 variant=canvas|form 双视图注册——画布挂载经 setActive 注册 canvas variant（左侧返回/面包屑/notice），world-detail-client 在设定视图经 setFormMode 注册 form variant（同一行结构、无画布工具）；WorldCanvasToolbar 包装画布工具组 + 只读徽标 + 关系引导，仅 canvas variant，由 page.tsx 的 Header 居中列渲染（三列 grid，工具组相对于整个 Header 居中，与左侧面包屑、右侧全局操作解耦）；WorldCanvasShareButton 在右侧渲染视图切换（canvas→「设定视图」、form→「画布视图」），两种视图切换位置一致。
canvas-toolbar.tsx: 画布工具组（CanvasToolbarItems，无浮动容器）：由 canvas-top-bar.tsx 的 WorldCanvasToolbar 包装后居中渲染进页面最顶 Header——选择/抓手模式（panMode 读自 canvas-store，全画布平移 overlay 由 canvas-pomelo.tsx 的 PanOverlay 承载）、连线工具（canvas-store.linkMode → CanvasBindsPlugin 点击节点拖出引导线，一次性后自动回选择模式）、「＋」创建菜单入口（B.7，独立插入按钮已收敛进创建菜单）、undo/redo（内存投影）、缩放菜单（放大/缩小/50%/100%/200%/适应项目/适应所选内容/对齐到网格开关）与帮助面板。pomelo 编辑器实例由 canvas-pomelo 挂载后经 setEditor 登记进 canvas-store。
canvas-pomelo.tsx: pomelo 底座：canvas-store → pomelo 文档按 block id diff 增量同步（T1：新增/删除/属性更新三路对账，不再全量重建，消除写后闪烁与重复图片请求；buildPomeloRecords）；ViewportPlugin 平移缩放 + CanvasBindsPlugin 交互绑定；底部浮动工具栏 CanvasFloatingToolbar；自由元素 note/text/shape→FreeElementBlock，绑定两实体的自由箭头复用 RelationArrowBlock 投影。
canvas-pomelo-plugin.ts: 画布交互绑定层：点击命中 → CanvasSelection 解析（驱动右侧面板）；拖拽位移 + 四角 resize 经 moveElement + persistGeometry（400ms 去抖）持久化；双击实体卡进入容器、双击空白 = 最近类型快捷建卡（Alt = 创建菜单）、双击便签/文本 = 就地编辑；右键 = 上下文菜单；Delete/Backspace 删关系/草稿（实体走删除确认）；选区 overlay 屏幕 space 绘制。
canvas-detail-panel.tsx: 右侧详情面板壳（空选 = World 态常显）；四类选中体路由到 panel/ 子组件（world/entity/relation/element），编辑主场在 panel/* 内聚实现（B.8）。
canvas-dialogs.tsx: 对话框层；受控关系确认（RelateDialog，T5：Top4 候选/搜索/分组/自定义类型）、Promote 确认、删除设定确认（影响范围）、添加字段（类型级，类型：单行/多行/数字/开关/素材（media，assetKind 经 options 携带））与创建菜单/右键菜单挂载（canvas-create-menu.tsx / canvas-context-menu.tsx）。
canvas-relation-candidates.ts: 关系候选 Top4 映射表（B.10 产品资产）与分组色转出；canvas-toast.tsx: 左下 toast 队列（B.4 反馈分级，3s 自消）。
index.tsx: 组合根；经 portal 挂载到工作台内容区（#workspace-content-region，避让全局 Header 与左侧 Chat），组合 toolbar + pomelo host + panel + dialogs，WorldCanvas 唯一出口。

依赖边界

- 数据流：组件只读 `useWorldCanvasStore` 快照并触发动作，绝不直接调用 recut-worlds-client 写接口。
- pomelo block id 约定：实体 `entity:<entityId>`（元素 id 仍为 `shape:<entityId>`）、World 节点 `shape:world`、自由元素直接用 world_canvas 元素 id、语义关系边 block id = `arrow:<relationId>`。
- pomelo 文档是内存投影：拖拽/resize 增量提交仅在文档内，pointerup 落回 canvas-store 持久化，异常时可随时全量重建。
- 画布元素写入不产 revision；实体/关系/Promote 写入产出 revision，冲突时 refreshRevision 重试一次。
- pomelo host 经 index.tsx 的 next/dynamic（ssr:false）挂载，禁止在服务端组件直接 import canvas-pomelo。
- 已知 v1 差异：未绑定两端实体的自由箭头暂不渲染；连线锚点/弯曲拖拽只在内存投影内，不持久化。
- panel/ 子目录：World/Relation/Element 三态自有面板；Entity 态与设定视图共用 web/components/world-entity/ 的 EntityEditor + FieldRow/AssetFieldRow（RFC 统一 Entity 模型 P1：一套编辑器，两个宿主）——panel/field-row.tsx 只是兼容 shim（AssetFieldRow 注入画布 apiBase），EntityPanel 是共享编辑器的画布薄壳，画布特有部分仅草稿确认条、子设定导航与页脚动作；编辑器固定顺序 标题→简介→正文（detail 一等字段）→字段（schema + 动态属性续排 + 添加属性/添加字段，media 属性/动态媒体属性同字段路径渲染，独立「参考素材」网格/封面按钮/A 虚线挂接线已退役——卡面图源 = 遍历 media attrs 的统一投影）→关系（词表内联建立）；panel/media-editor.tsx：媒体元素编辑器（element-panel 路由 kind=media 与 kind=attr 媒体卡）——预览区＋来源区（AI 生成 / 素材库（浮层内可上传）/ 本地上传 / 清除）+ 生成配方区（prompt/模型/当前图作底图回填，改后可再生成/复制配方，POST /v1/media/jobs + GET 轮询自适应采用）+ 素材历史区（element-asset-history-store：「当前 asset 是什么」的指针历史——任何来源换图即记一条，点缩略图设为当前（配方继承），删除历史项 = 删除该 asset）；画布写通道 setMediaElementAsset / setAttrMediaAsset（attr 卡若有属性边连到实体则按字段映射回写 media 属性值）。
- canvas-inline-editor.tsx：就地编辑器（命名态/便签正文共用）；EDITOR_METRICS 逐形态对齐各 Block 的画布排版（note 11/16 @10,10、text 13/20 无内边距、attr 值 11/17 @10,30、实体标题 15/semibold @PAD14、属性命名 11 徽标位），尺寸体验与画布渲染一致；正文编辑器高度锁定元素几何（内滚动，文本服从 box），并带「放大」按钮复用 FieldRow 的 FullscreenTextEditor 做全屏编辑；canvas-relation-candidates.ts：关系候选 Top4 映射（B.10）。
- 媒体（T8）：canvas-media.ts（source/purpose 辅助）+ canvas-media-dialogs.tsx（独立素材来源浮层/预览，无目标实体通道）+ MediaBlock（媒体元素渲染）+ 拖放矩阵（文件→卡=media 属性（attachMediaAttr，无 A 线）；文件→空白=独立元素；媒体卡→卡=media 属性换挂）。
- canvas-errors.ts：B.4 错误映射集中函数（applyCanvasError，写动作 catch 统一出口）；canvas-toast.tsx：toast 队列。
- 增量投影（T1）：语义写后合并返回对象进 store（不 load(true)）；dataVersion 仅推进文档 diff；全量 load 保留于首挂/进容器/冲突刷新。
- 容器导航（T6）：contextTrail 多级面包屑（>3 级折叠）+ Cmd/[ 上一层 + 进入自动换视口（有该上下文视口快照则恢复，无则 fit 子内容）+ 容器视图默认包含容器自身 entity（load 注入 context 实体）+ 空容器/空世界引导卡（T9）。
- P1：canvas-errors.ts + 历史菜单（T12 最近变更逐条撤销 + 版本快照回滚，后端 GET /revisions 与 revert 指针回移）+ 视口持久化（按「世界+上下文」分键：root `wc:vp:<worldId>`、容器 `wc:vp:<worldId>:<contextId>`，进出容器先存回来源再恢复目标，无快照才 fit）；canvas-outline.tsx 大纲/搜索 + 画面已移除实体放回（T14/T16，props.hidden 投影不渲染，设定保留）；canvas-ai-dialog.tsx AI 建实体（T13，契约 POST /ai/suggest-entities，后端 v1 未接 LLM 通道时 501 如实提示）；RelationTypePopover 关系线双击就地换类型（T15）。
- P1 未做（另行排期）：跨 context 终点选择器（需先定 scope 语义，见 PRD Q6）、回收站、字段外化 attr、卡片字段 chips。
- AI 反馈闭环（2026-09-13）：daemon 在 MCP `recut.worlds.*` 写成功后经 "world" 实时 channel（key=worldId）广播 `world.changed`，`index.tsx` 订阅后 `scheduleWorldReload()` 去抖重载当前文档（load 先 flush 本地脏集并走既有版本合并，选中按 id 重解析）；多步 AI 画布会话用 `recut.worlds.canvas.lock/unlock` 建立 advisory 锁，广播 `world.canvas.lock/unlock` → `setCanvasAiLocked`：上锁前落盘、锁期暂停本地保存并显示「AI 正在编辑画布」横幅、锁期忽略 world.changed（避免覆盖本地脏集），解锁后续跑脏集并重载。锁为进程内非持久、空闲 5 分钟自动释放，不替代服务端写校验。
- 选中上报 AI 上下文：`index.tsx` 把画布 `selection`（实体→`world_entity`、关系→`world_relation`、自由元素→`world_canvas_element`）与所在 `contextId/contextTrail/readOnly` 经 `setWorkFocus` 上报 Agent 面板；表单视图的 WorkFocus 在 `viewMode==="canvas"` 时让位（world-detail-client 不再覆盖），使 AI 知道「用户此刻在看画布上的哪个元素、哪一层」。
- 「+」生成引导面板（AttrCreatorPanel，canvas-pomelo.tsx）：两区布局——属性区给出来源实体 type schema 建议字段（已填值的带值置顶可选，点击生成属性并挂边——边即属性关联；未填值为普通 chip；media 字段按 options 定媒体）+ 一等实体字段「简介/正文」关联（预填 entity.intro/detail，编辑卡片正文经 syncAttrValue 的保留标签映射回写字段）+ 空白属性四媒体按钮；实体区列实体类型 + 「空白」（最近使用类型）直接建草稿卡；边类型不在面板选，创建后点击边在右侧边属性面板调整。createAttribute 支持 initial.label（元素名 + props.label）并返回属性元素 id；空白属性创建后进入 attr-title 命名态（inlineEdit 就地填属性名，commit 写元素名 + props.label 并把当前文本登记为实体 content 字段）；属性元素双击 = attr-body 编辑文本，commit 经 syncAttrValue 回写实体 content（label 映射 type schema 字段 key，否则 label 即 key；实体经属性边 fromElementId 解析）——右侧面板与画布同源显示。文本策略（文本服从 box，而非 box 服从文本）：文本属性卡在 free-element-block-v.ts 用 pushClipRoundRect 裁剪到几何 box，溢出直接截断；双击就地编辑时编辑器高度锁定元素几何、内滚动（不再随内容自增长），并提供「放大」按钮复用 FieldRow 的 FullscreenTextEditor，与属性面板编辑体验一致。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
