/*
 * [INPUT]: 依赖 Store 的工作区 SQLite、受控本地文件根和标准 HTTP 客户端
 * [OUTPUT]: 对外提供按 SHA-256 内容哈希去重的媒体资产、提供商凭据、能力路由、动态音色目录及同步/异步生成任务
 * [POS]: service 的 Media Platform 核心；普通 App 只通过 assetId 和 MCP/HTTP 使用，不持有供应商密钥
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
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
	store   Workspace
	mu      sync.Mutex
	pollers sync.Map
}

const mediaRequestTimeout = 2 * time.Minute
const atlasPollInterval = 2 * time.Second

const InterruptedMediaJobMessage = "本地服务重启前任务未完成，请重新生成。"

var mediaHTTPClient = &http.Client{Timeout: mediaRequestTimeout}

func NewMediaService(store Workspace) *MediaService { return &MediaService{store: store} }

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
