/*
 * [INPUT]: 依赖 Cloudflare R2 S3 兼容凭据（平台级机密，env 或 <dataDir>/share-credentials）、
 *          已完成 Asset 的内容寻址落盘字节与工作区 SQLite（media_shares 账本）
 * [OUTPUT]: 对外提供临时公网分享：把 completed Asset 发布为 7 天 TTL（可配）的不可猜测公网 URL
 *          （R2 对象 + CDN 自定义域），同 contentHash 去重复用、可即时吊销（删对象+账本墓碑）、
 *          Asset 删除级联吊销；TTL 兜底交给 R2 生命周期规则，本地账本丢失也能自动收敛
 * [POS]: media 的平台级分享能力；ShareClient 只做 R2 S3 线协议，账本与生命周期在 MediaService 上
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"time"
)

// DefaultShareTTL is the maximum public lifetime of a share. The real expiry is
// enforced by the R2 lifecycle rule (storage side); this ledger value drives
// reuse decisions and the user-facing expiresAt.
const DefaultShareTTL = 7 * 24 * time.Hour

const (
	defaultShareBucket     = "recut-assets"
	defaultSharePrefix     = "share"
	defaultShareBaseURL    = "https://cdn.recut.video"
	shareUploadTimeout     = 10 * time.Minute
	shareObjectCacheMaxAge = 3600 // bounds CDN edge residue after revocation
	shareTokenBytes        = 16   // 128-bit unguessable token
)

// ErrShareUnavailable is returned when no R2 share credentials are configured.
// Callers surface it as actionable guidance; pure text-to-video jobs never
// depend on the share capability.
var ErrShareUnavailable = errors.New("临时公开分享未配置（R2 凭据缺失）；带参考素材的 Skymind 视频生成暂不可用，纯文生视频不受影响")

var ErrShareNotFound = errors.New("media share not found")

// ShareClient speaks the Cloudflare R2 S3-compatible wire protocol with the
// minimal verb set a share needs: PutObject / DeleteObject. It holds no
// workspace state; the media_shares ledger lives on MediaService.
type ShareClient struct {
	Endpoint  string // https://<account-id>.r2.cloudflarestorage.com
	Host      string // <account-id>.r2.cloudflarestorage.com
	Bucket    string
	Prefix    string
	BaseURL   string // public CDN origin, e.g. https://cdn.recut.video
	AccessKey string
	SecretKey string
	HTTP      *http.Client
}

// NewShareClientFromEnv resolves the share storage configuration: environment
// first, then <dataDir>/share-credentials (env-style file, same shape as
// cdn/.env). Returns nil when the credential triple is incomplete — the share
// capability is then cleanly unavailable.
func NewShareClientFromEnv(dataDir string) *ShareClient {
	if dataDir != "" {
		loadShareCredentialsFile(path.Join(dataDir, "share-credentials"))
	}
	accessKey := firstEnv("RECUT_SHARE_R2_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID")
	secretKey := firstEnv("RECUT_SHARE_R2_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY")
	accountID := firstEnv("RECUT_SHARE_R2_ACCOUNT_ID", "R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID")
	if accessKey == "" || secretKey == "" || accountID == "" {
		return nil
	}
	host := accountID + ".r2.cloudflarestorage.com"
	return &ShareClient{
		Endpoint:  "https://" + host,
		Host:      host,
		Bucket:    firstEnvOr("RECUT_SHARE_BUCKET", "R2_BUCKET", defaultShareBucket),
		Prefix:    firstEnvOr("RECUT_SHARE_PREFIX", "", defaultSharePrefix),
		BaseURL:   firstEnvOr("RECUT_SHARE_BASE_URL", "CDN_BASE_URL", defaultShareBaseURL),
		AccessKey: accessKey,
		SecretKey: secretKey,
		HTTP:      &http.Client{Timeout: shareUploadTimeout},
	}
}

func firstEnv(names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

func firstEnvOr(names ...string) string {
	fallback := names[len(names)-1]
	for _, name := range names[:len(names)-1] {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return fallback
}

func loadShareCredentialsFile(file string) {
	content, err := os.ReadFile(file)
	if err != nil {
		return
	}
	for _, rawLine := range strings.Split(string(content), "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		eq := strings.Index(line, "=")
		if eq <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		value := strings.TrimSpace(line[eq+1:])
		if key != "" && os.Getenv(key) == "" {
			os.Setenv(key, value)
		}
	}
}

// ObjectURL renders the public CDN URL for a share object key.
func (c *ShareClient) ObjectURL(objectKey string) string {
	return strings.TrimRight(c.BaseURL, "/") + "/" + objectKey
}

func (c *ShareClient) objectKey(token, name string) string {
	return strings.TrimRight(c.Prefix, "/") + "/" + token + "/" + name
}

// signedRequest builds one SigV4-signed R2 request (region "auto", the R2
// S3-compatible convention).
func (c *ShareClient) signedRequest(method, objectKey string, payload []byte, contentType string) (*http.Request, error) {
	payloadHash := sha256.Sum256(payload)
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	scope := now.Format("20060102") + "/auto/s3/aws4_request"

	uri := url.PathEscape(c.Bucket) + "/" + escapeS3Path(objectKey)
	canonicalHeaders := "host:" + c.Host + "\n" +
		"x-amz-content-sha256:" + hex.EncodeToString(payloadHash[:]) + "\n" +
		"x-amz-date:" + amzDate + "\n"
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalRequest := method + "\n/" + uri + "\n\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + hex.EncodeToString(payloadHash[:])
	stringToSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + sha256hex([]byte(canonicalRequest))
	signature := s3Signature(c.SecretKey, stringToSign, scope)
	authorization := "AWS4-HMAC-SHA256 Credential=" + c.AccessKey + "/" + scope +
		", SignedHeaders=" + signedHeaders + ", Signature=" + signature

	request, err := http.NewRequest(method, c.Endpoint+"/"+uri, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("X-Amz-Date", amzDate)
	request.Header.Set("X-Amz-Content-Sha256", hex.EncodeToString(payloadHash[:]))
	request.Header.Set("Authorization", authorization)
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	return request, nil
}

// PutObject uploads one object with the share cache policy (bounded edge
// residue after revocation/expiry).
func (c *ShareClient) PutObject(objectKey string, content []byte, contentType string) error {
	request, err := c.signedRequest(http.MethodPut, objectKey, content, contentType)
	if err != nil {
		return err
	}
	request.Header.Set("Cache-Control", "public, max-age="+strconv.Itoa(shareObjectCacheMaxAge))
	response, err := c.do(request)
	if err != nil {
		return err
	}
	data, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("R2 upload failed: %s: %s", response.Status, strings.TrimSpace(string(data)))
	}
	return nil
}

// DeleteObject removes a share object (missing objects still succeed).
func (c *ShareClient) DeleteObject(objectKey string) error {
	request, err := c.signedRequest(http.MethodDelete, objectKey, nil, "")
	if err != nil {
		return err
	}
	response, err := c.do(request)
	if err != nil {
		return err
	}
	_, _ = io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("R2 delete failed: %s", response.Status)
	}
	return nil
}

func (c *ShareClient) do(request *http.Request) (*http.Response, error) {
	client := c.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	return client.Do(request)
}

func s3Signature(secret, stringToSign, scope string) string {
	key := []byte("AWS4" + secret)
	for _, part := range strings.Split(scope, "/") {
		key = hmacSHA256(key, []byte(part))
	}
	return hex.EncodeToString(hmacSHA256(key, []byte(stringToSign)))
}

func hmacSHA256(key, data []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(data)
	return mac.Sum(nil)
}

func sha256hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// escapeS3Path escapes each key segment individually so "/" separators survive.
func escapeS3Path(objectKey string) string {
	segments := strings.Split(objectKey, "/")
	for i, segment := range segments {
		segments[i] = url.PathEscape(segment)
	}
	return strings.Join(segments, "/")
}

// --- MediaService ledger -------------------------------------------------

const shareColumns = "id, asset_id, content_hash, token, url, object_key, expires_at, revoked_at, created_at, updated_at"

func (m *MediaService) SetShareClient(client *ShareClient) { m.shareClient = client }

// ShareClientAvailable reports whether temporary public shares can be made.
func (m *MediaService) ShareClientAvailable() bool { return m.shareClient != nil }

func scanShare(row mediaScanner) (MediaShare, error) {
	var share MediaShare
	var revoked, created, updated, expires string
	if err := row.Scan(&share.ID, &share.AssetID, &share.ContentHash, &share.Token, &share.URL, &share.ObjectKey, &expires, &revoked, &created, &updated); err != nil {
		return MediaShare{}, err
	}
	share.ExpiresAt, _ = time.Parse(time.RFC3339Nano, expires)
	share.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	share.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	if revoked != "" {
		t, _ := time.Parse(time.RFC3339Nano, revoked)
		share.RevokedAt = &t
	}
	return share, nil
}

// SharePublish makes one completed Asset publicly reachable under an
// unguessable 128-bit token. The same content (contentHash) is never
// re-uploaded: a live share is reused so "regenerate with a better prompt"
// loops cost zero extra uploads.
func (m *MediaService) SharePublish(asset MediaAsset, ttlDays int) (MediaShare, error) {
	if ttlDays <= 0 || ttlDays > 30 {
		ttlDays = 7
	}
	if m.shareClient == nil {
		return MediaShare{}, ErrShareUnavailable
	}
	if asset.Status != "completed" {
		return MediaShare{}, fmt.Errorf("share requires a completed asset, %q is %s", asset.Name, asset.Status)
	}
	db, err := m.database()
	if err != nil {
		return MediaShare{}, err
	}
	now := time.Now().UTC()
	if share, ok, err := m.findLiveShare(db, asset.ContentHash, now); err == nil && ok {
		return share, nil
	}
	filePath, _ := asset.Metadata["path"].(string)
	if filePath == "" {
		return MediaShare{}, fmt.Errorf("share cannot locate the stored file of asset %q", asset.ID)
	}
	content, err := os.ReadFile(filePath)
	if err != nil {
		return MediaShare{}, fmt.Errorf("share cannot read asset %q: %w", asset.ID, err)
	}
	token, err := shareToken()
	if err != nil {
		return MediaShare{}, err
	}
	objectKey := m.shareClient.objectKey(token, sanitizeShareName(asset.Name, asset.MimeType))
	if err := m.shareClient.PutObject(objectKey, content, asset.MimeType); err != nil {
		return MediaShare{}, err
	}
	share := MediaShare{
		ID:          shareID(asset.ContentHash, token),
		AssetID:     asset.ID,
		ContentHash: asset.ContentHash,
		Token:       token,
		URL:         m.shareClient.ObjectURL(objectKey),
		ObjectKey:   objectKey,
		ExpiresAt:   now.Add(time.Duration(ttlDays) * 24 * time.Hour),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := m.insertShare(share); err != nil {
		// Upload succeeded but the ledger did not: remove the orphan so a
		// retry cannot leak an untracked public object.
		_ = m.shareClient.DeleteObject(objectKey)
		return MediaShare{}, err
	}
	log.Printf("INFO media share published share_id=%s asset_id=%s token_prefix=%s ttl_days=%d", share.ID, asset.ID, token[:8], ttlDays)
	return share, nil
}

func (m *MediaService) findLiveShare(db *sql.DB, contentHash string, now time.Time) (MediaShare, bool, error) {
	share, err := scanShare(db.QueryRow("select "+shareColumns+" from media_shares where content_hash = ? and (revoked_at = '' or revoked_at is null) and expires_at > ? order by updated_at desc limit 1", contentHash, now.Format(time.RFC3339Nano)))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return MediaShare{}, false, nil
		}
		return MediaShare{}, false, err
	}
	return share, true, nil
}

func (m *MediaService) insertShare(share MediaShare) error {
	db, err := m.database()
	if err != nil {
		return err
	}
	_, err = db.Exec(`insert into media_shares (id, asset_id, content_hash, token, url, object_key, expires_at, revoked_at, created_at, updated_at)
values (?, ?, ?, ?, ?, ?, ?, '', ?, ?)
on conflict(id) do nothing`, share.ID, share.AssetID, share.ContentHash, share.Token, share.URL, share.ObjectKey, share.ExpiresAt.Format(time.RFC3339Nano), share.CreatedAt.Format(time.RFC3339Nano), share.UpdatedAt.Format(time.RFC3339Nano))
	return err
}

// RevokeShare deletes the R2 object immediately and tombstones the ledger row.
func (m *MediaService) RevokeShare(shareID string) error {
	if strings.TrimSpace(shareID) == "" {
		return errors.New("share id is required")
	}
	db, err := m.database()
	if err != nil {
		return err
	}
	share, err := scanShare(db.QueryRow("select "+shareColumns+" from media_shares where id = ?", shareID))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrShareNotFound
		}
		return err
	}
	if share.RevokedAt != nil {
		return nil
	}
	if m.shareClient != nil {
		if err := m.shareClient.DeleteObject(share.ObjectKey); err != nil {
			return err
		}
	}
	now := time.Now().UTC()
	if _, err := db.Exec("update media_shares set revoked_at = ?, updated_at = ? where id = ? and (revoked_at = '' or revoked_at is null)", now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), shareID); err != nil {
		return err
	}
	log.Printf("INFO media share revoked share_id=%s asset_id=%s", share.ID, share.AssetID)
	return nil
}

// ListShares returns the live (unrevoked, unexpired) shares of one asset.
func (m *MediaService) ListShares(assetID string) ([]MediaShare, error) {
	db, err := m.database()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query("select "+shareColumns+" from media_shares where asset_id = ? and (revoked_at = '' or revoked_at is null) and expires_at > ? order by created_at desc", assetID, time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []MediaShare{}
	for rows.Next() {
		share, err := scanShare(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, share)
	}
	return items, rows.Err()
}

// revokeAssetShares cascades from asset deletion. Best-effort: a failed R2
// delete never blocks the asset delete; the R2 lifecycle still expires it.
func (m *MediaService) revokeAssetShares(assetID string) {
	db, err := m.database()
	if err != nil {
		return
	}
	rows, err := db.Query("select "+shareColumns+" from media_shares where asset_id = ? and (revoked_at = '' or revoked_at is null)", assetID)
	if err != nil {
		return
	}
	shares := []MediaShare{}
	for rows.Next() {
		if share, err := scanShare(rows); err == nil {
			shares = append(shares, share)
		}
	}
	rows.Close()
	if len(shares) == 0 {
		return
	}
	now := time.Now().UTC()
	for _, share := range shares {
		if m.shareClient != nil {
			_ = m.shareClient.DeleteObject(share.ObjectKey)
		}
		_, _ = db.Exec("update media_shares set revoked_at = ?, updated_at = ? where id = ?", now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), share.ID)
	}
}

func shareToken() (string, error) {
	token := make([]byte, shareTokenBytes)
	if _, err := rand.Read(token); err != nil {
		return "", err
	}
	return hex.EncodeToString(token), nil
}

func shareID(contentHash, token string) string {
	return sha256hex([]byte(contentHash + ":" + token))[:24]
}

func sanitizeShareName(name, mimeType string) string {
	clean := strings.Map(func(r rune) rune {
		if r >= 0x20 && r < 0x7f && r != '/' && r != '\\' {
			return r
		}
		return '_'
	}, strings.TrimSpace(name))
	if clean == "" {
		clean = "asset"
	}
	if path.Ext(clean) == "" {
		clean += extensionFor(mimeType)
	}
	if len(clean) > 128 {
		clean = clean[len(clean)-128:]
	}
	return clean
}
