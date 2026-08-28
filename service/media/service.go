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
	// localSpeechExec 是本机 TTS（Audio Studio / CosyVoice2）执行桥。Daemon 在
	// 创建 MediaService 后注入（因为 MediaService 早于 AppHost 构建）；MCP 直连等
	// 短命进程保持 nil，此时本地路由提交会得到引导错误（走 audio-studio MCP）。
	localSpeechExec func(job MediaJob, model MediaModel, voiceID string) (MediaAsset, error)
	// shareClient 是临时公网分享（R2 + CDN）的线协议客户端；nil 表示分享能力
	// 不可用（凭据缺失），此时带参考素材的 Skymind 视频任务会给出可操作错误，
	// 纯文生视频与其他 Provider 不受影响。
	shareClient *ShareClient
}

// SetLocalSpeechExecutor wires the local-audio provider to an execution backend.
// The daemon supplies a bridge that delegates to Audio Studio's synthesized speech;
// without one, local route jobs fail with an actionable guidance error.
func (m *MediaService) SetLocalSpeechExecutor(exec func(job MediaJob, model MediaModel, voiceID string) (MediaAsset, error)) {
	if exec != nil {
		m.localSpeechExec = exec
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

func (m *MediaService) LocalSpeechExecutor() func(job MediaJob, model MediaModel, voiceID string) (MediaAsset, error) {
	return m.localSpeechExec
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
