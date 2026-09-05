/*
 * [INPUT]: 依赖媒体 DTO、凭据和资产查询；种子目录（catalog_seed.go）
 * [OUTPUT]: 原子快照化的 Provider/模型目录索引（modelByID/providerByID）、通用参考预算校验器、
 *          无凭据 Codex 原生图片路由、模型配置和引用能力校验
 * [POS]: media 的声明式模型契约层；种子目录可被 CDN catalog（providers/<id>.catalog.json）按 provider 整体覆盖；
 *        Codex 图片能力仅供 Agent 指令选择，不经 Provider 调度
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"fmt"
	"strconv"
	"strings"
	"sync/atomic"
)

// catalogIndex is one immutable snapshot of the model catalog: the flat lists
// plus by-ID indexes. Lookups read the current snapshot atomically so a CDN
// refresh can swap the whole catalog without locking readers.
type catalogIndex struct {
	providers     []MediaProvider
	providersByID map[string]MediaProvider
	modelsByID    map[string]MediaModel
}

var catalogCurrent atomic.Pointer[catalogIndex]

func init() {
	catalogCurrent.Store(buildCatalogIndex(seedProviders))
}

func buildCatalogIndex(providers []MediaProvider) *catalogIndex {
	index := &catalogIndex{
		providers:     append([]MediaProvider(nil), providers...),
		providersByID: make(map[string]MediaProvider, len(providers)),
		modelsByID:    make(map[string]MediaModel),
	}
	for _, provider := range index.providers {
		index.providersByID[provider.ID] = provider
		for _, model := range provider.Models {
			index.modelsByID[model.ID] = model
		}
	}
	return index
}

// swapCatalog atomically replaces the in-memory catalog; the CDN loader (P1)
// is the only intended caller. An in-flight job holds its resolved MediaModel
// value copy, so a refresh never mutates a running generation.
func swapCatalog(providers []MediaProvider) {
	catalogCurrent.Store(buildCatalogIndex(providers))
}

func currentCatalog() *catalogIndex { return catalogCurrent.Load() }

const CodexImageModelID = "codex/image"

var codexImageModel = MediaModel{
	ID:           CodexImageModelID,
	Provider:     "codex",
	Name:         "Codex",
	Capability:   ImageGenerate,
	InputModes:   []string{"text", "image"},
	Available:    true,
	Configurable: true,
}

var codexImageProvider = MediaProvider{
	ID:       "codex",
	Name:     "Codex",
	Protocol: "native",
	Models:   []MediaModel{codexImageModel},
}

func (m *MediaService) Providers() []MediaProvider {
	return append([]MediaProvider(nil), currentCatalog().providers...)
}

func (m *MediaService) Models() []MediaModel {
	models := []MediaModel{}
	for _, provider := range currentCatalog().providers {
		models = append(models, provider.Models...)
	}
	return models
}

func (m *MediaService) ConfiguredModels() ([]MediaConfiguration, error) {
	routes, err := m.ListRoutes()
	if err != nil {
		return nil, err
	}
	items := []MediaConfiguration{}
	for _, route := range routes {
		if !route.Enabled {
			continue
		}
		configuration, ok := m.configuredModelFor(route)
		if ok {
			items = append(items, configuration)
		}
	}
	return items, nil
}

// configuredModelFor 把一条已启用路由解析为配置视图；本地 provider（无凭据，
// 如 Audio Studio 本机 TTS）与 Codex 原生图同样不需要查询凭据。
func (m *MediaService) configuredModelFor(route MediaRoute) (MediaConfiguration, bool) {
	model, ok := modelByID(route.ModelID)
	if !ok {
		return MediaConfiguration{}, false
	}
	provider, _ := providerByID(model.Provider)
	configuration := MediaConfiguration{Route: route, Provider: provider, Model: model, RequiredInputs: modelInputFields(model.InputModes), OptionalOutputs: modelOutputFields(model)}
	if model.ID == CodexImageModelID {
		return configuration, true
	}
	if p, ok := providerByID(model.Provider); ok && p.Protocol == "local" {
		configuration.CredentialName = "Audio Studio（本机）"
		return configuration, true
	}
	credential, err := m.credential(route.CredentialID)
	if err != nil {
		return MediaConfiguration{}, false
	}
	configuration.CredentialName = credential.Name
	return configuration, true
}

// validateReferences checks every reference of one generation input and
// returns the normalized typed references. Each entry is an asset (library
// truth: exists, completed, kind matches) or an absolute http(s) URL
// (SSRF-safe; kind from its typed list). Per-model reference budgets apply to
// both sources; URL size/mime come from a HEAD probe when the server exposes
// one. Callers must persist the returned references — normalizing twice would
// repeat the URL HEAD probes.
func (m *MediaService) validateReferences(input GenerateMediaInput) (MediaReferences, error) {
	refs, err := m.normalizeReferences(input)
	if err != nil {
		return MediaReferences{}, err
	}
	allowed := referenceKindsFor(input.Capability)
	imageCount, videoCount, audioCount := 0, 0, 0
	assets := make([]MediaAsset, 0)
	urlRefs := make([]MediaReference, 0)
	for _, ref := range refs.List() {
		if !allowed[ref.Kind] {
			return MediaReferences{}, fmt.Errorf("%s cannot use %s as reference context", input.Capability, ref.Kind)
		}
		switch ref.Kind {
		case "image":
			imageCount++
		case "video":
			videoCount++
		case "audio":
			audioCount++
		}
		if ref.Source == "url" {
			if _, err := ValidateRemoteFetchURL(ref.Value); err != nil {
				return MediaReferences{}, err
			}
			urlRefs = append(urlRefs, ref)
			continue
		}
		asset, err := m.GetAsset(ref.Value)
		if err != nil {
			return MediaReferences{}, fmt.Errorf("reference asset %q is unavailable", ref.Value)
		}
		if asset.Status != "completed" {
			return MediaReferences{}, fmt.Errorf("reference asset %q is still %s", ref.Value, asset.Status)
		}
		if asset.Kind != ref.Kind {
			return MediaReferences{}, fmt.Errorf("reference asset %q is %s but was declared as %s", asset.Name, asset.Kind, ref.Kind)
		}
		assets = append(assets, asset)
	}
	model, ok := modelByID(input.ModelID)
	if !ok {
		return refs, nil
	}
	if err := validateModelReferences(model, imageCount, videoCount, audioCount); err != nil {
		return MediaReferences{}, err
	}
	if err := validateModelReferenceAssets(model, assets); err != nil {
		return MediaReferences{}, err
	}
	if err := m.validateModelReferenceURLs(model, urlRefs); err != nil {
		return MediaReferences{}, err
	}
	return refs, nil
}

// validateModelReferenceURLs enforces per-model reference budgets for URL
// references using a HEAD probe. Servers that expose no size (or block HEAD)
// are checked by the provider upstream instead of being rejected here.
func (m *MediaService) validateModelReferenceURLs(model MediaModel, refs []MediaReference) error {
	for _, ref := range refs {
		contentType, size, ok, err := m.remoteCache.HeadInfo(ref.Value)
		if err != nil || !ok {
			continue
		}
		mimeType := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
		if err := validateModelReferenceSpec(model, ref.Kind, mimeType, size); err != nil {
			return fmt.Errorf("url reference %s: %s", ref.Value, err)
		}
	}
	return nil
}

// validateModelReferences enforces the model's declarative reference budgets
// (catalog data, not per-model switches). A model without budgets accepts any
// counts; capability-level kind rules are enforced separately by the caller.
func validateModelReferences(model MediaModel, images, videos, audios int) error {
	for _, budget := range model.ReferenceBudgets {
		for _, requirement := range budget.Requirements {
			ok, err := evalReferenceRequirement(requirement, images, videos, audios)
			if err != nil {
				return err
			}
			if !ok {
				return fmt.Errorf("reference counts (%d image, %d video, %d audio) violate model budget %q", images, videos, audios, requirement)
			}
		}
		if budget.MaxImages > 0 && images > budget.MaxImages {
			return fmt.Errorf("%s accepts at most %d image references", model.Name, budget.MaxImages)
		}
		if budget.MaxVideos > 0 && videos > budget.MaxVideos {
			return fmt.Errorf("%s accepts at most %d video references", model.Name, budget.MaxVideos)
		}
		if budget.MaxAudios > 0 && audios > budget.MaxAudios {
			return fmt.Errorf("%s accepts at most %d audio references", model.Name, budget.MaxAudios)
		}
	}
	return nil
}

func validateModelReferenceAssets(model MediaModel, assets []MediaAsset) error {
	for _, asset := range assets {
		mimeType := strings.ToLower(strings.Split(asset.MimeType, ";")[0])
		if err := validateModelReferenceSpec(model, asset.Kind, mimeType, asset.SizeBytes); err != nil {
			return fmt.Errorf("%s reference %q: %s", asset.Kind, asset.Name, err)
		}
	}
	return nil
}

// evalReferenceRequirement evaluates one budget predicate like
// "images+videos>=1" or "videos==0" against the reference counts. Parse
// failures fail closed so a broken catalog entry cannot widen the budget.
func evalReferenceRequirement(requirement string, images, videos, audios int) (bool, error) {
	trimmed := strings.TrimSpace(requirement)
	invalid := fmt.Errorf("invalid model reference budget requirement %q", requirement)
	for _, op := range []string{">=", "<=", "=="} {
		index := strings.Index(trimmed, op)
		if index < 0 {
			continue
		}
		rhs, err := strconv.Atoi(strings.TrimSpace(trimmed[index+len(op):]))
		if err != nil {
			return false, invalid
		}
		total := 0
		for _, term := range strings.Split(trimmed[:index], "+") {
			switch strings.TrimSpace(term) {
			case "images":
				total += images
			case "videos":
				total += videos
			case "audios":
				total += audios
			default:
				return false, invalid
			}
		}
		switch op {
		case ">=":
			return total >= rhs, nil
		case "<=":
			return total <= rhs, nil
		default:
			return total == rhs, nil
		}
	}
	return false, invalid
}

// validateModelReferenceSpec is the per-(kind, mime, size) constraint from the
// model's declarative budgets, shared by asset and URL references. When a
// budget declares kind specs at all, kinds without a spec are rejected.
func validateModelReferenceSpec(model MediaModel, kind, mimeType string, size int64) error {
	for _, budget := range model.ReferenceBudgets {
		var spec *ReferenceKindSpec
		switch kind {
		case "image":
			spec = budget.Image
		case "video":
			spec = budget.Video
		case "audio":
			spec = budget.Audio
		}
		if spec == nil {
			if budget.Image != nil || budget.Video != nil || budget.Audio != nil {
				return fmt.Errorf("%s references are not accepted by %s", kind, model.Name)
			}
			continue
		}
		if spec.MaxBytes > 0 && size > spec.MaxBytes {
			return fmt.Errorf("%s reference of %s exceeds the %d byte limit", kind, model.Name, spec.MaxBytes)
		}
		if len(spec.Mimes) > 0 && !oneOf(mimeType, spec.Mimes...) {
			return fmt.Errorf("%s reference mime %q is not a supported %s reference", kind, mimeType, model.Name)
		}
	}
	return nil
}

func oneOf(value string, options ...string) bool {
	for _, option := range options {
		if value == option {
			return true
		}
	}
	return false
}

func referenceKindsFor(capability MediaCapability) map[string]bool {
	if capability == ImageGenerate {
		return map[string]bool{"image": true}
	}
	if capability == VideoGenerate {
		return map[string]bool{"image": true, "video": true, "audio": true}
	}
	return map[string]bool{}
}

func knownCapability(capability MediaCapability) bool {
	return capability == ImageGenerate || capability == VideoGenerate || capability == SpeechGenerate
}
func modelSupports(id string, capability MediaCapability) bool {
	model, ok := modelByID(id)
	return ok && model.Capability == capability
}
func providerByID(id string) (MediaProvider, bool) {
	if id == codexImageProvider.ID {
		return codexImageProvider, true
	}
	provider, ok := currentCatalog().providersByID[id]
	return provider, ok
}
func modelByID(id string) (MediaModel, bool) {
	if id == CodexImageModelID {
		return codexImageModel, true
	}
	model, ok := currentCatalog().modelsByID[id]
	return model, ok
}
func providerUsesOpenAIProtocol(id string) bool {
	provider, ok := providerByID(id)
	return ok && (provider.Protocol == "openai" || provider.Protocol == "openai-compatible")
}
func outputFields(capability MediaCapability) []string {
	switch capability {
	case ImageGenerate:
		return []string{"size", "quality", "background"}
	case VideoGenerate:
		return []string{"durationSeconds", "aspectRatio", "resolution"}
	case SpeechGenerate:
		return []string{"voice", "language", "speed", "format"}
	default:
		return nil
	}
}

func modelOutputFields(model MediaModel) []string {
	if len(model.OutputModes) > 0 {
		return append([]string(nil), model.OutputModes...)
	}
	return outputFields(model.Capability)
}

func modelInputFields(modes []string) []string {
	fields := []string{}
	for _, mode := range modes {
		switch mode {
		case "text":
			fields = append(fields, "prompt")
		case "image":
			fields = append(fields, "imageAssetIds")
		case "video":
			fields = append(fields, "videoAssetIds")
		case "audio":
			fields = append(fields, "audioAssetIds")
		}
	}
	return fields
}
