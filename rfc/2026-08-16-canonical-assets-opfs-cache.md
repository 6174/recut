<!--
 * [INPUT]: 依赖 Recut Local-first Extension Host、workspace.sqlite 的 media_assets / media_asset_projects、
 *          service 的 /v1/media/assets API、编辑器时间线的 mediaId 引用，以及浏览器 IndexedDB / OPFS 旧存储路径。
 * [OUTPUT]: 定义 Assets 为用户资产唯一真相源、OPFS 为可重建设备缓存的存储契约；规定上传、同步、离线、
 *           删除、缓存渐进加载体验与缺失素材降级行为，以及分阶段实施与验证标准。
 * [POS]: rfc 的跨域名与跨设备媒体持久化蓝图；获批后约束 service media、宿主 SDK 与所有 App 的媒体实现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: Canonical Assets——全局素材真相源与 OPFS 派生缓存

- 状态：提案
- 作者：Recut
- 日期：2026-08-16
- 决策范围：用户上传素材、生成素材、项目素材引用、浏览器 OPFS/IndexedDB、跨域名入口、跨设备打开、缓存渐进加载、离线编辑与删除保护
- 关联：`service/media/assets.go`、`service/project.go`、`service/server.go`、`apps/editor/ui/src/services/storage/*`、`apps/editor/ui/src/media/*`、`apps/editor/ui/src/recut/sdk.ts`、`apps/editor/background.js`

## 1. 摘要

Recut 的视频、图片、音频和其元数据必须有一个不依赖浏览器 origin 的唯一真相源：**Recut Assets**。

该真相源在 local-first 模式下是用户设备上的 Recut Daemon（`workspace.sqlite` + 内容寻址文件根）；未来连接远程 Service 时，它同样可以是用户已授权的远程 Service。它不是“必须上传云端”的同义词。

浏览器 OPFS 与 IndexedDB 保留，但只承担本机、当前 origin 的性能缓存职责。缓存被清除、域名变化、切换浏览器或换设备，都不得使项目失去资产；最多让首次打开需要重新下载。`app.recut.video`、`localhost`、`app.localhost` 只是入口，不是数据命名空间。宿主负责在启动 App 前发现并连接 Service；App 不参与发现。

## 2. 背景与病灶

当前系统已经有平台级 `media_assets`、`media_asset_projects` 与内容文件存储，也有以全局 `assetId` 表达素材依赖的方向。但编辑器历史链路仍可把项目/媒体回退到浏览器 IndexedDB 与 OPFS。浏览器存储按 origin 隔离：

```text
http://localhost:3000       ┐
http://app.localhost:3000   ├─ 三个互相隔离的浏览器存储桶
https://app.recut.video     ┘
```

这造成两个不可接受的结果：

1. 同一台设备换入口后，旧 OPFS 中唯一的原始素材不可见；项目仍有 `mediaId`，但素材字节或记录找不到。
2. 素材缺失时，前端可能把“找不到 Asset”误当作异常路径，进一步触发渲染或属性面板崩溃。

问题的本质不是域名，也不是 i18n；是浏览器缓存被错误地当作了用户资产的持久化真相源。

## 3. 目标与非目标

### 3.1 目标

1. 所有用户上传、生成和导入的图片/视频/音频先成为 Recut Asset，再允许被项目时间线引用。
2. 所有项目和 App 均以稳定 `assetId` 引用素材；浏览器不再拥有唯一素材副本。
3. 任意受支持入口、浏览器或设备打开同一项目时，均能从 Assets 恢复所需素材到本地缓存。
4. 离线时，已缓存素材可继续编辑；未缓存素材给出明确可恢复状态，不显示为空白且不崩溃。
5. 删除、同步与并发写入不产生无提示的孤儿引用或不可恢复数据丢失。
6. 不为同一设备强制维护两份“正式数据”；OPFS 的副本可随时丢弃并按需重建。

### 3.2 非目标

1. 本 RFC 不要求将本地用户的媒体无条件上传到 Recut 云端。
2. 本 RFC 不定义团队协作、端到端加密、素材版本历史或多区域云同步；它只服务当前用户的个人创作。
3. 本 RFC 不定义本地 Service 的发现、安装、连接、鉴权或重连。宿主在连接完成前不加载 App；连接失败由宿主显示错误。
4. 本 RFC 不包含旧浏览器数据库或 OPFS 的迁移；当前没有需要兼容的历史负担。
5. 本 RFC 不要求首次打开新设备时全量下载所有原片。
6. 本 RFC 不改变编辑器的时间线、预览或导出表达，只收敛它们取得媒体字节和元数据的路径。

## 4. 核心决策

| # | 决策 |
|---|---|
| D1 | **Assets 是唯一真相源**：Asset 元数据、内容哈希、二进制、生命周期状态和项目绑定只以 Recut Assets Service 为准。local-first 模式下该 Service 即用户设备上的 Daemon。 |
| D2 | **OPFS/IndexedDB 是缓存**：它们保存下载副本、缩略图、波形、代理文件和临时上传分片；没有业务唯一性，清除后可从 Assets 重建。 |
| D3 | **时间线只引用稳定 Asset**：`element.mediaId` 必须指向已完成或明确处于 `pending-upload` 的 Asset；项目保存不能偷偷仅写浏览器本地。 |
| D4 | **SDK 是唯一 Assets 入口**：宿主先完成 Service 连接，再连接 App；App 只调用 `recut.assets`，不负责发现 Service、不猜测 `window.location.origin`、也不直连未授权端点。 |
| D5 | **按需缓存，不全量镜像**：新设备先同步素材清单、缩略图和代理；原始文件仅在预览、编辑、导出或用户显式下载时分段拉取。 |
| D6 | **渐进可用、缺失可见**：素材未进入 OPFS 时先显示可下载的 Loading 状态和进度；不可取时才显示“素材不可用”。两者均保留片段编辑信息，所有面板与操作必须安全处理。 |
| D7 | **删除保留墓碑**：用户可删除仍被项目引用的 Asset；Service 删除内容但保留最小 Asset 墓碑与引用，时间线稳定显示“资源已删除”，而不是变成查无此物。 |

## 5. 术语与不变量

### 5.1 术语

- **Assets Service**：持有用户资产唯一正式记录与内容的 Service。可以是本机 Daemon，也可以是用户配置且已鉴权的远程 Service。
- **Asset**：全局稳定 ID 的媒体对象，含元数据、内容哈希、状态和内容字节。
- **Project Asset Link**：Asset 与 Project 的服务端绑定，不等同于时间线中某一个 clip。
- **OPFS Cache**：一个浏览器 origin 下的派生副本，支持断点续传与淘汰。
- **Manifest**：项目所引用 Asset 的版本化摘要，供客户端判断缓存命中与下载需求。

### 5.2 不变量

1. **资产存在性只由 Assets Service 判定**；OPFS 命中不证明 Asset 仍存在，OPFS 未命中也不证明 Asset 丢失。
2. **Asset ID 不变，内容哈希不可变**。替换内容必须创建新 Asset 或明确新 revision，不能静默覆盖同一 ID。
3. **缓存键为 `(assetId, contentHash)`**，不得仅以文件名或 `assetId` 缓存，防止内容更新后读旧字节。
4. **时间线引用、项目绑定与 Asset 状态必须可验证**。保存和导出发现不满足时给出结构化问题，不得导出空画面。
5. **缓存失效不改变项目语义**；缓存只影响可用性和性能。
6. **UI 永不把 Asset 缺失当作不可捕获异常**。任何选择、右键菜单、属性面板、拖拽、预览与导出入口都接受 `available | downloading | unavailable | pending-upload`。

## 6. 数据模型

### 6.1 Assets Service：权威记录

现有 `media_assets` 与 `media_asset_projects` 扩展为以下逻辑模型：

```text
Asset
  id: UUID
  kind: image | video | audio | transcript | reference
  name, mimeType, sizeBytes
  contentHash: sha256
  status: pending-upload | completed | failed | deleted
  origin: user-upload | generated | imported | migrated
  createdAt, updatedAt

ProjectAssetLink
  projectId, assetId, linkedAt

AssetContent
  contentHash -> content-addressed file path
```

- `completed` 才表示所有设备可可靠下载的正式资产。
- `pending-upload` 是可恢复的临时状态：它必须有服务端记录和可继续上传的 checkpoint，不能只在 OPFS 里“假装存在”。
- `failed` 保留错误原因并可重试；`deleted` 是用户主动删除后的墓碑状态：内容字节已移除，但 `id`、名称、类型、删除时间与项目引用仍保留，供时间线明确展示。

### 6.2 项目与时间线

```text
TimelineElement.mediaId ─┐
                         ├─ Asset.id
ProjectAssetLink ────────┘
```

- `TimelineElement.mediaId` 表示“这个 clip 使用哪个 Asset”。
- `ProjectAssetLink` 表示“这个项目被允许、且应能发现这个 Asset”。一个 Asset 可以被同一项目多个 clip 复用。
- 新增或替换 clip 时，服务端在同一事务中验证 Asset 状态与写入 ProjectAssetLink；不能先保存 clip、后异步赌绑定成功。

### 6.3 OPFS Cache：非权威记录

每个 origin 的 OPFS 可以保存：

```text
cache/{assetId}/{contentHash}/
  original.part      # 可续传分段；完成后原子改名 original
  proxy.mp4          # 可选低码率代理
  thumbnail.webp
  waveform.json
  cache-meta.json    # bytesCached、etag、lastAccess，不含资产真相
```

OPFS 中不保存唯一的项目资产登记；清除缓存后，客户端以 Manifest 重新建立它。

## 7. Service API 与 Recut SDK

### 7.1 宿主连接前置条件

Service 的发现、安装和连接属于工作台外层。宿主在连接成功后才向 iframe App 建立 MessageChannel；连接失败时，宿主显示可操作错误，App 不进入加载状态。因此媒体 App 永远不承担“从当前域名猜 Service 在哪里”的职责。

`app.recut.video`、`localhost`、`app.localhost` 只要被宿主连接到同一个 Service，就天然读取同一份 Assets；它们不需要、也不应该访问彼此的 OPFS。

### 7.2 Recut SDK Assets 能力

App 只使用 SDK，SDK 通过已建立的宿主桥转发到连接好的 Assets Service：

```ts
type RecutAssets = {
  get(input: { assetId: string }): Promise<Asset>;
  list(input: { projectId: string }): Promise<AssetManifest>;
  upload(input: { projectId: string; file: File }): Promise<{ asset: Asset }>;
  attach(input: { projectId: string; assetId: string }): Promise<void>;
  delete(input: { assetId: string }): Promise<void>;
  contentURL(input: { assetId: string }): Promise<string>;
	partURL(input: { assetId: string; part: "srt" | "json" | "content" | "image" }): Promise<string>;
  thumbnailURL(input: { assetId: string }): Promise<string | null>;
  proxyURL(input: { assetId: string }): Promise<string | null>;
};

recut.assets satisfies RecutAssets;
```

- `upload` 只有在 Service 返回正式 `assetId` 后才解析成功；SDK 负责分块上传、续传与取消语义，App 不保有另一套上传协议。
- `contentURL`、`thumbnailURL`、`proxyURL` 返回由宿主授予的短生命周期能力 URL。App 用标准 `fetch` + `Range` 读取字节并写入 OPFS，SDK 仍是 URL 的唯一取得入口；不得自行拼 `/v1/media/*` 或读取 `window.location.origin`。
- 若 SDK 桥断开，所有方法返回明确连接错误；App 展示错误边界，不回退到浏览器独立持久化。

### 7.3 Service API 的职责

保留并强化：

| API | 责任 |
|---|---|
| `POST /v1/media/assets` | 创建上传 Asset，返回稳定 `assetId` 与断点续传信息。 |
| `GET /v1/media/assets/{id}` | 返回权威元数据、状态、内容哈希和项目绑定摘要。 |
| `GET /v1/media/assets/{id}/content` | 返回内容，支持 `ETag`、`Range` 与断点续传。 |
| `POST /v1/media/assets/{id}/attach` | 把完成 Asset 原子绑定到项目。 |
| `DELETE /v1/media/assets/{id}` | 删除内容字节并把 Asset 标为 `deleted`；保留最小墓碑和项目引用。 |

项目素材 Manifest 首期复用已有端点，而不引入平行的 HTTP 模型：

```http
GET /v1/media/assets?projectId={projectId}
```

宿主把结果规范化为项目打开和缓存决策所需的最小权威摘要：

```json
{
  "projectId": "…",
  "version": 42,
  "assets": [
    {
      "id": "…",
      "kind": "video",
      "name": "recording.mov",
      "status": "completed",
      "contentHash": "sha256:…",
      "sizeBytes": 834211223,
      "hasProxy": true,
      "hasThumbnail": true
    }
  ]
}
```

Manifest 不携带视频字节；它是跨入口和跨设备恢复缓存的唯一索引。未来只有当列表 API 不能满足版本或分页需求时才新增专用 Manifest route。

## 8. 写入、同步与离线流程

### 8.1 上传新素材

```text
选择文件
  → Assets Service 创建 pending-upload Asset
  → 分块上传/断点续传，浏览器 OPFS 仅暂存未完成分块
  → Service 校验 MIME、大小与 sha256，原子写内容与元数据
  → Asset = completed
  → 原子绑定 ProjectAssetLink + 写入时间线 mediaId
  → 客户端以该 Asset 缓存预览副本
```

上传失败或页面关闭时，客户端凭 `assetId` 继续查询和续传；不得把“浏览器还留着文件”误认为上传成功。

### 8.2 新域名、新浏览器或新设备打开项目

```text
加载项目 → 取得 asset-manifest → 对每个 mediaId 查 OPFS (assetId, hash)
  ├─ 命中：直接使用缓存
  ├─ 未命中但在线：先取缩略图/代理，按需 Range 下载原片到 OPFS
  └─ 未命中且离线：显示“素材需联网下载”，保留可选择的片段
```

因此不会发生“换域名 = 素材丢失”；最多发生一次可见、可恢复的缓存冷启动。

### 8.3 预览、导出和后台下载优先级

1. 时间线缩略图优先下载 thumbnail。
2. 编辑预览优先下载 proxy；无 proxy 时按当前播放窗口做 Range 下载。
3. 导出要求所有相关原片完整可用；未缓存则显示准备进度，完成前不开始导出。
4. 后台预取只在用户允许、网络条件合适且有磁盘空间时进行；不得悄悄下载整库原片。

### 8.4 缓存淘汰

- 以 `lastAccess` 和配额为依据淘汰原片，优先保留缩略图、代理和正在编辑项目的素材。
- 淘汰前禁止删除进行中的上传分块。
- 淘汰只删 OPFS；服务端 Asset 与项目引用不变。
- 缓存清理按钮必须文案明确为“清理本机缓存”，不得称为“删除素材”。

## 9. 渐进加载体验、缺失与异常语义

### 9.1 加载体验原则

项目文档、时间线结构和媒体字节是不同层级的数据，不能要求“所有原片下载完”才打开编辑器。页面必须先让用户看见并操作时间线，再让每个片段逐步获得缩略图、代理和原片能力：

```text
项目文档已到达
  → 时间线立即可见、可选择/移动/裁切
  → 缩略图到达：显示静态首帧
  → 代理到达：可低码率预览
  → 原片到达：可逐帧预览与导出
```

- 加载状态不是错误：只要 Asset 在 Manifest 中且可访问，就显示“正在准备素材”，绝不显示“素材丢失”。
- 每个 clip 独立加载，不允许一个大视频阻塞整个项目、其他轨道或属性面板。
- 下载任务在页面刷新、切换路由或切换入口后可根据 `(assetId, contentHash)` 恢复；进度来自实际缓存字节，不使用无限旋转的假 Loading。
- 用户可继续选择、拖拽、裁切、改速、改效果和删除正在下载的 clip；播放、波形分析、逐帧预览和导出仅在依赖的资源就绪后开启。

### 9.2 统一媒体就绪状态

客户端对外暴露比“有/无素材”更精确的状态机：

```ts
type AssetReadiness =
  | { state: "metadata-loading" }
  | { state: "queued"; asset: Asset }
  | { state: "downloading"; asset: Asset; downloadedBytes: number; totalBytes: number; phase: "thumbnail" | "proxy" | "original"; previewURL?: string }
  | { state: "preview-ready"; asset: Asset; localURL: string }
  | { state: "ready"; asset: Asset; localURL: string }
  | { state: "pending-upload"; asset: Asset }
  | { state: "unavailable"; assetId: string; reason: "offline" | "deleted" | "not-found" | "failed" | "forbidden" };
```

正常下载路径单向朝更高可用性推进；重试只允许在网络恢复、授权更新或用户明确重试后从 `unavailable` 回到 `queued`。新 Manifest 的 `contentHash` 改变时创建新的缓存任务，旧缓存不冒充新版本：

```text
metadata-loading → queued → downloading(thumbnail) → downloading(proxy) → preview-ready → downloading(original) → ready
                                       └──────────────────────→ unavailable（仅确认失败、离线或不存在时）
```

### 9.3 时间线与预览 UI

| Readiness | 时间线片段 | 预览画布 | 可用操作 |
|---|---|---|---|
| `metadata-loading` | 片段几何和名称占位骨架 | 保持上一帧或中性占位 | 选择、移动、裁切、删除 |
| `queued` | 显示缩略图骨架与“等待下载” | 中性占位 | 同上；可取消低优先级预取 |
| `downloading(thumbnail/proxy)` | 叠加非阻塞进度条与百分比；名称始终可读 | 显示封面占位，代理就绪后自动可播 | 全部时间线编辑；播放按钮显示准备中 |
| `preview-ready` | 正常缩略图，可显示“高清仍在准备”弱提示 | 可播放代理 | 编辑与低码率预览；导出会请求原片 |
| `downloading(original)` | 保持正常缩略图与弱进度提示 | 保持代理播放，不回退占位 | 编辑与低码率预览；导出显示原片准备进度 |
| `ready` | 正常 | 原片预览 | 全部操作 |
| `pending-upload` | 上传进度与“尚未同步”标签 | 使用本地临时预览（若有） | 编辑可继续；跨设备与最终导出受限 |
| `unavailable/deleted` | 明确显示“资源已删除”与“重新绑定/删除片段”入口 | 不尝试解码 | 片段编辑、删除、重新绑定；禁用播放/导出该片段 |

交互要求：

1. **不阻塞选择**：点击下载中的片段必须立即选中并展示可编辑的时间、变换、效果等元数据；媒体探测字段单独显示“准备中”。
2. **不抢焦点**：后台下载完成只更新该 clip，不自动切换选区、不打断播放、不弹成功 toast。
3. **进度可解释**：显示“缩略图 / 预览代理 / 原片”阶段和可取消/暂停的低优先级下载；单个未知总大小时显示已下载字节与活动指示，不伪造百分比。
4. **导出前聚合**：用户点击导出时汇总仍需原片的 clip，展示总进度及可取消操作；只有资源齐备后开始编码。
5. **错误可重试**：网络失败保留已下载分段与失败原因，提供“重试下载”；Service 返回 `deleted` 时显示“资源已删除”，提供“重新绑定”和“删除片段”；只有数据完整性异常才显示“素材记录不存在”。

### 9.4 调度优先级

下载调度按用户当前意图排序：

1. 当前播放头附近、当前选中和当前可见轨道的 thumbnail/proxy；
2. 当前场景其余可见片段的 thumbnail；
3. 可能即将播放的代理；
4. 用户显式请求的原片与导出所需原片；
5. 非当前项目与后台预取。

切换项目、拖拽播放头或用户开始导出时，低优先级任务可暂停；已下载字节必须保留，恢复时继续而非重头下载。

## 10. 删除与数据完整性

### 10.1 客户端不可用状态

所有消费 `mediaId` 的 UI 必须使用 §9.2 的唯一 `AssetReadiness` 结果；不得另行把“找不到本地文件”简化为布尔值。这样下载中仍可保留已就绪代理，而 `unavailable` 也能被精确区分：

- `unavailable` clip 仍可选中、移动、裁切、删除、重新绑定；属性面板只隐藏依赖媒体探测的能力，绝不改变 React Hook 顺序。
- `deleted` 是正常业务状态：Service 在 Manifest 与 `GET Asset` 中返回墓碑，时间线显示“资源已删除”；不能把它提示成网络失败或素材丢失。
- `not-found` 只表示数据完整性异常（Manifest 与 `GET Asset` 都没有记录），要显示素材 ID 与“重新绑定”操作。
- `offline`、`queued` 和 `downloading` 不是数据丢失，必须区分展示。

### 10.2 删除协议

1. 删除 Asset 时 Service 结束活跃上传/生成 lease，删除内容寻址文件，并将 Asset `status` 写为 `deleted`。
2. 即使仍有 `ProjectAssetLink` 或时间线 clip，也不拒绝删除；这些引用继续指向同一个 `assetId`。
3. Service 保留最小墓碑（`id`、名称、类型、删除时间、状态与项目绑定），`GET Asset` 与 Manifest 均返回它；`GET content` 返回结构化 `410 asset_deleted`。
4. 客户端遇到墓碑显示“资源已删除”，允许删除 clip 或从 Assets 选择新素材重新绑定；不尝试自动恢复或伪造内容。
5. 本期不提供回收站、多版本或恢复功能；若未来加入，必须保留 `assetId` 并另行定义 Assets 生命周期 RFC。

### 10.3 数据完整性检查

- 项目加载时验证每一个 `mediaId` 在 ProjectAssetLink 和 Manifest 中可见；`deleted` 是有效、可渲染的墓碑状态，不是完整性错误。
- 项目保存和导出前再次验证；导出聚合 `deleted` 与其他不可用 clip，定位问题但不会使编辑器整体崩溃。
- 只有“时间线有引用但 ProjectAssetLink/Asset 墓碑均缺失”才是完整性错误；Service 应记录诊断，客户端提供重新绑定。

## 11. 个人使用的安全与隐私

1. local-first 默认将用户资产留在本机 Daemon 数据根，不因访问 `app.recut.video` 而自动上传云端。
2. App 只通过已连接的 `recut.assets` 使用素材，不从页面 URL 推断 Service 地址，也不访问其他 origin 的浏览器存储。
3. 上传在 Service 校验 MIME、尺寸、内容哈希与磁盘配额后才标记 `completed`。

## 12. 代码实施方案

本节按实际文件和调用方向拆分，目的是让实现保持一条数据流：

```text
Service media_assets ── Host bridge ── recut.assets SDK ── AssetCache(OPFS) ── Timeline / Preview / Export
```

浏览器缓存绝不反向写成项目或素材的真相；项目保存也不再回退到 IndexedDB。

### 12.1 Service：让删除成为墓碑，而不是 404

| 文件 | 修改 | 核心实现 |
|---|---|---|
| `service/media/types.go` | 扩展 `MediaAsset` | 增加 `DeletedAt *time.Time`（JSON `deletedAt`）；`status="deleted"` 时仍返回 ID、名称、类型、哈希与项目绑定。 |
| `service/project.go` | 扩展 `media_assets` schema | 增加 `deleted_at text not null default ''`；启动 schema upgrade 只补列，不迁移旧浏览器文件。 |
| `service/media/assets.go` | 扩展 `assetColumns` 与扫描 | 把 `deleted_at` 纳入所有 `select`、`scanAssetRow` 和 JSON DTO；`ListAssets(projectID)` 保留 `deleted` 行。 |
| `service/media/assets.go` | 重写 `DeleteAsset` | 在一个 SQLite transaction 中：终止可终止 job → `update media_assets set status='deleted', deleted_at=?, updated_at=?` → 保留 `media_asset_projects` → 写 `media_asset_events`。不再删除 `media_assets`、`media_asset_projects`、cover/Agent 引用。内容文件由独立 `removeContentIfUnreferenced(hash)` 在提交后处理。 |
| `service/media/assets.go` | 调整哈希去重 | `persistImportedFile` 的去重查询只命中 `status='completed'`。命中 `deleted` 的相同 hash 必须创建新 Asset，不能复活旧的已删除引用。 |
| `service/media_server.go` | 内容交付 | `getMediaAssetContent` / parts handler 在打开文件前检查 `status`；`deleted` 返回 HTTP `410` 和 `{ code: "asset_deleted", assetId }`。`getMediaAsset` 与列表仍返回墓碑。 |
| `service/media_server.go` | SSE | `streamMediaAssetEvents` 删除“读取失败即跳过”的隐含删除分支；墓碑能作为 `asset.updated` 发给所有客户端。 |
| `service/media_test.go`、`service/media_events_test.go` | 回归 | 断言“被 clip 引用的 Asset 删除后：元数据 200 且 status=deleted、content 410、项目列表仍含它、SSE 收到 deleted”。 |

删除的伪代码必须保持短小：

```go
func (m *MediaService) DeleteAsset(id string) error {
    return m.withAssetTx(id, func(tx *sql.Tx, asset MediaAsset, now time.Time) error {
        if asset.Status == "deleted" { return nil }
        if err := markAssetDeleted(tx, id, now); err != nil { return err }
        return recordAssetEvent(tx, id, now)
    })
}
```

`removeContentIfUnreferenced` 只依据 `content_hash` 查仍为 `completed` 的记录；它不能删除元数据墓碑，也不能接触项目引用。这样同 hash 的另一个 Asset 不会被误删。

### 12.2 Host：桥接平台能力，不让 iframe 猜 Service

现有 `web/app/projects/[id]/project-detail-client.tsx` 和 `web/app/workspace-app/[appID]/standalone-app-client.tsx` 各自处理 MessageChannel。实现时抽取 `web/lib/recut-assets-bridge.ts`，让两个宿主共用同一组端口处理器：

```ts
type AssetsRequest =
  | { type: "assets.get"; input: { assetId: string } }
  | { type: "assets.list"; input: { projectId: string } }
  | { type: "assets.upload"; input: { projectId: string; file: File } }
  | { type: "assets.attach"; input: { projectId: string; assetId: string } }
  | { type: "assets.delete"; input: { assetId: string } }
  | { type: "assets.content-url"; input: { assetId: string } }
  | { type: "assets.thumbnail-url"; input: { assetId: string } }
  | { type: "assets.proxy-url"; input: { assetId: string } };
```

实现规则：

1. 宿主已有 Service 连接是前置条件；没有连接时页面不创建 iframe，也不会发出 `recut.ui.connect`。
2. `assets.upload` 在宿主中用 `FormData` 调用既有 `POST /v1/media/assets`，成功后紧接 `POST /v1/media/assets/{id}/attach`。任一步失败即回复 error，绝不让 iframe 自行落盘为“成功素材”。
3. `assets.list` 代理既有 `GET /v1/media/assets?projectId=…`，把 `MediaAsset[]` 包成 `AssetManifest`；`deleted` 不过滤。
4. URL 类请求由宿主从已连接 Service 产生可访问能力 URL；App 只拿到结果，不接触 endpoint 配置。首期可以是受 Service CORS 保护的 URL，后续签名 URL 属于传输层升级，不阻塞本 RFC。
5. 增加 `assets.updated` 宿主事件转发，复用 `GET /v1/media/events` 的 cursor/SSE；iframe 收到墓碑后立即刷新对应缓存状态。

实现此共享 bridge 时，必须同步更新 `web/app/projects/[id]/README.md`、`web/app/workspace-app/[appID]/README.md`、`web/public/app-standard.md` 和中英文 SDK 文档，防止平台 SDK 契约与实现分裂。

### 12.3 iframe SDK：新增 `recut.assets`，移除 location 依赖

`apps/editor/ui/src/recut/sdk.ts` 是 editor 的唯一通信边界，按以下方式修改：

1. `RequestType` 加入上一节的 `assets.*` 请求；保留现有 `media.pick`，它仍用于打开全局素材选择器。
2. 在 `recut` 导出对象新增 `assets` 命名空间，逐项映射 MessagePort call，并为返回值声明 `Asset`/`AssetManifest` 类型。
3. 删除 `mediaContentURL` 与 `mediaPartURL` 对 `window.location.origin` 的依赖；所有调用点改为 `await recut.assets.contentURL({ assetId })` 等。
4. `apps/editor/ui/src/media/recut-assets.ts` 的导入逻辑改为 `recut.assets`；如果选择器返回已有 `assetId`，不再把它下载成新的 `File` 后重新导入为另一份 Asset。
5. 同一 SDK 契约后续抽到平台共享包；本期至少让 editor、`app-standard.md` 与 SDK 文档一致，其他 App 可按需接入。

### 12.4 编辑器类型和管理器：从 `File` 真相转为 `AssetRef`

当前 `apps/editor/ui/src/media/types.ts` 的 `MediaAsset` 强制包含 `file: File`，`MediaManager` 又经 `StorageService` 把该文件写入 OPFS。这是 origin 耦合的根。

替换为两层类型：

```ts
type AssetRef = {
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  status: "completed" | "deleted" | "failed" | "queued" | "running";
  hasAudio?: boolean;
};

type CachedAsset = {
  assetId: string;
  contentHash: string;
  thumbnailURL?: string;
  previewURL?: string;
  originalURL?: string;
  downloadedBytes: number;
  totalBytes: number;
};
```

- `MediaManager` 只保存 `AssetRef[]` 与就绪状态，不保存 `File`。
- `StorageService.saveProject/loadProject` 删除“平台失败则回退 IndexedDB 项目”的分支；桥断开直接抛出宿主连接错误。
- `StorageService` 中 `getProjectMediaAdapters`、`saveMediaAsset`、`loadAllMediaAssets`、`deleteMediaAsset` 的职责缩为 `AssetCache` 的 OPFS 读写，不再拥有项目/素材登记。
- 新建 `apps/editor/ui/src/media/asset-cache.ts`：只处理 `(assetId, contentHash)` 目录、`*.part` 原子续传、Object URL 生命周期和配额淘汰。
- 新建 `apps/editor/ui/src/media/asset-readiness-store.ts`：以 `assetId` 为键维护 §9.2 的 `AssetReadiness`，公开 `ensureThumbnail`、`ensurePreview`、`ensureOriginal`、`retry`、`evict`。每个下载任务用 `AbortController`，同一个 key 只允许一个 in-flight Promise。

核心下载函数保持单一职责：

```ts
async function ensureCached({ asset, tier }: { asset: AssetRef; tier: "thumbnail" | "proxy" | "original" }) {
  const cached = await cache.open({ assetId: asset.id, contentHash: asset.contentHash, tier });
  if (cached) return cached;
  const url = await recut.assets.contentURL({ assetId: asset.id });
  return cache.resumeFetch({ key: cacheKey(asset, tier), url, signal });
}
```

真实实现必须按 tier 调用对应 SDK URL，使用 `Range: bytes={cachedBytes}-` 并在 hash 改变时废弃旧目录；上例只表达职责边界。

### 12.5 时间线、属性和导出：消费 readiness，不自行查 File

| 调用点 | 改动 |
|---|---|
| `timeline/components/timeline-element.tsx` | 用 `useAssetReadiness(element.mediaId)` 渲染名称、骨架、分阶段进度、`资源已删除` 卡片；点击始终调用统一选择处理。 |
| `components/editor/panels/properties/index.tsx` 与 `registry.tsx` | 继续把 `locale` 从组件显式传给纯配置；同时接收可选 `AssetRef`，在 `deleted/downloading` 时只隐藏依赖媒体探测的字段。不可在 builder 中新增 Hook。 |
| `preview/*` 与 `services/video-cache/*` | 只在 `preview-ready` 或 `ready` 时取得 `previewURL/originalURL`；收到 `deleted` 或 hash 改变立即释放 Object URL 和解码 sink。 |
| `commands/media/add-media-asset.ts` | 先 `await recut.assets.upload`，再以服务端返回 ID 执行插入 clip；失败时不写 timeline。 |
| `commands/media/remove-media-asset.ts` | 删除全局 Asset 只调用 SDK 删除能力（补充 `assets.delete`）；命令完成后由 `assets.updated(deleted)` 更新所有引用 clip。 |
| export pipeline | 预扫描所有 `mediaId`：`deleted` 直接列在“资源已删除”；`preview-ready` 触发 `ensureOriginal` 并聚合 Loading；全部 `ready` 后才开始编码。 |

重新绑定不修改旧 Asset：上传/选择新的 `AssetRef` 后，只执行一个原子时间线命令，将目标 clip 的 `mediaId` 换成新 ID；旧的 `deleted` 墓碑继续保留给其他引用。

### 12.6 实施顺序与可提交切片

1. **Service tombstone**：schema、DTO、DeleteAsset、content 410、SSE 和 Go 测试。此切片独立可发布。
2. **Host + SDK**：共享 bridge、`recut.assets.get/list/upload/attach/*URL`、SDK 文档和 host 测试；不改 editor 行为。
3. **编辑器资产类型**：引入 `AssetRef`、删除项目/素材的 IndexedDB 回退、让 MediaManager 使用 Service 列表。
4. **OPFS Cache**：实现 cache/store/readiness，先接缩略图与 proxy，再接原片 Range 续传和配额淘汰。
5. **体验接线**：时间线 Loading/Deleted 卡片、属性面板安全降级、预览/导出准备 UI、重新绑定。
6. **跨入口回归**：同一 Service 下切换入口、清缓存、刷新续传、删除引用资产、离线缓存等全链路测试。

每一切片都保持“项目和 Asset 真相在 Service”的不变量；不能以临时 IndexedDB 回退换取表面可用。

## 13. 分阶段实施

### Phase 0：止血与观测

1. 修复所有缺失素材点击路径，统一 `ResolvedAsset` 降级状态，保证不崩溃。
2. 在项目加载、保存与导出时记录缺失 Asset 的结构化诊断。
3. 禁止新代码把 OPFS/IndexedDB 作为唯一媒体登记来源。

### Phase 1：确立权威 Assets

1. 完善 `media_assets`、项目绑定和内容寻址文件根的事务边界。
2. 补齐 Asset 状态、`contentHash`、Range/ETag，以及引用与删除墓碑的事务语义。
3. 新增项目 Asset Manifest API，并在宿主 SDK 注入 `assetsEndpoint`。
4. 编辑器及其他 App 的媒体 URL 全部改由 SDK 解析，不再依赖 `window.location.origin`。

### Phase 2：OPFS 缓存收敛

1. 实现以 `(assetId, contentHash)` 为键的缓存索引、分块下载、代理/缩略图优先级和可观测进度。
2. 将旧 `StorageService` 的浏览器持久化降级为离线缓存与临时上传恢复，移除其项目/资产真相职责。
3. 实现 §9 的逐片段 Loading、进度恢复、播放头优先调度与导出前资源准备 UI。
4. 增加配额管理与可解释的缓存清理 UI。

### Phase 3：跨入口与跨设备验证

1. `localhost`、`app.localhost`、`app.recut.video` 接入同一 Assets Endpoint 的契约测试。
2. 新浏览器/新设备冷缓存、已缓存离线和网络中断续传验证。
3. 为将来的远程同步增加设备授权和冲突策略 RFC，不在本期隐式实现。

## 14. 验收与测试矩阵

| 层 | 场景 | 断言 |
|---|---|---|
| Service 单测 | 上传、续传、哈希去重、绑定、删除 | Asset/链接/内容写入原子；有引用时仍删除内容并返回 `deleted` 墓碑。 |
| Service 单测 | Manifest、Range、ETag | 相同 hash 稳定命中；断点下载可恢复。 |
| 编辑器单测 | `ResolvedAsset` 的四种状态 | 缺失素材可选中，属性面板与菜单不抛异常。 |
| 浏览器 E2E | 同设备切换 `localhost` 与 `app.localhost` | 第二入口读取相同项目和 Asset；只发生缓存冷启动。 |
| 浏览器 E2E | 清理 OPFS 后重新打开 | 项目不变，素材重新下载，时间线不空白。 |
| 浏览器 E2E | 冷缓存大视频打开项目 | 时间线先可编辑；各片段独立显示真实 Loading 进度；代理就绪后可播，不等待原片。 |
| 浏览器 E2E | 下载中选择/拖拽/刷新 | 选区和属性面板稳定；刷新后从已下载字节续传，不重头下载。 |
| 浏览器 E2E | 离线新设备/旧设备 | 已缓存正常预览；未缓存显示可恢复提示。 |
| 浏览器 E2E | 删除仍被时间线引用的素材 | clip 保留并稳定显示“资源已删除”；可重新绑定或删除片段，点击不崩溃。 |
| 回归 | 导出含缺失素材 | 导出前列出明确缺失项，绝不悄悄输出空画面。 |

## 15. 开放问题

1. **大文件代理生成位置**：首期可由客户端生成代理并缓存；长期应由 Assets Service 生成可复用代理还是维持客户端派生，需按资源与个人设备性能权衡。

## 16. 成功标准

当以下语句全部成立时，本 RFC 才算完成：

> 用户的原始素材只因 Assets Service 中的正式删除或用户明确移除而消失；换域名、换浏览器、清理缓存、刷新页面或切换设备，只会改变下载速度，不会改变项目所引用的素材事实。
