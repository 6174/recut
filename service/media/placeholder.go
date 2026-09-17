/*
 * [INPUT]: 依赖 MediaService 的 proposed 生命周期行创建（createProposedAsset）与 material 层的 attributes/content 校验
 * [OUTPUT]: recut.media.asset.create：创建一个无字节的计划素材（status=proposed）并写入 content/attributes，可选关联项目；
 *   不建 job、不花钱、可被 asset.update 补 metadata.proposal 后经 confirm 原位生成
 * [POS]: media 的 content-first 计划层；参考素材 content 是「这是什么」，计划素材 content 是「我要它是什么」
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// PlaceholderAssetInput is the typed asset.create request.
type PlaceholderAssetInput struct {
	Name       string
	Kind       string
	Content    string
	Attributes []MaterialAttr
	ProjectID  string
}

// placeholderMimeType is the nominal mime type of a byte-less plan asset. It is
// replaced in place when the asset is generated.
func placeholderMimeType(kind string) string {
	switch kind {
	case "video":
		return "video/mp4"
	case "image":
		return "image/png"
	case "audio":
		return "audio/mpeg"
	case "code":
		return "text/plain"
	default:
		return "application/octet-stream"
	}
}

// CreatePlaceholderAsset creates the content-first plan asset of RFC §4.2. It
// writes content/attributes now (the generation spec) and leaves the recipe to
// a later asset.update + confirm.
func (m *MediaService) CreatePlaceholderAsset(input PlaceholderAssetInput) (MediaAsset, error) {
	kind := strings.TrimSpace(input.Kind)
	switch kind {
	case "video", "image", "audio", "code":
	default:
		return MediaAsset{}, fmt.Errorf("asset.create kind must be video, image, audio or code; got %q", input.Kind)
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return MediaAsset{}, errors.New("asset.create name is required")
	}
	if input.ProjectID != "" {
		if _, err := projectExists(m.store, input.ProjectID); err != nil {
			return MediaAsset{}, err
		}
	}
	now := time.Now().UTC()
	nowISO := now.Format(time.RFC3339Nano)
	metadata := map[string]any{
		"source": "planned",
	}
	if strings.TrimSpace(input.Content) != "" {
		metadata[MetadataKeyContent] = input.Content
		metadata[MetadataKeyContentMeta] = MaterialProvenance{By: MaterialActorAgent, Op: "asset.create", At: nowISO}
	}
	if len(input.Attributes) > 0 {
		attrs, err := applyMaterialAttrReplace(nil, input.Attributes, MaterialActorAgent, "asset.create", nowISO)
		if err != nil {
			return MediaAsset{}, err
		}
		metadata[MetadataKeyAttributes] = attrs
	}
	return m.createProposedAsset(name, input.ProjectID, kind, placeholderMimeType(kind), metadata)
}
