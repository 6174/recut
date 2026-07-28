/*
 * [INPUT]: 依赖 self-update 归档提取与发布包名称契约
 * [OUTPUT]: 验证 updater 只接受目标 binary，不会写入 archive 中的其他文件
 * [POS]: service 自更新边界的纯本地回归测试；不下载、不替换实际 daemon
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
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
