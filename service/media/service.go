/*
 * [INPUT]: 依赖 Store 的工作区 SQLite、受控本地文件根和按请求类别分隔的 HTTP 客户端
 * [OUTPUT]: 对外提供按 SHA-256 内容哈希去重的媒体资产、提供商凭据、能力路由、动态音色目录及同步/异步生成任务；同一凭据的一次请求生成有界串行执行
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
	dedupeMu          sync.Mutex
	pollers           sync.Map
	oneRequestGates   sync.Map
	schedulerID       string
	notifyMediaChange func()
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
	return &MediaService{store: store, schedulerID: "media-reconciler-" + id, notifyMediaChange: func() {}}
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
