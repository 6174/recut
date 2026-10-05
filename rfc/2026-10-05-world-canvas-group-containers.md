# World Canvas 分组容器（Group Container）与交互插件模块化

- 状态：设计稿（待评审）
- 日期：2026-10-05
- 范围：`web/app/worlds/[worldID]/canvas/`、`web/lib/pomelo/world-canvas/`
- 结论摘要：新增画布元素 `kind="group"`（渲染为 block `type="group"`，成员用 `props.groupId` 单向归属）；把 1364 行的 `CanvasBindsPlugin` 收敛为「交互内核 + 行为（behavior）+ 画笔（painter）+ 命中提供者（hit provider）」四段，**Group 的所有特殊性只落在一个 `group-behavior` 与一个 `group/` 模块里**；不改 server 元素契约（复用通用 element 与 props 按 key 合并）。

---

## 1. 背景与问题

### 1.1 产品问题

画布元素一多（一屏几十张卡 + 上百条关系）就「看着乱」：逻辑上同一组的卡散落在画布各处、关系线横穿整屏。Figma 式分组容器是经过验证的解法：把一组元素框进一个有名字/底色/边界的容器，容器随内容自适应，拖动容器即整组移动。

### 1.2 架构问题（本 RFC 的真正核心）

`web/app/worlds/[worldID]/canvas/canvas-pomelo-plugin.ts` 的 `CanvasBindsPlugin` 已经 1364 行，一个 `#paint()` 覆盖层函数近 200 行、`onPointerDown/onPointerUp` 各一两百行。它同时承担：

| 职责 | 位置（现状） |
| --- | --- |
| 点击命中（节点/连线） | `hitTest` |
| 选中解析 → `CanvasSelection` | `selectBlock` |
| 四角 resize（含对齐吸附） | `activeCorners` / `applyDragMove` resize 分支 |
| 拖拽位移（多选、对齐吸附、媒体换挂） | `applyDragMove` move 分支 / `onPointerUp` |
| 关系线三控制点 | `activeLinkHandles` / link 分支 |
| 「+」属性引导线 | `plusHandles` / `#guide` |
| 框选 | `#marquee` / `#marqueeBlockIds` |
| 双击（进容器/编辑/换图） | `onDoubleClick` |
| 右键菜单 | `onContextMenu` |
| 键盘（undo/复制/删除/Esc） | `onKeyDown` |
| 覆盖层绘制 | `#paint` |

要加分组，直觉做法是在这些地方各插一段 `if (group)`：命中多一层、绘制多一段、拖拽多展开、提交多一步自适应。**每加一种交互就线性改四处**，这正是用户点名要避免的。

因此本 RFC 分两层交付：**① 交互层重构**（把「新增交互」从「改四处」变成「加一个 behavior + 一个 painter 注册」）；**② Group 设计**（作为重构后第一个被验证的扩展，且 Group 的复杂逻辑全部下沉到独立模块）。

---

## 2. 目标与非目标

### 目标

1. 画布支持 Figma 式分组容器：创建 / 解散、组内归属、整组移动、随内容自适应 resize、名称、背景色、组内批量布局（grid / tree）。
2. 重构选择/拖拽插件：内核机制与具体交互解耦，Group **不侵入** move/resize/marquee 等既有行为。
3. **零 server 契约改动**——复用 `WorldCanvasElement` 的通用 `kind/props/geometry` 与既有按 key 合并（RFC 2026-10-03）。
4. 全部操作可撤销、可落库、可在多标签/AI 并发下安全合并。

### 非目标（v1 明确不做）

- 嵌套分组（group 套 group）。
- 组内相对定位 / 缩放时成员按比例放大（本 RFC 坚持**绝对画布定位**，见 §3.3）。
- 跨层（容器导航 context）分组。
- 把 group 提升为一等语义实体（world_entity）、生产树节点或 AI 工具体。
- 拖拽中的实时裁剪成员（把组外成员裁掉）。

---

## 3. 数据模型

### 3.1 Group 就是一类画布元素

新增 `WorldCanvasElement.kind = "group"`，几何即容器框：

```jsonc
{
  "id": "shape:group-<ts>",
  "contextId": "",                 // 与成员同层
  "kind": "group",
  "name": "第二段落视频生成",       // 一等字段：容器标题
  "props": {
    "background": "#242629",       // 容器底色（hex，默认取 graph-theme 的 groupFill）
    "layout": "free",              // free | grid | tree-down | tree-right（仅记录最近一次布局）
    "padding": 24,                 // 内容内边距（世界坐标）
    "fit": "bbox"                  // bbox | manual（见 §5.4）
  },
  "geometry": { "x": 0, "y": 0, "width": 900, "height": 640, "zIndex": -2 },
  "style": {},
  "layer": "0"
}
```

渲染为 pomelo block `type="group"`（见 §6.2），`zIndex = -2`，低于连线（`relation-arrow` 的 `-1`）与所有节点，保证容器在成员之下。

### 3.2 成员归属：单向、扁平、派生的 `node.group_id`

成员元素上写：`props.groupId = "<groupElementId>"`（用户所说的 `node.group_id`）。

- **成员是唯一真源**，group 不存 children 列表，成员集合始终由 `elements.filter(e => e.props.groupId === groupId)` **派生**——避免「children 列表 + 成员指针」双真源不一致。
- 归属变更只改一个 props key，天然走既有 `mergeCanvasElementPatch` 的按 key 合并：AI 改同元素 `props.text` 与用户改组归属不会互相覆盖。
- 删除 group 元素 ≠ 删除成员：只清空成员的 `groupId`（§5.2）。
- v1 只允许单层；`props.groupId` 指向的元素若其 `kind` 不是 group 或已不存在，按「未分组」处理（fail open，不做硬校验）。

### 3.3 为什么不用 pomelo 父子关系 / 相对坐标

- 用户明确要求「元素位置仍用绝对画布定位，不相对 Group 定位」。用 pomelo `children` 会引入相对坐标、裁剪、父变换，与「pomelo 文档是 `world_canvas` 的可重建投影、store 是唯一真相」冲突。
- 绝对定位下，移动组 = 对每个成员写一次绝对 x/y；z 序仍由 block `zIndex` + 注册顺序控制，与父子无关。

### 3.4 与既有字段组的对应

| 数据 | 存储 | 脏字段组 | 撤销通道 |
| --- | --- | --- | --- |
| group 容器框 | `geometry` | `geometry` | `logGeometryChange` |
| group 名称 | `name`（一等） | `props`+`meta`（沿用 `upsertElement` 全组） | `logChange` |
| 背景 / layout / padding / fit | `props` | `props` | `logChange` |
| 成员归属 `groupId` | `props` | `props` | `logChange`（含在编组批里） |

---

## 4. 交互设计

### 4.1 创建 / 解散 / 删除

- **编组**：多选（`selectedIds.length ≥ 2`）→ `Cmd/Ctrl+G` 或右键「编组」。几何 = 选中并集 bbox + padding；写每个选中元素 `props.groupId`；`withChangeGroup` 合并为一条撤销。
- **解散分组（Ungroup）**：选中 group → `Cmd/Ctrl+Shift+G` 或面板「解散分组」。**保留全部成员**，只清成员 `groupId` + `removeElement(group)`，一条撤销。
- **删除分组（Delete Group）**：选中 group → `Delete/Backspace`（组选中态）或面板「删除分组」。语义 = 删除容器**及其全部成员画布元素**，与「解散」明确区分：
  - 成员中的**实体投影**（`kind="entity"`）走「仅从画布移除」，底层设定 `world_entity` 保留（与现有删除设定确认弹框中的「仅从画布移除」同源，不误归档设定）；
  - 成员中的**自由元素 / 属性卡 / 媒体卡 / 连线**直接删除（连线中两端都在组内的随删；一端在组外的一端保留——其一端被移除后由既有清理逻辑处理）；
  - 成员若还属于其他关系（组外实体间关系）不受影响；
  - 删除前弹确认框（复用 `DeleteSelectionConfirmDialog` 的能力，列出「将删除 N 个元素」），确认后整批经 `withChangeGroup` 合并为**一条撤销**；撤销按删除快照恢复 group、成员及其 `groupId`。
- **删除组 vs 解散组的边界**：任何「只移除容器、内容全部留画布」的场景一律走**解散**；「容器和内容一起清掉」才走**删除分组**。面板两个按钮并存，文案与图标区分（解散 = 拆分图标，删除 = 垃圾桶 + 红色）。
- **拖入归属**（要求 2）：元素移动 **commit 后**，取其中心点，命中最上层包含该点的 group：
  - 命中且不同于当前 `groupId` → 写入新 `groupId`；
  - 未命中且原有 `groupId` → 清空；
  - 归属变化与几何变化合并进同一条撤销。
- **拖出**：中心点离开组框即清归属（与拖入同一条判定）。

### 4.2 命中优先级（关键，决定「点成员选成员」）

命中链按优先级：

```
成员节点（最高）  >  group 背景/标题栏  >  连线  >  空白
```

- 点成员卡 → 选成员（可参与多选）；
- 点组内空白 / 标题栏 → 选 group；
- 双击标题栏 → 就地重命名；
- 点画布空白 → 框选清选。
- group 的命中区域 = 容器框减去所有成员“外接矩形”的剩余部分（标题栏 + padding 带），这样点成员绝不会误选到 group。

### 4.3 移动（要求 4）

- 选中 group 拖拽：对 **group + 其所有成员** 应用同一 delta，各自写绝对 x/y；组内相对关系天然不变。
- 提交走现有 `logGeometryChange`，一个 `entries` 数组包含 group 与全部成员 → 一次拖拽 = 一条撤销。
- 多选里同时含 group 与独立元素时，展开为「组的成员 ∪ 独立元素」的并集去重后再位移。
- 对齐吸附以「整组包围盒」参与（对齐插件看到的是一个矩形，而非逐个成员）。

### 4.4 resize 与自适应 bbox（要求 1 / 5 / 6 / 7）

group 给四角 resize 手柄（在 `resize-policy` 白名单加 `group`）。规则：

```
目标框 = userRect
最终框 = union(userRect, membersBBox + padding)     // merge：绝不小于内容
group.geometry = 最终框
```

- **要求 1**：向内拖到小于成员 bbox 时，自动 merge（= 贴到 bbox + padding），不会裁掉成员。
- **要求 5/6**：成员移动 / 新增 / 删除后，对受影响的 group 调用 `fitGroup`：
  - `fit="bbox"`（默认）：框精确等于 `membersBBox + padding`（可增可减）；
  - `fit="manual"`：框 = `union(manualRect, membersBBox + padding)`（只增不减，保留用户放大意图）。
- **要求 7**：`padding` 从 `props.padding` 读，默认 `GROUP_PADDING`（24）。
- 成员被移出组后，`fit="bbox"` 的组自动收缩到剩余成员；`fit="manual"` 保持不变。

### 4.5 右侧属性面板 `GroupPanel`（要求 8）

选中 group 时，`detail-panel` 路由到 `panel/group-panel.tsx`：

| 区块 | 内容 | 写通道 |
| --- | --- | --- |
| 标题 | 名称（`FieldRow`） | 写 `element.name` |
| 外观 | 背景色（预设 swatch + 自定义 hex + 透明） | `props.background` |
| 成员 | `N 个元素` + 可滚动列表（点击定位到该元素） | 只读派生 |
| 布局 | `grid` / `tree-down` / `tree-right` 按钮（默认**按名称排序**） | 纯函数算坐标 → 写成员 x/y + `fitGroup` |
| 自适应 | `fit` 开关 + 「适应内容」按钮 | `props.fit` / 一次 fit |
| 危险区 | 「解散分组」（保留内容）/「删除分组」（容器 + 内容，红色 + 确认框） | §4.1 |

**默认按名称排序**（要求 8 第 4 点）是布局函数的默认参数，排序键 `displayNameOf`：

1. 实体卡 → `entity.name`；2. 自由元素/属性卡 → `element.name`；3. 无 name → 文本首行 / kind；4. 空名排最后。
   大小写不敏感、数字按自然序（`2` < `10`）、同名按 id 稳定排序。

### 4.6 布局语义

- **grid**：组内容盒内**行优先**铺排，列数 = `ceil(sqrt(n))`（可后续在面板暴露列数/间距），按名称序。
- **tree-down / tree-right**：复用现有 `computeTreeLayout`（依组内成员间的关系边/自由箭头建森林），同级排序改为名称序；无内部边时退化为按名称的单行/单列。
- 布局只改成员 x/y + 重算 group 框，**不改尺寸**；整批一条撤销。
- 现有工具栏「对齐」下拉（多选）与组内布局**共用纯几何模块** `arrange.ts`，不新写一套。

---

## 5. 交互插件重构（核心）

### 5.1 目标结构

```
web/lib/pomelo/world-canvas/interaction/     ← 新增，渲染器/业务无关的交互内核
  kernel.ts        CanvasInteractionPlugin：唯一挂 DOM 事件 + ticker 合帧 + overlay 合成
  context.ts       InteractionContext：toWorld/toScreen/hitTest/store 访问/requestFrame
  behavior.ts      Behavior 接口 + HitProvider/Painter/CommitHook 类型
  session.ts       DragSession：统一 Move/Resize/Link/Marquee/Group 的指针会话状态机
  hit-test.ts      通用节点/连线命中（从 CanvasBindsPlugin 抽出）
  live-geometry.ts 实时几何 Map（从插件字段抽出，供文档重建优先采用）

web/app/worlds/[worldID]/canvas/behaviors/   ← 宿主行为（绑定 canvas-store）
  move-behavior.ts       拖拽位移（不认识 group，走 MoveResolver）
  resize-behavior.ts     四角 resize（走 ResizeBoundsResolver）
  marquee-behavior.ts    空白框选
  link-behavior.ts       关系线三控制点
  add-attr-behavior.ts   「+」属性引导线
  hover-behavior.ts      hover / 文本卡全屏入口显隐
  group-behavior.ts      ★ Group 专属：命中背景、整组展开移动、提交后归属 reconciliation + fit
  commands.ts            双击 / 右键 / 键盘（命令层，非指针会话）

web/lib/pomelo/world-canvas/group/           ← 新增，纯逻辑，零渲染/零 store
  group-model.ts    成员派生 / bbox / padding / fit / 归属判定（纯函数，配 node:test）
  group-metrics.ts  GROUP_PADDING / 标题栏高度 / 颜色 token
  group-block-v.ts  GroupBlockV 渲染（容器 + 标题栏 + 名称）
  group-layout.ts   grid / tree（名称排序），或扩展 arrange.ts 的 sortBy
```

### 5.2 内核职责（`kernel.ts`）

内核只做「与具体交互无关」的事，**完全不认识 group**：

1. 监听 `pointerdown/move/up/cancel/leave`、`dblclick`、`contextmenu`、键盘；维护 pointer capture 与空格平移让位。
2. 维护 `DragSession`：一个会话 = 一个 behavior 的接管（`onPointerDown` 返回 `true` 即锁定），后续 move/up 只路由给它。
3. ticker 合帧：`pointermove` 只存最新事件，一帧至多 apply 一次（沿用现有纪律）。
4. 命中：向所有注册的 `HitProvider` 取候选，按 `priority` 排序取第一个命中。
5. overlay：先 `clearAll`，再按 painter 分层（背景 → 内容 → 手柄 → 草稿）调用各 behavior 的 `paint`。
6. 提交：behavior 产出 `GeometryCommit` 批次后，内核广播 `onGeometryCommit` 给所有 behavior（Group 在这里被唤醒），再交 store 落库。

### 5.3 Behavior 契约

```ts
interface InteractionBehavior {
  id: string;
  priority: number;                          // 命中/接管优先级
  hit?(ctx: InteractionContext, world: Point): Hit | null;
  onPointerDown?(ctx: InteractionContext, e: PointerEvent, hit: Hit | null): boolean; // true = 接管本次会话
  onDragMove?(ctx: InteractionContext, session: DragSession, e: PointerEvent): void;
  onPointerUp?(ctx: InteractionContext, session: DragSession, e: PointerEvent): void;
  paint?(ctx: InteractionContext, overlay: DomOverlay, session: DragSession | null): void;
  onGeometryCommit?(ctx: InteractionContext, batch: GeometryCommit): void;  // 提交后钩子
  cursor?(ctx: InteractionContext, world: Point): string | null;
}
```

**Group 不侵入其他行为**靠三个扩展点：

| 扩展点 | 提供者 | 消费者 | Group 如何介入 |
| --- | --- | --- | --- |
| `HitProvider` 链 | group-behavior | kernel | 提供一个低优先级 provider，命中容器框减成员区 |
| `MoveResolver` | group-behavior | move-behavior | 命中 group 时把拖动体展开为「group + 全部成员」 |
| `ResizeBoundsResolver` | group-behavior | resize-behavior | 对 group 的请求框套 `union(bbox+padding)` |
| `CommitHook` | group-behavior | kernel | 提交后做成员归属 reconciliation + `fitGroup` |

- `move-behavior` 不知道 group：它只问 `resolveMoveTargets(hit, dragSet)`；默认实现返回原集合，group-behavior 注册的实现返回展开集合。
- `resize-behavior` 不知道 group：它只问 `resolveResizeBounds(record, requested)`；默认裁剪到 `MIN_SIZE`，group 实现叠加 bbox merge。
- marquee / link / add-attr 完全无改动（框选会自然选中 group，因为 group 进了 `MARQUEE_NODE_TYPES`）。
- 于是「新增 Group 交互」= 只加 `group-behavior.ts` + `group/` 模块，**不碰** move/resize/marquee/link。

### 5.4 迁移策略（避免大爆炸重写）

1. 先建内核，保留 `CanvasBindsPlugin` 作为 **facade**：把现有事件/绘制/提交原样转调内核，行为先全部塞在一个 `legacy-behavior` 里，行为清单为空。此步纯搬家、行为不变。
2. 逐条把 `legacy-behavior` 的职责搬进独立 behavior：marquee → move → resize → link → add-attr → hover → commands。**每搬一条都在真机验证一次**，可单独回退。
3. 行为拆完后新增 `group-behavior` + `group/`，作为重构后第一个新交互验收点。

---

## 6. Group 模块设计

### 6.1 `group-model.ts`（纯函数，单一真源）

```ts
export const GROUP_PADDING = 24;

isGroup(record): boolean
membersOf(elements, groupId): WorldCanvasElement[]
membersBBox(members, rectOf): Rect | null              // rectOf 由宿主注入 blockRect
fitRect(bbox: Rect | null, padding: number, current?: Rect): Rect | null
mergeRect(a: Rect, b: Rect): Rect                      // 并集
topGroupAt(elements, membersBBox, point, excludeId): WorldCanvasElement | null   // 中心命中判定
reconcileElement(elements, element, rect, padding): { groupId: string | null }   // 返回应写归属
```

所有函数零渲染、零 store，配 `*.test.ts`（对齐 `arrange.test.ts` 的 node:test 风格）。

### 6.2 `group-block-v.ts`（渲染）

- `static type = "group"`；`override zIndex = -2`；`renderOnZoom = true`。
- 画：圆角容器填充（`props.background`，默认 `GRAPH_COLORS.groupFill`）+ 1px 描边 + 顶部标题栏（名称，`GRAPH_TEXT.caption`/标题字号）。
- 低细节（`isLowDetail`）时只留填充面，隐藏标题。
- 不需要图片/媒体，无 atlas 影响。
- 颜色 token 加到 `graph-theme.ts`（`groupFill` / `groupStroke`），遵守「配色单一真源」。

### 6.3 布局 `group-layout.ts`

- `computeGridLayout(nodes, { columns?, gap, sortBy: "name" | "position" })`：行优先、名称序、锚定组内容盒左上角。
- `computeTreeLayout` 现有实现增加 `sortBy`（默认 `"position"` 保持旧行为；组内布局传 `"name"`）。
- 均返回与输入同序的目标左上角；调用方（store）负责落库 + `fitGroup` + 一条撤销。

### 6.4 面板 `panel/group-panel.tsx`

见 §4.5；路由由 `element-panel.tsx` 增加 `isGroup = element.kind === "group"` 分支（或 `detail-panel` 直接路由），不塞进媒体编辑器。

---

## 7. 与现有系统的接线

| 位置 | 改动 |
| --- | --- |
| `canvas-pomelo.tsx` `buildPomeloRecords` | `state.elements` 循环里**先**输出 `kind === "group"` 的 record（低 z 优先），再输出其余；group record 携带 `x/y/width/height/name/background` |
| `WORLD_VELLO_BLOCKS` | 注册 `GroupBlockV` |
| `canvas-pomelo-plugin.ts` `NODE_TYPES` / `MARQUEE_NODE_TYPES` | 加 `"group"`；命中优先级由新内核的 hit provider 处理（成员优先于 group） |
| `resize-policy.ts` | `RESIZABLE_BLOCK_KINDS` 加 `"group"` |
| `canvas-store.ts` | `CanvasSelection` **不新增类型**（group 是 `type:"canvas"` 元素）；新增 `groupSelection()` / `ungroup(id)` / `setGroupProps(id, patch)` / `arrangeGroup(id, mode)` / `fitGroup(id)`；`select` 保持不变 |
| `arrange.ts` | 增加 `sortBy` 与 `computeGridLayout`（组内 + 多选两处共用） |
| `canvas-clipboard.ts` | 片段需含 group 元素；复制/粘贴时重映射成员 `props.groupId`；`shape:world` 仍恒过滤 |
| `removeElement` | 删成员 → 触发 `fitGroup`；直接删 group（如 Delete 键）默认按**解散**处理（保内容）；**删除分组**走新动作 `deleteGroup(id)`（同批删成员 + 容器，确认框，一条撤销） |
| `recut-worlds` skill / MCP | 无需新工具；AI 写 `kind:"group"` + 成员 `props.groupId` 即可（通用 element 通道），仅在 skill 文案补一句 |

---

## 8. 持久化、并发与撤销

- **持久化**：全部走既有字段组（geometry/props/meta）与去抖整包保存；`props.groupId` 是普通 props key，按 key 合并。
- **并发**（多标签/AI）：
  - 成员 text 与 `groupId` 同元素不同 key → 合并安全；
  - group 框与成员位置可能来自不同写者 → `fitGroup` 在本地提交后重算，即使远端短暂用旧框，下次任一提交会重新收敛；不引入 CRDT。
- **撤销**：
  - 拖拽整组 / resize = 一条 `logGeometryChange`（多 entry）；
  - 编组 / 解散 / 布局 / 改归属 = 一条 `withChangeGroup`（内部多笔 props/geometry 写）；
  - `restoreElement` 需按快照恢复 group 及其成员的 `groupId`（删除撤销）。

---

## 9. 里程碑

| 里程碑 | 内容 | 验收 |
| --- | --- | --- |
| **M0 数据与渲染** | `kind=group` 元素模型、`GroupBlockV`、store 动作（建/删/改 props）、`buildPomeloRecords` 排序、server 直通验证 | 手写一个 group 元素能渲染为置底容器，刷新不丢 |
| **M1 内核重构** | interaction 内核 + facade 迁移 + 行为逐个搬家（先不含 group） | 现有交互全部回归通过（拖拽/缩放/框选/连线/双击/快捷键） |
| **M2 Group 交互** | `group-behavior`：编组/解散、命中优先级、整组移动、拖入归属、bbox 自适应 resize | §10 验收 1–7 |
| **M3 面板与布局** | `GroupPanel`（名称/背景/布局/fit）+ `computeGridLayout` 与 `sortBy:"name"` | §10 验收 8–11 |
| **M4 收口** | 剪贴板/删除/撤销/AI 文案/多标签并发 | §10 验收 12–14 |

---

## 10. 验收

1. 多选 ≥2 → `Cmd+G` 编组：容器框 = 并集 bbox + padding，标题栏可命名。
2. 拖动组内成员到组外 → 松手后归属清除；拖入另一组 → 归属切换，两组框各自自适应。
3. 拖动 group → group 与全部成员同 delta 绝对位移，组内相对位置不变；`⌘Z` 一次回退整组。
4. 向内拖 resize 到小于成员 bbox → 框 merge 回 `bbox + padding`，成员不被裁。
5. 成员向外移动 → 组框自动扩大；成员移出后（`fit=bbox`）组框自动收缩。
6. 点成员选成员、点组内空白/标题栏选 group，互不误选。
7. 框选与 group 相交能选中 group；组内布局后仍满足 4/5 的自适应。
8. 面板可改名称、背景色；刷新后保持。
9. panel「grid / tree-down / tree-right」一键布局，**默认按名称排序**，整批一条撤销。
10. `fit=manual` 放大后成员小幅移动不会缩回；「适应内容」可复位。
11. 空组 / 单成员组 / 成员全部移出组 均不崩、框不出现负尺寸。
12. 复制含 group 的选区再粘贴：id/`groupId` 正确重映射，不串组。
13. **解散分组**（及撤销）：容器消失、成员全部留在原地、归属清空/恢复正确。
14. **删除分组**（及撤销）：确认框列出 N 项；确认后容器与成员一起消失，实体成员设定仍在（仅从画布移除）；`⌘Z` 一次恢复容器、成员与归属；「解散」不会误删内容。
15. 多标签并发：A 拖组、B 改成员文本，互不覆盖；AI 只写成员实体不受影响。

---

## 11. 风险与开放问题

- **嵌套分组**：v1 单层。若将来支持，`reconcile`/`membersOf` 需改为按 `groupId` 图做传递闭包，并定义命中「最内层组」。本 RFC 不预留递归实现，只保证 `props.groupId` 语义可向上兼容。
- **布局与手工排布的冲突**：一键布局会覆盖用户手工位置；用一条可撤销操作兜底，不改自动重排行为。
- **大组性能**：`reconcile` 在每次成员提交后触发。以 `elements` 建一次 `groupId → members[]` 索引，只处理本次变更元素所在组，避免 O(n²)。若成员数极大，可将 `fitGroup` 去抖到帧末。
- **对齐吸附与组**：组拖动以整组包围盒参与吸附；成员单独拖动是否吸附到组边框，留待 M2 实测后决定。
- **z 序**：当前依赖 block `zIndex`（group `-2` < arrow `-1` < 节点 `0`）。若未来引入显式 `layer` 排序，需要把 group 明确定义为「组内容层之下」。
- **与生产树/容器导航的关系**：group 是纯视觉容器，与 `recut.worlds.production` 的生产树、`contextTrail` 容器导航**无关**（后者是语义层级，前者是同一画布层内的视觉框）。若产品希望「组 = 子世界」，属于另一个 RFC。

---

## 12. 改动面摘要

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `web/lib/pomelo/world-canvas/interaction/*` | 新增 | 交互内核（kernel/behavior/session/hit-test/live-geometry） |
| `web/app/worlds/[worldID]/canvas/behaviors/*` | 新增 | 行为拆分（marquee/move/resize/link/add-attr/hover/group/commands） |
| `web/lib/pomelo/world-canvas/group/*` | 新增 | `group-model` / `group-metrics` / `group-block-v` / `group-layout` |
| `web/app/worlds/[worldID]/canvas/panel/group-panel.tsx` | 新增 | 组属性面板 |
| `canvas-pomelo-plugin.ts` | 改 | 收敛为 facade + 行为注册 |
| `canvas-pomelo.tsx` | 改 | `buildPomeloRecords` 输出 group、注册 block |
| `canvas-store.ts` | 改 | group 动作、删组清归属 |
| `arrange.ts` | 改 | `sortBy` + `computeGridLayout` |
| `resize-policy.ts` | 改 | 白名单加 `group` |
| `canvas-clipboard.ts` | 改 | 片段含 group + 重映射 |
| `graph-theme.ts` | 改 | group 配色 token |
| server | **不动** | 通用 element 通道直通 |
