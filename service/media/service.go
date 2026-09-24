/*
 * [INPUT]: 依赖 Store 的工作区 SQLite、受控本地文件根和按请求类别分隔的 HTTP 客户端
 * [OUTPUT]: 对外提供按 SHA-256 内容哈希去重的媒体资产、提供商凭据、能力路由、动态音色目录及同步/异步生成任务；
 * 统一远程资源缓存 RemoteFileCache（<dataRoot>/files/cdn，URL → 本地文件）；同一凭据的一次请求生成有界串行执行
 * [POS]: service 的 Media Platform 核心；普通 App 只通过 assetId 和 MCP/HTTP 使用，不持有供应商密钥
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/http"
	"path/filepath"
	"sync"
	"time"
)

type Workspace interface {
	WorkspaceDatabase() (*sql.DB, error)
	MediaRoot() string
	ProjectExists(id string) error
}

type MediaService struct {
	store             Workspace
	remoteCache       *RemoteFileCache
	dedupeMu          sync.Mutex
	pollers           sync.Map
	oneRequestGates   sync.Map
	schedulerID       string
	notifyMediaChange func()
	// localAppExec 是 App 贡献的本地 provider（contributes.media）执行桥，按 provider id 分派。
	// Daemon 在 AppHost 就绪后注入；短命进程保持空，本地路由提交会得到引导错误。语音与图片/视频
	// 共用同一条通用桥（由 App 的 executor 声明输入映射与结果路径），平台无 per-app 分支。
	localAppExec map[string]func(job MediaJob, model MediaModel, output map[string]any) (MediaAsset, error)
	// localVoiceProviders 是各本地 provider 的声音面，按 provider id 注入（App 的 voices 声明）。
	// 缺省 nil 时该 provider 分组只声明模型、不返回声音。
	localVoiceProviders map[string]func() []MediaVoice
	// localModelProvider 是本地生成 App 的模型面（comfy.catalog），聚合所有本地生成 provider 的就绪度。
	// Daemon 在 AppHost 就绪后注入；nil 时本地生成分组只声明平台模型、不带引擎就绪度。
	localModelProvider func() []LocalModelInfo
	// shareClient 是临时公网分享（R2 + CDN）的线协议客户端；nil 表示分享能力
	// 不可用（凭据缺失），此时带参考素材的 Skymind 视频任务会给出可操作错误，
	// 纯文生视频与其他 Provider 不受影响。
	shareClient *ShareClient
	// videoProposalGate 是平台生成策略钩子：返回 true 时视频生成先落待用户确认
	// 的资产（默认）。service 层注入它读取用户偏好；nil 时按默认 true。
	videoProposalGate func() bool
}

// SetLocalVoiceProvider wires one local provider's voice catalog (e.g. Audio
// Studio presets + characters) so capability voice groups can present local
// voices next to cloud ones. nil keeps that provider's group voiceless.
func (m *MediaService) SetLocalVoiceProvider(providerID string, provider func() []MediaVoice) {
	if providerID == "" || provider == nil {
		return
	}
	if m.localVoiceProviders == nil {
		m.localVoiceProviders = map[string]func() []MediaVoice{}
	}
	m.localVoiceProviders[providerID] = provider
}

// LocalVoiceProvider exposes one provider's wired voice catalog (used by the
// capability voice aggregation and tests).
func (m *MediaService) LocalVoiceProvider(providerID string) func() []MediaVoice {
	if m.localVoiceProviders == nil {
		return nil
	}
	return m.localVoiceProviders[providerID]
}

// SetLocalModelProvider wires the local generation providers' model catalog so
// capability model groups can present local engines next to cloud models. nil
// keeps the local group without engine readiness.
func (m *MediaService) SetLocalModelProvider(provider func() []LocalModelInfo) {
	if provider != nil {
		m.localModelProvider = provider
	}
}

// SetVideoProposalGate wires the platform policy that decides whether video
// generation lands as a user-confirmed asset first. The daemon injects a reader
// for the user's preference; nil keeps the default (gate on).
func (m *MediaService) SetVideoProposalGate(gate func() bool) {
	if gate != nil {
		m.videoProposalGate = gate
	}
}

// SaveGeneratedAudio persists synthesized speech bytes as a completed media asset.
// Used by the local speech executor (Audio Studio bridge / tests) to produce the
// same durable asset contract as cloud providers.
func (m *MediaService) SaveGeneratedAudio(job MediaJob, content []byte, mimeType string, metadata map[string]any) (MediaAsset, error) {
	if mimeType == "" {
		mimeType = "audio/wav"
	}
	return m.saveGeneratedAsset(job, content, "audio", mimeType, metadata)
}

// SetLocalAppExecutor wires one App-contributed local provider (contributes.media)
// to its execution bridge, keyed by provider id. The daemon supplies a bridge
// that delegates to the App's generate/save operations; without one, local
// route jobs for that provider fail with an actionable guidance error.
func (m *MediaService) SetLocalAppExecutor(providerID string, exec func(job MediaJob, model MediaModel, output map[string]any) (MediaAsset, error)) {
	if providerID == "" || exec == nil {
		return
	}
	if m.localAppExec == nil {
		m.localAppExec = map[string]func(job MediaJob, model MediaModel, output map[string]any) (MediaAsset, error){}
	}
	m.localAppExec[providerID] = exec
}

// LocalAppExecutor exposes a wired App-contributed executor (used by tests/daemon
// to propagate the bridge to a scheduler-owned MediaService copy).
func (m *MediaService) LocalAppExecutor(providerID string) func(job MediaJob, model MediaModel, output map[string]any) (MediaAsset, error) {
	if m.localAppExec == nil {
		return nil
	}
	return m.localAppExec[providerID]
}

const mediaRequestTimeout = 5 * time.Minute
const atlasPollInterval = 5 * time.Second
const atlasPollRequestTimeout = 12 * time.Second
const InterruptedMediaJobMessage = "本地服务重启前任务未完成，请重新生成。"

// Large provider submissions and output downloads may legitimately take time.
// Polling is a tiny status read: a separate short deadline prevents a slow
// Atlas response from monopolizing a durable task lease for two minutes.
var mediaHTTPClient = &http.Client{Timeout: mediaRequestTimeout}
var atlasPollingHTTPClient = &http.Client{Timeout: atlasPollRequestTimeout}

func NewMediaService(store Workspace) *MediaService {
	id, err := newID()
	if err != nil {
		id = fmt.Sprintf("fallback-%d", time.Now().UTC().UnixNano())
	}
	service := &MediaService{store: store, schedulerID: "media-reconciler-" + id, notifyMediaChange: func() {}}
	// 统一远程资源缓存：<dataRoot>/files/cdn（内容寻址）。World url 证据、
	// 生成参考等云端资源的本地映射都走它；不产生 Asset 行。store 为 nil 的
	// 纯校验用例不落盘，跳过缓存初始化。
	if store != nil {
		service.remoteCache = NewRemoteFileCache(filepath.Join(store.MediaRoot(), "files", "cdn"))
		service.remoteCache.LoadIndex()
	}
	return service
}

// RemoteCache exposes the unified remote-file cache (URL → local path) for the
// daemon's other layers (MCP recut.files.fetch, HTTP /v1/files/remote).
func (m *MediaService) RemoteCache() *RemoteFileCache {
	return m.remoteCache
}

// SetNotifyMediaChange wires the durable media_asset_events table to an
// in-process wakeup. The daemon installs a changeHub notifier here; short-lived
// MCP processes keep the no-op default and rely on the SSE fallback poll.
func (m *MediaService) SetNotifyMediaChange(notify func()) {
	if notify != nil {
		m.notifyMediaChange = notify
	}
}

func (m *MediaService) publishAssetChange() { m.notifyMediaChange() }

func projectExists(store Workspace, id string) (struct{}, error) {
	return struct{}{}, store.ProjectExists(id)
}
func newID() (string, error) {
	bytes := make([]byte, 12)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
func (m *MediaService) database() (*sql.DB, error) { return m.store.WorkspaceDatabase() }

// oneRequestGate prevents a reconciliation tick from turning a batch of
// queued byte-returning requests into an upstream connection burst. The
// durable job lease is acquired before this gate, so waiting work remains
// owned and recoverable without crossing the external billing boundary.
func (m *MediaService) oneRequestGate(credentialID string) chan struct{} {
	gate, _ := m.oneRequestGates.LoadOrStore(credentialID, make(chan struct{}, 1))
	return gate.(chan struct{})
}

func (m *MediaService) Database() (*sql.DB, error) { return m.database() }
func (m *MediaService) ResolveRoute(input GenerateMediaInput) (MediaRoute, MediaCredential, error) {
	return m.resolveRoute(input)
}
func ProviderByID(id string) (MediaProvider, bool) { return providerByID(id) }
func ModelByID(id string) (MediaModel, bool)       { return modelByID(id) }
func ValidateModelReferences(model MediaModel, images, videos, audios int) error {
	return validateModelReferences(model, images, videos, audios)
}
func ReferenceKindsFor(capability MediaCapability) map[string]bool {
	return referenceKindsFor(capability)
}
