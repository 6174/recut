/*
 * [INPUT]: 依赖公开 release manifest、macOS launchd、当前 service 二进制路径、macOS 系统 PEM 根证书与标准库网络/归档能力
 * [OUTPUT]: 对外提供严格校验证书与 SHA-256 的发布包下载、原子 self-update 与延迟重启能力
 * [POS]: service 的自更新边界；浏览器只请求本机 API，二进制替换和 launchd 重启始终由 daemon 自己完成
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const defaultUpdateBaseURL = "https://cdn.recut.video"
const macOSSystemCertificateBundle = "/etc/ssl/cert.pem"

type releaseManifest struct {
	Version  string                    `json:"version"`
	Packages map[string]releasePackage `json:"packages"`
}

type releasePackage struct {
	Archive string `json:"archive"`
	SHA256  string `json:"sha256"`
}

type ServiceUpdater struct {
	downloadBase string
	httpClient   *http.Client
	executable   func() (string, error)
	goos         string
	goarch       string
	restart      func() error
}

func NewServiceUpdater() *ServiceUpdater {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("RECUT_UPDATE_BASE_URL")), "/")
	if base == "" {
		base = defaultUpdateBaseURL
	}
	return &ServiceUpdater{
		downloadBase: base,
		httpClient:   newUpdateHTTPClient(),
		executable:   os.Executable,
		goos:         runtime.GOOS,
		goarch:       runtime.GOARCH,
		restart:      restartLaunchdService,
	}
}

func newUpdateHTTPClient() *http.Client {
	if runtime.GOOS != "darwin" {
		return &http.Client{Timeout: 90 * time.Second}
	}
	roots, err := certificatePoolFromPEM(macOSSystemCertificateBundle)
	if err != nil {
		return &http.Client{Timeout: 90 * time.Second}
	}
	return newTLSHTTPClient(roots)
}

func certificatePoolFromPEM(path string) (*x509.CertPool, error) {
	pemData, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read system certificate bundle: %w", err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(pemData) {
		return nil, errors.New("system certificate bundle contains no certificates")
	}
	return roots, nil
}

func newTLSHTTPClient(roots *x509.CertPool) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{RootCAs: roots}
	return &http.Client{Timeout: 90 * time.Second, Transport: transport}
}

func (u *ServiceUpdater) Update() (string, error) {
	if u == nil || u.goos != "darwin" {
		return "", errors.New("self-update is currently available only on macOS")
	}
	manifest, err := u.fetchManifest()
	if err != nil {
		return "", err
	}
	key := u.goos + "-" + u.goarch
	packageInfo, ok := manifest.Packages[key]
	if !ok || packageInfo.Archive == "" || packageInfo.SHA256 == "" {
		return "", fmt.Errorf("release does not include a package for %s", key)
	}
	executable, err := u.executable()
	if err != nil {
		return "", fmt.Errorf("locate running service: %w", err)
	}
	if filepath.Base(executable) != "recut-service" {
		return "", errors.New("self-update is only available for the installed recut-service binary")
	}
	archive, err := u.fetchArchive(manifest.Version, packageInfo)
	if err != nil {
		return "", err
	}
	defer archive.Close()
	staged, err := extractReleaseBinary(archive, "recut-service-"+key, filepath.Dir(executable))
	if err != nil {
		return "", err
	}
	if err := os.Rename(staged, executable); err != nil {
		return "", fmt.Errorf("activate updated service: %w", err)
	}
	return manifest.Version, nil
}

func (u *ServiceUpdater) RestartSoon() {
	go func() {
		time.Sleep(500 * time.Millisecond)
		_ = u.restart()
	}()
}

func (u *ServiceUpdater) CanRestart() bool {
	if u == nil || u.goos != "darwin" {
		return false
	}
	executable, err := u.executable()
	return err == nil && filepath.Base(executable) == "recut-service"
}

func (u *ServiceUpdater) fetchManifest() (releaseManifest, error) {
	manifest := releaseManifest{}
	// latest 只存最新版 manifest 指针（含 version 字段）；包本体在版本目录。
	response, err := u.httpClient.Get(u.downloadBase + "/releases/latest/manifest.json")
	if err != nil {
		return manifest, fmt.Errorf("download release manifest: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return manifest, fmt.Errorf("download release manifest: received HTTP %d", response.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&manifest); err != nil {
		return manifest, fmt.Errorf("parse release manifest: %w", err)
	}
	if manifest.Version == "" {
		return manifest, errors.New("release manifest has no version")
	}
	return manifest, nil
}

func (u *ServiceUpdater) fetchArchive(version string, packageInfo releasePackage) (io.ReadCloser, error) {
	if strings.Contains(packageInfo.Archive, "/") || !strings.HasSuffix(packageInfo.Archive, ".tar.gz") {
		return nil, errors.New("release manifest has an invalid archive name")
	}
	// 包从版本目录下载（/releases/<version>/<archive>），latest 只是指针。
	response, err := u.httpClient.Get(u.downloadBase + "/releases/" + version + "/" + packageInfo.Archive)
	if err != nil {
		return nil, fmt.Errorf("download service package: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, fmt.Errorf("download service package: received HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 32<<20))
	response.Body.Close()
	if err != nil {
		return nil, fmt.Errorf("read service package: %w", err)
	}
	digest := sha256.Sum256(data)
	if !strings.EqualFold(hex.EncodeToString(digest[:]), packageInfo.SHA256) {
		return nil, errors.New("service package checksum does not match release manifest")
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

func extractReleaseBinary(archive io.Reader, expectedName, destination string) (string, error) {
	gzipReader, err := gzip.NewReader(archive)
	if err != nil {
		return "", fmt.Errorf("read service package: %w", err)
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	for {
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", fmt.Errorf("read service package: %w", err)
		}
		if header.Name != expectedName || !header.FileInfo().Mode().IsRegular() {
			continue
		}
		staged, err := os.CreateTemp(destination, ".recut-service-update-")
		if err != nil {
			return "", fmt.Errorf("stage updated service: %w", err)
		}
		if _, err := io.Copy(staged, io.LimitReader(tarReader, 64<<20)); err != nil {
			staged.Close()
			return "", fmt.Errorf("extract updated service: %w", err)
		}
		if err := staged.Chmod(0o755); err != nil {
			staged.Close()
			return "", fmt.Errorf("set updated service permissions: %w", err)
		}
		if err := staged.Close(); err != nil {
			return "", fmt.Errorf("close updated service: %w", err)
		}
		return staged.Name(), nil
	}
	return "", errors.New("service package does not contain the expected binary")
}

func restartLaunchdService() error {
	command := exec.Command("launchctl", "kickstart", "-k", fmt.Sprintf("gui/%d/video.recut.service", os.Getuid()))
	if output, err := command.CombinedOutput(); err != nil {
		return fmt.Errorf("restart launchd service: %s", strings.TrimSpace(string(output)))
	}
	return nil
}
