/*
 * [INPUT]: 真实 Skymind Token API（RECUT_E2E_SKYMIN）+ R2 临时分享凭据（env 或
 *          cdn/.env，与发布工具链同一份）；真实 workspace SQLite（temp dir）
 * [OUTPUT]: 不经 UI 的 skymind 全链路 E2E：gpt-image-2 文生图 → 生成图作为参考图
 *          自动发布临时公网 URL → Seedance 2.5 参考图生视频 + Seedance 2.0 文生视频，
 *          断言终态 completed、产物字节有效、usage/任务 ID 落 Asset metadata。
 *          每次运行成本约 ¥10-15（2 视频 + 1 图片，480p/5s 最小规格），仅显式开启时运行。
 * [POS]: service 的接口层 skymind 验证；默认跳过（RECUT_E2E_SKYMIN=1 开启）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// loadRepoCDNEnv loads cdn/.env (repo root) when R2 credentials are not in the
// environment, so the E2E reuses the same R2 S3 credentials as the CDN tooling.
func loadRepoCDNEnv(t *testing.T) {
	t.Helper()
	if os.Getenv("R2_ACCESS_KEY_ID") != "" && os.Getenv("R2_SECRET_ACCESS_KEY") != "" {
		return
	}
	envPath := filepath.Join("..", "cdn", ".env")
	content, err := os.ReadFile(envPath)
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

func TestSkymindRealGatewayE2E(t *testing.T) {
	if os.Getenv("RECUT_E2E_SKYMIN") != "1" {
		t.Skip("set RECUT_E2E_SKYMIN=1 to run the real Skymind E2E (costs real money)")
	}
	key := os.Getenv("SKYMIN")
	if key == "" {
		t.Fatal("set SKYMIN=sk-... (real key)")
	}
	loadRepoCDNEnv(t)

	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	mediaService := NewMediaService(store)
	if client := NewShareClientFromEnv(store.root); client != nil {
		mediaService.SetShareClient(client)
		t.Logf("share enabled: bucket=%s prefix=%s base=%s", client.Bucket, client.Prefix, client.BaseURL)
	} else {
		t.Skip("R2 share credentials unavailable; the reference-image leg of this E2E requires them (env or cdn/.env)")
	}
	credential, err := mediaService.SaveCredential(MediaCredential{Provider: "skymind-token", Name: "E2E"}, key)
	if err != nil {
		t.Fatal(err)
	}

	// 1) 图片：gpt-image-2 文生图（最小成本参数）。
	imageJob, err := mediaService.Generate(GenerateMediaInput{
		Capability: ImageGenerate, ModelID: "skymind-token/gpt-image-2", CredentialID: credential.ID,
		Prompt:         "A small red fox standing on a snowy hill at dawn, cinematic, high detail",
		IdempotencyKey: "e2e-skymind-image", Output: map[string]any{"size": "1024x1024", "quality": "low"},
	})
	if err != nil {
		t.Fatalf("image Generate: %v", err)
	}
	imageFinal := waitForMediaJob(t, mediaService, imageJob.ID, true, 5*time.Minute)
	if imageFinal.Status != "completed" {
		t.Fatalf("image job not completed: %+v", imageFinal)
	}
	imageAsset, err := mediaService.GetAsset(imageFinal.AssetIDs[0])
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("image completed: asset=%s usage=%v", imageAsset.ID, imageAsset.Metadata["usage"])

	// 2) 视频（参考图）：生成图作为参考 → 自动发布临时公网 URL → Seedance 2.5。
	videoRefJob, err := mediaService.Generate(GenerateMediaInput{
		Capability: VideoGenerate, ModelID: "skymind-token/seedance-2.5", CredentialID: credential.ID,
		Prompt:         "让画面中的狐狸缓缓眨动眼睛，微微抬头望向镜头，背景雪雾轻微流动",
		ReferenceIDs:   []string{imageAsset.ID},
		IdempotencyKey: "e2e-skymind-video-25",
		Output:         map[string]any{"durationSeconds": 5, "aspectRatio": "16:9", "resolution": "480p"},
	})
	if err != nil {
		t.Fatalf("video(ref) Generate: %v", err)
	}
	videoRefFinal := waitForMediaJob(t, mediaService, videoRefJob.ID, true, 10*time.Minute)
	if videoRefFinal.Status != "completed" {
		t.Fatalf("reference video job not completed: %+v", videoRefFinal)
	}
	videoRefAsset, err := mediaService.GetAsset(videoRefFinal.AssetIDs[0])
	if err != nil {
		t.Fatal(err)
	}
	if videoRefAsset.Metadata["providerTaskId"] == "" {
		t.Fatalf("provider task id missing: %v", videoRefAsset.Metadata)
	}
	t.Logf("reference video completed: asset=%s task=%s usage=%v", videoRefAsset.ID, videoRefAsset.Metadata["providerTaskId"], videoRefAsset.Metadata["usage"])

	// 3) 视频（纯文本）：Seedance 2.0 文生视频。
	videoTextJob, err := mediaService.Generate(GenerateMediaInput{
		Capability: VideoGenerate, ModelID: "skymind-token/seedance-2.0", CredentialID: credential.ID,
		Prompt:         "一只小狐狸在雪后的山丘上缓缓转身，望向远方的朝阳，镜头缓慢推进，电影感",
		IdempotencyKey: "e2e-skymind-video-20",
		Output:         map[string]any{"durationSeconds": 5, "aspectRatio": "16:9", "resolution": "480p"},
	})
	if err != nil {
		t.Fatalf("video(text) Generate: %v", err)
	}
	videoTextFinal := waitForMediaJob(t, mediaService, videoTextJob.ID, true, 10*time.Minute)
	if videoTextFinal.Status != "completed" {
		t.Fatalf("text video job not completed: %+v", videoTextFinal)
	}
	videoTextAsset, err := mediaService.GetAsset(videoTextFinal.AssetIDs[0])
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("text video completed: asset=%s task=%s usage=%v", videoTextAsset.ID, videoTextAsset.Metadata["providerTaskId"], videoTextAsset.Metadata["usage"])

	// 4) 产物字节有效性（不依赖 ffprobe）。
	assertMP4Bytes(t, "reference video", videoRefAsset)
	assertMP4Bytes(t, "text video", videoTextAsset)
	assertPNGBytes(t, "image", imageAsset)

	// 5) 分享账本：参考图应有未过期分享（供重试复用）。
	shares, err := mediaService.ListShares(imageAsset.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(shares) != 1 {
		t.Fatalf("expected exactly one live share for the reference image, got %d", len(shares))
	}
	t.Logf("reference share: url=%s expires=%s", shares[0].URL, shares[0].ExpiresAt.Format(time.RFC3339))
	// 显式吊销，避免 E2E 留下长期公开链接（7 天 TTL 仍为兜底）。
	if err := mediaService.RevokeShare(shares[0].ID); err != nil {
		t.Fatalf("RevokeShare: %v", err)
	}
}

func assertMP4Bytes(t *testing.T, label string, asset MediaAsset) {
	t.Helper()
	path, _ := asset.Metadata["path"].(string)
	if path == "" {
		t.Fatalf("%s: no stored path", label)
	}
	content, err := os.ReadFile(path)
	if err != nil || len(content) < 32 {
		t.Fatalf("%s: unreadable or too small (%d bytes, %v)", label, len(content), err)
	}
	// ISO BMFF: ftyp box within the first 12 bytes.
	if !strings.Contains(string(content[:12]), "ftyp") {
		t.Fatalf("%s: not an MP4 (missing ftyp box): % x", label, content[:12])
	}
}

func assertPNGBytes(t *testing.T, label string, asset MediaAsset) {
	t.Helper()
	path, _ := asset.Metadata["path"].(string)
	if path == "" {
		t.Fatalf("%s: no stored path", label)
	}
	content, err := os.ReadFile(path)
	if err != nil || len(content) < 8 {
		t.Fatalf("%s: unreadable or too small (%d bytes, %v)", label, len(content), err)
	}
	signature := []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}
	if string(content[:8]) != string(signature) {
		t.Fatalf("%s: not a PNG: % x", label, content[:8])
	}
}
