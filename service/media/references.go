/*
 * [INPUT]: 依赖 MediaService 的 Asset 读取、RemoteFileCache 与标准库 JSON
 * [OUTPUT]: 对外提供生成参考的 asset|url 双源模型 MediaReferences：输入规范化（typed 列表优先，
 * 兼容旧版 flat assetIds）、作业持久化双格式解析（ParseJobReferences）、提交期解析（jobReferences）
 * 与统一的本地文件解析（referenceFile：asset → 素材路径；url → 远程缓存路径）
 * [POS]: media 包的参考输入边界；World 证据（assetId|url）因此可以原样进入生成参考，
 * 两套来源各自独立运行，url 资源经统一缓存本地映射，绝不污染素材库
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"encoding/json"
	"fmt"
	"mime"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// MediaReference is one generation reference. Source is "asset" (a local
// library entity) or "url" (an absolute http(s) remote resource).
type MediaReference struct {
	Kind   string `json:"kind"`   // image | video | audio
	Source string `json:"source"` // asset | url
	Value  string `json:"value"`  // assetId or absolute http(s) URL
}

// MediaReferences groups job references by kind. Every entry is an assetId or
// an absolute http(s) URL — the same dual source as World evidence.
type MediaReferences struct {
	Images []string `json:"image,omitempty"`
	Videos []string `json:"video,omitempty"`
	Audio  []string `json:"audio,omitempty"`
}

func IsRemoteReference(value string) bool {
	trimmed := strings.TrimSpace(value)
	return strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://")
}

func (r MediaReferences) Empty() bool {
	return len(r.Images) == 0 && len(r.Videos) == 0 && len(r.Audio) == 0
}

// Flat is the legacy wire shape: one list, order image/video/audio.
func (r MediaReferences) Flat() []string {
	refs := make([]string, 0, len(r.Images)+len(r.Videos)+len(r.Audio))
	refs = append(refs, r.Images...)
	refs = append(refs, r.Videos...)
	return append(refs, r.Audio...)
}

// List expands the typed lists into one MediaReference slice.
func (r MediaReferences) List() []MediaReference {
	refs := []MediaReference{}
	for _, value := range r.Images {
		refs = append(refs, referenceOf("image", value))
	}
	for _, value := range r.Videos {
		refs = append(refs, referenceOf("video", value))
	}
	for _, value := range r.Audio {
		refs = append(refs, referenceOf("audio", value))
	}
	return refs
}

func referenceOf(kind, value string) MediaReference {
	source := "asset"
	if IsRemoteReference(value) {
		source = "url"
	}
	return MediaReference{Kind: kind, Source: source, Value: strings.TrimSpace(value)}
}

// ParseJobReferences reads media_jobs.reference_ids_json in both shapes: the
// typed object (new) and the flat assetId array (legacy rows). It returns the
// typed references (empty for legacy) and the flat view.
func ParseJobReferences(raw string) (MediaReferences, []string) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "null" {
		return MediaReferences{}, []string{}
	}
	var typed MediaReferences
	if err := json.Unmarshal([]byte(trimmed), &typed); err == nil && !typed.Empty() {
		return typed, typed.Flat()
	}
	legacy := []string{}
	if err := json.Unmarshal([]byte(trimmed), &legacy); err == nil {
		return MediaReferences{}, legacy
	}
	return MediaReferences{}, []string{}
}

// KindFromContentType maps a content type to a reference kind.
func KindFromContentType(contentType string) string {
	switch {
	case strings.HasPrefix(contentType, "image/"):
		return "image"
	case strings.HasPrefix(contentType, "video/"):
		return "video"
	case strings.HasPrefix(contentType, "audio/"):
		return "audio"
	}
	return ""
}

// normalizeReferences resolves one input's reference lists into the typed
// model. Typed lists win; the legacy flat ReferenceIDs fallback derives each
// entry's kind from the asset truth (or a content-type probe for URLs).
func (m *MediaService) normalizeReferences(input GenerateMediaInput) (MediaReferences, error) {
	if !input.References.Empty() {
		return input.References, nil
	}
	refs := MediaReferences{}
	for _, value := range input.ReferenceIDs {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if IsRemoteReference(value) {
			kind, err := m.probeReferenceKind(value)
			if err != nil {
				return MediaReferences{}, err
			}
			appendToKind(&refs, kind, value)
			continue
		}
		asset, err := m.GetAsset(value)
		if err != nil {
			return MediaReferences{}, fmt.Errorf("reference asset %q is unavailable", value)
		}
		appendToKind(&refs, asset.Kind, asset.ID)
	}
	return refs, nil
}

func appendToKind(refs *MediaReferences, kind, value string) {
	switch kind {
	case "image":
		refs.Images = append(refs.Images, value)
	case "video":
		refs.Videos = append(refs.Videos, value)
	case "audio":
		refs.Audio = append(refs.Audio, value)
	}
}

// probeReferenceKind determines a URL reference's kind: a content-type probe
// first, then the URL path extension.
func (m *MediaService) probeReferenceKind(rawURL string) (string, error) {
	if contentType, _, ok, err := m.remoteCache.HeadInfo(rawURL); err == nil && ok {
		if kind := KindFromContentType(contentType); kind != "" {
			return kind, nil
		}
	}
	if parsed, err := url.Parse(rawURL); err == nil {
		switch strings.ToLower(path.Ext(parsed.Path)) {
		case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp":
			return "image", nil
		case ".mp4", ".mov", ".webm", ".m4v":
			return "video", nil
		case ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac":
			return "audio", nil
		}
	}
	return "", fmt.Errorf("cannot determine the media kind of url %q", rawURL)
}

// jobReferences resolves one job's references for provider submission. New
// jobs carry typed references; legacy jobs (flat assetIds) re-derive the kind
// from the asset truth, exactly as before.
func (m *MediaService) jobReferences(job MediaJob) ([]MediaReference, error) {
	if !job.References.Empty() {
		return job.References.List(), nil
	}
	refs := []MediaReference{}
	for _, id := range job.ReferenceIDs {
		asset, err := m.GetAsset(id)
		if err != nil {
			return nil, fmt.Errorf("reference asset %q is unavailable", id)
		}
		refs = append(refs, MediaReference{Kind: asset.Kind, Source: "asset", Value: asset.ID})
	}
	return refs, nil
}

// referenceFile resolves one reference to a local file. Asset references use
// the content-addressed media store; URL references flow through the unified
// remote cache (first use downloads, later uses are filesystem hits). The
// media library is never touched by URL references.
func (m *MediaService) referenceFile(ref MediaReference) (path, mimeType, name string, err error) {
	if ref.Source == "url" {
		result, err := m.remoteCache.LocalPathFor(ref.Value)
		if err != nil {
			return "", "", "", err
		}
		mimeType := result.ContentType
		if mimeType == "" {
			mimeType = mimeByExtension(path)
		}
		name = filepath.Base(result.Path)
		return result.Path, mimeType, name, nil
	}
	asset, err := m.GetAsset(ref.Value)
	if err != nil {
		return "", "", "", err
	}
	assetPath, _ := asset.Metadata["path"].(string)
	if _, err := os.Stat(assetPath); err != nil {
		return "", "", "", fmt.Errorf("reference asset %q cannot be read", asset.Name)
	}
	return assetPath, asset.MimeType, asset.Name, nil
}

// mimeByExtension best-effort content type from a file extension.
func mimeByExtension(filePath string) string {
	if guessed := mime.TypeByExtension(strings.ToLower(path.Ext(filePath))); guessed != "" {
		return guessed
	}
	return "application/octet-stream"
}

// ReferencesForStorage is the media_jobs.reference_ids_json payload: the typed
// object when references carry kind information, the legacy flat array for
// untyped inputs (old rows and tooling stay readable).
func (j MediaJob) ReferencesForStorage() any {
	if !j.References.Empty() {
		return j.References
	}
	if j.ReferenceIDs != nil {
		return j.ReferenceIDs
	}
	return []string{}
}
