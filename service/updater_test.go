/*
 * [INPUT]: 依赖 self-update 归档提取、发布包名称契约与本地 TLS 测试服务器
 * [OUTPUT]: 验证 updater 只接受目标 binary，不会写入 archive 中的其他文件，并使用显式 PEM 根证书保持 TLS 校验
 * [POS]: service 自更新边界的纯本地回归测试；不下载、不替换实际 daemon
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestExtractReleaseBinaryUsesOnlyExpectedEntry(t *testing.T) {
	archive := releaseArchive(t, map[string]string{"README.md": "ignore", "recut-service-darwin-arm64": "binary"})
	destination := t.TempDir()
	path, err := extractReleaseBinary(bytes.NewReader(archive), "recut-service-darwin-arm64", destination)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(path) != destination {
		t.Fatalf("staged binary outside destination: %s", path)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "binary" {
		t.Fatalf("staged binary = %q, error = %v", data, err)
	}
}

func TestExtractReleaseBinaryRejectsMissingTarget(t *testing.T) {
	archive := releaseArchive(t, map[string]string{"other": "binary"})
	if _, err := extractReleaseBinary(bytes.NewReader(archive), "recut-service-darwin-arm64", t.TempDir()); err == nil {
		t.Fatal("missing binary was accepted")
	}
}

func TestTLSHTTPClientVerifiesPEMRoot(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	certificatePath := filepath.Join(t.TempDir(), "roots.pem")
	pemData := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw})
	if err := os.WriteFile(certificatePath, pemData, 0o600); err != nil {
		t.Fatal(err)
	}
	roots, err := certificatePoolFromPEM(certificatePath)
	if err != nil {
		t.Fatal(err)
	}
	response, err := newTLSHTTPClient(roots).Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d", response.StatusCode)
	}
}

// TestFetchArchiveUsesVersionedPath 验证：manifest 从 /releases/latest 指针读取，
// 包本体从 /releases/<version>/<archive> 版本目录下载（latest 只作指针，不含包）。
func TestFetchArchiveUsesVersionedPath(t *testing.T) {
	archiveBytes := releaseArchive(t, map[string]string{"recut-service-darwin-arm64": "binary"})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/releases/latest/manifest.json":
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"version":"0.1.30","packages":{"darwin-arm64":{"archive":"recut-service-darwin-arm64.tar.gz","sha256":"` + sha256Hex(archiveBytes) + `"}}}`))
		case "/releases/0.1.30/recut-service-darwin-arm64.tar.gz":
			_, _ = writer.Write(archiveBytes)
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	updater := &ServiceUpdater{
		downloadBase: server.URL,
		httpClient:   server.Client(),
		goos:         "darwin",
		goarch:       "arm64",
	}
	manifest, err := updater.fetchManifest()
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Version != "0.1.30" {
		t.Fatalf("manifest version = %q", manifest.Version)
	}
	archive, err := updater.fetchArchive(manifest.Version, manifest.Packages["darwin-arm64"])
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	data, err := io.ReadAll(archive)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, archiveBytes) {
		t.Fatalf("downloaded archive bytes differ (got %d bytes)", len(data))
	}
}

func releaseArchive(t *testing.T, files map[string]string) []byte {
	t.Helper()
	buffer := bytes.Buffer{}
	gzipWriter := gzip.NewWriter(&buffer)
	tarWriter := tar.NewWriter(gzipWriter)
	for name, content := range files {
		if err := tarWriter.WriteHeader(&tar.Header{Name: name, Mode: 0o755, Size: int64(len(content))}); err != nil {
			t.Fatal(err)
		}
		if _, err := tarWriter.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
