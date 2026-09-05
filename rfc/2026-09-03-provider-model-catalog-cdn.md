<!--
 * [INPUT]: service/media 现有 Provider 架构（catalog.go 声明式硬编码目录、config.go 凭据/路由、
 *          jobs.go / model_providers / providers/* 协议适配器、jobs_atlas.go / jobs_skymind.go）；
 *          cdn/ 既有 R2 分发模式（buckets/{audio,effects,fonts,voices} + Makefile sync + catalog.json
 *          CDN-first 回退内嵌的读取纪律，见 editor library_browse / audio presets）；
 *          web/components/settings-panel.tsx 的「连接 Provider → 选用途模型」交互；
 *          rfc/2026-08-24-skymind-token-api-provider.md 确立的凭据级 modelOverrides 稳定覆盖面。
 * [OUTPUT]: Provider 模型目录（Model Catalog）上 CDN 的 RFC：cdn/providers/<provider>.catalog.json
 *          单一信息源、make sync-models 管理员同步工具、服务端 CDN-first + 内嵌种子回退的目录加载、
 *          模型参考预算/输出参数从代码 switch 迁入目录契约、设置面板按「Provider · Model」清晰展示。
 * [POS]: rfc 设计稿；不修改任何代码。新增 Provider 仍需写协议适配代码（不可避免），
 *        但 Provider 的模型清单/参数/预算全部走网络目录，新增模型零代码发布。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
-->

# RFC：Provider 模型目录上 CDN（Model Catalog as Data）

- 状态：**P0 已实施（2026-09-03）**——`MediaModel` 增加 `Status/ReferenceBudgets/Meta`、`MediaProvider` 增加 `Revision/UpdatedAt/Source/Extensions`；种子目录迁入 `catalog_seed.go`；`modelByID/providerByID` 改为 `atomic.Pointer` 快照 + by-ID 索引；三个参考预算 switch 删除，替换为解析 `ReferenceBudgets` 的通用校验器（`service` 全量测试绿）。**P2 核心已实施（2026-09-03）**——双栏 `ModelPicker`（搜索 + Provider 分组 + 详情卡：凭据状态/计费/输入/输出/参考上限/文档链接），候选仅限已连接 Provider + 本机免 key 项，Codex 前端注入移除；`CustomSelect` 支持可选 `searchable`/`group`。**P1 同步工具已实施（2026-09-04）**——`cdn/scripts/fetch-models.mjs` + 三个 fetcher（Atlas 全量 + 三层推断 + 上游 pricing 自动归一、MiniMax 策展 + voices 扩展段、Skymind API + 策展段）+ `make sync-models / reindex-providers`，`sync-models` 缺省全量、单失败不阻塞、人工字段保护（逐字段胜出、pricing 随上游流动）实测通过。**同步工具两阶段化（2026-09-04）**——fetcher 契约从单 `fetch()` 拆为 `fetchRaw()`（上游原始模型清单原样落盘 `cdn/buckets/providers/raw/<id>.raw.json`，留档审阅 + 支持离线重跑）与 `transform()`（原始清单 + 策展/价格/修正 sources → 富 meta catalog）；`--fetch-only` / `--transform-only` 支持分阶段执行；meta 透传上游 `description`（summary）与 `context_length`（contextLength）；`raw/` 随 `make sync PREFIX=providers` 一并上传（CDN 同时分发 raw 与 transformed）。**P1 目录加载器已实施（2026-09-04）**——`service/media/catalog_loader.go`：daemon 启动路径显式开启（`main.go` → `StartProviderCatalogLoader`），本地缓存（`<dataRoot>/cache/providers/`）同步加载立即生效 + 后台 CDN 首发/6h 刷新，sha256 完整性锚点 + schema/前缀/capability/status/预算谓词加载期校验，CDN 按 provider 整体覆盖种子、`codex`/`local-audio` 永不参与，任何失败静默保留当前目录绝不回退；测试与 MCP 短命进程零网络零落盘；fixture 驱动 loader 单测（`catalog_loader_test.go`）。**待实施**：P2 凭据前置引导/E2E、P3 skymind 目录化运维（§8）
- 作者：Recut
- 日期：2026-09-03
- 决策范围：
  1. 新增 CDN 目录前缀 `cdn/providers/`：每 Provider 一份 `catalog.json` + 一份全局 `index.json`，由管理员经 `make sync-models` 同步维护
  2. `service/media` 目录加载改为 **CDN-first + 内嵌种子回退**（复用 effects/voices 已验证的模式），模型清单、输入/输出参数、参考素材预算全部数据化
  3. 设置面板展示升级：按能力分组的模型卡显示「Provider · Model · 关键参数」完整配置路径
  4. 明确扩展边界：**新增 Provider = 代码（协议适配器 + 种子目录条目）；新增/更新模型 = 只改目录数据，零代码零发版**
- 非目标：不改变凭据（BYOK）、Route、Job 调度、幂等纪律；不做用户自建目录；本期不做目录签名（见 §10 风险）
- 关联：[Skymind Token API Provider](./2026-08-24-skymind-token-api-provider.md)（modelOverrides 先例）、[ARCHITECTURE.md · Media Platform](../ARCHITECTURE.md)、`cdn/Makefile`、`service/media/catalog.go`

## 0. 问题与结论摘要

现状：`catalog.go:27-48` 硬编码 8 个 Provider 共 ~15 个模型；每上一个新模型（哪怕只是同协议下换一个 `APIModelID`）都要改 Go 代码、发版、用户升级。参考素材预算（Seedance 9 图/3 视频/3 音频等）也硬编码在 `validateModelReferences` 的 switch 里，目录数据与校验逻辑分裂两处。设置面板选模型时只显示模型名，用户分不清「同一能力下这个模型来自哪个 Provider、走哪把 key、参数约束是什么」。

| 决策点 | 结论 |
|---|---|
| 目录存放 | R2 `providers/` 前缀：`https://cdn.recut.video/providers/index.json` + `providers/<provider-id>.catalog.json`；本地暂存 `cdn/buckets/providers/` |
| 更新工具 | `make sync-models PROVIDER=minimax`：从上游 API/文档拉取模型清单 → 归一化为目录 JSON → 管理员人工审阅 diff → `make sync PREFIX=providers` 上传 |
| 运行时加载 | 服务启动 + 每 6h 刷新：CDN index → 按 sha256 拉各 Provider catalog → 校验 schema → 与内嵌种子**按 (provider, modelID) 合并**（远端覆盖种子）；CDN 不可达时静默用种子，绝不因目录失败阻断生成 |
| 数据化范围 | 模型清单、InputModes/OutputModes、参考预算（kind/mime/size 上限）、EditModelID、展示名/文档链接/弃用标记全部进目录；`referenceKindsFor` 等能力级兜底保留在代码 |
| 不数据化 | Protocol 适配器、凭据校验、Job 调度、per-provider 请求构造（`jobs_atlas.go`/`jobs_skymind.go`/`jobs.go` minimax/elevenlabs 分支）——新增 Provider 仍需写代码 |
| UI 展示 | 模型卡副标题 `ProviderName · 模型名`，附能力徽章、参考预算摘要、弃用/新标记；按「已有凭据的 Provider 优先」排序 |
| 目录 ID 稳定性 | 模型平台 ID 保持 `provider/apiModelID` 不变（Route/Job 引用它的兼容性不动）；上游 ID 漂移仍走凭据级 `modelOverrides`，目录只是默认值 |

## 1. 现状与差距

### 1.1 现有链路（本 RFC 的改造基座）

```text
catalog.go: mediaProviders []MediaProvider   ← 全部硬编码，发版才能变
    │  modelByID / providerByID（全量线性扫描）
    ▼
config.go: BYOK 凭据（model_overrides_json 凭据级 APIModelID 覆盖）
    ▼
Route（media_routes: capability → modelId + credentialId）
    ▼
jobs.go: validateModelReferences / validateModelReferenceSpec   ← 模型预算硬编码 switch
    │  execute 按 credential.Provider switch 分派协议（minimax/elevenlabs/atlas/skymind…）
    ▼
providers/{atlas,skymind} + model_providers 图片策略注册表
```

### 1.2 差距清单

| # | 差距 | 影响 |
|---|---|---|
| G1 | 新模型必须改 `catalog.go` + 发版；三个主力 Provider（minimax / atlas-cloud / skymind-token 国内中转）上游模型迭代快（MiniMax speech-2.8 系列、Atlas 上架的 Seedream/Grok Imagine、网关渠道版本漂移） | 上架滞后数天到数周 |
| G2 | 模型约束（参考预算、mime/size）与目录数据分离在 `catalog.go` 两个 switch | 新模型容易漏配，出错只在上游收费后才暴露 |
| G3 | 设置面板模型卡信息弱：无 Provider 归属强调、无参数/预算说明，多 Provider 同能力时难以对比 | 用户配错路由（如用 Atlas key 选了 MiniMax 模型）只能靠报错发现 |
| G4 | `Available/Configurable` 等标记无人维护，没有弃用/灰度语义 | 下线模型无提示，Job 到上游才失败 |

### 1.3 已验证的先例（直接复用其纪律）

- **effects / audio catalog**：`library_browse` 走 CDN `catalog.json` → 回退包内 catalog → 回退内嵌最小集，`source` 字段标注来源。本 RFC 完全照搬这条链。
- **voices presets**：`make voices-sync` 以脚本再生成单一信息源 + CDN 暂存，管理员上传。`sync-models` 是同一工具形态。
- **modelOverrides**（Skymind RFC 确立）：凭据级覆盖是上游 ID 漂移的唯一稳定面，目录只提供默认值。

## 2. 目录数据契约（CDN 侧）

### 2.1 文件布局

```text
cdn/buckets/providers/
  index.json                      # 全局索引：版本、各 provider 摘要 + sha256
  minimax.catalog.json
  atlas-cloud.catalog.json
  skymind-token.catalog.json
  openai.catalog.json             # 其余 provider 同构，逐步迁
  ...
```

分发后 `https://cdn.recut.video/providers/index.json`。`providers/` 加入 cdn/Makefile 既有 `upload/sync/list/check` 的合法前缀集。

### 2.2 index.json

```json
{
  "schema": "recut.provider-catalog@1",
  "updatedAt": "2026-09-03T08:00:00Z",
  "providers": [
    {
      "id": "minimax",
      "protocol": "minimax",
      "catalogUrl": "https://cdn.recut.video/providers/minimax.catalog.json",
      "sha256": "…",
      "revision": 14,
      "modelCount": 6
    }
  ]
}
```

`index.json` 是完整性锚点：sha256 防止 CDN 边缘缓存新旧 catalog 错配（catalog 与 index 的更新顺序是 **先传 catalog、后传 index**，index 是发布点）。

### 2.3 单 Provider catalog

```json5
{
  "schema": "recut.provider-catalog@1",
  "provider": {
    "id": "minimax",
    "name": "MiniMax",
    "protocol": "minimax",
    "defaultApiBase": "https://api.minimaxi.com"
  },
  "updatedAt": "2026-09-03T08:00:00Z",
  "models": [
    {
      "id": "minimax/speech-2.8-hd",
      "apiModelId": "speech-2.8-hd",
      "name": "MiniMax Speech 2.8 HD",
      "capability": "speech.generate",
      "status": "stable",
      "inputModes": ["text"],
      "outputModes": ["voice", "language", "speed", "format"],
      "referenceBudgets": [],
      "meta": {
        "docsUrl": "https://platform.minimax.io/docs/t2a",
        "summary": "中文旁白主力，HD 音质按字符计费",
        "pricing": "≈ $100 / 百万字符（HD）",
        "tags": ["zh", "narration"]
      }
    },
    {
      "id": "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video",
      "apiModelId": "bytedance/seedance-2.0-mini/reference-to-video",
      "name": "Seedance 2.0 Mini · 多参考视频",
      "capability": "video.generate",
      "status": "stable",
      "inputModes": ["text", "image", "video", "audio"],
      "outputModes": ["durationSeconds", "resolution", "aspectRatio", "bitrateMode", "generateAudio", "seed", "watermark", "returnLastFrame"],
      "referenceBudgets": [
        {
          "requirements": ["images+videos>=1"],
          "maxImages": 9, "maxVideos": 3, "maxAudios": 3,
          "image": { "maxBytes": 31457280, "mimes": ["image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff", "image/gif", "image/heic", "image/heif"] },
          "video": { "maxBytes": 52428800, "mimes": ["video/mp4", "video/quicktime"] },
          "audio": { "maxBytes": 15728640, "mimes": ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3"] }
        }
      ]
    }
  ],
  "extensions": {
    // Per-provider 扩展数据：schema 不约束内部结构，服务端按 provider 透传给对应能力面。
    // 例 1：MiniMax 系统音色缓存——设置面板可在未连接凭据时预览音色库概况，
    //       连接后仍以 ListVoices 实时拉取为准，缓存只做展示兜底。
    // 例 2：未来可挂 Atlas 的模型测速/可用性采样、网关渠道版本备注等。
    "voices": [
      { "id": "male-qn-qingse", "name": "青涩青年音色", "category": "system", "description": "青涩青年音色…" }
    ]
  }
}
```

契约要点：

- **`model.id` 全局唯一且不可变**（`provider/apiModelID`），是 Route/Job/参考数据的引用身份；目录改版绝不复用或改名旧 ID。
- **`status`**：`stable | new | deprecated | retired`（缺省 = stable）。`deprecated` 在 UI 打标并在 Job 提交时出诊断日志；`retired` 的模型目录里仍保留条目（供历史 Route 解析）但拒绝新建 Route。
- **`referenceBudgets`** 取代 `validateModelReferences` / `validateModelReferenceSpec` 中的 per-model switch（§5）。结构必须能表达现有全部约束：`requirements` 谓词列表（如 `images+videos>=1`、`videos==0`）、每 kind 数量上限、每 kind mime/size 白名单；无预算 = 能力级兜底。
- **`meta`** 全部可选，仅供 UI 展示，服务端不消费。
- **`extensions`** 仅约束「必须是对象」；内部结构 per-provider 自定义，schema 校验器不深入。服务端以 `map[string]json.RawMessage` 透传，消费方（如设置面板的音色预览、未来某 App 的 capability 面）自行解析。扩展数据损坏**不影响模型目录生效**——解析失败只记诊断。

## 3. `make sync-models`：目录同步工具（可插拔 per-provider fetcher）

每个 Provider 的上游数据源、认证方式、归一化逻辑都不同，同步工具采用**注册表 + 单文件 fetcher** 结构：`cdn/scripts/fetchers/<provider>.mjs` 各自导出统一的 `fetch(ctx)` 接口，入口脚本按注册表分派。默认不带参数**同步全部已注册 provider**，`PROVIDER=x` 只跑单个。

```make
sync-models: ## 从上游拉取 provider 模型清单到 cdn/buckets/providers/（缺省全部；PROVIDER=minimax 只跑单个）。
	node scripts/fetch-models.mjs $(PROVIDER) $(ARGS)

reindex-providers: ## 重算各 catalog sha256 并重建 index.json（发布前最后一步）。
	node scripts/fetch-models.mjs --reindex-only
```

### 3.1 Fetcher 接口契约

```js
// cdn/scripts/fetchers/<provider>.mjs
export default {
  id: "minimax",
  // 返回 { provider: {...}, models: [...], extensions: {...} }，符合 §2.3 契约
  async fetch({ sourcesDir, env, previousCatalog }) { ... }
}
```

- `previousCatalog` 传入现有 catalog（若有），fetcher 必须**保护人工字段**：对已存在条目只更新结构字段（apiModelId/inputModes/outputModes），不触碰 `meta`/`status`/`referenceBudgets`/`extensions` 的人工值；新条目带 `status: "new"` 与空预算默认值。
- fetcher 失败只让**该 provider** 报错退出（默认全量模式下其余 provider 继续跑，最终汇总非零退出码），互不阻塞。
- **脚本只生成候选，绝不自动上传**；`extensions` 大段（如 MiniMax 音色缓存）同样受人工字段保护，且 `--reindex-only` 不触发 fetch。

### 3.2 三个主力 Provider 的 fetcher 设计

> 实现注记（2026-09-03，`cdn/scripts/fetch-models.mjs` + `cdn/scripts/fetchers/`）：策展源以 **JSON** 落盘（`cdn/sources/*.json`，避免引入 yaml 依赖）；共享逻辑（人工字段保护 `mergeCatalog`、schema 校验、sha256 index）在入口脚本。已实测：Atlas 全量同步拉到 6 个媒体模型（4 图像含上游自动价格、2 策展视频）+ MiniMax 策展 2 模型；skymind `/v1/models` 无 key 时 401、走策展段（设 `SKYMIND_API_KEY` 后自动合并）。

| Fetcher | 数据源 | 策略 | 说明 |
|---|---|---|---|
| `fetchers/minimax.mjs` | 人工策展 `sources/minimax.models.json` + 可选 `POST /v1/get_voice`（需 `MINIMAX_API_KEY`）刷新 `extensions.voices` | **策展为主 + 扩展段可选在线刷新** | MiniMax 无公开 `/v1/models` 端点；无 key 时保留现有 voices 缓存不动 |
| `fetchers/atlas-cloud.mjs` | `GET /api/v1/catalog/models`（媒体模型主源：pricing/input/output_modalities/description/tags，2026-09-04 实测 419 条含 image 124 + video 206 + audio 20）+ `GET /api/v1/models`（补充源：profile 长描述/readme/封面）+ `sources/atlas-cloud.models.json`（策展段，含 referenceBudgets）+ `sources/atlas-cloud.pricing.json`（价格兜底）+ `sources/atlas-cloud.overrides.json`（修正面） | **媒体模型全量同步 + 上游 pricing 自动归一**（image `$x/张`、video `$x/秒` 含分辨率分档）；**注意 `GET /v1/models` 是 LLM 列表、不含媒体模型，已弃用**；chat 类型排除，其余全量上架 |
| `fetchers/skymind-token.mjs` | `GET /v1/models`（new-api 网关，含 `supported_endpoint_types`）+ `sources/skymind-token.models.json` 策展段 | **API 拉取 + 策展段合并** | `/v1/models` 无 key 返回 401，仅用策展段；已知不含视频模型 → 视频走策展段 |

#### 3.2.1 Atlas Cloud 全量同步细则

Atlas 图片/视频模型持续上新，fetcher 采取「**全量拉取、规则归一、人工只做修正**」：

1. **全量拉取**：`GET /v1/models` 全部条目入目录（去重 by id），不与 allowlist 求交集；allowlist 文件废弃。
2. **能力推断（三层，实测校准）**：① 模态 `output_modalities` 含 image/video/audio 直接可信；② 名称启发式（`*image*`/seedream/imagine/flux → 图片；`*video*`/seedance/kling → 视频；`tts`/speech → 语音）——上游已知把图像模型 `output_modalities` 标成 `["text"]`；③ 策展段 `atlas-cloud.models.json` 优先级最高（上游列表缺失的 Seedance 等视频网关模型，人工维护含 `referenceBudgets`）。纯文本 LLM（无媒体能力）直接排除。
3. **价格合并（关键字段）**：上游 `pricing`（per-token 美元）自动归一化为「输入 $x/M · 输出 $y/M」展示串；`sources/atlas-cloud.pricing.json` 人工价格优先（如按张计费写 `≈ $0.03/张`）。**价格缺失的模型照常上架**（UI 隐藏计费行），可随时补。合并语义：`meta` 人工字段逐字段胜出，但 `pricing` 在人工未写时随上游定价流动（`fetch-models.mjs` 的 mergeCatalog 已实现，实测 summary/status 保留、价格可更新）。
4. **人工修正面**：`atlas-cloud.overrides.json` 只允许修正 `capability`/`inputModes`（推断纠错）、`name`/`summary`/`docsUrl`/`tags`（展示）与 `status`（下架/灰度）。
5. **下架消化**：上游消失的模型置 `status: "retired"`（保留条目供历史 Route 解析，UI 隐藏），不物理删除——避免 CDN 边缘缓存旧目录时模型闪断。

新增 Provider 的 fetcher = 新增一个 `<provider>.mjs`（入口按目录自动发现）+ 必要的 sources/*.json，其余流程零改动。

三个来源统一输出 2.3 契约的 JSON。流程：

```text
make sync-models                    # 全部 fetcher 顺序执行，单个失败不阻塞其余
make sync-models PROVIDER=atlas-cloud
  → fetcher.fetch() → 归一化（保护人工字段）→ 写 cdn/buckets/providers/atlas-cloud.catalog.json
  → git diff 供管理员审阅
管理员确认 → make reindex-providers（重算 sha256 + index.json）→ make sync PREFIX=providers
```

## 4. 服务端：目录加载与合并

### 4.1 `catalog_loader.go`（新文件，media 包内）

```go
type catalogSource struct {
    revision int
    updatedAt time.Time
    providers []MediaProvider   // 复用现有 DTO，扩展字段见 §4.3
}

func (m *MediaService) refreshCatalog(ctx) // 启动时同步加载一次 + 后台每 6h 刷新
```

加载链（照搬 effects catalog 纪律）：

1. 读本地缓存文件（`<dataRoot>/cache/providers/index.json`，上次成功结果）→ 立即可用
2. 后台 fetch CDN `index.json`（10s 超时）→ 校验 schema 版本 → 逐 provider fetch catalog → sha256 校验 → schema 校验（模型 ID 前缀必须等于 provider ID、capability 合法、budgets 可解析）
3. 校验通过 → 原子替换内存目录 + 写缓存文件；任何一步失败 → 保留当前目录并记诊断日志，**绝不回退到比当前更旧的目录**
4. CDN 与缓存均不可用 → 用编译期种子目录（现有 `mediaProviders` 字面量收进 `catalog_seed.go`）

**合并规则**：以 provider ID 为单位整体覆盖——CDN 有该 provider 的 catalog 则完全取代种子中该 provider 的模型清单（种子仅当 CDN 缺失该 provider 时兜底）。`codex` 与 `local-audio` 两个特殊 provider 不参与 CDN 目录（无网络语义），始终走代码。

### 4.2 并发与一致性

- 现有 `modelByID` / `providerByID` 改为读 `atomic.Pointer[catalogSource]` 快照（替换全量线性扫描可以顺手建 `map[string]MediaModel` 索引，模型量上到几百后必要）。
- 快照替换是原子的；进行中的 Job 在开始时已解析出 `MediaModel` 值拷贝，不受刷新影响。
- `refreshCatalog` 单飞（singleflight），后台定时与手动触发不并发。

### 4.3 DTO 扩展（types.go）

```go
type MediaModel struct {
    // …现有字段不变…
    Status           string            `json:"status,omitempty"`            // stable|new|deprecated|retired
    ReferenceBudgets []ReferenceBudget `json:"referenceBudgets,omitempty"`  // 取代 per-model switch
    Meta             *MediaModelMeta   `json:"meta,omitempty"`              // docsUrl/summary/pricing/tags，仅展示
}

type MediaProvider struct {
    // …现有字段不变…
    Revision  int    `json:"revision,omitempty"`
    UpdatedAt string `json:"updatedAt,omitempty"`
    Source    string `json:"source,omitempty"`   // cdn|seed，供 UI/诊断标注
}
```

## 5. 参考预算校验迁移

`catalog.go:203-264` 的 `validateModelReferences` / `validateModelReferenceSpec` / `validSeedanceReference` 三个 switch 全部删除，替换为解析 `ReferenceBudgets` 的通用校验器：

- 能力级兜底保留在代码（`referenceKindsFor`：image 只收 image 引用等），模型无预算时按能力兜底 + 拒绝一切超预算引用，行为与现状一致（无预算模型现在就是 switch 不命中 → 放行）。
- 校验器在目录加载时对每个模型预算做一次结构自检，坏数据在加载期报错而不是生成期。

## 6. 设置面板（web）

### 6.1 模型卡展示升级（G3）

`ModelRouteCard` 的模型列表按 provider 分组小节呈现；每张模型卡副标题改为完整配置路径：

```text
MiniMax · MiniMax Speech 2.8 HD          ← providerName · model.name（现状仅 model.name）
[语音生成] [中文/旁白] [NEW|DEPRECATED]   ← capability + meta.tags + status 徽章
参考：仅文本 · 计费 ≈ $100/M 字符         ← budgets 摘要 + meta.pricing（有值时）
```

- 无该 Provider 凭据的模型置灰并在点击时引导「连接 MiniMax」（现状是保存时才报 `need credential`，前移到选择时）。
- `status: deprecated` 的已配置 Route 显示迁移提示；`retired` 不出现在候选列表。
- providerGuidance 硬编码 i18n 键的 fallback 文案改为读 `meta.summary`（有 CDN 目录后每个模型自带中文简介，i18n 键只作为无 meta 时的兜底）。

### 6.2 API 不变

`GET /v1/media/providers|models|configurations` 响应结构不变（新增字段向后兼容），前端 store 无需迁移。

## 7. 新增 Provider 的边界（重申）

| 动作 | 需要代码？ | 说明 |
|---|---|---|
| 新增/更新/下线某 Provider 的**模型** | ❌ | 只改 catalog JSON，管理员 `sync-models` + 上传，用户 6h 内自动生效（或重启即时生效） |
| 调整模型**参考预算/输出参数** | ❌ | 同上 |
| 新增 **Provider**（新协议/新网关） | ✅ | ① `providers/<name>/` 线协议适配器或 `jobs.go` execute 分派分支 ② `catalog_seed.go` 种子条目 ③ Settings 面板 i18n 指导文案 ④ `cdn/sources/<name>.models.yaml` 策展源 |
| 新增**能力**（如 music.generate） | ✅ | 超出本期范围 |

适配器纪律不变：纯线协议、checkpoint 幂等、短超时轮询、终态立即回收字节。

## 8. 实施计划

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 | DTO 扩展 + `catalog_seed.go`（现状字面量迁移，行为零变化）+ 快照化 `modelByID/providerByID`；参考预算通用校验器替换三个 switch（现有全部模型测试不动、全绿） | `go test ./service/...` 全绿；Settings 面板行为无回归 |
| P1 | `catalog_loader.go` CDN-first 加载 + 本地缓存 + singleflight 刷新；`cdn/scripts/fetch-models.mjs` + `sources/*.models.yaml` + `make sync-models/reindex-providers`；`providers/` 前缀接入 cdn/Makefile | 断网/坏 JSON/坏 sha256 三种故障注入下服务正常用种子运行；minimax + atlas-cloud 两份目录实际上架 |
| P2 | Settings 面板展示升级（分组、路径副标题、状态徽章、预算/计费摘要、凭据前置引导） | 面板截图走查 + 弃用迁移提示 E2E |
| P3 | skymind-token 目录化（视频人工策展段 + `/v1/models` 拉取段合并）；`status` 生命周期接入 Job 诊断 | sync-models 对三 provider 全部可一键产出候选 |

P0 与 P1 可独立合入：P0 落地后目录即「结构数据化但来源仍是种子」，P1 才引入 CDN。

## 9. 测试

- **目录加载**：fixture 目录（合法/坏 schema/sha 不符/部分 provider 缺失）驱动 loader 单测；断网种子回退单测。
- **预算校验器**：现有 `validateModelReferences` 的全部用例改写为目录驱动（相同输入 → 相同拒绝信息），保证迁移等价。
- **sync-models**：归一化器单测（Atlas `/v1/models` 响应 fixture、new-api `supported_endpoint_types` fixture）；人工字段保护规则单测。
- **E2E**：RECUT_E2E 门控，CDN 目录上架一个新 MiniMax speech 模型 → 重启服务 → Settings 选择 → 生成成功，全程零代码变更。

## 10. 风险与开放问题

| 风险 | 缓解 |
|---|---|
| CDN 被投毒/劫持注入恶意目录 | P1 先用 sha256（防错配）+ schema 严格校验 + 预算结构自检；目录只影响「调哪个上游 API」，凭据与请求构造仍在代码，攻击面有限。签名（ed25519，公钥内嵌）留作 P2 可选加固 |
| 目录与代码能力不同步（目录出现代码不认识的 outputMode） | loader 校验：未知 capability 拒绝；未知 outputMode 保留但 UI 标 unknown，生成时按能力兜底白名单过滤 |
| 用户 Route 指向被 retired 的模型 | 保留目录条目供解析；Job 提交时出诊断并返回明确错误文案 |
| 上游 `/v1/models` 噪声大（Atlas） | allowlist 交集 + 人工策展字段保护，脚本永不全自动 |
| 开放问题：目录刷新对长驻 desktop 进程的生效时机 | 倾向 6h 定时 + 重启即时；是否需要「设置面板手动刷新目录」按钮，留 P2 决定 |
