/*
 * [INPUT]: 依赖 AgentBridge 会话鉴权、AppHost 双 target 运行时、Catalog 的 App 与 skill 树、MediaService 与 JSON-RPC 请求/响应模型
 * [OUTPUT]: 对外提供项目/App-state target 解析、Skill 读取、跨 App operation 路由、受限 Component Author 调度及平台工具清单
 * [POS]: service 的 MCP Host；不把页面上下文变成全局 capability 或 operation 权限限制
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"recut-service/motion_graphic"
)

type mcpRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

// mcpToolDescriptions holds the tool-level MCP descriptions in zh (the service
// default) and en. Schema-internal per-property descriptions are not localized
// yet; see D12.
var mcpToolDescriptions = map[string]map[Locale]string{
	"recut.context": {
		LocaleZh: "读取当前 Recut 会话上下文：已安装 App（含绝对路径 root）、Skill 元数据、媒体配置、可选集成能力状态与 .recut 文件系统路径（paths）。每个 native session（含 resume 续跑）只调用一次；同一会话的整段生命周期内复用已确认快照，仅在用户说明或本会话执行了 Provider/模型/App 变更、任务切换到快照未覆盖的 App/Project、或工具报告状态失效时刷新。会话不绑定任何项目；需要项目信息时用 recut.project.list / recut.project.get 或 recut.project_context。",
		LocaleEn: "Read the current Recut session context: installed Apps (including absolute root paths), Skill metadata, media configuration, optional integration readiness, and .recut filesystem paths (paths). Call it once per native session (including resumed runs); reuse the confirmed snapshot for the entire session lifetime, refreshing only when the user states or this session performs Provider/model/App changes, the task moves to an App or Project not covered by the snapshot, or a tool reports stale state. The session is not bound to a Project; use recut.project.list / recut.project.get or recut.project_context when you need project information.",
	},
	"recut.apps.list": {
		LocaleZh: "列出已安装 App（含 kind、skill 目录、Git 仓库、可更新状态与安装状态）。",
		LocaleEn: "List installed Apps (kind, skill directory, Git repository, update availability, and installation status).",
	},
	"recut.apps.store": {
		LocaleZh: "列出 App Store 中可安装的 Recut App（appId、name、kind、GitHub repository、是否已安装）。需要安装时用 recut.apps.install 传入其 repository。",
		LocaleEn: "List installable Recut Apps in the App Store (appId, name, kind, GitHub repository, and whether already installed). Use recut.apps.install with its repository to install one.",
	},
	"recut.apps.install": {
		LocaleZh: "从一个 Git 仓库安装标准 Recut App（克隆、校验 manifest 后激活）。仅当用户明确要求安装该仓库时调用。",
		LocaleEn: "Install a standard Recut App from a Git repository (clone, validate the manifest, then activate). Call it only when the user explicitly asks to install that repository.",
	},
	"recut.apps.update": {
		LocaleZh: "更新一个已安装 App（传 package）或全部已安装 App。仅当用户明确要求更新时调用。",
		LocaleEn: "Update one installed App (pass its package) or all installed Apps. Call it only when the user explicitly asks to update.",
	},
	"recut.skills.list": {
		LocaleZh: "列出所有可读 skill（平台技能 appId=`recut.platform` + 已安装 App 的技能）：id、appId、name、description。平台能力（World/画布、导演类等）的技能只在 `recut.platform` 下，做这些任务前先在这里发现对应 skill。",
		LocaleEn: "List every readable skill (platform skills under appId=recut.platform plus installed App skills): id, appId, name, description. Platform capabilities (World/canvas, directing, ...) live only under recut.platform; discover them here before starting those tasks.",
	},
	"recut.skills.read": {
		LocaleZh: "读取一个 skill 的完整正文（平台技能传 appId=`recut.platform`，其余传 App id）；该正文对对应能力的工具契约与决策门有权威性。",
		LocaleEn: "Read the full body of a skill (pass appId=recut.platform for platform skills, otherwise the App id); it is authoritative for that capability's tool contracts and decision gates.",
	},
	"recut.skills.reference": {
		LocaleZh: "读取一个 skill 声明的引用/资源子文档。路径必须是该 skill 目录内前置声明的相对路径。",
		LocaleEn: "Read a reference/resource sub-document declared by a skill. The path must be a relative path declared inside that skill's directory.",
	},
	"recut.project.create": {
		LocaleZh: "创建一个真实的 Recut Project Doc。仅当用户明确要求新建项目时调用；成功返回的 projectId 会出现在项目桌面。它不会创建 Brief、Artifact 或工作流资源。",
		LocaleEn: "Create a real Recut Project Doc. Call it only when the user explicitly asks to create a project; the returned projectId appears on the project desktop. It does not create Brief, Artifact, or workflow resources.",
	},
	"recut.project.list": {
		LocaleZh: "列出全部用户项目（Doc metadata：id、name、owner App、版本）。",
		LocaleEn: "List all user projects (Doc metadata: id, name, owner App, version).",
	},
	"recut.project.get": {
		LocaleZh: "读取一个项目的 Doc metadata。",
		LocaleEn: "Read a project's Doc metadata.",
	},
	"recut.project_context": {
		LocaleZh: "读取一个项目的深层上下文：owner App 的 workflow.context、已产出 Artifact、appState 与项目绝对路径（paths.projectFilesRoot）。",
		LocaleEn: "Read a project's deep context: the owner App's workflow.context, produced Artifacts, appState, and the project's absolute paths (paths.projectFilesRoot).",
	},
	"recut.job.status": {
		LocaleZh: "读取一个任务（job）的当前状态：queued / running / completed / failed / cancelled / interrupted。统一观察层同时覆盖本地 App shell job（如 audio.install/transcribe、depth.generate、render.export）与平台媒体生成 job（recut.image/video/speech.generate 返回的 jobId）；返回视图带 kind 区分 shell / media。",
		LocaleEn: "Read the current status of a job: queued / running / completed / failed / cancelled / interrupted. The unified observation layer covers both local App shell jobs (e.g. audio.install/transcribe, depth.generate, render.export) and platform media generation jobs (jobIds returned by recut.image/video/speech.generate); the returned view carries a kind of shell or media.",
	},
	"recut.job.wait": {
		LocaleZh: "等待一个任务（job）达到终态（completed / interrupted / failed / cancelled），sub-agent / shell / media job 通用。等待是短窗口轮询（单次最多 15s），超时返回当前状态而不报错，可继续用 recut.job.status 继续轮询。",
		LocaleEn: "Wait for a job to reach a terminal state (completed / interrupted / failed / cancelled), working for sub-agent, shell, and media jobs. Waiting is a short-window poll (at most 15s per call); on timeout it returns the current state without error, keep polling with recut.job.status.",
	},
	"recut.job.logs": {
		LocaleZh: "读取本地 App shell job 的 stdout/stderr 日志，或子 Agent job 的当前视图（含 toolCalls 提交账本），供失败诊断；媒体生成 job 无进程日志。",
		LocaleEn: "Read the stdout/stderr logs of a local App shell job, or a sub-agent job's current view (including the toolCalls commit ledger) for failure diagnosis; media generation jobs have no process logs.",
	},
	"recut.job.cancel": {
		LocaleZh: "取消一个 queued / running 的本地 App shell job 或子 Agent job（sub-agent job 取消会传播到子 CLI 进程；已提交的部分结果仍会被 finalize 并以 interrupted 终态呈现）。",
		LocaleEn: "Cancel a queued or running local App shell job or a sub-agent job (cancellation propagates to the child CLI process; already committed partial results are still finalized and surfaced as an interrupted terminal state).",
	},
	"recut.files.fetch": {
		LocaleZh: "把绝对 http(s) URL 映射为本地文件路径（统一远程缓存 <dataRoot>/files/cdn，内容寻址、重复访问零网络、≤100MB、拒绝内网/回环地址）。需要本地文件时使用（查看、处理、传给只收本地路径的工具）；只想要素材库 Asset 用 recut.media.import_url；生成参考（imageAssetIds 等）可直接传 URL，无需先调用本工具。",
		LocaleEn: "Map an absolute http(s) URL to a local file path (unified remote cache <dataRoot>/files/cdn, content-addressed, repeat access is a filesystem hit, ≤100MB, private/loopback addresses refused). Use it when a local file is needed (viewing, processing, or feeding a local-path-only tool); use recut.media.import_url when an Asset-library entry is wanted; generation references (imageAssetIds, ...) accept URLs directly, so this tool is not required for them.",
	},
	"recut.image.generate": {
		LocaleZh: "提交图片生成任务。立即返回处于 queued 状态的稳定 jobId 与 assetIds；常驻 Daemon 完成后将同一 Asset 原位转为 completed 或 failed。可立刻用 assetId 建立项目引用，再用 recut.media.wait_for_job 等待终态。",
		LocaleEn: "Submit an image generation job. It immediately returns a stable queued jobId and assetIds; the persistent Daemon moves the same Asset to completed or failed in place. You may create project references with the assetId right away, then use recut.media.wait_for_job to await the terminal state.",
	},
	"recut.video.generate": {
		LocaleZh: "提交长时间运行的视频生成。立即返回处于 queued 状态的稳定 jobId 与 assetIds；常驻 Daemon 接受 Atlas 任务后将同一 Asset 原位转为 running，再回收为 completed 或 failed。可立刻用 assetId 建立项目引用。",
		LocaleEn: "Submit a long-running video generation. It immediately returns a stable queued jobId and assetIds; after the persistent Daemon accepts the Atlas task, the same Asset moves to running in place and is later reclaimed as completed or failed. Create project references with the assetId right away.",
	},
	"recut.speech.generate": {
		LocaleZh: "提交长时间运行的语音生成。云端路由先用 recut.media.list_voices 查询凭据可用的 voiceId；本机 TTS 路由可省略 voiceId（用 Audio Studio 默认音，或经其 audio.synthesize/audio.save）。立即返回 jobId 与处于 queued 状态的稳定 assetIds。",
		LocaleEn: "Submit a long-running speech generation. For cloud routes first query the credential's available voiceId with recut.media.list_voices; the local TTS route may omit voiceId (Audio Studio default voice, or use audio.synthesize/audio.save). It immediately returns a jobId and stable queued assetIds.",
	},
	"recut.media.list_voices": {
		LocaleZh: "读取当前可用音色：云端凭据（MiniMax/ElevenLabs）的音色，或本机 TTS 的 Audio Studio 默认音（credentialId 传 local-audio 或留空）。",
		LocaleEn: "Read currently available voices: those of a cloud credential (MiniMax/ElevenLabs), or the Audio Studio default voice for local TTS (pass credentialId local-audio or leave it empty).",
	},
	"recut.media.list_capability_voices": {
		LocaleZh: "按能力聚合所有可用的声音分组：本地 provider 一组、云端每个凭据一组、未配置凭据的 provider 返回占位组（带 error）供引导设置。用于跨 provider 声音选择，不依赖默认路由。",
		LocaleEn: "Aggregate all available voice groups for one capability: one group per local provider, one per cloud credential, and placeholder groups (with error) for unconfigured providers to guide setup. Use it to select voices across providers without depending on the default route.",
	},
	"recut.media.get_job": {
		LocaleZh: "读取媒体生成任务状态。",
		LocaleEn: "Read a media generation job's status.",
	},
	"recut.media.wait_for_job": {
		LocaleZh: "等待本地 Daemon 已提交的媒体任务达到 completed 或 failed。",
		LocaleEn: "Wait for a media job submitted to the local Daemon to reach completed or failed.",
	},
	"recut.media.list_assets": {
		LocaleZh: "检索工作区或指定项目的可复用媒体素材。优先用 ids 精确取回，或用 kind/query/limit 过滤分页；不要全量拉取素材库。",
		LocaleEn: "Search reusable media assets in the workspace or a specific project. Prefer ids for exact lookup, or kind/query/limit for filtered pages; never pull the whole library.",
	},
	"recut.media.asset.get": {
		LocaleZh: "读取单个素材的完整创作信息：content（长正文）、contentMeta（正文溯源）、attributes（有序 typed 属性，含 source/provenance 字段级溯源）与 facets（系统结构化组，proposal/reference 等，locked）。素材只有基础字段时用 list_assets，需要属性/正文/证据时用本工具。",
		LocaleEn: "Read one asset's full creative-information layer: content (long-form body), contentMeta (content provenance), attributes (ordered typed properties with source/provenance field-level traceability) and facets (system structured groups such as proposal/reference, locked). Use list_assets for basic fields; use this tool when attributes/content/evidence are needed.",
	},
	"recut.media.asset.update": {
		LocaleZh: "修改素材的 name / content / attributes。attributes 为整体替换，attrPatch 为按 key 合并（不传 attributes 时生效）；locked 属性的 type/label 与删除会被拒（值仍可改），越权 fail closed。服务端自动写入 source 与 provenance（Agent 调用记为 agent），用于 AI 生成字段的溯源。",
		LocaleEn: "Update an asset's name / content / attributes. attributes replaces the whole list; attrPatch merges by key (used when attributes is omitted). For locked attributes the type/label and removal are rejected (value is still editable), failing closed on violations. The service stamps source and provenance automatically (agent for Agent calls) so AI-written fields are traceable.",
	},
	"recut.media.import_image": {
		LocaleZh: "将 Codex 原生生成后已写入会话工作区的图片归档为 Media Asset。只接受相对路径；服务端验证路径、符号链接、文件类型与大小，并返回真实 assetId。",
		LocaleEn: "Archive an image written to the session workspace by Codex-native generation as a Media Asset. Only relative paths are accepted; the service validates the path, symlinks, file type, and size, and returns the real assetId.",
	},
	"recut.media.create_reference": {
		LocaleZh: "把文章、网页、YouTube、小红书、抖音等公开链接登记为可跨项目复用的全局 reference Asset。URL 是唯一身份并按规范 URL 去重；可同时提交正文全文（article/web 的真实文章数据）、base64 图片（真实图片数据）与尽量完整的平台元数据。正文与图片作为不可变 parts 随素材保存，可经素材 parts 接口审阅；服务本身不抓取或下载外部内容。",
		LocaleEn: "Register a public link (article, web, YouTube, Xiaohongshu, Douyin, etc.) as a reusable global reference Asset across projects. The URL is the unique identity and is deduplicated by canonical URL; you may submit the full body text (real article data for article/web), a base64 image (real image data), and as complete platform metadata as possible. The body and image are saved as immutable parts with the asset and can be reviewed through the asset parts API; the service itself never fetches or downloads external content.",
	},
	"recut.media.attach": {
		LocaleZh: "把现有媒体 assetId 引用到目标项目。",
		LocaleEn: "Attach an existing media assetId to a target project.",
	},
	"recut.media.import_url": {
		LocaleZh: "把一个绝对 http(s) URL 的媒体（图片/视频/音频，≤25MB）下载到本地素材库，返回 assetId。用于把 World 的 url 证据、网页资源收进用户自己的素材库；同一内容按哈希去重。不抓取正文或网页内容。",
		LocaleEn: "Download an absolute http(s) media URL (image/video/audio, ≤25MB) into the local media library and return its assetId. Use it to pull a World's url evidence or a web resource into the user's own library; identical content is deduplicated by hash. It never fetches article or webpage content.",
	},
	"recut.media.probe": {
		LocaleZh: "探测一个素材的客观参数（时长/宽高/帧率/是否有音轨），本地 ffprobe，纯观察。",
		LocaleEn: "Probe one asset's objective facts (duration/width/height/fps/hasAudio) locally with ffprobe; pure observation.",
	},
	"recut.media.frames": {
		LocaleZh: "按 atSec 列表或 intervalSec 区间抽取关键帧，每帧落为稳定 image 素材并返回 [{atSec,assetId}]。maxFrames 上限保护；帧数超限会报错而不是静默截断。",
		LocaleEn: "Extract frames by an explicit atSec list or an intervalSec range; each frame becomes a stable image asset and [{atSec,assetId}] is returned. maxFrames bounds the request; exceeding it errors rather than silently truncating.",
	},
	"recut.media.contactSheet": {
		LocaleZh: "在 [startSec,endSec] 上按 intervalSec 抽帧并合成带时间码的接触表（可传 transcriptAssetId 叠词标签），返回 sheetAssetId 与逐格 cells。用于快速看清整片画面节奏。",
		LocaleEn: "Extract frames across [startSec,endSec] at intervalSec and composite a timecoded contact sheet (pass transcriptAssetId to overlay word labels); returns sheetAssetId and per-cell assets. Use it to read a whole clip's visual rhythm at a glance.",
	},
	"recut.media.boundaries": {
		LocaleZh: "用 PySceneDetect 检测切点，返回 [{atSec,kind,score?}]。score 为尽力而为；快摇、强运动与叠化仍可能误检，只作参考不当作精确镜头切分。",
		LocaleEn: "Detect cuts with PySceneDetect, returning [{atSec,kind,score?}]. Scores are best-effort; fast pans, heavy motion and dissolves can still be misdetected, so treat it as a reference, not exact shot segmentation.",
	},
	"recut.media.clip": {
		LocaleZh: "把 [startSec,endSec] 精确重编码为新的 video 素材并返回 clipAssetId（重编码保证边界准确，非流拷贝）。",
		LocaleEn: "Re-encode [startSec,endSec] into a new video asset and return clipAssetId (re-encoding keeps boundaries frame-accurate; this is not a stream copy).",
	},
	"recut.media.words": {
		LocaleZh: "词级时间（可选增强，默认不要调用）：委托 audio-studio 转写并请求词级时间戳，返回 transcriptAssetId 与 wordLevel。仅在卡拉OK/词级绑定/单词删除时才开。",
		LocaleEn: "Word-level timing (optional enhancement; do not call by default): delegates transcription to audio-studio with word timestamps requested, returning transcriptAssetId and wordLevel. Only enable it for karaoke/word-binding/word-deletion work.",
	},
	"recut.media.measure": {
		LocaleZh: "纯本地估算一段文案的朗读时长（不调模型）。用于生成前判断时长与排布。",
		LocaleEn: "Estimate narration duration locally (no model call). Use it to judge length and placement before generating.",
	},
	"recut.media.reference.create": {
		LocaleZh: "把一支真实内容素材标记为参考并初始化 metadata.reference 观察组；sourceUrl 仅作溯源，不抓取、不去重。与链接型 recut.media.create_reference 不同。",
		LocaleEn: "Mark a real-content asset as a reference and initialize its metadata.reference observation group; sourceUrl is provenance only (no fetch, no dedupe). Distinct from the link-oriented recut.media.create_reference.",
	},
	"recut.media.reference.attach": {
		LocaleZh: "把观察证据（probe/transcript/frames/sheets/boundaries/clips）幂等写入参考素材的 metadata.reference：按 (kind,assetId/params) 去重，重复理解复用已有证据。只装观察，不装主观判断。",
		LocaleEn: "Idempotently write observation evidence (probe/transcript/frames/sheets/boundaries/clips) into a reference asset's metadata.reference, deduplicating by (kind,assetId/params). Observations only; never subjective judgement.",
	},
	"recut.media.asset.create": {
		LocaleZh: "创建一个无字节的计划素材（status=proposed，不花钱、不建 job）并写入 content（规格，可 @ 引用）与可选 attributes。生成时用 asset.update 补 metadata.proposal 再 confirm，产物原位填回同一 assetId。",
		LocaleEn: "Create a byte-less plan asset (status=proposed; no cost, no job) with content (the spec, may use inline @ references) and optional attributes. At generation time add metadata.proposal via asset.update, confirm, and the output fills the same assetId in place.",
	},
	"recut.media.import_media": {
		LocaleZh: "把会话工作区或目标项目内的本地视频/音频/图片文件导入为素材（≤2GB，流式读取），返回真实 assetId。用于宿主 Agent 自行下载的素材入库。",
		LocaleEn: "Import a local video/audio/image file from the session workspace or target project as an asset (≤2GB, streamed), returning the real assetId. Use it to bring host-agent-downloaded media into the library.",
	},
	"recut.media.understand.status": {
		LocaleZh: "检查理解工具的环境就绪（平台 Python venv、ffmpeg、ffprobe、PySceneDetect/Pillow/numpy）。缺失时返回需要准备，绝不静默安装。",
		LocaleEn: "Check understanding-tool readiness (platform Python venv, ffmpeg, ffprobe, PySceneDetect/Pillow/numpy). Missing pieces report as needing preparation; it never installs silently.",
	},
	"recut.media.understand.prepare": {
		LocaleZh: "异步准备平台理解环境：向全局平台 Python venv 安装锁定依赖并补齐 ffprobe，写入版本标记。返回 jobId，用 recut.job.wait 观察终态。",
		LocaleEn: "Asynchronously prepare the platform understanding environment: install the locked dependencies and ffprobe into the global platform Python venv and write a version marker. Returns a jobId; observe the terminal state with recut.job.wait.",
	},
	"recut.motion-graphic.create": {
		LocaleZh: "创建组件素材的唯一入口（异步 job）。传入一组 items（每项含 brief），平台受限作者子 Agent 构建 + 轻量验证后发布为 verified 素材并建立 type=component 引用；结果返回 assetIds[] 与 components[]。创建本身绝不插入时间线。",
		LocaleEn: "The only entry point to create component assets (async job). Given items (each with a brief), the platform's restricted author sub-agent builds and lightly verifies them into verified assets with a type=component reference; the result returns assetIds[] and components[]. Creation never inserts into the timeline.",
	},
	"recut.motion-graphic.revise": {
		LocaleZh: "修复或调整已有组件的唯一入口。传入 componentId 与 instruction；构建 + 轻量验证后生成新 head，并返回同一条 component asset 的 assetId。旧 verified head 在 job 失败前保持不变，绝不插入时间线。",
		LocaleEn: "The only entry point to fix or adjust an existing component. Given componentId and instruction, it builds and lightly verifies a new head and returns the assetId of the same component asset. The old verified head survives failures and the timeline is never touched.",
	},
	"recut.motion-graphic.update": {
		LocaleZh: "主 Agent 直接提交组件源码的新版本（绕过受限子 Agent）。传入 componentId 与完整 source；平台基于当前 verified head 开新版本，构建 + 轻量验证后成为新 verified head 进入素材库；不插入时间线。先 motion-graphic.source 读当前源码再改。",
		LocaleEn: "Main agent commits a new component source version directly (bypassing the restricted sub-agent). Given componentId and the full source, the platform opens a new version from the current verified head, builds and lightly verifies it into a new verified head in the library, never inserting into the timeline. Read the current source with motion-graphic.source first.",
	},
	"recut.motion-graphic.source": {
		LocaleZh: "读取组件某版本源码（AI 二次调整 / 主 Agent 审查的权威输入）。",
		LocaleEn: "Read a component version's source (the authoritative input for AI revision or main-agent review).",
	},
	"recut.motion-graphic.list": {
		LocaleZh: "列出组件素材数据（含 verified head 状态、inputs、mode 与对应 assetId）；素材发现与放置优先使用 asset.list 和 timeline.placeComponents.assetId。",
		LocaleEn: "List component asset data (verified head status, inputs, mode, and the matching assetId); prefer asset.list and timeline.placeComponents.assetId for discovery and placement.",
	},
	"recut.motion-graphic.archive": {
		LocaleZh: "归档组件素材：从素材库隐藏但保留版本和已有时间线引用，不修改时间线。",
		LocaleEn: "Archive a component asset: hide it from the library while keeping its versions and existing timeline references; the timeline is untouched.",
	},
	"recut.motion-graphic.verify": {
		LocaleZh: "受管组件版本验证：报告为“能构建、能跑”的轻量验证（Go esbuild + 确定性扫描 + 形状校验），报告 ok 即发布 verified head；不要求真实渲染。普通 Agent 不直接调用。",
		LocaleEn: "Managed component verification: a lightweight 'builds and runs' check (Go esbuild + determinism scan + shape check); an ok report publishes the verified head. No real rendering is required. Not called directly by ordinary agents.",
	},
}

// mcpDescription resolves a tool-level MCP description for the requested
// locale, falling back to the zh default.
func mcpDescription(locale Locale, key string) string {
	if localized, ok := mcpToolDescriptions[key]; ok {
		if text, ok := localized[locale]; ok && text != "" {
			return text
		}
		if text, ok := localized[LocaleZh]; ok {
			return text
		}
	}
	return key
}

func handleMCP(bridge *AgentBridge, host *AppHost, media *MediaService, session AgentSession, request mcpRequest) (any, error) {
	locale := DefaultLocale
	if bridge != nil && bridge.store != nil {
		locale, _ = bridge.store.StoredLocale()
	}
	switch request.Method {
	case "initialize":
		return map[string]any{"protocolVersion": "2025-03-26", "serverInfo": map[string]string{"name": "recut-mcp-host", "version": "0.3.0"}, "capabilities": map[string]any{"tools": map[string]any{}}}, nil
	case "tools/list":
		return mcpToolListForSession(bridge, media, session, locale), nil
	case "tools/call":
		input := struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}{}
		if err := json.Unmarshal(request.Params, &input); err != nil {
			return nil, err
		}
		result, err := mcpToolCall(bridge, host, media, session, input.Name, input.Arguments, locale)
		if err != nil {
			return nil, err
		}
		return truncateMCPToolResult(result), nil
	default:
		return nil, fmt.Errorf("unsupported MCP method %q", request.Method)
	}
}

func mcpToolList(bridge *AgentBridge, media *MediaService, locale Locale) map[string]any {
	return mcpToolListForSession(bridge, media, AgentSession{}, locale)
}

func mcpToolListForSession(bridge *AgentBridge, media *MediaService, session AgentSession, locale Locale) map[string]any {
	tools := platformMCPToolDefinitions(locale)
	apps, err := bridge.store.catalog.List()
	if err != nil {
		return map[string]any{"tools": visibleToolsForSession(tools, session)}
	}
	for _, app := range apps {
		tools = append(tools, appMCPToolDefinitions(app)...)
	}
	if session.AllowsTool(motion_graphic.CommitTool) && len(session.AllowedTools) > 0 {
		tools = append(tools, componentCommitToolDefinition(locale))
	}
	return map[string]any{"tools": visibleToolsForSession(tools, session)}
}

// visibleToolsForSession applies per-session tool filtering: an explicit
// AllowedTools allowlist wins, and built-in bridge sessions also drop the
// external-only tools (they rely on the core guide instead).
func visibleToolsForSession(tools []map[string]any, session AgentSession) []map[string]any {
	visible := filterSessionTools(tools, session)
	if isInternalBridgeSession(session) {
		visible = excludeTools(visible, externalOnlyTools)
	}
	return visible
}

func filterSessionTools(tools []map[string]any, session AgentSession) []map[string]any {
	if len(session.AllowedTools) == 0 {
		return tools
	}
	filtered := make([]map[string]any, 0, len(session.AllowedTools))
	for _, tool := range tools {
		name, _ := tool["name"].(string)
		if session.AllowsTool(name) {
			filtered = append(filtered, tool)
		}
	}
	return filtered
}

func componentCommitToolDefinition(locale Locale) map[string]any {
	return platformTool(motion_graphic.CommitTool, map[Locale]string{
		LocaleZh: "提交一个已完成的项目私有组件素材。只在 Component Author 完成创作后调用一次；平台构建、入库并安排验证，绝不插入时间线。",
		LocaleEn: "Commit one finished private component asset. Call exactly once when Component Author finishes; the platform builds, stores, and schedules verification, never a timeline placement.",
	}[locale], map[string]any{
		"type":     "object",
		"required": []string{"name", "surface", "source"},
		"properties": map[string]any{
			"name":     map[string]string{"type": "string"},
			"surface":  map[string]any{"type": "string", "enum": []string{"html", "react", "r3f"}},
			"keywords": map[string]any{"type": "array", "items": map[string]string{"type": "string"}},
			"inputs":   map[string]any{"type": "array", "description": "ParamDefinition[]"},
			"source":   map[string]string{"type": "string"},
		},
	})
}

// platformMCPToolDefinitions returns the global, App-agnostic MCP tools the
// platform always exposes: session context, apps/skills/project management,
// design system and media generation. They are unconditional and form the
// "全局" group in GET /v1/mcp/tools. Tool-level descriptions follow the
// requested locale; schema-internal property descriptions stay Chinese for now.
func platformMCPToolDefinitions(locale Locale) []map[string]any {
	tools := make([]map[string]any, 0)
	tools = append(tools,
		platformTool("recut.context", mcpDescription(locale, "recut.context"), map[string]any{"type": "object", "properties": map[string]any{}}),
		platformTool("recut.apps.list", mcpDescription(locale, "recut.apps.list"), map[string]any{"type": "object", "properties": map[string]any{}}),
		platformTool("recut.apps.store", mcpDescription(locale, "recut.apps.store"), map[string]any{"type": "object", "properties": map[string]any{}}),
		platformTool("recut.apps.install", mcpDescription(locale, "recut.apps.install"), map[string]any{"type": "object", "required": []string{"repository"}, "properties": map[string]any{"repository": map[string]string{"type": "string", "description": "GitHub 仓库 URL（git@… 或 https://…）。"}}}),
		platformTool("recut.apps.update", mcpDescription(locale, "recut.apps.update"), map[string]any{"type": "object", "properties": map[string]any{"package": map[string]string{"type": "string", "description": "可选：要更新的 App 包名（如 recut-ai-short-film）；缺省更新全部。"}}}),
		platformTool("recut.skills.list", mcpDescription(locale, "recut.skills.list"), map[string]any{"type": "object", "properties": map[string]any{}}),
		platformTool("recut.skills.read", mcpDescription(locale, "recut.skills.read"), map[string]any{"type": "object", "required": []string{"appId", "skillId"}, "properties": map[string]any{"appId": map[string]string{"type": "string"}, "skillId": map[string]string{"type": "string"}}}),
		platformTool("recut.skills.reference", mcpDescription(locale, "recut.skills.reference"), map[string]any{"type": "object", "required": []string{"appId", "skillId", "path"}, "properties": map[string]any{"appId": map[string]string{"type": "string"}, "skillId": map[string]string{"type": "string"}, "path": map[string]string{"type": "string"}}}),
		projectMCPToolDefinition(locale),
		platformTool("recut.project.list", mcpDescription(locale, "recut.project.list"), map[string]any{"type": "object", "properties": map[string]any{}}),
		platformTool("recut.project.get", mcpDescription(locale, "recut.project.get"), map[string]any{"type": "object", "required": []string{"projectId"}, "properties": map[string]any{"projectId": map[string]string{"type": "string"}}}),
		platformTool("recut.project_context", mcpDescription(locale, "recut.project_context"), map[string]any{"type": "object", "required": []string{"projectId"}, "properties": map[string]any{"projectId": map[string]string{"type": "string", "description": "要读取上下文的 Project Doc ID。"}}}),
		platformTool("recut.agent.run", mcpDescription(locale, "recut.agent.run"), map[string]any{"type": "object", "required": []string{"app", "operation", "payload"}, "properties": map[string]any{
			"app":       map[string]string{"type": "string", "description": "承载该子 Agent 运行的 App ID。"},
			"operation": map[string]string{"type": "string", "description": "App 用于声明 SubAgentRequest 的 background operation（返回 {subAgent:{allowedTools,prompt,...}}）。"},
			"payload":   map[string]any{"type": "object", "description": "传给该 operation 的参数。"},
			"target":    map[string]any{"type": "object", "description": "可选的 {projectId} 目标；缺省用 App 默认 scope。"},
		}}),
		platformTool("recut.job.status", mcpDescription(locale, "recut.job.status"), map[string]any{"type": "object", "required": []string{"jobId"}, "properties": map[string]any{"jobId": map[string]string{"type": "string"}}}),
		platformTool("recut.job.wait", mcpDescription(locale, "recut.job.wait"), map[string]any{"type": "object", "required": []string{"jobId"}, "properties": map[string]any{"jobId": map[string]string{"type": "string"}, "timeoutSeconds": map[string]any{"type": "number", "minimum": 1, "maximum": 15, "description": "单次最多阻塞 15 秒（Streamable HTTP 兼容，避免长阻塞连接被断开）；超时返回当前状态，需用 recut.job.status 继续轮询。长任务请用短轮询，不要设接近 300 秒。"}}}),
		platformTool("recut.job.logs", mcpDescription(locale, "recut.job.logs"), map[string]any{"type": "object", "required": []string{"jobId"}, "properties": map[string]any{"jobId": map[string]string{"type": "string"}, "limit": map[string]any{"type": "number", "minimum": 1, "maximum": 2000, "description": "只返回最近 N 行，默认 300。"}}}),
		platformTool("recut.job.cancel", mcpDescription(locale, "recut.job.cancel"), map[string]any{"type": "object", "required": []string{"jobId"}, "properties": map[string]any{"jobId": map[string]string{"type": "string"}}}),
		platformTool("recut.files.fetch", mcpDescription(locale, "recut.files.fetch"), map[string]any{"type": "object", "required": []string{"url"}, "properties": map[string]any{"url": map[string]string{"type": "string", "description": "绝对 http(s) URL（限公网地址，≤100MB）。"}, "name": map[string]string{"type": "string", "description": "可选：返回结果中的显示名称。"}}}),
	)
	tools = append(tools, mediaMCPToolDefinitions(locale)...)
	tools = append(tools, worldsMCPToolDefinitions(locale)...)
	tools = append(tools, motionGraphicMCPToolDefinitions(locale)...)
	return tools
}

// appMCPToolDefinitions returns the MCP tools an App exposes through its
// declared operations: one tool per operation whose surfaces include "mcp".
func appMCPToolDefinitions(app App) []map[string]any {
	tools := make([]map[string]any, 0)
	for _, operation := range app.Manifest.Operations {
		if !declaresOperation(app.Manifest, operation.Name, "mcp") {
			continue
		}
		tools = append(tools, map[string]any{"name": app.Manifest.ID + "." + operation.Name, "description": operation.Description, "inputSchema": wrappedOperationSchema(operation)})
	}
	return tools
}

// mcpToolGroups splits the full MCP tool set into the platform's global tools
// and per-App groups, for the settings panel to render Recut-provided MCP
// services grouped by owning App. Apps without any MCP operation are omitted.
// Tool descriptions and App metadata follow the persisted language preference
// because the settings panel has no Accept-Language header of its own.
func mcpToolGroups(bridge *AgentBridge) map[string]any {
	locale := DefaultLocale
	if bridge != nil && bridge.store != nil {
		locale, _ = bridge.store.StoredLocale()
	}
	apps, err := bridge.store.catalog.List()
	if err != nil {
		return map[string]any{"global": platformMCPToolDefinitions(locale), "apps": []map[string]any{}}
	}
	appGroups := make([]map[string]any, 0, len(apps))
	for _, app := range apps {
		tools := appMCPToolDefinitions(app)
		if len(tools) == 0 {
			continue
		}
		manifest := app.Manifest.LocalizedFor(locale)
		appGroups = append(appGroups, map[string]any{
			"appId":       manifest.ID,
			"name":        manifest.Name,
			"kind":        string(manifest.Kind),
			"description": manifest.Description,
			"tools":       tools,
		})
	}
	return map[string]any{"global": platformMCPToolDefinitions(locale), "apps": appGroups}
}

func platformTool(name, description string, schema map[string]any) map[string]any {
	return map[string]any{"name": name, "description": description, "inputSchema": schema}
}

// wrappedOperationSchema copies the App schema and adds the __recut target
// envelope without mutating the App-owned contract. additionalProperties is
// relaxed at the host boundary so an App schema with additionalProperties: false
// still accepts a legal target.
func wrappedOperationSchema(operation Operation) map[string]any {
	schema := cloneJSONMap(operation.InputSchema)
	properties := map[string]any{}
	if existing, ok := schema["properties"].(map[string]any); ok {
		for key, value := range existing {
			properties[key] = value
		}
	}
	properties["__recut"] = map[string]any{
		"type": "object",
		"properties": map[string]any{
			"target": map[string]any{
				"type":     "object",
				"required": []string{"projectId"},
				"properties": map[string]any{
					"projectId": map[string]string{"type": "string", "description": "要操作的 Project Doc ID。仅接受 owner App 的项目；缺省则落到该 App 的全局状态。"},
				},
			},
		},
	}
	schema["properties"] = properties
	schema["additionalProperties"] = true
	return schema
}

func cloneJSONMap(value map[string]any) map[string]any {
	cloned := map[string]any{}
	for key, item := range value {
		cloned[key] = item
	}
	return cloned
}

func mcpToolCall(bridge *AgentBridge, host *AppHost, media *MediaService, session AgentSession, name string, arguments map[string]any, locale Locale) (any, error) {
	if !session.AllowsTool(name) {
		return nil, fmt.Errorf("tool %q is unavailable in this focused Agent session", name)
	}
	if strings.HasPrefix(name, motion_graphic.MotionGraphicToolPrefix) {
		return motionGraphicMCPTool(bridge, host, session, name, arguments, locale)
	}
	switch name {
	case "recut.context":
		return recutContextTool(bridge, media, session, locale)
	case "recut.project_context":
		return projectContextTool(bridge, host, media, session, arguments, locale)
	case "recut.project.create":
		return projectMCPTool(bridge.store, arguments)
	case "recut.project.list":
		projects, err := bridge.store.List()
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(projects)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(projects)}, nil
	case "recut.project.get":
		projectID, _ := arguments["projectId"].(string)
		project, err := bridge.store.Get(projectID)
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(project)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(project)}, nil
	case "recut.apps.list":
		return appsListTool(bridge, locale)
	case "recut.apps.store":
		return appStoreTool(bridge, locale)
	case "recut.apps.install":
		return appsInstallTool(bridge, arguments)
	case "recut.apps.update":
		return appsUpdateTool(bridge, arguments)
	case "recut.skills.list":
		return skillsListTool(bridge, session)
	case "recut.skills.read":
		return skillReadTool(bridge, arguments)
	case "recut.skills.reference":
		return skillReferenceTool(bridge, arguments)
	case "recut.agent.run":
		return agentRunMCPTool(bridge, host, session, arguments, locale)
	case "recut.files.fetch":
		if media == nil {
			return nil, errors.New("media service is unavailable")
		}
		result, err := fetchRemoteFileTool(media.RemoteCache(), arguments)
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(result)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
	case "recut.media.understand.prepare":
		return understandPrepareTool(host, media, session, arguments)
	case "recut.media.words":
		return understandWordsTool(host, media, arguments, locale)
	}
	if isMediaMCPTool(name) {
		return mediaMCPTool(bridge.store, media, session, name, arguments)
	}
	if strings.HasPrefix(name, "recut.worlds.") {
		return worldsMCPTool(NewWorldStore(bridge.store, media, bridge.worldPublisher()), name, arguments)
	}
	if strings.HasPrefix(name, "recut.job.") {
		return jobMCPTool(bridge, host.jobs, host.async, media, name, arguments)
	}
	prefix, appID, ok := splitAppTool(name)
	if !ok {
		return nil, fmt.Errorf("tool %q is not a platform or App tool", name)
	}
	app, ok := bridge.store.catalog.Get(appID)
	if !ok {
		return nil, fmt.Errorf("app %q is unavailable", appID)
	}
	operationName := name[len(prefix):]
	if !declaresOperation(app.Manifest, operationName, "mcp") {
		return nil, fmt.Errorf("App %q does not expose MCP operation %q", appID, operationName)
	}
	target, args, err := resolveAppTarget(bridge, app, arguments)
	if err != nil {
		return nil, err
	}
	// manifest 标记 subAgent 的 op：平台通用受限子 Agent 运行（authorize → run → finalize），
	// 上下文与工具范围由 background 动态声明，无任何 App 专属 Go 代码。
	if operationIsSubAgent(app.Manifest, operationName) {
		view, err := startAppSubAgentJob(bridge, host, session, target, appID, operationName, args, locale)
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(view)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": view}, nil
	}
	result, err := host.InvokeMCPLocale(target, appID, operationName, args, locale)
	if err != nil {
		return nil, err
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

func splitAppTool(name string) (prefix, appID string, ok bool) {
	parts := strings.Split(name, ".")
	if len(parts) < 3 {
		return "", "", false
	}
	appID = strings.Join(parts[:2], ".")
	return appID + ".", appID, true
}

// resolveAppTarget applies the target resolution rules: explicit __recut.target
// > App global state. The __recut field is stripped and never reaches
// background.js. Sessions never carry a default Project; the model must pass an
// explicit target to operate on a Project.
func resolveAppTarget(bridge *AgentBridge, app App, arguments map[string]any) (Target, map[string]any, error) {
	args := map[string]any{}
	for key, value := range arguments {
		if key != "__recut" {
			args[key] = value
		}
	}
	projectID := explicitProjectID(arguments)
	if projectID != "" {
		if err := bridge.store.projectOwnedBy(projectID, app.Manifest.ID); err != nil {
			return Target{}, nil, fmt.Errorf("invalid target %q: %w", projectID, err)
		}
		return Target{ProjectID: projectID, AppID: app.Manifest.ID}, args, nil
	}
	return Target{AppID: app.Manifest.ID}, args, nil
}

func explicitProjectID(arguments map[string]any) string {
	recut, ok := arguments["__recut"].(map[string]any)
	if !ok {
		return ""
	}
	target, ok := recut["target"].(map[string]any)
	if !ok {
		return ""
	}
	projectID, _ := target["projectId"].(string)
	return strings.TrimSpace(projectID)
}

// requestedProjectID resolves a Project target for platform tools (media,
// import_image) that have no App owner: __recut target > explicit argument.
func requestedProjectID(arguments map[string]any) string {
	if projectID := explicitProjectID(arguments); projectID != "" {
		return projectID
	}
	if projectID, _ := arguments["projectId"].(string); strings.TrimSpace(projectID) != "" {
		return strings.TrimSpace(projectID)
	}
	return ""
}

// externalOnlyPlatformSkills lists platform skills that only make sense to an
// external MCP Agent: they document the url output format and connection/install
// steps (and carry the MCP registration). Built-in bridge sessions already get
// that guidance from the core guide, so the interface must not surface them.
var externalOnlyPlatformSkills = map[string]bool{"recut": true}

// isExternalMCPSession reports whether the caller is an external MCP client
// (device-token session, ID "external") rather than a built-in bridge session.
func isExternalMCPSession(session AgentSession) bool {
	return session.ID == "external"
}

// isInternalBridgeSession reports whether the caller is a built-in bridge
// session (real session id). Empty sessions (generic tool listings) are not
// treated as internal.
func isInternalBridgeSession(session AgentSession) bool {
	return session.ID != "" && session.ID != "external"
}

// externalOnlyTools are platform tools that only make sense to an external MCP
// client. Built-in bridge sessions get everything from the core guide (which
// already embeds the capability snapshot), so they must not see these - they
// would only add noise or invite redundant calls.
var externalOnlyTools = map[string]bool{"recut.context": true}

// excludeTools drops the named tools from a tool list (audience filtering).
func excludeTools(tools []map[string]any, hidden map[string]bool) []map[string]any {
	filtered := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		if name, _ := tool["name"].(string); hidden[name] {
			continue
		}
		filtered = append(filtered, tool)
	}
	return filtered
}

// capabilitySnapshot is the decision-sized capability view shared by
// recut.context and the built-in session guide: installed Apps and their
// skills, platform skills, media routes/readiness, integrations, and .recut
// paths. It carries metadata only (never skill bodies or the provider catalog).
// A nil bridge/store yields nil so callers can render the locale-only guide.
func capabilitySnapshot(bridge *AgentBridge, media *MediaService, session AgentSession, locale Locale) map[string]any {
	if bridge == nil || bridge.store == nil {
		return nil
	}
	// skills 是一张扁平清单：平台技能（appId=`recut.platform`）在前，已安装 App
	// 的技能在后——对 Agent 都是同一种可加载工作流，appId 即来源。平台技能不属于
	// 任何已安装 App，若不并入这里，World/画布这类平台能力就对 Agent 不可发现。
	// 内建桥会话已有 core guide，不再暴露只服务外部 Agent 的平台技能。
	internal := !isExternalMCPSession(session)
	skillSummary := make([]map[string]any, 0)
	if platformSkills, err := NewRecutSkillsManager(bridge.store.root).Skills(); err == nil {
		for _, skill := range platformSkills {
			if internal && externalOnlyPlatformSkills[skill.ID] {
				continue
			}
			skillSummary = append(skillSummary, map[string]any{"id": skill.ID, "appId": platformSkillAppID, "name": skill.Name, "description": skill.Description})
		}
	}
	appSummaries := make([]map[string]any, 0)
	storeApps := []StoreApp{}
	apps := []App{}
	if bridge.store.catalog != nil {
		apps, _ = bridge.store.catalog.List()
		storeApps, _ = bridge.store.AppStoreFor(locale)
	}
	for _, app := range apps {
		skills, err := app.Skills()
		if err != nil {
			continue
		}
		manifest := app.Manifest.LocalizedFor(locale)
		summary := map[string]any{"appId": manifest.ID, "name": manifest.Name, "kind": string(manifest.Kind), "description": manifest.Description, "root": app.Root}
		skillsMeta := make([]map[string]any, 0, len(skills))
		for _, skill := range skills {
			skillsMeta = append(skillsMeta, map[string]any{"id": skill.ID, "name": skill.Name, "description": skill.Description})
			skillSummary = append(skillSummary, map[string]any{"id": skill.ID, "appId": app.Manifest.ID, "name": skill.Name, "description": skill.Description})
		}
		summary["skills"] = skillsMeta
		appSummaries = append(appSummaries, summary)
	}
	mediaConfiguration, mediaReadiness := mediaContext(media)
	return map[string]any{
		"apps":         appSummaries,
		"skills":       skillSummary,
		"media":        map[string]any{"defaultRoutes": mediaConfiguration, "readiness": mediaReadiness},
		"integrations": recutIntegrationContext(apps, storeApps),
		"paths": map[string]any{
			"dataRoot":         bridge.store.root,
			"appsDir":          filepath.Join(bridge.store.root, "apps"),
			"projectsDir":      filepath.Join(bridge.store.root, "projects"),
			"sessionWorkspace": bridge.store.SessionWorkspaceDir(session.ID),
			"mediaDir":         filepath.Join(bridge.store.root, "media"),
			"modelsDir":        filepath.Join(bridge.store.root, "models"),
			"skillsDir":        filepath.Join(bridge.store.root, "skills"),
			"designSystemsDir": filepath.Join(bridge.store.root, "skills", designSystemSkillID),
		},
	}
}

func recutContextTool(bridge *AgentBridge, media *MediaService, session AgentSession, locale Locale) (any, error) {
	// 内建桥会话：能力快照与系统信息已内嵌在会话 guide（动态配置 / 当前系统信息）
	// 并由平台每轮重新注入，recut.context 只回会话身份，不再重复搬运能力载荷。
	if !isExternalMCPSession(session) {
		result := map[string]any{
			"session": map[string]any{"id": session.ID, "taskId": session.TaskID},
			"notice":  "内建会话的能力快照与系统信息已内嵌在会话 guide（动态配置 / 当前系统信息），平台每轮重新注入；无需调用 recut.context。",
		}
		data, _ := json.Marshal(result)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
	}
	// 外部 MCP 客户端没有 guide 注入点：recut.context 是其唯一能力入口，返回完整载荷。
	result := capabilitySnapshot(bridge, media, session, locale)
	if result == nil {
		result = map[string]any{}
	}
	result["session"] = map[string]any{"id": session.ID, "taskId": session.TaskID}
	result["instructions"] = bridgeInstructions
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

// recutIntegrationContext exposes platform-level optional App capabilities.
// Domain Apps consume this read-only snapshot instead of guessing whether a
// companion MCP surface is installed. Installation remains user-authorized.
func recutIntegrationContext(apps []App, storeApps []StoreApp) map[string]any {
	result := map[string]any{}
	audio := map[string]any{
		"appId":      "recut.audio-studio",
		"capability": "transcription",
		"installed":  false,
		"mcpReady":   false,
		"status":     "not-installed",
		"action":     "Use recut.apps.install with the Audio Studio repository, then start a new Agent session.",
	}
	for _, app := range apps {
		if app.Manifest.ID != "recut.audio-studio" {
			continue
		}
		audio["installed"] = true
		for _, operation := range app.Manifest.Operations {
			for _, surface := range operation.Surfaces {
				if surface == "mcp" {
					audio["mcpReady"] = true
					break
				}
			}
		}
		if audio["mcpReady"] == true {
			audio["status"] = "ready"
			audio["action"] = "Use the installed Audio Studio MCP transcription operations."
		} else {
			audio["status"] = "installed-no-mcp"
			audio["action"] = "Update or reinstall Audio Studio so its MCP operations are available, then start a new Agent session."
		}
	}
	if !audio["installed"].(bool) {
		for _, app := range storeApps {
			if app.AppID == "recut.audio-studio" {
				audio["repository"] = app.Repository
				break
			}
		}
	}
	result["audioStudio"] = audio
	return result
}

// mediaContext turns persisted routes into a decision-ready view for Agents.
// Tool discovery is static, but a provider-backed generation call is only
// possible after the user has configured its capability's default route.
// defaultRoutes is a compact projection (see mediaRoutesView): the agent acts on
// the configured default model, never the full provider catalog.
func mediaContext(media *MediaService) (any, map[string]map[string]string) {
	readiness := map[string]map[string]string{}
	for _, capability := range []MediaCapability{ImageGenerate, VideoGenerate, SpeechGenerate} {
		readiness[string(capability)] = map[string]string{
			"status":  "not-configured",
			"routeId": string(capability) + ".default",
			"action":  "Open Recut settings, connect a Provider, then choose a model for this capability.",
		}
	}
	if media == nil {
		return []map[string]any{}, readiness
	}
	configured, err := media.ConfiguredModels()
	if err != nil {
		for _, value := range readiness {
			value["status"] = "unavailable"
			value["action"] = "Reconnect to the local Recut service, then inspect its media settings."
		}
		return []map[string]any{}, readiness
	}
	for _, configuration := range configured {
		value := readiness[string(configuration.Route.Capability)]
		if configuration.Model.ID == CodexImageModelID {
			value["status"] = "codex-native"
			value["action"] = "Use Codex native image generation; do not call recut.image.generate."
			continue
		}
		if configuration.Provider.ID == "local-audio" {
			// 本机 TTS 路由就绪：Agent 应优先使用 Audio Studio 的 MCP
			// （audio.synthesize + audio.save）完成配音，recut.speech.generate 仍可用但
			// 依赖 daemon 注入的本地执行桥。
			value["status"] = "ready"
			value["routeId"] = configuration.Route.ID
			value["modelId"] = configuration.Model.ID
			value["provider"] = "local-audio"
			value["credentialName"] = configuration.CredentialName
			value["local"] = "true"
			value["action"] = "Local Audio Studio TTS is configured; use audio.synthesize + audio.save (or recut.speech.generate when the daemon bridge is wired)."
			continue
		}
		value["status"] = "ready"
		value["routeId"] = configuration.Route.ID
		value["modelId"] = configuration.Model.ID
		value["credentialName"] = configuration.CredentialName
		value["action"] = ""
	}
	return mediaRoutesView(configured), readiness
}

// mediaRoutesView is the MCP-facing, decision-sized projection of the configured
// default routes. The agent only acts on the globally configured default model per
// capability, so the full provider catalog (every model plus its display meta,
// parameter schema and voice lists) is deliberately excluded; shipping it turned
// recut.context into a truncated ~48KB payload that cost the agent extra calls to
// parse. Route identity, credential and the selected model's generation contract
// are preserved so generation and voice lookups stay possible.
func mediaRoutesView(configured []MediaConfiguration) []map[string]any {
	view := make([]map[string]any, 0, len(configured))
	for _, configuration := range configured {
		model := map[string]any{
			"id":          configuration.Model.ID,
			"name":        configuration.Model.Name,
			"provider":    configuration.Model.Provider,
			"capability":  string(configuration.Model.Capability),
			"inputModes":  configuration.Model.InputModes,
			"outputModes": configuration.Model.OutputModes,
		}
		if len(configuration.Model.Parameters) > 0 {
			model["parameters"] = configuration.Model.Parameters
		}
		view = append(view, map[string]any{
			"routeId":         configuration.Route.ID,
			"capability":      string(configuration.Route.Capability),
			"modelId":         configuration.Route.ModelID,
			"credentialId":    configuration.Route.CredentialID,
			"credentialName":  configuration.CredentialName,
			"providerName":    configuration.Provider.Name,
			"model":           model,
			"requiredInputs":  configuration.RequiredInputs,
			"optionalOutputs": configuration.OptionalOutputs,
		})
	}
	return view
}

func appsListTool(bridge *AgentBridge, locale Locale) (any, error) {
	apps, err := bridge.store.catalog.List()
	if err != nil {
		return nil, err
	}
	installations, _ := bridge.store.catalog.Installations()
	installByID := map[string]AppInstallation{}
	for _, installation := range installations {
		installByID[installation.Manifest.ID] = installation
	}
	result := make([]map[string]any, 0, len(apps))
	for _, app := range apps {
		skills, _ := app.Skills()
		skillsMeta := make([]map[string]any, 0, len(skills))
		for _, skill := range skills {
			skillsMeta = append(skillsMeta, map[string]any{"id": skill.ID, "name": skill.Name, "description": skill.Description})
		}
		manifest := app.Manifest.LocalizedFor(locale)
		entry := map[string]any{"appId": manifest.ID, "name": manifest.Name, "kind": string(manifest.Kind), "description": manifest.Description, "skills": skillsMeta}
		if installation, ok := installByID[app.Manifest.ID]; ok {
			entry["package"] = installation.Package
			entry["repository"] = installation.Repository
			entry["revision"] = installation.Revision
			entry["dirty"] = installation.Dirty
			entry["updateAvailable"] = installation.UpdateAvailable
			entry["manageable"] = installation.Manageable
			entry["status"] = installation.Status
		}
		result = append(result, entry)
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

func appStoreTool(bridge *AgentBridge, locale Locale) (any, error) {
	store, err := bridge.store.AppStoreFor(locale)
	if err != nil {
		return nil, err
	}
	installed := map[string]bool{}
	for _, app := range bridge.store.catalog.snapshotApps() {
		installed[app.Manifest.ID] = true
	}
	result := make([]map[string]any, 0, len(store))
	for _, app := range store {
		result = append(result, map[string]any{
			"appId": app.AppID, "name": app.Name, "description": app.Description,
			"kind": app.Kind, "repository": app.Repository, "installed": installed[app.AppID],
		})
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

func appsInstallTool(bridge *AgentBridge, arguments map[string]any) (any, error) {
	repository, _ := arguments["repository"].(string)
	if strings.TrimSpace(repository) == "" {
		return nil, errors.New("repository is required")
	}
	installed, err := bridge.store.catalog.InstallGitHub(strings.TrimSpace(repository))
	if err != nil {
		return nil, err
	}
	data, _ := json.Marshal(installed)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(installed)}, nil
}

func appsUpdateTool(bridge *AgentBridge, arguments map[string]any) (any, error) {
	packageName, _ := arguments["package"].(string)
	if strings.TrimSpace(packageName) != "" {
		updated, err := bridge.store.catalog.UpdateInstallation(strings.TrimSpace(packageName))
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(updated)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(updated)}, nil
	}
	result, err := bridge.store.catalog.UpdateInstallations()
	if err != nil {
		return nil, err
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

func skillsListTool(bridge *AgentBridge, session AgentSession) (any, error) {
	result := []map[string]any{}
	internal := !isExternalMCPSession(session)
	if platformSkills, err := NewRecutSkillsManager(bridge.store.root).Skills(); err == nil {
		for _, skill := range platformSkills {
			if internal && externalOnlyPlatformSkills[skill.ID] {
				continue
			}
			result = append(result, map[string]any{"id": skill.ID, "appId": platformSkillAppID, "name": skill.Name, "description": skill.Description})
		}
	}
	apps, err := bridge.store.catalog.List()
	if err != nil {
		return nil, err
	}
	for _, app := range apps {
		skills, err := app.Skills()
		if err != nil {
			continue
		}
		for _, skill := range skills {
			result = append(result, map[string]any{"id": skill.ID, "appId": app.Manifest.ID, "name": skill.Name, "description": skill.Description})
		}
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

func skillReadTool(bridge *AgentBridge, arguments map[string]any) (any, error) {
	appID, _ := arguments["appId"].(string)
	skillID, _ := arguments["skillId"].(string)
	// Platform skills are daemon-owned (not installed Apps): resolve them from
	// the synced skill source tree so Agents can read them like any App skill.
	if appID == platformSkillAppID && bridge.store != nil {
		root := filepath.Join(bridge.store.root, "skills", filepath.Base(skillID))
		body, err := os.ReadFile(filepath.Join(root, "SKILL.md"))
		if err != nil {
			return nil, fmt.Errorf("read platform skill %q: %w", skillID, err)
		}
		name, description, references, resources := parseSkillFrontmatter(string(body))
		result := map[string]any{"id": skillID, "appId": platformSkillAppID, "name": name, "description": description, "body": string(body), "references": references, "resources": resources}
		data, _ := json.Marshal(result)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
	}
	app, ok := bridge.store.catalog.Get(appID)
	if !ok {
		return nil, fmt.Errorf("app %q is unavailable", appID)
	}
	skills, err := app.Skills()
	if err != nil {
		return nil, err
	}
	for _, skill := range skills {
		if skill.ID == skillID {
			data, _ := json.Marshal(map[string]any{"id": skill.ID, "appId": skill.AppID, "name": skill.Name, "description": skill.Description, "body": skill.Body, "references": skill.References, "resources": skill.Resources})
			return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(map[string]any{"id": skill.ID, "appId": skill.AppID, "name": skill.Name, "description": skill.Description, "body": skill.Body, "references": skill.References, "resources": skill.Resources})}, nil
		}
	}
	return nil, fmt.Errorf("skill %q is not provided by app %q", skillID, appID)
}

func skillReferenceTool(bridge *AgentBridge, arguments map[string]any) (any, error) {
	appID, _ := arguments["appId"].(string)
	skillID, _ := arguments["skillId"].(string)
	path, _ := arguments["path"].(string)
	// Platform skill references resolve from the daemon-owned source dir
	// (Ensure() deploys each skill tree there; targets symlink it).
	if appID == platformSkillAppID && bridge.store != nil {
		root := filepath.Join(bridge.store.root, "skills", filepath.Base(skillID))
		resolvedRoot, err := filepath.EvalSymlinks(root)
		if err != nil {
			return nil, fmt.Errorf("resolve platform skill root: %w", err)
		}
		for _, candidate := range skillReferenceCandidates(path) {
			resolved, resolveErr := filepath.EvalSymlinks(filepath.Join(root, candidate))
			if errors.Is(resolveErr, os.ErrNotExist) {
				continue
			}
			if resolveErr != nil {
				return nil, fmt.Errorf("resolve skill reference: %w", resolveErr)
			}
			relative, relativeErr := filepath.Rel(resolvedRoot, resolved)
			if relativeErr != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
				return nil, fmt.Errorf("skill reference escapes the skill directory")
			}
			info, statErr := os.Stat(resolved)
			if statErr != nil || info.IsDir() {
				continue
			}
			content, readErr := os.ReadFile(resolved)
			if readErr != nil {
				return nil, readErr
			}
			result := map[string]any{"appId": appID, "skillId": skillID, "path": filepath.ToSlash(relative), "content": string(content)}
			data, _ := json.Marshal(result)
			return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
		}
		return nil, fmt.Errorf("skill reference is unavailable")
	}
	app, ok := bridge.store.catalog.Get(appID)
	if !ok {
		return nil, fmt.Errorf("app %q is unavailable", appID)
	}
	skills, err := app.Skills()
	if err != nil {
		return nil, err
	}
	for _, skill := range skills {
		if skill.ID != skillID {
			continue
		}
		root := filepath.Clean(skill.Root)
		resolvedRoot, err := filepath.EvalSymlinks(root)
		if err != nil {
			return nil, fmt.Errorf("resolve skill root: %w", err)
		}
		for _, candidate := range skillReferenceCandidates(path) {
			resolved, resolveErr := filepath.EvalSymlinks(filepath.Join(root, candidate))
			if errors.Is(resolveErr, os.ErrNotExist) {
				continue
			}
			if resolveErr != nil {
				return nil, fmt.Errorf("resolve skill reference: %w", resolveErr)
			}
			relative, relativeErr := filepath.Rel(resolvedRoot, resolved)
			if relativeErr != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
				return nil, fmt.Errorf("skill reference escapes the skill directory")
			}
			info, statErr := os.Stat(resolved)
			if statErr != nil || info.IsDir() {
				continue
			}
			content, readErr := os.ReadFile(resolved)
			if readErr != nil {
				return nil, readErr
			}
			result := map[string]any{"appId": appID, "skillId": skillID, "path": filepath.ToSlash(relative), "content": string(content)}
			data, _ := json.Marshal(result)
			return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
		}
		return nil, fmt.Errorf("skill reference is unavailable")
	}
	return nil, fmt.Errorf("skill %q is not provided by app %q", skillID, appID)
}

func skillReferenceCandidates(path string) []string {
	clean := filepath.Clean(path)
	if path == "" || filepath.IsAbs(path) || clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return nil
	}
	if clean == "references" || strings.HasPrefix(clean, "references"+string(filepath.Separator)) {
		return []string{clean}
	}
	return []string{clean, filepath.Join("references", clean)}
}

func projectMCPToolDefinition(locale Locale) map[string]any {
	return map[string]any{
		"name":        "recut.project.create",
		"description": mcpDescription(locale, "recut.project.create"),
		"inputSchema": map[string]any{
			"type":     "object",
			"required": []string{"name", "appId"},
			"properties": map[string]any{
				"name":  map[string]string{"type": "string", "description": "新项目的显示名称。"},
				"appId": map[string]string{"type": "string", "description": "承载该项目的 owner App ID。"},
			},
		},
	}
}

func projectMCPTool(store *Store, input map[string]any) (any, error) {
	name, _ := input["name"].(string)
	appID, _ := input["appId"].(string)
	project, err := store.Create(CreateInput{Name: name, AppID: appID})
	if err != nil {
		return nil, err
	}
	data, _ := json.Marshal(project)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(project)}, nil
}

// mediaAssetFilterFromInput maps list_assets tool arguments onto the SQL-side
// MediaAssetFilter. ids accepts an array or a comma-separated string; kind/
// status/query narrow the set; limit/offset paginate. An exact ids lookup
// ignores the other predicates by contract (see MediaAssetFilter).
func mediaAssetFilterFromInput(input map[string]any) MediaAssetFilter {
	filter := MediaAssetFilter{
		Kind:   stringValue(input["kind"]),
		Status: stringValue(input["status"]),
		Query:  stringValue(input["query"]),
	}
	switch ids := input["ids"].(type) {
	case []any:
		for _, raw := range ids {
			if id, ok := raw.(string); ok && id != "" {
				filter.IDs = append(filter.IDs, id)
			}
		}
	case string:
		for _, id := range strings.Split(ids, ",") {
			if id = strings.TrimSpace(id); id != "" {
				filter.IDs = append(filter.IDs, id)
			}
		}
	}
	if limit := numericValue(input["limit"]); limit > 0 {
		filter.Limit = int(limit)
	}
	if offset := numericValue(input["offset"]); offset > 0 {
		filter.Offset = int(offset)
	}
	return filter
}

func mediaMCPTool(store *Store, media *MediaService, session AgentSession, name string, input map[string]any) (any, error) {
	var result any
	var err error
	switch name {
	case "recut.image.generate", "recut.video.generate", "recut.speech.generate":
		capability := map[string]MediaCapability{"recut.image.generate": ImageGenerate, "recut.video.generate": VideoGenerate, "recut.speech.generate": SpeechGenerate}[name]
		propose, proposeErr := media.ShouldPropose(mediaGenerationInput(input, capability), stringValue(input["mode"]))
		if proposeErr != nil {
			err = proposeErr
			break
		}
		if propose {
			var asset MediaAsset
			asset, err = media.Propose(proposalInputFromMCP(input, capability))
			if err == nil {
				result = mediaAssetView(asset)
			}
			break
		}
		job, generateErr := media.Generate(mediaGenerationInput(input, capability))
		err = generateErr
		if err == nil {
			result = mediaJobView(job)
		}
	case "recut.media.propose":
		capability := MediaCapability(stringValue(input["capability"]))
		asset, proposeErr := media.Propose(proposalInputFromMCP(input, capability))
		err = proposeErr
		if err == nil {
			result = mediaAssetView(asset)
		}
	case "recut.media.list_proposals":
		projectID := requestedProjectID(input)
		if workspace, _ := input["workspace"].(bool); workspace {
			projectID = ""
		}
		page, listErr := media.ListProposals(projectID, mediaAssetFilterFromInput(input))
		err = listErr
		if err == nil {
			result = page
		}
	case "recut.media.update_proposal":
		asset, updateErr := media.UpdateProposal(stringValue(input["assetId"]), proposalPatchFromMCP(input))
		err = updateErr
		if err == nil {
			result = mediaAssetView(asset)
		}
	case "recut.media.confirm_proposal":
		job, confirmErr := media.ConfirmProposal(stringValue(input["assetId"]), proposalPatchPointerFromMCP(input))
		err = confirmErr
		if err == nil {
			result = mediaJobView(job)
		}
	case "recut.media.reject_proposal":
		assetID := stringValue(input["assetId"])
		err = media.RejectProposal(assetID)
		result = map[string]any{"assetId": assetID, "rejected": err == nil}
	case "recut.media.list_voices":
		credentialID, _ := input["credentialId"].(string)
		result, err = media.ListVoices(credentialID)
	case "recut.media.list_capability_voices":
		capability, _ := input["capability"].(string)
		result, err = media.CapabilityVoiceGroups(MediaCapability(capability))
	case "recut.media.get_job":
		id, _ := input["jobId"].(string)
		job, getErr := media.GetJob(id)
		err = getErr
		if err == nil {
			result = mediaJobView(job)
		}
	case "recut.media.wait_for_job":
		id, _ := input["jobId"].(string)
		job, waitErr := media.WaitForTerminalJob(id, mediaWaitTimeout(input))
		err = waitErr
		if err == nil {
			result = mediaJobView(job)
		}
	case "recut.media.list_assets":
		workspace, _ := input["workspace"].(bool)
		projectID := requestedProjectID(input)
		if workspace {
			projectID = ""
		}
		result, err = media.ListAssetsFiltered(projectID, mediaAssetFilterFromInput(input))
	case "recut.media.asset.get":
		asset, getErr := media.GetAsset(stringValue(input["assetId"]))
		err = getErr
		if err == nil {
			result = materialAssetView(asset)
		}
	case "recut.media.asset.update":
		update, decodeErr := materialUpdateFromMCP(input)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		asset, updateErr := media.UpdateMaterial(stringValue(input["assetId"]), update, MaterialActorAgent, "asset.update")
		err = updateErr
		if err == nil {
			result = materialAssetView(asset)
		}
	case "recut.media.import_image":
		result, err = importNativeImage(store, media, session, input)
	case "recut.media.create_reference":
		result, err = media.CreateReferenceAsset(ReferenceAssetInput{
			Name: stringValue(input["name"]), URL: stringValue(input["url"]), SourceKind: stringValue(input["sourceKind"]),
			Summary: stringValue(input["summary"]), Description: stringValue(input["description"]), Excerpt: stringValue(input["excerpt"]),
			Author: stringValue(input["author"]), PublishedAt: stringValue(input["publishedAt"]), SiteName: stringValue(input["siteName"]),
			Language: stringValue(input["language"]), ThumbnailURL: stringValue(input["thumbnailUrl"]),
			Content: stringValue(input["content"]), ContentMimeType: stringValue(input["contentMimeType"]),
			ImageData: stringValue(input["imageData"]), ImageMimeType: stringValue(input["imageMimeType"]),
			ChannelName: stringValue(input["channelName"]), ChannelURL: stringValue(input["channelUrl"]),
			DurationSec: numericValue(input["durationSeconds"]), ViewCount: int64(numericValue(input["viewCount"])), LikeCount: int64(numericValue(input["likeCount"])),
		})
	case "recut.media.attach":
		id, _ := input["assetId"].(string)
		err = media.Attach(id, requestedProjectID(input))
		result = map[string]any{"assetId": id, "projectId": requestedProjectID(input), "attached": err == nil}
	case "recut.media.import_url":
		result, err = importMediaURL(media, input)
	case "recut.media.import_media":
		result, err = importLocalMedia(store, media, session, input)
	case "recut.media.probe":
		probe, probeErr := media.UnderstandProbe(context.Background(), stringValue(input["assetId"]))
		err = probeErr
		if probeErr == nil {
			result = map[string]any{
				"assetId": stringValue(input["assetId"]), "durationSec": probe.DurationSec,
				"width": probe.Width, "height": probe.Height, "fps": probe.FPS, "hasAudio": probe.HasAudio,
			}
		}
	case "recut.media.frames":
		var framesResult UnderstandFramesResult
		framesResult, err = media.UnderstandFrames(context.Background(), UnderstandFramesInput{
			AssetID:   stringValue(input["assetId"]),
			AtSec:     numberSlice(input["atSec"]),
			Interval:  numericValue(input["intervalSec"]),
			StartSec:  optionalNumber(input["startSec"]),
			EndSec:    optionalNumber(input["endSec"]),
			MaxFrames: int(numericValue(input["maxFrames"])),
			ProjectID: requestedProjectID(input),
		})
		if err == nil {
			result = framesResult
		}
	case "recut.media.contactSheet":
		var sheetResult UnderstandContactSheetResult
		sheetResult, err = media.UnderstandContactSheet(context.Background(), UnderstandContactSheetInput{
			AssetID:           stringValue(input["assetId"]),
			StartSec:          optionalNumber(input["startSec"]),
			EndSec:            optionalNumber(input["endSec"]),
			Interval:          numericValue(input["intervalSec"]),
			Columns:           int(numericValue(input["columns"])),
			CellPx:            int(numericValue(input["cellPx"])),
			TranscriptAssetID: stringValue(input["transcriptAssetId"]),
			ProjectID:         requestedProjectID(input),
		})
		if err == nil {
			result = sheetResult
		}
	case "recut.media.boundaries":
		var boundariesResult UnderstandBoundariesResult
		boundariesResult, err = media.UnderstandBoundaries(context.Background(), UnderstandBoundariesInput{
			AssetID:   stringValue(input["assetId"]),
			Threshold: numericValue(input["threshold"]),
			MinGapSec: numericValue(input["minGapSec"]),
		})
		if err == nil {
			result = boundariesResult
		}
	case "recut.media.clip":
		var clipResult UnderstandClipResult
		clipResult, err = media.UnderstandClip(context.Background(), stringValue(input["assetId"]), numericValue(input["startSec"]), numericValue(input["endSec"]), requestedProjectID(input))
		if err == nil {
			result = clipResult
		}
	case "recut.media.measure":
		result = media.UnderstandMeasure(MeasureRequestInput{
			Text: stringValue(input["text"]), Language: stringValue(input["language"]), Pace: numericValue(input["pace"]),
		})
	case "recut.media.reference.create":
		var asset MediaAsset
		asset, err = media.CreateReference(stringValue(input["assetId"]), stringValue(input["sourceUrl"]))
		if err == nil {
			result = materialAssetView(asset)
		}
	case "recut.media.reference.attach":
		attach, decodeErr := referenceAttachFromMCP(input)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		var asset MediaAsset
		asset, err = media.AttachReferenceEvidence(attach)
		if err == nil {
			result = materialAssetView(asset)
		}
	case "recut.media.asset.create":
		var attributes []MaterialAttr
		if raw, ok := input["attributes"]; ok && raw != nil {
			attributes, err = decodeMaterialAttrs(raw)
			if err != nil {
				break
			}
		}
		var asset MediaAsset
		asset, err = media.CreatePlaceholderAsset(PlaceholderAssetInput{
			Name: stringValue(input["name"]), Kind: stringValue(input["kind"]),
			Content: stringValue(input["content"]), Attributes: attributes,
			ProjectID: requestedProjectID(input),
		})
		if err == nil {
			result = materialAssetView(asset)
		}
	case "recut.media.understand.status":
		result = media.UnderstandEnvironment(context.Background())
	default:
		return nil, fmt.Errorf("unknown media tool %q", name)
	}
	if err != nil {
		if strings.Contains(err.Error(), "no route configured for ") {
			return nil, fmt.Errorf("%w; open Recut settings, connect a Provider, then choose the default model for this capability", err)
		}
		return nil, err
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

// OpenCode 将 MCP structuredContent 校验为 record。文本负载保留原始结果，
// 仅把列表装入稳定的对象信封。
func structuredMCPContent(result any) any {
	value := reflect.ValueOf(result)
	if value.IsValid() && (value.Kind() == reflect.Array || value.Kind() == reflect.Slice) {
		return map[string]any{"items": result}
	}
	return result
}

// mcpToolTextBudget caps the JSON text payload of any single tools/call result.
// A tool that dumps an unbounded list (e.g. the whole media library) must never
// flood the Agent context or overflow a line-oriented transport downstream.
// Oversized payloads are spilled to a deterministic temp file and returned as a
// structured truncation envelope, so the size is data the Agent can act on —
// query with filter parameters or read the spilled file — not a silent failure.
const mcpToolTextBudget = 48 << 10

// mcpToolPreviewBytes keeps a readable prefix of the oversized payload in the
// envelope itself; it is a byte prefix of the JSON text, not valid JSON.
const mcpToolPreviewBytes = 8 << 10

// truncateMCPToolResult enforces mcpToolTextBudget on the text content of a
// tools/call envelope. Results at or under budget pass through untouched; the
// platform tools and every installed App's MCP tool share this single funnel.
func truncateMCPToolResult(result any) any {
	envelope, ok := result.(map[string]any)
	if !ok {
		return result
	}
	text := mcpEnvelopeText(envelope)
	if len(text) <= mcpToolTextBudget {
		return result
	}
	path, err := writeMCPToolOverflow([]byte(text))
	if err != nil {
		log.Printf("WARN mcp tool output overflow spill failed: %v", err)
		path = ""
	}
	preview := text
	if len(preview) > mcpToolPreviewBytes {
		preview = preview[:mcpToolPreviewBytes]
	}
	notice := map[string]any{
		"truncated":      true,
		"totalBytes":     len(text),
		"preview":        preview,
		"fullOutputPath": path,
		"hint":           "工具输出超过 48KB 已截断。优先用查询/过滤/分页参数缩小结果重新调用；确需完整数据时用本地文件工具读取 fullOutputPath。",
	}
	data, err := json.Marshal(notice)
	if err != nil {
		return result
	}
	return map[string]any{
		"content":           []map[string]string{{"type": "text", "text": string(data)}},
		"structuredContent": structuredMCPContent(notice),
	}
}

// mcpEnvelopeText extracts the first text content string from a tools/call
// result envelope. Both content shapes used in this service are supported; an
// unrecognized shape returns "" and passes through unmodified.
func mcpEnvelopeText(envelope map[string]any) string {
	switch content := envelope["content"].(type) {
	case []map[string]string:
		if len(content) > 0 {
			return content[0]["text"]
		}
	case []any:
		if len(content) > 0 {
			if item, ok := content[0].(map[string]string); ok {
				return item["text"]
			}
		}
	}
	return ""
}

// writeMCPToolOverflow spills an oversized tool payload to a content-addressed
// temp file and returns its absolute path. The hash-based name dedupes repeats
// of the same oversized output within a boot.
func writeMCPToolOverflow(data []byte) (string, error) {
	sum := sha256.Sum256(data)
	path := filepath.Join(os.TempDir(), fmt.Sprintf("recut-tool-output-%x.json", sum))
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	return path, os.WriteFile(path, data, 0o600)
}

// mediaJobView exposes an async generation job under the explicit `jobId` key
// that wait_for_job / get_job / recut.job.* accept, so an Agent never has to
// guess that the job's `id` field is its jobId. assetIds stay the stable
// project references and kind marks this as a media job in the unified view.
func mediaJobView(job MediaJob) map[string]any {
	return map[string]any{
		"jobId":      job.ID,
		"id":         job.ID,
		"kind":       "media",
		"capability": job.Capability,
		"status":     job.Status,
		"modelId":    job.ModelID,
		"assetIds":   job.AssetIDs,
		"remoteId":   job.RemoteID,
		"error":      job.Error,
	}
}

func mediaMCPToolDefinitions(locale Locale) []map[string]any {
	tools := []map[string]any{
		{"name": "recut.image.generate", "description": mcpDescription(locale, "recut.image.generate"), "inputSchema": mediaGenerationSchema("生成提示词。", true, false, false)},
		{"name": "recut.video.generate", "description": mcpDescription(locale, "recut.video.generate"), "inputSchema": mediaGenerationSchema("生成提示词。", true, true, true)},
		{"name": "recut.speech.generate", "description": mcpDescription(locale, "recut.speech.generate"), "inputSchema": speechGenerationSchema()},
		{"name": "recut.media.list_voices", "description": mcpDescription(locale, "recut.media.list_voices"), "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"credentialId": map[string]string{"type": "string", "description": "云端语音 provider 的凭据 ID；本机 TTS 可传 local-audio 或留空返回 Audio Studio 默认音。"}}}},
		{"name": "recut.media.list_capability_voices", "description": mcpDescription(locale, "recut.media.list_capability_voices"), "inputSchema": map[string]any{"type": "object", "required": []string{"capability"}, "properties": map[string]any{"capability": map[string]any{"type": "string", "enum": []string{"speech.generate"}, "description": "要聚合声音的能力；当前 speech.generate 提供动态 voices，其他能力返回空列表。"}}}},
		{"name": "recut.media.get_job", "description": mcpDescription(locale, "recut.media.get_job"), "inputSchema": map[string]any{"type": "object", "required": []string{"jobId"}, "properties": map[string]any{"jobId": map[string]string{"type": "string"}}}},
		{"name": "recut.media.wait_for_job", "description": mcpDescription(locale, "recut.media.wait_for_job"), "inputSchema": map[string]any{"type": "object", "required": []string{"jobId"}, "properties": map[string]any{"jobId": map[string]string{"type": "string"}, "timeoutSeconds": map[string]any{"type": "number", "minimum": 1, "maximum": 15, "description": "单次最多阻塞 15 秒（Streamable HTTP 兼容，避免长阻塞连接被断开）；超时返回当前状态，需继续轮询。长任务请用短轮询，不要设接近 300 秒。"}}}},
		{"name": "recut.media.list_assets", "description": mcpDescription(locale, "recut.media.list_assets"), "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"projectId": map[string]string{"type": "string", "description": "可选的 Project target；缺省返回 workspace 级素材。"}, "workspace": map[string]string{"type": "boolean"}, "ids": map[string]any{"type": "array", "items": map[string]string{"type": "string"}, "description": "精确 assetId 列表（也接受逗号分隔字符串）；用于按已知 ID 取回完整记录，给定时忽略 kind/query 等其他过滤。"}, "kind": map[string]string{"type": "string", "description": "按素材类型过滤：image / video / audio / transcript 等。"}, "status": map[string]string{"type": "string", "description": "按状态过滤（如 completed / queued / running）；缺省排除 deleted。"}, "query": map[string]string{"type": "string", "description": "按名称模糊匹配。"}, "limit": map[string]any{"type": "integer", "description": "分页大小，默认 200，上限 500。"}, "offset": map[string]any{"type": "integer", "description": "分页偏移；结合返回的 total 判断是否还有下一页。"}}}},
		{"name": "recut.media.asset.get", "description": mcpDescription(locale, "recut.media.asset.get"), "inputSchema": map[string]any{"type": "object", "required": []string{"assetId"}, "properties": map[string]any{"assetId": map[string]string{"type": "string", "description": "要读取完整创作信息的素材 assetId。"}}}},
		{"name": "recut.media.asset.update", "description": mcpDescription(locale, "recut.media.asset.update"), "inputSchema": map[string]any{"type": "object", "required": []string{"assetId"}, "properties": map[string]any{
			"assetId":    map[string]string{"type": "string"},
			"name":       map[string]string{"type": "string", "description": "新的展示名。"},
			"content":    map[string]string{"type": "string", "description": "非结构化长正文（markdown）；服务端同时写入 contentMeta 溯源。"},
			"attributes": map[string]any{"type": "array", "items": map[string]any{"type": "object"}, "description": "整体替换：有序 typed 属性 [{key,label,type,value,options?,locked?}]；locked 结构不可改、可改值。"},
			"attrPatch":  map[string]any{"type": "array", "items": map[string]any{"type": "object"}, "description": "按 key 合并的局部更新；未提供的字段保持不变，新 key 追加。"},
		}}},
		{"name": "recut.media.import_image", "description": mcpDescription(locale, "recut.media.import_image"), "inputSchema": map[string]any{"type": "object", "required": []string{"path"}, "properties": map[string]any{"path": map[string]string{"type": "string", "description": "本机图片路径：会话工作区相对路径或系统绝对路径（~/ 会展开）；最终文件必须落在会话工作区或目标 Project 内，Codex 原生图请先写入工作区再用相对路径归档。"}, "name": map[string]string{"type": "string", "description": "可选的素材显示名称。"}, "projectId": map[string]string{"type": "string", "description": "可选的 Project target；缺省落到 workspace 级素材。"}}}},
		{"name": "recut.media.create_reference", "description": mcpDescription(locale, "recut.media.create_reference"), "inputSchema": map[string]any{"type": "object", "required": []string{"name", "url", "sourceKind"}, "properties": map[string]any{"name": map[string]string{"type": "string", "description": "来源标题。"}, "url": map[string]string{"type": "string", "description": "公开的绝对 http(s) URL；作为全局去重身份。"}, "sourceKind": map[string]string{"type": "string", "description": "如 article、web、youtube、xiaohongshu、douyin、image。"}, "summary": map[string]string{"type": "string", "description": "该来源的简短事实摘要。"}, "description": map[string]string{"type": "string", "description": "来源自身的简介或视频简介。"}, "excerpt": map[string]string{"type": "string", "description": "直接引用的原文片段，便于审阅。"}, "author": map[string]string{"type": "string", "description": "作者或发布者名称。"}, "publishedAt": map[string]string{"type": "string", "description": "发布时间（ISO-8601）。"}, "siteName": map[string]string{"type": "string", "description": "站点名称，如 The New York Times。"}, "language": map[string]string{"type": "string", "description": "内容语言代码，如 zh、en。"}, "thumbnailUrl": map[string]string{"type": "string", "description": "来源封面/缩略图 URL。"}, "content": map[string]string{"type": "string", "description": "文章或网页的完整正文（真实文章数据）；保存为 content part，默认 text/markdown。"}, "contentMimeType": map[string]string{"type": "string", "description": "正文 part 的 MIME 类型，缺省 text/markdown；限 text/*、application/json、application/xml。"}, "imageData": map[string]string{"type": "string", "description": "图片内容（base64 或 data: URL）；保存为不可变的 image part，限 20MB。"}, "imageMimeType": map[string]string{"type": "string", "description": "图片 MIME 类型，如 image/png、image/jpeg。"}, "channelName": map[string]string{"type": "string", "description": "YouTube 等视频平台的频道/账号名。"}, "channelUrl": map[string]string{"type": "string", "description": "频道主页 URL。"}, "durationSeconds": map[string]any{"type": "number", "description": "视频时长（秒）。"}, "viewCount": map[string]any{"type": "integer", "description": "播放量。"}, "likeCount": map[string]any{"type": "integer", "description": "点赞数。"}}}},
		{"name": "recut.media.attach", "description": mcpDescription(locale, "recut.media.attach"), "inputSchema": map[string]any{"type": "object", "required": []string{"assetId", "projectId"}, "properties": map[string]any{"assetId": map[string]string{"type": "string"}, "projectId": map[string]string{"type": "string"}}}},
		{"name": "recut.media.import_url", "description": mcpDescription(locale, "recut.media.import_url"), "inputSchema": map[string]any{"type": "object", "required": []string{"url"}, "properties": map[string]any{"url": map[string]string{"type": "string", "description": "绝对 http(s) URL，限 image/video/audio、≤25MB。"}, "name": map[string]string{"type": "string", "description": "可选的素材显示名称；缺省取 URL 末段。"}, "projectId": map[string]string{"type": "string", "description": "可选的 Project target；提供时同时关联到该项目。"}}}},
		{"name": "recut.media.import_media", "description": mcpDescription(locale, "recut.media.import_media"), "inputSchema": map[string]any{"type": "object", "required": []string{"path"}, "properties": map[string]any{"path": map[string]string{"type": "string", "description": "本机视频/音频/图片文件路径：会话工作区相对路径或系统绝对路径（~/ 会展开）；最终文件必须落在会话工作区或目标 Project 内。"}, "name": map[string]string{"type": "string", "description": "可选的素材显示名称。"}, "mimeType": map[string]string{"type": "string", "description": "可选；缺省按扩展名/内容探测。"}, "projectId": map[string]string{"type": "string", "description": "可选的 Project target；缺省落到 workspace 级素材。"}}}},
		{"name": "recut.media.probe", "description": mcpDescription(locale, "recut.media.probe"), "inputSchema": map[string]any{"type": "object", "required": []string{"assetId"}, "properties": map[string]any{"assetId": map[string]string{"type": "string", "description": "已完成的本地 video/audio/image 素材。"}}}},
		{"name": "recut.media.frames", "description": mcpDescription(locale, "recut.media.frames"), "inputSchema": map[string]any{"type": "object", "required": []string{"assetId"}, "properties": map[string]any{
			"assetId":     map[string]string{"type": "string"},
			"atSec":       map[string]any{"type": "array", "items": map[string]any{"type": "number"}, "description": "精确时间点列表（与 intervalSec 二选一）。"},
			"intervalSec": map[string]any{"type": "number", "description": "等间隔抽帧（默认区间为整片）。"},
			"startSec":    map[string]any{"type": "number"},
			"endSec":      map[string]any{"type": "number"},
			"maxFrames":   map[string]any{"type": "integer", "description": "帧数上限，默认 24、硬上限 120；超出报错。"},
			"projectId":   map[string]string{"type": "string", "description": "可选；把衍生帧素材关联到该项目。"},
		}}},
		{"name": "recut.media.contactSheet", "description": mcpDescription(locale, "recut.media.contactSheet"), "inputSchema": map[string]any{"type": "object", "required": []string{"assetId", "intervalSec"}, "properties": map[string]any{
			"assetId":           map[string]string{"type": "string"},
			"startSec":          map[string]any{"type": "number"},
			"endSec":            map[string]any{"type": "number"},
			"intervalSec":       map[string]any{"type": "number"},
			"columns":           map[string]any{"type": "integer", "description": "列数；缺省取近似正方。"},
			"cellPx":            map[string]any{"type": "integer", "description": "单元格边长像素，默认 320。"},
			"transcriptAssetId": map[string]string{"type": "string", "description": "可选；提供时叠词标签。"},
			"projectId":         map[string]string{"type": "string"},
		}}},
		{"name": "recut.media.boundaries", "description": mcpDescription(locale, "recut.media.boundaries"), "inputSchema": map[string]any{"type": "object", "required": []string{"assetId"}, "properties": map[string]any{
			"assetId":   map[string]string{"type": "string"},
			"threshold": map[string]any{"type": "number", "description": "ContentDetector 阈值，缺省检测器默认。"},
			"minGapSec": map[string]any{"type": "number", "description": "切点最小间隔（去抖），缺省 0。"},
		}}},
		{"name": "recut.media.clip", "description": mcpDescription(locale, "recut.media.clip"), "inputSchema": map[string]any{"type": "object", "required": []string{"assetId", "startSec", "endSec"}, "properties": map[string]any{
			"assetId":   map[string]string{"type": "string"},
			"startSec":  map[string]any{"type": "number"},
			"endSec":    map[string]any{"type": "number"},
			"projectId": map[string]string{"type": "string"},
		}}},
		{"name": "recut.media.words", "description": mcpDescription(locale, "recut.media.words"), "inputSchema": map[string]any{"type": "object", "properties": map[string]any{
			"assetId":           map[string]string{"type": "string", "description": "本地 audio/video 素材；与 transcriptAssetId 二选一。"},
			"transcriptAssetId": map[string]string{"type": "string", "description": "已有 transcript 素材；与 assetId 二选一。"},
			"language":          map[string]string{"type": "string", "description": "auto/zh/en，缺省 auto。"},
			"model":             map[string]string{"type": "string", "description": "ASR 模型，缺省 whisper-small。"},
		}}},
		{"name": "recut.media.measure", "description": mcpDescription(locale, "recut.media.measure"), "inputSchema": map[string]any{"type": "object", "required": []string{"text"}, "properties": map[string]any{
			"text":     map[string]string{"type": "string"},
			"language": map[string]string{"type": "string"},
			"pace":     map[string]any{"type": "number", "description": "语速倍率，缺省 1.0。"},
		}}},
		{"name": "recut.media.reference.create", "description": mcpDescription(locale, "recut.media.reference.create"), "inputSchema": map[string]any{"type": "object", "required": []string{"assetId"}, "properties": map[string]any{
			"assetId":   map[string]string{"type": "string"},
			"sourceUrl": map[string]string{"type": "string", "description": "仅作溯源，不抓取、不去重。"},
		}}},
		{"name": "recut.media.reference.attach", "description": mcpDescription(locale, "recut.media.reference.attach"), "inputSchema": map[string]any{"type": "object", "required": []string{"assetId"}, "properties": map[string]any{
			"assetId":     map[string]string{"type": "string", "description": "参考素材 assetId。"},
			"sourceUrl":   map[string]string{"type": "string"},
			"source":      map[string]any{"type": "object", "description": "{assetId,durationSec,width,height,fps,hasAudio}。"},
			"transcript":  map[string]any{"type": "object", "description": "{assetId,language,wordLevel}。"},
			"frames":      map[string]any{"type": "array", "items": map[string]any{"type": "object"}, "description": "[{atSec,assetId}]。"},
			"sheets":      map[string]any{"type": "array", "items": map[string]any{"type": "object"}, "description": "[{range:[start,end],assetId,transcriptAssetId?}]。"},
			"boundaries":  map[string]any{"type": "array", "items": map[string]any{"type": "object"}, "description": "[{atSec,kind,score?}]。"},
			"clips":       map[string]any{"type": "array", "items": map[string]any{"type": "object"}, "description": "[{startSec,endSec,assetId,label?}]。"},
			"toolVersion": map[string]string{"type": "string"},
		}}},
		{"name": "recut.media.asset.create", "description": mcpDescription(locale, "recut.media.asset.create"), "inputSchema": map[string]any{"type": "object", "required": []string{"name", "kind"}, "properties": map[string]any{
			"name":       map[string]string{"type": "string"},
			"kind":       map[string]any{"type": "string", "enum": []string{"video", "image", "audio", "code"}},
			"content":    map[string]string{"type": "string", "description": "计划规格（富文本，可 @ 引用证据/角色/World）。"},
			"attributes": map[string]any{"type": "array", "items": map[string]any{"type": "object"}, "description": "可选结构化字段 [{key,label,type,value}]。"},
			"projectId":  map[string]string{"type": "string"},
		}}},
		{"name": "recut.media.understand.status", "description": mcpDescription(locale, "recut.media.understand.status"), "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
		{"name": "recut.media.understand.prepare", "description": mcpDescription(locale, "recut.media.understand.prepare"), "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
	}
	return append(tools, proposalMCPToolDefinitions()...)
}

func mediaWaitTimeout(input map[string]any) time.Duration {
	// 与 recut.job.wait 一致：单次等待封顶 15s（Streamable HTTP 兼容），避免长阻塞连接被断开。
	max := agentJobWaitWindow
	seconds, _ := input["timeoutSeconds"].(float64)
	if seconds <= 0 || time.Duration(seconds*float64(time.Second)) > max {
		return max
	}
	return time.Duration(seconds * float64(time.Second))
}

// jobMCPTool implements the unified platform job observation surface
// (recut.job.*). Local App shell jobs, App/UI deferred handles (async_ops) and
// platform media generation jobs all live behind the same jobId namespace:
// status/wait look up focused Component Author jobs, then shell jobs, then
// deferred handles, then media jobs; every view carries a `kind` discriminator.
// Author diagnostics are exposed through logs and cancellation propagates to
// the child Codex process.
func jobMCPTool(bridge *AgentBridge, jobs *ShellJobManager, async *AsyncOpsManager, media *MediaService, name string, input map[string]any) (any, error) {
	jobID, _ := input["jobId"].(string)
	if strings.TrimSpace(jobID) == "" {
		return nil, errors.New("jobId is required")
	}
	var result any
	var err error
	switch name {
	case "recut.job.status":
		if view, ok := bridge.agentJobView(jobID); ok {
			result = view
		} else {
			result, err = unifiedJobStatus(jobs, async, media, jobID)
		}
	case "recut.job.wait":
		if view, ok := bridge.waitAgentJob(jobID, jobWaitTimeout(input)); ok {
			result = view
		} else {
			result, err = unifiedJobWait(jobs, async, media, jobID, jobWaitTimeout(input))
		}
	case "recut.job.logs":
		if view, ok := bridge.agentJobView(jobID); ok {
			result = map[string]any{"jobId": jobID, "kind": "sub-agent", "diagnostics": view}
			break
		}
		var logs []ShellJobLog
		logs, err = jobs.LogsByID(jobID)
		if err == nil {
			result = jobLogViews(logs, input)
		} else if _, asyncErr := async.FindByID(jobID); asyncErr == nil {
			// deferred Handle 无进程日志；生命周期事件在项目账本。
			result = map[string]any{"jobId": jobID, "kind": "deferred", "logs": []any{}}
			err = nil
		}
	case "recut.job.cancel":
		if cancelled, ok := bridge.cancelAgentJob(jobID); ok {
			result = cancelled
			break
		}
		var job ShellJob
		job, err = jobs.FindByID(jobID)
		if err == nil {
			if job.Status != ShellJobQueued && job.Status != ShellJobRunning {
				result = map[string]any{"jobId": jobID, "kind": "shell", "cancelled": false, "status": string(job.Status)}
				break
			}
			err = jobs.CancelByID(jobID)
			result = map[string]any{"jobId": jobID, "kind": "shell", "cancelled": err == nil}
			break
		}
		if op, asyncErr := async.FindByID(jobID); asyncErr == nil {
			if op.Status != AsyncOpPending && op.Status != AsyncOpRunning {
				result = map[string]any{"jobId": jobID, "kind": "deferred", "cancelled": false, "status": string(op.Status)}
				break
			}
			if _, cancelErr := async.Cancel(jobID); cancelErr != nil {
				err = cancelErr
				break
			}
			result = map[string]any{"jobId": jobID, "kind": "deferred", "cancelled": true, "status": "cancelled"}
			err = nil
			break
		}
		err = errors.New("job not found")
	default:
		return nil, fmt.Errorf("unknown job tool %q", name)
	}
	if err != nil {
		return nil, err
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

// unifiedJobStatus reads one job by a shared jobId. Shell jobs and deferred
// handles are checked first (both local), then the media store.
func unifiedJobStatus(jobs *ShellJobManager, async *AsyncOpsManager, media *MediaService, jobID string) (any, error) {
	if shell, err := jobs.FindByID(jobID); err == nil {
		view := jobView(shell)
		view["kind"] = "shell"
		return view, nil
	}
	if op, err := async.FindByID(jobID); err == nil {
		return asyncOpView(op), nil
	}
	if media == nil {
		return nil, errors.New("job not found")
	}
	job, err := media.GetJob(jobID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("job not found")
	}
	if err != nil {
		return nil, err
	}
	view := mediaJobView(job)
	view["kind"] = "media"
	return view, nil
}

// unifiedJobWait waits for any backend to reach a terminal state. Both wait
// contracts return the current (possibly non-terminal) job once the timeout is
// reached, so the Agent can keep polling with status.
func unifiedJobWait(jobs *ShellJobManager, async *AsyncOpsManager, media *MediaService, jobID string, timeout time.Duration) (any, error) {
	if shell, err := jobs.WaitByID(jobID, timeout); err == nil {
		view := jobView(shell)
		view["kind"] = "shell"
		return view, nil
	}
	deadline := time.Now().Add(timeout)
	for {
		op, err := async.FindByID(jobID)
		if err == nil {
			if op.Status != AsyncOpPending && op.Status != AsyncOpRunning {
				return asyncOpView(op), nil
			}
			if time.Now().After(deadline) {
				return asyncOpView(op), nil
			}
			time.Sleep(250 * time.Millisecond)
			continue
		}
		break
	}
	if media == nil {
		return nil, errors.New("job not found")
	}
	job, err := media.WaitForTerminalJob(jobID, timeout)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("job not found")
	}
	if err != nil {
		return nil, err
	}
	view := mediaJobView(job)
	view["kind"] = "media"
	return view, nil
}

func jobView(job ShellJob) map[string]any {
	view := map[string]any{
		"id":        job.ID,
		"projectId": job.ProjectID,
		"appId":     job.AppID,
		"status":    string(job.Status),
		"exitCode":  job.ExitCode,
		"error":     job.Error,
	}
	if job.StartedAt != nil {
		view["startedAt"] = job.StartedAt.UTC().Format(time.RFC3339Nano)
	}
	if job.EndedAt != nil {
		view["endedAt"] = job.EndedAt.UTC().Format(time.RFC3339Nano)
	}
	if job.CreatedAt != nil {
		view["createdAt"] = job.CreatedAt.UTC().Format(time.RFC3339Nano)
	}
	return view
}

// jobWaitTimeout 是 recut.job.wait 单次阻塞窗口。阻塞 HTTP 长轮询与 Streamable
// HTTP 传输不兼容（连接会在任务收尾/空闲期被断开，2026-08-21 会话复现 EOF）；因此无论
// 调用方传多少 timeout，单次等待都被封顶到 agentJobWaitWindow，超时返回当前状态由
// 调用方继续轮询，连接永不长期占用。
func jobWaitTimeout(input map[string]any) time.Duration {
	max := agentJobWaitWindow
	seconds, _ := input["timeoutSeconds"].(float64)
	if seconds <= 0 || time.Duration(seconds*float64(time.Second)) > max {
		return max
	}
	return time.Duration(seconds * float64(time.Second))
}

func jobLogViews(logs []ShellJobLog, input map[string]any) []map[string]any {
	limit := int64(300)
	if value, ok := input["limit"].(float64); ok && value > 0 {
		limit = int64(value)
	}
	if limit > 2000 {
		limit = 2000
	}
	views := make([]map[string]any, 0, len(logs))
	for _, entry := range logs {
		views = append(views, shellLogMap(entry))
	}
	if limit < int64(len(views)) {
		views = views[len(views)-int(limit):]
	}
	return views
}

func importNativeImage(store *Store, media *MediaService, session AgentSession, input map[string]any) (MediaAsset, error) {
	rawPath, _ := input["path"].(string)
	name, _ := input["name"].(string)
	trimmed := strings.TrimSpace(rawPath)
	if trimmed == "" {
		return MediaAsset{}, fmt.Errorf("path must be a non-empty file path")
	}
	if strings.HasPrefix(trimmed, "~/") || strings.HasPrefix(trimmed, `~\`) {
		if home, err := os.UserHomeDir(); err == nil {
			trimmed = filepath.Join(home, strings.TrimPrefix(trimmed[1:], string(filepath.Separator)))
		}
	}
	// The import base is always the session workspace. Native images are
	// written into the workspace root; a resolved file must stay inside the
	// workspace or an explicitly targeted Project root. Absolute paths from
	// the local machine are accepted but still sandboxed to allowedRoots.
	workspaceDir := store.SessionWorkspaceDir(session.ID)
	if err := os.MkdirAll(workspaceDir, 0o755); err != nil {
		return MediaAsset{}, err
	}
	base, err := filepath.EvalSymlinks(workspaceDir)
	if err != nil {
		return MediaAsset{}, err
	}
	var candidate string
	if filepath.IsAbs(trimmed) {
		candidate = filepath.Clean(trimmed)
	} else {
		candidate = filepath.Join(base, filepath.Clean(trimmed))
	}
	path, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return MediaAsset{}, fmt.Errorf("resolve image path: %w", err)
	}
	allowedRoots := []string{base}
	projectID := requestedProjectID(input)
	if projectID != "" {
		if projectRoot, rootErr := filepath.EvalSymlinks(store.projectDir(projectID)); rootErr == nil {
			allowedRoots = append(allowedRoots, projectRoot)
		}
	}
	if !withinAllowedRoots(allowedRoots, path) {
		return MediaAsset{}, fmt.Errorf("path must remain inside the session workspace or the target Project")
	}
	info, err := os.Stat(path)
	if err != nil {
		return MediaAsset{}, err
	}
	if !info.Mode().IsRegular() {
		return MediaAsset{}, fmt.Errorf("path must point to a regular image file")
	}
	if info.Size() > 20<<20 {
		return MediaAsset{}, fmt.Errorf("image exceeds the 20 MB import limit")
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return MediaAsset{}, err
	}
	mimeType := http.DetectContentType(content)
	if !strings.HasPrefix(mimeType, "image/") {
		return MediaAsset{}, fmt.Errorf("path must contain a supported image file")
	}
	if strings.TrimSpace(name) == "" {
		name = filepath.Base(path)
	}
	return media.ImportNativeImage(projectID, name, mimeType, content)
}

func withinAllowedRoots(roots []string, path string) bool {
	for _, root := range roots {
		relative, err := filepath.Rel(root, path)
		if err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative) {
			return true
		}
	}
	return false
}

// resolveSessionFilePath resolves a user-supplied path to a real file inside the
// session workspace or the explicitly targeted Project, mirroring
// importNativeImage's sandbox rules. The returned projectID is the resolved
// target (may be empty).
func resolveSessionFilePath(store *Store, session AgentSession, input map[string]any) (string, string, error) {
	trimmed := strings.TrimSpace(stringValue(input["path"]))
	if trimmed == "" {
		return "", "", errors.New("path must be a non-empty file path")
	}
	if strings.HasPrefix(trimmed, "~/") || strings.HasPrefix(trimmed, `~\`) {
		if home, err := os.UserHomeDir(); err == nil {
			trimmed = filepath.Join(home, strings.TrimPrefix(trimmed[1:], string(filepath.Separator)))
		}
	}
	workspaceDir := store.SessionWorkspaceDir(session.ID)
	if err := os.MkdirAll(workspaceDir, 0o755); err != nil {
		return "", "", err
	}
	base, err := filepath.EvalSymlinks(workspaceDir)
	if err != nil {
		return "", "", err
	}
	var candidate string
	if filepath.IsAbs(trimmed) {
		candidate = filepath.Clean(trimmed)
	} else {
		candidate = filepath.Join(base, filepath.Clean(trimmed))
	}
	path, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", "", fmt.Errorf("resolve path: %w", err)
	}
	projectID := requestedProjectID(input)
	allowedRoots := []string{base}
	if projectID != "" {
		if projectRoot, rootErr := filepath.EvalSymlinks(store.projectDir(projectID)); rootErr == nil {
			allowedRoots = append(allowedRoots, projectRoot)
		}
	}
	if !withinAllowedRoots(allowedRoots, path) {
		return "", "", errors.New("path must remain inside the session workspace or the target Project")
	}
	return path, projectID, nil
}

// importLocalMedia streams a local video/audio/image file into the asset
// library. It closes the M3 gap where a host agent's own download had no MCP
// entry; unlike import_image it accepts any media kind and does not buffer the
// file in memory.
func importLocalMedia(store *Store, media *MediaService, session AgentSession, input map[string]any) (MediaAsset, error) {
	path, projectID, err := resolveSessionFilePath(store, session, input)
	if err != nil {
		return MediaAsset{}, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return MediaAsset{}, err
	}
	if !info.Mode().IsRegular() {
		return MediaAsset{}, errors.New("path must point to a regular media file")
	}
	if info.Size() > 2<<30 {
		return MediaAsset{}, errors.New("media exceeds the 2 GB import limit")
	}
	mimeType := strings.TrimSpace(stringValue(input["mimeType"]))
	if mimeType == "" {
		mimeType = mime.TypeByExtension(strings.ToLower(filepath.Ext(path)))
	}
	if mimeType == "" {
		if file, openErr := os.Open(path); openErr == nil {
			header := make([]byte, 512)
			read, _ := file.Read(header)
			_ = file.Close()
			mimeType = http.DetectContentType(header[:read])
		}
	}
	file, err := os.Open(path)
	if err != nil {
		return MediaAsset{}, err
	}
	defer file.Close()
	name := strings.TrimSpace(stringValue(input["name"]))
	if name == "" {
		name = filepath.Base(path)
	}
	asset, err := media.ImportMediaReader(name, mimeType, file)
	if err != nil {
		return MediaAsset{}, err
	}
	if projectID != "" {
		if attachErr := media.Attach(asset.ID, projectID); attachErr != nil {
			return MediaAsset{}, attachErr
		}
	}
	return asset, nil
}

// numberSlice coerces a JSON array of numbers into []float64.
func numberSlice(value any) []float64 {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	numbers := make([]float64, 0, len(items))
	for _, item := range items {
		numbers = append(numbers, numericValue(item))
	}
	return numbers
}

// optionalNumber returns a pointer to the supplied number, or nil when absent.
func optionalNumber(value any) *float64 {
	if value == nil {
		return nil
	}
	number := numericValue(value)
	return &number
}

// referenceAttachFromMCP decodes the loosely-typed reference.attach evidence via
// a JSON round-trip into the typed contract.
func referenceAttachFromMCP(input map[string]any) (ReferenceAttachInput, error) {
	attach := ReferenceAttachInput{
		AssetID:     stringValue(input["assetId"]),
		SourceURL:   stringValue(input["sourceUrl"]),
		ToolVersion: stringValue(input["toolVersion"]),
	}
	if raw, ok := input["source"]; ok && raw != nil {
		source := ReferenceSource{}
		if err := decodeJSONValue(raw, &source); err != nil {
			return ReferenceAttachInput{}, fmt.Errorf("source must be an object: %w", err)
		}
		attach.Source = &source
	}
	if raw, ok := input["transcript"]; ok && raw != nil {
		transcript := ReferenceTranscript{}
		if err := decodeJSONValue(raw, &transcript); err != nil {
			return ReferenceAttachInput{}, fmt.Errorf("transcript must be an object: %w", err)
		}
		attach.Transcript = &transcript
	}
	for key, target := range map[string]any{
		"frames":     &attach.Frames,
		"sheets":     &attach.Sheets,
		"boundaries": &attach.Boundaries,
		"clips":      &attach.Clips,
	} {
		raw, ok := input[key]
		if !ok || raw == nil {
			continue
		}
		if err := decodeJSONValue(raw, target); err != nil {
			return ReferenceAttachInput{}, fmt.Errorf("%s must be an array: %w", key, err)
		}
	}
	return attach, nil
}

func decodeJSONValue(raw any, target any) error {
	data, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}

// understandPrepareTool prepares the platform understanding environment. It is
// the only understanding path that writes to disk, runs as an observable shell
// job, and is never triggered implicitly by a read-only tool.
func understandPrepareTool(host *AppHost, media *MediaService, session AgentSession, arguments map[string]any) (any, error) {
	if host == nil || host.jobs == nil {
		return nil, errors.New("job manager is unavailable")
	}
	if media == nil {
		return nil, errors.New("media service is unavailable")
	}
	command, args, ok := media.UnderstandPrepareArgs()
	if !ok {
		return nil, errors.New("平台 Python venv 尚未就绪；请先重新运行 Recut 安装器，再调用 recut.media.understand.prepare")
	}
	job, err := host.jobs.Start(ShellJobStart{
		ProjectID:      requestedProjectID(arguments),
		AppID:          platformSkillAppID,
		Command:        command,
		Args:           args,
		Dir:            media.DataDir(),
		TimeoutSeconds: 1800,
	})
	if err != nil {
		return nil, err
	}
	view := map[string]any{"jobId": job.ID, "id": job.ID, "kind": "shell", "status": string(job.Status)}
	data, _ := json.Marshal(view)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": view}, nil
}

// understandWordsTool requests word-level timing. It delegates to audio-studio
// through the capability bridge (the platform never copies the ASR model), and
// is opt-in only: callers must ask for it explicitly.
func understandWordsTool(host *AppHost, media *MediaService, arguments map[string]any, locale Locale) (any, error) {
	if media == nil {
		return nil, errors.New("media service is unavailable")
	}
	if transcriptAssetID := stringValue(arguments["transcriptAssetId"]); transcriptAssetID != "" {
		wordLevel, err := media.TranscriptWordLevel(transcriptAssetID)
		if err != nil {
			return nil, err
		}
		result := map[string]any{"transcriptAssetId": transcriptAssetID, "transcriptId": transcriptAssetID, "wordLevel": wordLevel}
		data, _ := json.Marshal(result)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": result}, nil
	}
	assetID := stringValue(arguments["assetId"])
	if assetID == "" {
		return nil, errors.New("word-level transcription needs assetId or transcriptAssetId")
	}
	if host == nil {
		return nil, errors.New("app host is unavailable")
	}
	kind := "video"
	if asset, err := media.GetAsset(assetID); err == nil {
		kind = asset.Kind
	}
	model := stringValue(arguments["model"])
	if model == "" {
		model = "whisper-small"
	}
	language := stringValue(arguments["language"])
	if language == "" {
		language = "auto"
	}
	caller := Target{ProjectID: requestedProjectID(arguments), AppID: platformSkillAppID}
	envelope, err := host.capabilityInvoke(caller, "recut.audio-studio", "audio.transcribe", map[string]any{
		"assetId": assetID, "kind": kind, "model": model, "language": language,
		"saveToLibrary": true, "wordTimestamps": true,
	}, "transcribe", locale)
	if err != nil {
		return nil, err
	}
	if ok, _ := envelope["ok"].(bool); !ok {
		return nil, fmt.Errorf("word-level transcription failed: %v", envelope["error"])
	}
	view := map[string]any{"assetId": assetID, "model": model, "language": language, "wordLevel": true, "wordTimestampsRequested": true}
	if result, ok := envelope["result"].(map[string]any); ok {
		if job, ok := result["job"].(map[string]any); ok {
			view["jobId"] = job["id"]
			view["kind"] = "media"
		}
		if transcript, ok := result["transcript"].(map[string]any); ok {
			view["transcriptId"] = transcript["id"]
			view["transcriptAssetId"] = transcript["assetId"]
		}
	}
	data, _ := json.Marshal(view)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": view}, nil
}

func isMediaMCPTool(name string) bool {
	for _, tool := range mediaMCPToolDefinitions(DefaultLocale) {
		if tool["name"] == name {
			return true
		}
	}
	return false
}

func mediaGenerationSchema(textDescription string, imageReferences, videoReferences, audioReferences bool) map[string]any {
	properties := map[string]any{
		"text":           map[string]any{"type": "string", "description": textDescription},
		"route":          map[string]any{"type": "string", "description": "可选的同类媒体 route；未提供时使用项目默认 route。"},
		"output":         map[string]any{"type": "object", "description": "当前模型契约允许的可选输出参数。"},
		"idempotencyKey": map[string]any{"type": "string"},
		"mode":           map[string]any{"type": "string", "enum": []string{"propose", "generate"}, "description": "缺省按策略：video（及标记 requiresProposal 的高价模型）先 propose 落提案，用户确认后才生成；generate 为直生逃生门。"},
		"modelId":        map[string]any{"type": "string", "description": "可选；与 credentialId 成对时直连该模型。"},
		"credentialId":   map[string]any{"type": "string", "description": "可选；与 modelId 成对时直连该凭据。"},
	}
	for key, description := range proposalExtraProperties {
		properties[key] = description
	}
	if imageReferences {
		properties["imageAssetIds"] = map[string]any{"type": "array", "items": map[string]string{"type": "string"}, "description": "作为图片参考的全局 assetId。"}
	}
	if videoReferences {
		properties["videoAssetIds"] = map[string]any{"type": "array", "items": map[string]string{"type": "string"}, "description": "作为视频参考的全局 assetId。"}
	}
	if audioReferences {
		properties["audioAssetIds"] = map[string]any{"type": "array", "items": map[string]string{"type": "string"}, "description": "作为音频参考的全局 assetId。"}
	}
	return map[string]any{"type": "object", "required": []string{"text"}, "properties": properties}
}

// proposalExtraProperties are the proposal-only fields shared by generation and
// propose tools: reference role bindings and the reviewable recipe extras.
var proposalExtraProperties = map[string]any{
	"references": map[string]any{"type": "array", "description": "生成参考的角色绑定记录（顺序即提交顺序）；每项 {id, kind, role, label}，role↔kind 不匹配或未知 role 会被拒绝。",
		"items": map[string]any{"type": "object", "required": []string{"id"}, "properties": map[string]any{
			"id":    map[string]any{"type": "string", "description": "参考素材 assetId。"},
			"kind":  map[string]any{"type": "string", "enum": []string{"image", "video", "audio"}},
			"role":  map[string]any{"type": "string", "description": "受控 role：pov/color-card/environment/character/prop/style-ref/motion-ref/voice/sfx/music。"},
			"label": map[string]any{"type": "string"},
		}}},
	"aspectRatio": map[string]any{"type": "string", "description": "提案画幅（如 9:16）。"},
	"durationSec": map[string]any{"type": "number", "description": "提案时长（秒）。"},
	"note":        map[string]any{"type": "string", "description": "提案意图/承接关系，供用户判断。"},
	"batchId":     map[string]any{"type": "string", "description": "同一场戏分镜的归组 id。"},
	"proposedBy":  map[string]any{"type": "string", "enum": []string{"agent", "user"}},
	"origin": map[string]any{"type": "object", "description": "发起方可追溯信息。", "properties": map[string]any{
		"appId": map[string]any{"type": "string"}, "projectId": map[string]any{"type": "string"},
		"worldId": map[string]any{"type": "string"}, "entityId": map[string]any{"type": "string"},
	}},
}

func proposalMCPToolDefinitions() []map[string]any {
	proposeProperties := map[string]any{
		"capability":    map[string]any{"type": "string", "enum": []string{"image.generate", "video.generate", "speech.generate"}},
		"text":          map[string]any{"type": "string", "description": "生成提示词。"},
		"route":         map[string]any{"type": "string"},
		"modelId":       map[string]any{"type": "string"},
		"credentialId":  map[string]any{"type": "string"},
		"output":        map[string]any{"type": "object"},
		"imageAssetIds": map[string]any{"type": "array", "items": map[string]string{"type": "string"}},
		"videoAssetIds": map[string]any{"type": "array", "items": map[string]string{"type": "string"}},
		"audioAssetIds": map[string]any{"type": "array", "items": map[string]string{"type": "string"}},
	}
	for key, value := range proposalExtraProperties {
		proposeProperties[key] = value
	}
	updateProperties := map[string]any{
		"assetId":      map[string]any{"type": "string", "description": "要修改的提案资产 assetId。"},
		"text":         map[string]any{"type": "string", "description": "新的生成提示词。"},
		"modelId":      map[string]any{"type": "string"},
		"credentialId": map[string]any{"type": "string"},
		"output":       map[string]any{"type": "object"},
	}
	for _, key := range []string{"references", "aspectRatio", "durationSec", "note"} {
		updateProperties[key] = proposalExtraProperties[key]
	}
	confirmProperties := map[string]any{
		"assetId":      map[string]any{"type": "string", "description": "要确认的提案资产 assetId。"},
		"text":         map[string]any{"type": "string"},
		"modelId":      map[string]any{"type": "string"},
		"credentialId": map[string]any{"type": "string"},
		"output":       map[string]any{"type": "object"},
	}
	for _, key := range []string{"references", "aspectRatio", "durationSec", "note"} {
		confirmProperties[key] = proposalExtraProperties[key]
	}
	return []map[string]any{
		{"name": "recut.media.propose", "description": "创建一个生成提案（任意 capability）：校验模型/参考后落为全局 proposed 资产，不建任务、不花钱，等用户确认。参考用 references[] 声明 role；视频默认也走本入口。", "inputSchema": map[string]any{"type": "object", "required": []string{"capability", "text"}, "properties": proposeProperties}},
		{"name": "recut.media.list_proposals", "description": "列出 proposed 状态的生成提案（可按 projectId 过滤，分页）。用于查看待确认/失败/已确认的提案；确认权只在用户。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"projectId": map[string]any{"type": "string"}, "workspace": map[string]any{"type": "boolean"}, "limit": map[string]any{"type": "integer"}, "offset": map[string]any{"type": "integer"}}}},
		{"name": "recut.media.update_proposal", "description": "确认前原地修改提案配方（提示词/参考/模型/参数/画幅/时长/备注）。仅对 proposed 资产生效，其它状态拒绝。", "inputSchema": map[string]any{"type": "object", "required": []string{"assetId"}, "properties": updateProperties}},
		{"name": "recut.media.confirm_proposal", "description": "用户确认提案：把同一 proposed 资产转为真实生成任务（复用 assetId，引用无需重指）。这是唯一花钱动作；Agent 不得代用户确认，只由 UI/用户显式触发。", "inputSchema": map[string]any{"type": "object", "required": []string{"assetId"}, "properties": confirmProperties}},
		{"name": "recut.media.reject_proposal", "description": "放弃一个提案（软删墓碑，保留记录）。仅由用户/UI 触发。", "inputSchema": map[string]any{"type": "object", "required": []string{"assetId"}, "properties": map[string]any{"assetId": map[string]any{"type": "string"}}}},
	}
}

func speechGenerationSchema() map[string]any {
	schema := mediaGenerationSchema("需要朗读的旁白文本。", false, false, false)
	schema["required"] = []string{"text"}
	properties := schema["properties"].(map[string]any)
	properties["voiceId"] = map[string]any{"type": "string", "description": "由 recut.media.list_voices 返回的当前 Provider 音色 ID；本地路由可省略（用默认音）。"}
	properties["modelId"] = map[string]any{"type": "string", "description": "可选；与 credentialId 成对传入时直连该模型+凭据路由（如用非默认 provider 的声音），缺省走 speech.generate 默认路由。"}
	properties["credentialId"] = map[string]any{"type": "string", "description": "可选；与 modelId 成对传入时生效，指定云端凭据。"}
	return schema
}

func mediaGenerationInput(input map[string]any, capability MediaCapability) GenerateMediaInput {
	prompt, _ := input["text"].(string)
	route, _ := input["route"].(string)
	key, _ := input["idempotencyKey"].(string)
	output, _ := input["output"].(map[string]any)
	if output == nil {
		output = map[string]any{}
	} else {
		copied := map[string]any{}
		for key, value := range output {
			copied[key] = value
		}
		output = copied
	}
	if voiceID, _ := input["voiceId"].(string); voiceID != "" {
		output["voiceId"] = voiceID
	}
	// modelId + credentialId 成对出现时直连该路由（绕过默认路由），供跨 provider 声音选择。
	modelID, _ := input["modelId"].(string)
	credentialID, _ := input["credentialId"].(string)
	return GenerateMediaInput{Capability: capability, Prompt: prompt, Route: route, ModelID: modelID, CredentialID: credentialID, ReferenceIDs: mediaReferenceIDs(input), Output: output, ProjectID: requestedProjectID(input), IdempotencyKey: key}
}

func stringsFromAny(value any) []string {
	values, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		if item, ok := value.(string); ok {
			result = append(result, item)
		}
	}
	return result
}

func mediaReferenceIDs(input map[string]any) []string {
	ids := append([]string{}, stringsFromAny(input["imageAssetIds"])...)
	ids = append(ids, stringsFromAny(input["videoAssetIds"])...)
	return append(ids, stringsFromAny(input["audioAssetIds"])...)
}

// proposalInputFromMCP maps a generation/propose tool call into a proposal.
// Reference roles/labels travel in the optional `references` array; the flat
// image/video/audioAssetIds remain the submission order.
func proposalInputFromMCP(input map[string]any, capability MediaCapability) ProposeInput {
	prompt, _ := input["text"].(string)
	route, _ := input["route"].(string)
	modelID, _ := input["modelId"].(string)
	credentialID, _ := input["credentialId"].(string)
	output, _ := input["output"].(map[string]any)
	if output == nil {
		output = map[string]any{}
	} else {
		copied := map[string]any{}
		for key, value := range output {
			copied[key] = value
		}
		output = copied
	}
	if voiceID, _ := input["voiceId"].(string); voiceID != "" {
		output["voiceId"] = voiceID
	}
	return ProposeInput{
		Capability:     capability,
		Route:          route,
		ModelID:        modelID,
		CredentialID:   credentialID,
		Prompt:         prompt,
		ReferenceIDs:   mediaReferenceIDs(input),
		ReferencesMeta: proposalReferencesFromMCP(input),
		Output:         output,
		ProjectID:      requestedProjectID(input),
		AspectRatio:    stringValue(input["aspectRatio"]),
		DurationSec:    numericValue(input["durationSec"]),
		Note:           stringValue(input["note"]),
		ProposedBy:     stringValue(input["proposedBy"]),
		BatchID:        stringValue(input["batchId"]),
		Origin:         proposalOriginFromMCP(input),
	}
}

func proposalReferencesFromMCP(input map[string]any) []ProposalReference {
	items, ok := input["references"].([]any)
	if !ok || len(items) == 0 {
		return nil
	}
	references := []ProposalReference{}
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		reference := ProposalReference{ID: stringValue(item["id"]), Kind: stringValue(item["kind"]), Role: stringValue(item["role"]), Label: stringValue(item["label"])}
		if reference.ID == "" {
			continue
		}
		references = append(references, reference)
	}
	return references
}

func proposalOriginFromMCP(input map[string]any) *ProposalOrigin {
	raw, ok := input["origin"].(map[string]any)
	if !ok {
		return nil
	}
	origin := &ProposalOrigin{AppID: stringValue(raw["appId"]), ProjectID: stringValue(raw["projectId"]), WorldID: stringValue(raw["worldId"]), EntityID: stringValue(raw["entityId"])}
	if *origin == (ProposalOrigin{}) {
		return nil
	}
	return origin
}

// proposalPatchFromMCP collects only the fields the caller actually supplied;
// absent fields stay nil so the merge leaves them unchanged.
func proposalPatchFromMCP(input map[string]any) ProposalPatch {
	patch := ProposalPatch{}
	if value, ok := input["text"].(string); ok {
		patch.Prompt = &value
	} else if value, ok := input["prompt"].(string); ok {
		patch.Prompt = &value
	}
	if value, ok := input["modelId"].(string); ok {
		patch.ModelID = &value
	}
	if value, ok := input["credentialId"].(string); ok {
		patch.CredentialID = &value
	}
	if value, ok := input["output"].(map[string]any); ok {
		patch.Output = value
	}
	if raw, present := input["references"]; present && raw != nil {
		references := proposalReferencesFromMCP(input)
		patch.References = &references
	}
	if value, ok := input["aspectRatio"].(string); ok {
		patch.AspectRatio = &value
	}
	if _, present := input["durationSec"]; present {
		value := numericValue(input["durationSec"])
		patch.DurationSec = &value
	}
	if value, ok := input["note"].(string); ok {
		patch.Note = &value
	}
	return patch
}

// proposalPatchPointerFromMCP returns nil when the caller supplied no patch
// field, so confirm uses the stored recipe untouched.
func proposalPatchPointerFromMCP(input map[string]any) *ProposalPatch {
	for _, key := range []string{"text", "prompt", "modelId", "credentialId", "output", "references", "aspectRatio", "durationSec", "note"} {
		if _, present := input[key]; present {
			patch := proposalPatchFromMCP(input)
			return &patch
		}
	}
	return nil
}

// materialUpdateFromMCP maps the asset.update tool arguments onto the media
// layer input. Presence of the key (not its value) decides whether a field is
// written, so content:"" can intentionally clear the body.
func materialUpdateFromMCP(input map[string]any) (MaterialUpdateInput, error) {
	update := MaterialUpdateInput{}
	if raw, ok := input["name"]; ok {
		name := stringValue(raw)
		update.Name = &name
	}
	if raw, ok := input["content"]; ok {
		content := stringValue(raw)
		update.Content = &content
	}
	if raw, ok := input["attributes"]; ok {
		attrs, err := decodeMaterialAttrs(raw)
		if err != nil {
			return MaterialUpdateInput{}, err
		}
		update.Attributes = &attrs
	}
	if raw, ok := input["attrPatch"]; ok {
		attrs, err := decodeMaterialAttrs(raw)
		if err != nil {
			return MaterialUpdateInput{}, err
		}
		update.AttrPatch = attrs
	}
	return update, nil
}

func decodeMaterialAttrs(raw any) ([]MaterialAttr, error) {
	data, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	attrs := []MaterialAttr{}
	if err := json.Unmarshal(data, &attrs); err != nil {
		return nil, errors.New("attributes must be an array of {key,label,type,value} objects")
	}
	return attrs, nil
}

// materialAssetView exposes the reusable creative-information layer of an
// asset: content/contentMeta and the ordered attributes with provenance.
func materialAssetView(asset MediaAsset) map[string]any {
	var attributes any = []any{}
	if raw, ok := asset.Metadata[MetadataKeyAttributes]; ok && raw != nil {
		attributes = raw
	}
	view := map[string]any{
		"assetId":    asset.ID,
		"id":         asset.ID,
		"kind":       asset.Kind,
		"name":       asset.Name,
		"status":     asset.Status,
		"origin":     asset.Origin,
		"createdAt":  asset.CreatedAt,
		"updatedAt":  asset.UpdatedAt,
		"attributes": attributes,
	}
	if content, ok := asset.Metadata[MetadataKeyContent]; ok {
		view["content"] = content
	}
	if contentMeta, ok := asset.Metadata[MetadataKeyContentMeta]; ok {
		view["contentMeta"] = contentMeta
	}
	return view
}

// mediaAssetView exposes a proposed (or otherwise) asset under the explicit
// `assetId` key. Proposal-only recipe fields are inlined for reviewer context.
func mediaAssetView(asset MediaAsset) map[string]any {
	view := map[string]any{
		"assetId":   asset.ID,
		"id":        asset.ID,
		"kind":      asset.Kind,
		"name":      asset.Name,
		"status":    asset.Status,
		"origin":    asset.Origin,
		"createdAt": asset.CreatedAt,
	}
	if asset.Status == AssetStatusProposed {
		view["prompt"] = stringValue(asset.Metadata["prompt"])
		view["referenceIds"] = asset.Metadata["referenceIds"]
		view["proposal"] = asset.Metadata["proposal"]
	}
	return view
}

func projectContextTool(bridge *AgentBridge, host *AppHost, media *MediaService, session AgentSession, arguments map[string]any, locale Locale) (any, error) {
	projectID, _ := arguments["projectId"].(string)
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, fmt.Errorf("projectId is required")
	}
	result := map[string]any{
		"session":      map[string]any{"id": session.ID, "taskId": session.TaskID},
		"instructions": bridgeInstructions,
		"apps":         []map[string]any{},
		"skills":       []map[string]any{},
	}
	project, err := bridge.store.Get(projectID)
	if err != nil {
		return nil, fmt.Errorf("project %q is unavailable", projectID)
	}
	workflow, workflowErr := host.InvokeMCPLocale(Target{ProjectID: project.ID, AppID: project.AppID}, project.AppID, "workflow.context", map[string]any{}, locale)
	if workflowErr == nil {
		result["workflow"] = workflow
	}
	artifacts, _ := bridge.store.ListArtifacts(projectID)
	result["project"] = project
	result["artifacts"] = artifacts
	result["appState"] = map[string]any{"appId": project.AppID}
	if filesRoot, err := bridge.store.ProjectFilesRoot(projectID); err == nil {
		result["paths"] = map[string]any{"projectDir": bridge.store.projectDir(projectID), "projectFilesRoot": filesRoot}
	}
	if media != nil {
		if configured, err := media.ConfiguredModels(); err == nil {
			result["media"] = map[string]any{"defaultRoutes": mediaRoutesView(configured)}
		}
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}
