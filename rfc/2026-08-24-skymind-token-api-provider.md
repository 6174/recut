<!--
 * [INPUT]: Skymind Token API（https://token-api.skymind.pro/docs，new-api 系企业 LLM 网关，
 *          文档为内嵌 OpenAPI 3.0.1 共 66 端点，Bearer sk- key 认证）；2026-08-24 用真实 API key
 *          完成的全量探测与 E2E 实测（gpt-image-2 文生图、doubao-seedance-2.0 文生视频、
 *          doubao-seedance-2-5-260628 参考图生视频，参考图走 R2 临时公网 URL，证据见
 *          output/skymind-e2e/，本地 gitignored）；service/media 现有 Provider 架构
 *          （catalog.go / config.go / jobs.go / jobs_atlas.go / jobs_scheduler.go /
 *          model_providers/ / providers/）；cdn/config.mjs + cdn/scripts/r2.mjs（R2 S3 兼容上传
 *          与 cdn.recut.video 自定义域分发，已实测 share/ 前缀公开可读）。
 * [OUTPUT]: 平台层对接 Skymind Token API 的 Provider RFC：三个模型（gpt-image-2 图片、
 *          Seedance 2.0 / 2.5 视频）的目录与协议适配设计、可配置化（APIBase / APIModelID /
 *          默认输出参数 / metadata 透传）、错误映射、与既有 Job 调度（durable lease + checkpoint
 *          幂等）的接线；以及为「参考素材必须公网 URL」而新增的平台级临时公网分享能力
 *          （Cloudflare R2 + CDN，7 天生命周期 TTL、不可猜测 token、可即时吊销）。
 * [POS]: rfc 的「Skymind Token API Provider + 临时公网分享」设计稿；不修改任何代码，
 *        获批后按 §9 分阶段实施并反向更新 ARCHITECTURE.md / service/media/README.md。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
-->

# RFC：Skymind Token API Provider（GPT Image 2 + Seedance 2.0/2.5）与临时公网分享

- 状态：**P0 已实施（2026-08-24/25）**——`skymind-token` provider（图片 `gpt-image-2` + 视频 Seedance 2.0/2.5）、`shares.go` 临时公网分享（R2 `share/` 前缀 + `media_shares` 账本 + 7 天 TTL）、`media_credentials.model_overrides_json` 均落地；经平台全链路真实 E2E 验证（`service/skymind_e2e_test.go`，RECUT_E2E_SKYMIN=1 门控）：文生图→生成图自动发布公网 URL→Seedance 2.5 参考图生视频→Seedance 2.0 文生视频，全部 completed、产物字节有效、usage/远端 task id 落 Asset metadata、分享显式吊销。P1/P2 未实施（§9）
- 作者：Recut
- 日期：2026-08-24
- 决策范围：
  1. 平台层（`service/media`）新增 `skymind-token` Provider：`gpt-image-2`（图片）、`doubao-seedance-2.0` / `doubao-seedance-2-5-260628`（视频）三个模型的目录、凭据、协议适配、错误映射与 Job 接线
  2. 新增平台级**临时公网分享**能力（`recut.share`）：把已完成 Asset 发布为 7 天 TTL 的不可猜测公网 URL，解决 Seedance 参考图/视频/音频「必须公网 URL」的硬约束
  3. 明确可扩展性边界：模型 ID 易变（带日期版本）→ 配置化；网关已有 TTS / 图片异步 / Kling / 即梦 / 火山原生 / 人像素材库等端点 → 只留协议适配扩展点，本期不接
- 关联：[ARCHITECTURE.md · Media Platform](../ARCHITECTURE.md)、[service/media/README.md](../service/media/README.md)、[AI 解说音频素材生命周期](./2026-08-21-ai-narration-audio-asset-lifecycle.md)（local-audio 无凭据 Provider 先例）、[Canonical Assets](./2026-08-16-canonical-assets-opfs-cache.md)

## 0. 结论摘要

| 决策点 | 结论 |
|---|---|
| 对接模式 | 完全复用现有 Provider Registry 五层结构（catalog 目录 → BYOK 凭据 → Route → `model_providers` 图片策略 / `providers/*` 协议适配器 → durable job 调度），新增 `skymind-token` Provider，**不新建任何平行机制** |
| 本期模型（3 个） | `gpt-image-2`（图片，同步 `/v1/images/generations`）；`doubao-seedance-2.0` 与 `doubao-seedance-2-5-260628`（视频，异步统一任务 `/openapi/v1/video/generations`） |
| 参考素材公网 URL | 新增 `recut.share`：R2（复用现有 Cloudflare 账号与 `cdn/scripts/r2.mjs` S3 工具链）+ CDN 自定义域，URL 形如 `https://share.recut.video/<128bit token>/<名>`；**TTL 落在存储侧**（R2 生命周期 7 天声明式过期，本地账本丢失也能自动收敛）；本地 `media_shares` 账本负责复用、吊销与审计 |
| 模型 ID 易变 | 上游模型 ID 带日期/渠道变体（实测 `2.5` 的真实 ID 是 `doubao-seedance-2-5-260628`，`seedance-2.5` 等常见写法全部 `model_not_found`）→ `APIModelID` 从硬编码改为**凭据级可覆盖**（`media_credentials` 增加 `model_overrides_json`） |
| 模型发现 | `GET /v1/models` 实测只含 chat/图片模型（37 个，含网关扩展字段 `supported_endpoint_types`），**不含视频模型** → 目录保持声明式 + 凭据保存时可选 reconcile（P1），不以 `/v1/models` 作为视频模型可用性判据 |
| 计费/幂等 | 上游按任务**预扣费**（实测 `insufficient_user_quota`：余额 ¥99.99 < 预扣 ¥1050 时提交即拒）→ 沿用 scheduler 既有纪律：提交结果与远端 task id 同事务 checkpoint，「未知提交」只查询不重发，绝不重复扣费 |
| 结果回收 | 实测视频结果 `video_url` 是火山 TOS **24 小时签名链接**（`X-Tos-Expires=86400`）→ 终态后立即下载；同时实测 `GET /openapi/v1/video/generations/{task_id}/content` 返回与 video_url **逐字节一致**（MD5 相同）的 mp4 流，作为首选回收通道 |
| E2E | 真实 key 真实扣费各一次全通过：文生图 ✅、sd2.0 文生视频 ✅、sd2.5 公网参考图生视频 ✅、R2 分享 URL 被上游成功消费 ✅、data URL 被拒（`invalid_reference_image_url`）✅。产物在 `output/skymind-e2e/`（gitignored） |

**尽量不动的现状**：`media_jobs` / `media_assets` / `media_task_leases` 表结构与调度纪律不动；图片/视频/语音三能力契约（`recut.image/video/speech.generate` + `jobId/assetIds`）不动；`model_providers` 策略注册表与 `providers/*` 适配器边界不动；Settings 面板既有「连接 Provider → 选择用途模型」交互不动。

---

## 1. 现状与差距

### 1.1 平台现有 Provider 模式（本 RFC 的扩展基座）

```text
mediaProviders 目录（catalog.go，声明式）
  MediaProvider{ID, Name, Protocol, DefaultAPIBase, Models[]}
  MediaModel{ID, APIModelID, EditModelID, Capability, InputModes, OutputModes, Available, Configurable}
        │
        ▼
BYOK 凭据（config.go，media_credentials 表：provider/name/api_base/secret_ciphertext）
  secret AES-GCM 加密；apiBase 空则回退 Provider.DefaultAPIBase
        │
        ▼
Route（media_routes 表：capability → modelId + credentialId，SettingsPanel 配置）
        │
        ▼
Job 编排（jobs.go：createJob → queued Asset → execute / submitXxx）
  图片：model_providers 注册表按 Provider ID 分派策略（atlas / openai / openai-compatible）
  视频：目前仅 Atlas 路径（jobs_atlas.go：Submit → 绑定 prediction ID → 短超时轮询 → fetchMedia）
  调度：jobs_scheduler.go（durable 扫描 + SQLite lease + checkpoint 幂等）
        │
        ▼
协议适配器（providers/atlas/atlas.go：只做线协议，不碰 SQLite / 密钥 / Asset）
```

关键纪律（新 Provider 必须继承）：

- **checkpoint 幂等**：异步提交的外部接受（task id）与本地 `running` 状态必须一次事务落库；「未知提交失败」只查询、不重发（收费请求绝不双发）
- **短超时轮询**：状态查询固定短超时（现 Atlas 12s），轮询退避封顶 30s，重试预算耗尽即失败并记诊断
- **终态立即回收字节**：结果 URL 一律当场 `fetchMedia` 落 Asset，不依赖外链长期有效
- **适配器纯线协议**：`providers/*` 只接收已解密凭据与引用数据，返回供应商结果

### 1.2 Skymind Token API 是什么

- 部署形态：new-api 系企业 LLM 网关（错误信封 `new_api_error`、分组/渠道/预扣费/`supported_endpoint_types` 扩展字段均为其特征）。官方文档站是 SPA，OpenAPI 3.0.1 规范（66 端点）内嵌于其前端 JS chunk（本 RFC 已完整提取，含全部请求/响应 schema 与示例）
- 认证：`Authorization: Bearer sk-...`（单 key；分组 `default` 由网关侧管理，调用方不可见不可选）
- 计费：按模型**预扣费**——提交任务时预扣，完成后按实际用量结算（自适应时长场景「预扣 30s 按实际结算」）；余额不足提交即拒
- 模型表面：`/v1/models` 返回 37 个 chat/图片模型（含 `gpt-image-2`、`gemini-*-image` 等）；**视频模型不在列表中**，但统一视频端点按模型名路由（§2 实测）

### 1.3 三个硬差距（本 RFC 要解决的）

1. **无 skymind Provider**：平台媒体面无法使用 gpt-image-2（非 Atlas 渠道）与 Seedance 2.0/2.5
2. **参考素材必须公网 URL**：统一视频端点的 `images[]/videos[]/audios[]` 只收公网可访问 URL。实测 data URL 提交直接被拒：`{"code":"invalid_reference_image_url","message":"reference image URL is invalid"}`（提交期校验、不扣费）。平台 Asset 目前全部经认证端点 `/v1/media/assets/{id}/content` 交付，**不存在任何临时公网 URL 能力** → 视频带参考图在当前平台逻辑上跑不通，需要新的平台能力（§4）
3. **结果外链易失**：视频成功后的 `content.video_url` 是火山 TOS 24h 签名链接 → 平台必须终态即时下载（现有纪律恰好覆盖，新 Provider 直接继承）

---

## 2. 上游 API 表面（2026-08-24 实测）

### 2.1 本期用到的端点

| 用途 | 端点 | 协议要点 |
|---|---|---|
| 模型列表 | `GET /v1/models` | OpenAI 格式；网关扩展字段 `supported_endpoint_types`（如 `["openai"]`、`["gemini","openai"]`）；**不含视频模型** |
| 图片生成 | `POST /v1/images/generations` | OpenAI 兼容；`model/prompt/n/size/quality/style/response_format(url\|b64_json)`；同步返回，`usage` 含 `image_tokens` |
| 视频提交 | `POST /openapi/v1/video/generations` | 统一任务协议（§2.3）；立即返回 `queued` |
| 视频查询 | `GET /openapi/v1/video/generations/{task_id}` | 状态机 `queued → running → succeeded / failed`；成功后 `content.video_url`（TOS 24h 签名） |
| 视频下载 | `GET /openapi/v1/video/generations/{task_id}/content` | 成功任务直接返回 mp4 流（实测与 video_url 下载 MD5 一致）；未成功返回 JSON 错误 |

统一视频请求 schema（OpenAPI 原文摘要）：

```jsonc
{
  "model": "doubao-seedance-2.0",      // 必填，按模型名路由到渠道
  "prompt": "…",                        // 必填
  "images": ["https://…"],              // 参考图，必须公网 URL（图生视频）
  "videos": ["https://…"],              // 参考视频（能力以所选模型为准）
  "audios": ["https://…"],              // 参考音频（能力以所选模型为准）
  "resolution": "720p",                 // 480p / 720p / 1080p
  "ratio": "16:9",                      // 16:9 / 9:16 / 1:1 …
  "duration": 5,                        // 秒；-1 = 自适应时长（预扣 30s 按实际结算）
  "metadata": {                          // 模型原生高级参数，与标准字段同名时以此为准（model 除外）
    "generate_audio": true,             //   是否生成音频（实测不传时默认 true）
    "seed": 20250731                    //   随机种子（必须放 metadata.seed，顶层 seed 不解析）
  }
}
```

成功响应（实测，sd2.0）：

```jsonc
{
  "id": "task_g47wPNxg…", "model": "doubao-seedance-2.0", "status": "succeeded",
  "content": {"video_url": "https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/…?X-Tos-Expires=86400…"},
  "usage": {"completion_tokens": 50638, "total_tokens": 50638},
  "seed": 27449, "resolution": "480p", "duration": 5, "ratio": "16:9",
  "framespersecond": 24, "output_format": "mp4", "generate_audio": true,
  "execution_expires_after": 172800, "created_at": 1787568256, "updated_at": 1787568381
}
```

### 2.2 模型 ID 实测（当前账号/分组）

| 平台目录名 | 上游 APIModelID | 实测路由 | 备注 |
|---|---|---|---|
| GPT Image 2 | `gpt-image-2` | ✅ | 另有带日期 ID `gpt-image-2-2026-04-21` 在 `/v1/models` 中 |
| Seedance 2.0 | `doubao-seedance-2.0` | ✅ | 文/图生视频均验证 |
| Seedance 2.5 | `doubao-seedance-2-5-260628` | ✅ | **仅此带日期 ID 可路由**；`seedance-2.5` / `doubao-seedance-2.5` / `doubao-seedance-2-5` / `dreamina-seedance-2-5-filter-off` 等常见写法全部 `model_not_found` |

已知但未在本网关开通的变体（来自上游文档，供配置覆盖参考）：`doubao-seedance-2-0-260128`、`doubao-seedance-2-0-fast-260128`、`doubao-seedance-2-0-filter-off`、`dreamina-seedance-2-0-mini-filter-off`、`dreamina-seedance-2-5-filter-off`。

> **结论**：模型 ID 是「账号 × 分组 × 渠道 × 日期版本」的函数，且视频模型不可发现（不在 `/v1/models`）。目录给稳定默认值，**凭据级覆盖**是唯一可靠的配置化路径（§5.3）。

### 2.3 错误面（实测 + OpenAPI schema）

| 场景 | 响应形态 | 平台映射 |
|---|---|---|
| 模型无渠道 | `{"error":{"code":"model_not_found","message":"No available channel for model X under group default (distributor) …"}}`（OpenAI 兼容错误信封） | 提交期失败：「该模型在当前 Skymind 账号/分组未开通，请更换模型或联系网关管理员」 |
| 缺参 | `{"code":"invalid_request","message":"prompt 不能为空","data":null}`（统一任务信封） | 提交期失败（不应发生：平台侧 schema 校验先行） |
| 参考 URL 非法/data URL | `{"code":"invalid_reference_image_url","message":"…"}` | 提交期失败：「参考素材必须为公网 URL」（§4 能力缺失时的兜底报错） |
| 余额不足 | `{"code":"insufficient_user_quota","message":"预扣费额度失败, 用户剩余额度: ¥99.99…, 需要预扣费额度: ¥1050…"}` | 提交期失败：「Skymind 余额不足（预扣费失败）：剩余额度 …」 |
| 上游故障 | `{"code":"fail_to_fetch_task","message":"provider API error (status 500)"}` | 按既有纪律：无远端 task id → 可重试；有 task id → 只查询 |
| 任务失败 | `status:"failed"` + `error:{code,message}`（如 `InvalidParameter` 参考图不可访问） | Asset 终态 failed，message 透传用户 |

两种错误信封并存（OpenAI 兼容端点 `{error:{…}}` vs 统一任务端点 `{code,message,data}`）→ 协议适配器统一归一为 `providerError{code, message, retryable, stage}`。

### 2.4 网关已有但本期不接的端点（扩展位）

OpenAPI 中还包含：`/v1/audio/speech`、`/v1/audio/transcriptions`、`/v1/audio/translations`（OpenAI 音频格式）、`/v1/images/edits` 与 `/v1/images/generations/async`（Qwen 图片编辑/异步 + `{task_id}` / `{task_id}/content` 任务对）、`/v1/videos`（Sora 兼容）、`/kling/...`、`/jimeng/`、`/api/v3/contents/generations/tasks`（火山原生 v3）、`/api/v1/seedance/videos`（火山兼容）、四类人像素材库（火山 Ark / 移动云 / Ocean / 真人认证）与 `/api/openapi/usage-logs/*`（用量日志）。

**本期全部不接**，但架构上它们都落在同一个扩展位：新增端点 = 在 `providers/skymind` 适配器内新增方法 + catalog 增加模型条目 + （如为新能力）注册 `model_providers` 策略。协议适配器接口按「端点族」而非「模型」设计（§5.4），使 TTS/Kling/火山原生未来接入不改 Job 层。

---

## 3. Provider 设计

### 3.1 目录条目（catalog.go 增量）

```go
{ID: "skymind-token", Name: "Skymind Token API", Protocol: "skymind",
 DefaultAPIBase: "https://token-api.skymind.pro",
 Models: []MediaModel{
   {ID: "skymind-token/gpt-image-2", Provider: "skymind-token", Name: "GPT Image 2",
    Capability: ImageGenerate, APIModelID: "gpt-image-2",
    InputModes: []string{"text"}, Available: true, Configurable: true},
   {ID: "skymind-token/seedance-2.0", Provider: "skymind-token", Name: "Seedance 2.0 · 文/参考视频",
    Capability: VideoGenerate, APIModelID: "doubao-seedance-2.0",
    InputModes: []string{"text", "image", "video", "audio"},
    OutputModes: []string{"durationSeconds", "aspectRatio", "resolution", "generateAudio", "seed"},
    Available: true, Configurable: true},
   {ID: "skymind-token/seedance-2.5", Provider: "skymind-token", Name: "Seedance 2.5 · 文/参考视频",
    Capability: VideoGenerate, APIModelID: "doubao-seedance-2-5-260628",
    InputModes: []string{"text", "image", "video", "audio"},
    OutputModes: []string{"durationSeconds", "aspectRatio", "resolution", "generateAudio", "seed"},
    Available: true, Configurable: true},
}},
```

- `InputModes` 沿用平台语义：`text/image/video/audio` → `requiredInputs` 自动派生 `prompt/imageAssetIds/videoAssetIds/audioAssetIds`
- 参考素材约束沿用 Seedance 既有校验（`validSeedanceReference`：图片 <30MB 多格式 / 视频 ≤50MB mp4,mov / 音频 ≤15MB wav,mp3）；数量上限待上游明确，P0 先按 图≤9、视频≤3、音频≤3（对齐 Atlas Seedance 2.0 Mini 契约）
- 两档 Seedance 的模型差异（2.5 相对 2.0 的能力增量）由上游文档/网关侧决定，平台不硬编码差异；`OutputModes` 给同一集合，实际可用性以任务响应为准

### 3.2 协议适配器 `providers/skymind/`（新目录，纯线协议）

```go
// 请求/结果 DTO 与 Atlas 适配器同纪律：只接收 APIBase/secret/HTTP 客户端与引用数据
type VideoSubmitRequest struct {
    APIModel string
    Prompt   string
    Images   []string // 公网 URL（由 media 层经 §4 分享能力发布得到）
    Videos   []string
    Audios   []string
    Resolution, Ratio string
    Duration int // 秒；-1 自适应
    Metadata map[string]any // generate_audio / seed 等原生参数
}
type VideoTask struct {
    ID string
    Status string // queued / running / succeeded / failed
    VideoURL string
    Error   *VideoTaskError
    Usage   *VideoUsage
    // 其余观测字段（seed/resolution/duration/ratio/…）原样保留入 Asset metadata
}
func SubmitImage(ctx, base, key, ImageRequest) (ImageResult{bytes,mime}, error) // POST /v1/images/generations (b64_json)
func SubmitVideo(ctx, base, key, VideoSubmitRequest) (VideoTask, error)          // POST /openapi/v1/video/generations
func PollVideo(ctx, base, key, taskID) (VideoTask, error)                        // GET /openapi/v1/video/generations/{id}
func FetchVideo(ctx, base, key, taskID) ([]byte, error)                          // GET /openapi/v1/video/generations/{id}/content（首选）
```

- 图片：固定 `response_format=b64_json` 直接取字节（实测 `data[0].b64_json`；无 `url` 字段时回退下载 `url`）
- 视频：状态查询固定短超时（12s，继承 `atlasPollingHTTPClient` 同款配置）；回收**首选 `/content`**（实测逐字节一致，且规避 TOS 签名链接 24h 过期），`/content` 异常时回退 `video_url`
- 端点族隔离：`SubmitImage/PollVideo/FetchVideo` 按端点族划分，未来 TTS（`SynthesizeSpeech`）、图片异步（`SubmitImageAsync/PollImageAsync`）在**同一适配器**内增量，Job 层不感知

### 3.3 Job 接线（jobs.go / jobs_skymind.go）

- **图片**（同步策略，入 `model_providers` 注册表，仿 `openai.go`）：
  - `skymind` 策略：`GenerateImage` → `SubmitImage` → 字节入 Asset；输出参数映射 `size/quality`（OpenAI 风格，与现有 openai 策略同构）
  - 无参考图编辑变体（`EditModelID` 空）：本期 `InputModes=["text"]`，与目录一致
- **视频**（异步，新 `jobs_skymind.go`，对齐 `jobs_atlas.go` 纪律）：
  1. 参考素材 → 公网 URL：`SharePublish(asset)`（§4）逐个发布；任一失败即 job 失败（错误映射：分享能力不可用 / 素材不可读）
  2. 组装请求：`durationSeconds→duration`、`aspectRatio→ratio`、`resolution→resolution`；`generateAudio` 默认 `true`（对齐平台 Seedance 契约「同步音频默认开启，用户可显式关闭」）写入 `metadata.generate_audio`；`seed` 写入 `metadata.seed`
  3. `SubmitVideo` → task id 与 queued Asset 的 `remote_id` **同事务绑定**（checkpoint）
  4. 轮询（scheduler lease 推进）：`queued/running` → 继续（间隔 15s 起、退避封顶 30s，实测 480p/5s 任务 120–160s 到终态）；`succeeded` → `FetchVideo` → `completeRemoteAsset(video/mp4)`；`failed` → 终态 + 错误映射
  5. 重启恢复：`remote_id` 非空 → 直接 `PollVideo` 续跑（「未知提交」永不重发，预扣费模型下双发=双扣）
- `queuedAssetSpec`：video → `video/mp4`（与 Atlas 一致）
- 实测时长参考：sd2.0 t2v 480p/5s ≈ 155s；sd2.5 i2v 480p/5s ≈ 123s（含排队）→ 轮询预算按 10 分钟默认、`execution_expires_after`（172800s）为硬上限

### 3.4 参考素材能力矩阵

| 输入模式 | 平台来源 | 上游形态 | 依赖 |
|---|---|---|---|
| 文生视频 | `prompt` | `prompt` | 无 |
| 图生视频 / 多参考图 | image Asset（completed） | `images[]` 公网 URL | §4 分享 |
| 参考视频 | video Asset | `videos[]` 公网 URL | §4 分享 |
| 参考音频 | audio Asset | `audios[]` 公网 URL | §4 分享 |

发布复用规则（§4.4）：同一 contentHash 的 Asset 已存在未过期分享则**复用** URL，不重复上传——同一批参考素材在「改提示词重跑」的高频场景下零额外上传成本。

---

## 4. 临时公网分享（`recut.share`）

### 4.1 目标与边界

把「已完成」的本地 Asset 发布为**临时、不可猜测、可即时吊销**的公网 URL，供需要公网引用的上游（本期：Seedance 参考素材）使用。

- 平台级能力，不绑定任何 App/项目；Asset 已内容寻址落盘，分享只增加「公开访问通道 + 生命周期」
- **TTL 上限 7 天**（可配置，默认 7），由**存储侧生命周期**兜底：即使本地账本丢失（workspace 重建、误删），R2 对象也按期自动过期
- 明确非目标：不做永久公开链接（稳定公开资源仍走 `cdn.recut.video` 既有发布流）；不做目录/列表/搜索（防枚举）；不做转码（原字节直发）

### 4.2 存储与分发（Cloudflare R2 + CDN）

复用现有 Recut Cloudflare 账号（`cdn/config.mjs`：account `eb5cc0bf…`，R2 S3 兼容端点 `https://<account>.r2.cloudflarestorage.com`，自定义域 `cdn.recut.video`）。

| 项 | P0 落地（立即可用，已实测） | P1 加固 |
|---|---|---|
| 桶 | 现有 `recut-assets`，key 前缀 `share/`（本次 E2E 即走此路径：`cdn.recut.video/share/e2e/fox.png` → 200 / image/png / 逐字节一致） | 独立桶 `recut-share` + 独立域 `share.recut.video`（DNS + 自定义域一次性配置） |
| TTL | R2 生命周期规则：P0 用前缀作用域规则（`share/` 前缀 → 7 天过期）；P1 桶级规则 | 桶级 7 天过期 |
| 缓存 | 上传时写 `Cache-Control: public, max-age=3600`：吊销/过期后 CDN 边缘残留窗口 ≤ 1h（token 不可猜测，窗口风险可接受） | 独立域独立缓存策略 + Cloudflare rate-limit 规则（如 60 req/min/IP） |
| 凭据 | 复用 `cdn/.env` 同款 R2 S3 密钥（access key 作用域需含 `recut-assets` 写权限——现密钥已满足） | 桶级 scope 收窄密钥 |

> 用户提出的「基于 Cloudflare CDN 建临时 bucket」= 表中 P1 形态；P0 先以现有桶前缀跑通全链路（零新基建、本 RFC 的 E2E 已验证），P1 把隔离做干净。Go 侧实现是同一份（桶名 + 基址来自配置），迁移只是改两个配置值。

### 4.3 URL 与对象键

```text
URL = {shareBase}/<token>/<name>          例：https://share.recut.video/9f2c…e1a4/fox.png
key = share/<token>/<name>                （P0：cdn.recut.video 域下 share/<token>/<name>）
token = 16 字节随机（128bit，32 hex）——不可枚举、不可由内容推导
name  = 原 Asset 名（sanitize 后，保留扩展名以便上游识别 MIME）
```

- 同 contentHash 去重：发布前查 `media_shares`（contentHash + 未过期 + 未吊销）→ 命中即复用，返回既有 URL
- 上传幂等：S3 `PutObject`（覆盖语义）+ 既有 `skipExisting` MD5 比对逻辑（`cdn/scripts/r2.mjs` 同款）

### 4.4 本地账本（新表 `media_shares`）

```sql
create table if not exists media_shares (
  id          text primary key,          -- newID()
  asset_id    text not null,
  content_hash text not null,
  token       text not null unique,
  url         text not null,
  object_key  text not null,
  expires_at  text not null,             -- RFC3339，= 发布时刻 + ttl（默认 7d）
  revoked_at  text,                      -- 非空 = 已吊销（R2 对象已删）
  created_at  text not null,
  updated_at  text not null
);
create index if not exists idx_media_shares_asset on media_shares(asset_id);
create index if not exists idx_media_shares_hash on media_shares(content_hash, revoked_at);
```

- 与 `media_asset_events` 无关（分享不改变 Asset 本身）；Asset 删除（安全删除路径）时**级联吊销**其全部未过期分享
- 后台 sweep（搭 scheduler 既有循环便车，无需常驻新循环）：过期且未吊销的记录 → 惰性标记（对象已由 R2 生命周期删除，仅清账本）

### 4.5 API 与内部接口

```text
POST   /v1/media/shares            {assetId, ttlDays?} → {shareId, url, expiresAt}
GET    /v1/media/shares?assetId=   → [{…}]（该 Asset 未过期分享）
DELETE /v1/media/shares/{shareId}  → 立即删 R2 对象 + 账本墓碑
内部   MediaService.SharePublish(asset MediaAsset, ttl time.Duration) (Share, error)
```

- `SharePublish` 是 Provider 提交前的唯一入口：completed 校验、MIME/大小校验（≤ 上游限制：图 30MB / 视频 50MB / 音频 15MB）、去重复用、上传、落账本
- MCP（P1）：`recut.media.share` / `recut.media.unshare`——给 Agent 显式分享需求（如「把这张图发给上游工具」）一个稳定入口；本期 P0 只暴露 REST + 内部入口
- UI（P1）：素材库分享菜单项「生成 7 天临时公开链接」（含隐私提示文案：链接将在 7 天后自动失效，持有者期间可访问）

### 4.6 安全与隐私

1. **不可猜测**：128bit 随机 token；对象键不含项目/用户 ID；R2 不开放匿名 List
2. **最小暴露**：只发布 completed 的媒体字节；不发布 parts/元数据/文稿
3. **短命**：默认 7 天、存储侧强制；用户可提前吊销（秒级生效，CDN 残留 ≤ 1h 由 `max-age` 约束）
4. **凭据**：R2 S3 密钥是 **Recut 平台级机密**（与 `cdn/.env` 同性质），非用户 BYOK：Go daemon 从 `~/.recut/share-credentials`（发布流注入）或环境变量读取；密钥轮换=换文件重启 daemon。若本地无凭据 → 分享能力标记不可用，带参考素材的 skymind 视频 job 明确失败（「临时公开分享未配置」），**纯文生视频不受影响**
5. **审计**：`media_shares` 账本 + 发布/吊销事件进 service 日志（含 assetId/token 前 8 位，不落 URL 全量）

---

## 5. 可配置化

### 5.1 凭据级（Settings 面板，沿用现有交互）

- 新增 Provider 卡片 **Skymind Token API**：名称 + API Key（`sk-…`）+ API Base（默认 `https://token-api.skymind.pro`，可改）
- 保存凭据时（P1）可选调用 `GET /v1/models` 做 reconcile：图片模型缺失 → 提示「该 key 未开通图片模型」；**视频模型不参与 reconcile**（上游不列出，见 §2.1）

### 5.2 Route

`image.generate` / `video.generate` 能力下可选 skymind 模型，与 atlas/openai 模型同级竞争；默认输出字段由 `OutputModes` 驱动（视频：durationSeconds/aspectRatio/resolution/generateAudio/seed）

### 5.3 模型 ID 覆盖（关键配置面）

`media_credentials` 增加可空列 `model_overrides_json`：

```jsonc
// model_overrides_json（按平台模型 ID 覆盖上游 APIModelID，凭据级）
{
  "skymind-token/seedance-2.5": "doubao-seedance-2-5-260628",
  "skymind-token/seedance-2.0": "doubao-seedance-2.0"
}
```

- 解析顺序：凭据覆盖 > catalog `APIModelID` 默认值；覆盖值原样透传（拼写错误 → 上游 `model_not_found`，错误映射已覆盖）
- 这是应对「账号 × 分组 × 日期版本」模型 ID 漂移的唯一稳定面：网关侧换版本（如 `…-260715`）= 改一个 JSON 字段，不发版
- 校验：只允许覆盖 `provider == credential.provider` 的模型 ID，防止把 A provider 的模型名指到 B 协议

### 5.4 端点族扩展位

`providers/skymind` 适配器按端点族组织方法（§3.2），未来接入清单（均不改 Job 层，只加适配器方法 + catalog 条目 + 必要时 `model_providers` 策略）：

| 未来端点 | 能力 | 形态 |
|---|---|---|
| `/v1/audio/speech` | SpeechGenerate | 同步（OpenAI 音频格式，voice 目录需上游模型列表支持后接 `recut.media.list_voices`） |
| `/v1/images/edits`、`/v1/images/generations/async` | ImageGenerate 参考图编辑 / 异步 | 策略新增 EditModelID + 异步任务对（复用视频任务轮询纪律） |
| `/kling/...`、`/jimeng/`、`/api/v3/contents/generations/tasks` | VideoGenerate 多上游 | 同一 `VideoSubmitRequest` DTO 下多协议实现，catalog 模型条目区分 |
| 人像素材库（Ark/Ocean/移动云/真人） | 虚拟人资产 | 独立能力族，`asset://` 引用进入 `metadata.content`（上游文档明确该通道） |
| `/api/openapi/usage-logs/*` | 用量/成本观测 | P2：Provider 用量进 job metadata / 成本面板 |

---

## 6. E2E 证据（2026-08-24，真实 key、真实扣费、每项一次）

> 产物：`output/skymind-e2e/`（gitignored）。成本控制：全部 480p / 5s 最小规格；用户确认通过后未做任何重复付费调用。重跑成本估算 ≈ ¥15（2 视频 + 1 图）。

| # | 验证项 | 方法 | 结果 |
|---|---|---|---|
| 1 | gpt-image-2 文生图 | `POST /v1/images/generations`（b64_json, 1024x1024, quality=low） | ✅ `fox.png` 1.38MB，PNG 1024×1024 RGB；`usage={total_tokens:214, image_tokens:196}` |
| 2 | Seedance 2.0 文生视频 | 提交 `doubao-seedance-2.0` 480p/16:9/5s → 15s 轮询 → `succeeded`（155s）→ `/content` 下载 | ✅ `vid20.mp4`：h264 864×496 @24fps + AAC 音频轨，5.06s，1.27MB；`generate_audio` 默认 true；`video_url` 为 TOS 24h 签名 |
| 3 | R2 临时公网分享 | `fox.png` 经 `cdn/scripts/cli.mjs upload share` 上传 → 公开 GET | ✅ `https://cdn.recut.video/share/e2e/fox.png` → 200 / image/png / 1382669 字节逐字节一致（**P0 前缀模式可行性得证**；测后已清理对象） |
| 4 | Seedance 2.5 公网参考图生视频 | 提交 `doubao-seedance-2-5-260628`，`images=[#3 的公开 URL]` → 轮询 → `succeeded`（123s）→ 下载 | ✅ `vid25.mp4`：h264 854×480 @24fps + AAC，5.06s，2.25MB——**「本地素材 → R2 分享 → 公网 URL → 上游消费」闭环全链路得证** |
| 5 | data URL 拒绝 | 提交带 `data:image/png;base64,…` 参考图 | ✅ 提交期即拒 `invalid_reference_image_url`（不扣费）→ 证实 §1.3 硬约束，§4 能力为必需而非可选 |
| 6 | `/content` 与 `video_url` 一致性 | 同一已完成任务两通道下载 | ✅ MD5 相同（`cc44229b…`）→ `/content` 作首选回收通道成立 |
| 7 | 模型发现局限 | `GET /v1/models` | ⚠️ 37 模型仅 chat/图片；sd2.0/2.5 均不在列表 → §2.2 结论：视频模型不可发现，配置化覆盖为必需 |
| 8 | 预扣费与错误面 | 余额不足/未知模型探测 | ✅ `insufficient_user_quota`（预扣 ¥1050 > 余额 ¥99.99，提交即拒）、`model_not_found`（含分组信息）→ 错误映射表（§2.3）全部有真实样本 |

重跑脚本（最小 4 步，约 ¥15）：

```bash
KEY=sk-…; B=https://token-api.skymind.pro
# 1) 图
curl -s "$B/v1/images/generations" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"model":"gpt-image-2","prompt":"…","size":"1024x1024","quality":"low","response_format":"b64_json"}'
# 2) 参考图发布到 R2（share/ 前缀）→ 得公开 URL（或 P1 独立域）
# 3) 视频提交（sd2.5 参考图 / sd2.0 纯文本）
curl -s "$B/openapi/v1/video/generations" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"model":"doubao-seedance-2-5-260628","prompt":"…","images":["https://…/share/<token>/fox.png"],"resolution":"480p","ratio":"16:9","duration":5}'
# 4) 轮询 GET $B/openapi/v1/video/generations/{task_id} 至 succeeded → GET …/content 下载
```

---

## 7. 风险与边界

| 风险 | 缓解 |
|---|---|
| 模型 ID 漂移（日期版本/渠道变体） | §5.3 凭据级覆盖 + 错误映射把 `model_not_found` 转成可操作提示；目录默认值随网关版本滚动更新 |
| 预扣费下的重复扣费 | checkpoint 幂等纪律（§3.3 第 5 条）：有 remote task id 只查询不重发；「未知提交」沿用既有 `submission_started_at` 语义 |
| 结果外链 24h 过期 | 终态立即下载 + `/content` 首选（§3.2）；job 长期 running 不阻塞——轮询在 scheduler 内持续，下载发生在 `succeeded` 转换瞬间 |
| 分享链接泄露（7 天窗口） | 128bit token + 不可枚举 + 可秒级吊销 + `max-age` 限制 CDN 残留 + 独立域 rate-limit（P1）+ UI 隐私提示；敏感素材由用户决定是否分享 |
| R2 凭据进入本地 daemon | 平台级 scope 收窄密钥（仅 share 桶/前缀 读写删）；无凭据时分享不可用但文生视频可用（降级清晰） |
| 上游分组/渠道差异（如 2.5 需网关侧开通） | `model_not_found` 错误映射直接给出「请为分组与模型配置渠道」语义，不吞错 |
| 成本失控（实测 ≈¥5/条视频） | 目录默认输出参数保守（P0 默认 480p/5s 可由用户上调）；job 创建日志（既有审计）可核对扣费；`usage.total_tokens` 原样存 Asset metadata 供对账 |

**明确不做（本期）**：TTS/转录/翻译端点、图片编辑与异步图片、Kling/即梦/火山原生协议、人像素材库、用量日志面板、WebSocket/Realtime——全部只留扩展位（§5.4），避免一次性把 66 端点全量镜像进平台。

---

## 8. 验收标准（实施后）

1. Settings 保存 skymind 凭据后，`/v1/media/models` 出现 3 个模型；Route 可选；`recut.image.generate` / `recut.video.generate` 全链路（MCP/HTTP 等价）跑到 completed，Asset 可播放/可显示
2. 带参考图视频：参考 Asset 自动 `SharePublish`，job metadata 记录 token；完成后分享**不自动删除**（TTL 兜底 + 复用），`DELETE /v1/media/shares/{id}` 秒级失效（公开 GET → 404）
3. 幂等：提交后杀进程重启 → daemon 凭 remote task id 续轮询至终态，**不产生第二个上游任务**（以上游任务 ID 唯一性断言）
4. 错误映射：余额不足 / 模型未开通 / 参考 URL 非法 三类错误在 UI 文案层可读（非裸 JSON）
5. 分享生命周期：R2 生命周期规则生效（`share/` 前缀对象 7 天自动消失——P0 用 1 天临时规则 + 短期对象验证机制，生产恢复 7 天）
6. 测试：L1 协议映射单测（错误信封归一、参数映射、metadata 透传）+ L2 真实 key E2E（仿 `service/transcribe_e2e_test.go` 模式：env 提供 key 才跑、缺失即 skip，默认 480p/5s 最小成本，视频轮询上限 10 分钟）

---

## 9. 实施顺序

| 阶段 | 内容 | 依赖 |
|---|---|---|
| P0 | `providers/skymind` 适配器（图/视频三端点 + 错误归一）；catalog 3 模型；`model_providers/skymind.go` 图片策略；`jobs_skymind.go`（含参考发布接线）；`media_credentials.model_overrides_json` 迁移；`media_shares` 表 + `SharePublish` + REST API + R2 客户端（`recut-assets/share/` 前缀模式）；Settings 面板 Provider 卡片；错误映射文案 | 无（R2 凭据已在 `cdn/.env` 同账号） |
| P0 测试 | L1 单测 + L2 真实 key E2E（§8.6） | P0 |
| P1 | 独立桶 `recut-share` + `share.recut.video` 域 + 桶级 7 天生命周期 + rate-limit；`Cache-Control` 规范固化；MCP `recut.media.share/unshare` + 素材库分享 UI；`/v1/models` reconcile 提示 | P0 |
| P2 | TTS（`/v1/audio/speech`）；图片编辑/异步；Kling/即梦/火山原生；人像素材库；usage-logs 成本面板 | P0 + 上游账号开通对应渠道 |
