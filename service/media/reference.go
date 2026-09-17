/*
 * [INPUT]: 依赖 MediaService 的 Asset 读取/元数据事务、material 层的 attributes/content 写入与 understand 的观察类型
 * [OUTPUT]: 真实内容参考资产的标记与观察证据写入：reference.create 初始化 metadata.reference（只装观察），
 *   reference.attach 按 (kind,assetId/params) 幂等合并 probe/transcript/frames/sheets/boundaries/clips
 * [POS]: media 的「参考角色 + 观察证据」契约层；参考是素材角色（kind 仍 video/image/audio），不是新字节类型
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"recut-service/media/understand"
)

// MetadataKeyReference is the owner-op-written observation group of a reference
// asset. It only holds pointers (assetIds) and objective quantities.
const MetadataKeyReference = "reference"

// ReferenceSource is the reference's own media facts.
type ReferenceSource struct {
	AssetID     string  `json:"assetId"`
	URL         string  `json:"url,omitempty"`
	DurationSec float64 `json:"durationSec,omitempty"`
	Width       int     `json:"width,omitempty"`
	Height      int     `json:"height,omitempty"`
	FPS         float64 `json:"fps,omitempty"`
	HasAudio    bool    `json:"hasAudio,omitempty"`
}

// ReferenceTranscript points at a transcript asset used for this reference.
type ReferenceTranscript struct {
	AssetID   string `json:"assetId"`
	Language  string `json:"language,omitempty"`
	WordLevel bool   `json:"wordLevel"`
}

// ReferenceFrame is one evidence frame pointer.
type ReferenceFrame struct {
	AtSec   float64 `json:"atSec"`
	AssetID string  `json:"assetId"`
}

// ReferenceSheet is one contact-sheet pointer over a source range.
type ReferenceSheet struct {
	Range             [2]float64 `json:"range"`
	AssetID           string     `json:"assetId"`
	TranscriptAssetID string     `json:"transcriptAssetId,omitempty"`
}

// ReferenceClip is one source-segment pointer.
type ReferenceClip struct {
	StartSec float64 `json:"startSec"`
	EndSec   float64 `json:"endSec"`
	AssetID  string  `json:"assetId"`
	Label    string  `json:"label,omitempty"`
}

// ReferenceProvenance records where the reference came from.
type ReferenceProvenance struct {
	SourceURL string `json:"sourceUrl,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
}

// ReferenceEvidence is the whole metadata.reference observation group.
type ReferenceEvidence struct {
	Source       *ReferenceSource      `json:"source,omitempty"`
	Transcript   *ReferenceTranscript  `json:"transcript,omitempty"`
	Frames       []ReferenceFrame      `json:"frames,omitempty"`
	Sheets       []ReferenceSheet      `json:"sheets,omitempty"`
	Boundaries   []understand.Boundary `json:"boundaries,omitempty"`
	Clips        []ReferenceClip       `json:"clips,omitempty"`
	Provenance   *ReferenceProvenance  `json:"provenance,omitempty"`
	UnderstoodAt string                `json:"understoodAt,omitempty"`
	ToolVersion  string                `json:"toolVersion,omitempty"`
}

// ReferenceAttachInput is the reference.attach payload: any subset may be
// supplied; each kind merges idempotently.
type ReferenceAttachInput struct {
	AssetID     string
	SourceURL   string
	Source      *ReferenceSource
	Transcript  *ReferenceTranscript
	Frames      []ReferenceFrame
	Sheets      []ReferenceSheet
	Boundaries  []understand.Boundary
	Clips       []ReferenceClip
	ToolVersion string
}

// ReadReferenceEvidence decodes metadata.reference of an asset. A missing or
// malformed group yields an empty evidence value (never an error) so partial
// evidence always stays usable.
func ReadReferenceEvidence(asset MediaAsset) ReferenceEvidence {
	raw, ok := asset.Metadata[MetadataKeyReference]
	if !ok || raw == nil {
		return ReferenceEvidence{}
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return ReferenceEvidence{}
	}
	var evidence ReferenceEvidence
	if err := json.Unmarshal(data, &evidence); err != nil {
		return ReferenceEvidence{}
	}
	return evidence
}

// isReferenceableKind reports whether an asset carries real bytes that can be
// understood and marked as a reference. Link-only research assets are excluded.
func isReferenceableKind(kind string) bool {
	switch kind {
	case "video", "image", "audio":
		return true
	}
	return false
}

// CreateReference marks an existing real media asset as a reference and seeds
// its observation group. sourceUrl is provenance only: it never dedupes,
// fetches, or downloads.
func (m *MediaService) CreateReference(assetID, sourceURL string) (MediaAsset, error) {
	asset, err := m.GetAsset(strings.TrimSpace(assetID))
	if err != nil {
		return MediaAsset{}, fmt.Errorf("media asset %q not found", assetID)
	}
	if !isReferenceableKind(asset.Kind) {
		return MediaAsset{}, fmt.Errorf("reference.create requires a video/image/audio asset; %q is %s", asset.Name, asset.Kind)
	}
	now := time.Now().UTC()
	evidence := ReadReferenceEvidence(asset)
	if evidence.Source == nil {
		evidence.Source = &ReferenceSource{AssetID: asset.ID}
	}
	sourceURL = strings.TrimSpace(sourceURL)
	if sourceURL != "" {
		evidence.Source.URL = sourceURL
	}
	if evidence.Provenance == nil {
		evidence.Provenance = &ReferenceProvenance{CreatedAt: now.Format(time.RFC3339Nano)}
	}
	if sourceURL != "" {
		evidence.Provenance.SourceURL = sourceURL
	}
	evidence.ToolVersion = understand.UnderstandToolVersion
	if evidence.Source.DurationSec == 0 {
		if probe, probeErr := m.UnderstandProbe(context.Background(), asset.ID); probeErr == nil {
			evidence.Source.DurationSec = probe.DurationSec
			evidence.Source.Width = probe.Width
			evidence.Source.Height = probe.Height
			evidence.Source.FPS = probe.FPS
			evidence.Source.HasAudio = probe.HasAudio
		}
	}
	return m.writeReferenceEvidence(asset.ID, evidence)
}

// AttachReferenceEvidence merges observation evidence into a reference asset's
// metadata.reference idempotently.
func (m *MediaService) AttachReferenceEvidence(input ReferenceAttachInput) (MediaAsset, error) {
	asset, err := m.GetAsset(strings.TrimSpace(input.AssetID))
	if err != nil {
		return MediaAsset{}, fmt.Errorf("media asset %q not found", input.AssetID)
	}
	if !isReferenceableKind(asset.Kind) {
		return MediaAsset{}, fmt.Errorf("reference.attach requires a video/image/audio asset; %q is %s", asset.Name, asset.Kind)
	}
	evidence := ReadReferenceEvidence(asset)
	mergeReference(&evidence, input)
	toolVersion := strings.TrimSpace(input.ToolVersion)
	if toolVersion == "" {
		toolVersion = understand.UnderstandToolVersion
	}
	evidence.ToolVersion = toolVersion
	evidence.UnderstoodAt = time.Now().UTC().Format(time.RFC3339Nano)
	return m.writeReferenceEvidence(asset.ID, evidence)
}

func mergeReference(evidence *ReferenceEvidence, input ReferenceAttachInput) {
	if input.Source != nil {
		if evidence.Source == nil {
			evidence.Source = &ReferenceSource{}
		}
		mergeReferenceSource(evidence.Source, *input.Source)
	}
	if strings.TrimSpace(input.SourceURL) != "" {
		if evidence.Provenance == nil {
			evidence.Provenance = &ReferenceProvenance{CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
		}
		if evidence.Provenance.SourceURL == "" {
			evidence.Provenance.SourceURL = strings.TrimSpace(input.SourceURL)
		}
		if evidence.Source != nil && evidence.Source.URL == "" {
			evidence.Source.URL = strings.TrimSpace(input.SourceURL)
		}
	}
	if input.Transcript != nil && strings.TrimSpace(input.Transcript.AssetID) != "" {
		transcript := *input.Transcript
		transcript.AssetID = strings.TrimSpace(transcript.AssetID)
		evidence.Transcript = &transcript
	}
	if evidence.Provenance == nil {
		evidence.Provenance = &ReferenceProvenance{CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	}
	for _, frame := range input.Frames {
		if strings.TrimSpace(frame.AssetID) == "" {
			continue
		}
		if !containsReferenceFrame(evidence.Frames, frame) {
			evidence.Frames = append(evidence.Frames, frame)
		}
	}
	for _, sheet := range input.Sheets {
		if strings.TrimSpace(sheet.AssetID) == "" {
			continue
		}
		if !containsReferenceSheet(evidence.Sheets, sheet.AssetID) {
			evidence.Sheets = append(evidence.Sheets, sheet)
		}
	}
	for _, boundary := range input.Boundaries {
		if !containsReferenceBoundary(evidence.Boundaries, boundary.AtSec) {
			evidence.Boundaries = append(evidence.Boundaries, boundary)
		}
	}
	for _, clip := range input.Clips {
		if strings.TrimSpace(clip.AssetID) == "" {
			continue
		}
		if !containsReferenceClip(evidence.Clips, clip.AssetID) {
			evidence.Clips = append(evidence.Clips, clip)
		}
	}
}

func mergeReferenceSource(target *ReferenceSource, incoming ReferenceSource) {
	if incoming.AssetID != "" {
		target.AssetID = incoming.AssetID
	}
	if incoming.URL != "" && target.URL == "" {
		target.URL = incoming.URL
	}
	if incoming.DurationSec > 0 {
		target.DurationSec = incoming.DurationSec
	}
	if incoming.Width > 0 {
		target.Width = incoming.Width
	}
	if incoming.Height > 0 {
		target.Height = incoming.Height
	}
	if incoming.FPS > 0 {
		target.FPS = incoming.FPS
	}
	target.HasAudio = target.HasAudio || incoming.HasAudio
}

func containsReferenceFrame(frames []ReferenceFrame, candidate ReferenceFrame) bool {
	for _, frame := range frames {
		if frame.AssetID == candidate.AssetID {
			return true
		}
		if frame.AtSec == candidate.AtSec && frame.AssetID == "" {
			return true
		}
	}
	return false
}

func containsReferenceSheet(sheets []ReferenceSheet, assetID string) bool {
	for _, sheet := range sheets {
		if sheet.AssetID == assetID {
			return true
		}
	}
	return false
}

func containsReferenceBoundary(boundaries []understand.Boundary, atSec float64) bool {
	for _, boundary := range boundaries {
		if boundary.AtSec == atSec {
			return true
		}
	}
	return false
}

func containsReferenceClip(clips []ReferenceClip, assetID string) bool {
	for _, clip := range clips {
		if clip.AssetID == assetID {
			return true
		}
	}
	return false
}

// writeReferenceEvidence persists metadata.reference in the asset's own row and
// emits one durable asset event.
func (m *MediaService) writeReferenceEvidence(assetID string, evidence ReferenceEvidence) (MediaAsset, error) {
	asset, err := m.GetAsset(assetID)
	if err != nil {
		return MediaAsset{}, err
	}
	metadata := map[string]any{}
	for key, value := range asset.Metadata {
		metadata[key] = value
	}
	metadata[MetadataKeyReference] = evidence
	serialized, err := json.Marshal(metadata)
	if err != nil {
		return MediaAsset{}, err
	}
	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	now := time.Now().UTC()
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	result, err := tx.Exec("update media_assets set metadata_json = ?, updated_at = ? where id = ?", string(serialized), now.Format(time.RFC3339Nano), assetID)
	if err != nil {
		_ = tx.Rollback()
		return MediaAsset{}, err
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		_ = tx.Rollback()
		if err != nil {
			return MediaAsset{}, err
		}
		return MediaAsset{}, errors.New("media asset not found")
	}
	if err := recordAssetEvent(tx, assetID, now); err != nil {
		_ = tx.Rollback()
		return MediaAsset{}, err
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	m.publishAssetChange()
	return m.GetAsset(assetID)
}
