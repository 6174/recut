/*
 * [INPUT]: 依赖 media 的 Asset 读取/落盘（GetAsset、saveDerivedAsset、store.MediaRoot）与 media/understand 的 Toolkit
 * [OUTPUT]: 平台媒体理解能力：probe / frames / contactSheet / boundaries / clip / measure —— 解析本地素材路径、
 *   调用 understand adapter、把帧/接触表/片段落为普通 image/video 素材并返回稳定 assetId
 * [POS]: media 包对理解工具的编排层；纯计算与 ffmpeg/Python IO 在 media/understand，本层只负责素材化与错误面
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"recut-service/media/understand"
)

// DataDir is the platform data root (also the media root). Understanding tools
// need it to locate the global Python venv and the fonts directory.
func (m *MediaService) DataDir() string { return m.store.MediaRoot() }

func (m *MediaService) understandingToolkit() *understand.Toolkit {
	return understand.NewToolkit(m.store.MediaRoot(), nil)
}

// UnderstandEnvironment reports the readiness of probe/frames/contactSheet/
// boundaries (ffprobe + platform Python modules). It never installs anything.
func (m *MediaService) UnderstandEnvironment(ctx context.Context) understand.Environment {
	return m.understandingToolkit().Environment(ctx)
}

// UnderstandPrepareArgs returns the command/args that prepare the platform
// understanding environment, or ok=false when the platform venv is absent.
func (m *MediaService) UnderstandPrepareArgs() (string, []string, bool) {
	return understand.PrepareArgs(m.store.MediaRoot())
}

// UnderstandProbe returns the objective facts of one local media asset.
func (m *MediaService) UnderstandProbe(ctx context.Context, assetID string) (understand.Probe, error) {
	_, path, err := m.readableMediaAsset(assetID, "video", "audio", "image")
	if err != nil {
		return understand.Probe{}, err
	}
	return m.understandingToolkit().Probe(ctx, path)
}

// UnderstandFrame is one extracted frame saved as an image asset.
type UnderstandFrame struct {
	AtSec   float64 `json:"atSec"`
	AssetID string  `json:"assetId"`
}

// UnderstandFramesResult is the frames tool envelope.
type UnderstandFramesResult struct {
	AssetID string            `json:"assetId"`
	Probe   understand.Probe  `json:"probe"`
	Frames  []UnderstandFrame `json:"frames"`
}

// UnderstandFramesInput is the typed frames request.
type UnderstandFramesInput struct {
	AssetID   string
	AtSec     []float64
	Interval  float64
	StartSec  *float64
	EndSec    *float64
	MaxFrames int
}

// UnderstandFrames extracts frames and saves each as an image asset.
func (m *MediaService) UnderstandFrames(ctx context.Context, input UnderstandFramesInput) (UnderstandFramesResult, error) {
	asset, path, err := m.readableMediaAsset(input.AssetID, "video", "image")
	if err != nil {
		return UnderstandFramesResult{}, err
	}
	toolkit := m.understandingToolkit()
	probe, err := toolkit.Probe(ctx, path)
	if err != nil {
		return UnderstandFramesResult{}, err
	}
	times, err := understand.PlanFrames(understand.FramePlanRequest{
		AtSec: input.AtSec, IntervalSec: input.Interval,
		StartSec: input.StartSec, EndSec: input.EndSec,
		MaxFrames: input.MaxFrames, DurationSec: probe.DurationSec,
	})
	if err != nil {
		return UnderstandFramesResult{}, err
	}
	tempDir, err := os.MkdirTemp(m.store.MediaRoot(), "understand-frames-")
	if err != nil {
		return UnderstandFramesResult{}, err
	}
	defer os.RemoveAll(tempDir)
	extracted, err := toolkit.ExtractFrames(ctx, path, times, tempDir)
	if err != nil {
		return UnderstandFramesResult{}, err
	}
	frames := make([]UnderstandFrame, 0, len(extracted))
	for _, frame := range extracted {
		content, err := os.ReadFile(frame.Path)
		if err != nil {
			return UnderstandFramesResult{}, err
		}
		saved, err := m.saveDerivedAsset(content, "image", "image/png", fmt.Sprintf("frame-%s-%.2fs.png", asset.ID, frame.AtSec), "understand", "", map[string]any{
			"source":      "understand",
			"sourceAsset": asset.ID,
			"atSec":       frame.AtSec,
		})
		if err != nil {
			return UnderstandFramesResult{}, err
		}
		frames = append(frames, UnderstandFrame{AtSec: frame.AtSec, AssetID: saved.ID})
	}
	return UnderstandFramesResult{AssetID: asset.ID, Probe: probe, Frames: frames}, nil
}

// UnderstandGridPanel is one sliced sheet cell saved as an image asset.
type UnderstandGridPanel struct {
	Row     int    `json:"row"`
	Col     int    `json:"col"`
	Coord   string `json:"coord"` // R{r}C{c}, 1-based
	Shot    int    `json:"shot"`  // 1-based, row-major
	AssetID string `json:"assetId"`
	X       int    `json:"x"`
	Y       int    `json:"y"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
}

// UnderstandGridSliceInput is the typed gridSlice request.
type UnderstandGridSliceInput struct {
	AssetID  string
	Rows     int
	Cols     int
	GutterPx int
}

// UnderstandGridSliceResult is the gridSlice tool envelope.
type UnderstandGridSliceResult struct {
	AssetID string                `json:"assetId"`
	Rows    int                   `json:"rows"`
	Cols    int                   `json:"cols"`
	Width   int                   `json:"width"`
	Height  int                   `json:"height"`
	Panels  []UnderstandGridPanel `json:"panels"`
}

// UnderstandGridSlice cuts one image (e.g. an N-cell storyboard sheet) into
// rows×cols equal cells by deterministic pixel math and saves each cell as an
// image asset. Pair each panel with its manifest entry by Coord.
func (m *MediaService) UnderstandGridSlice(ctx context.Context, input UnderstandGridSliceInput) (UnderstandGridSliceResult, error) {
	asset, path, err := m.readableMediaAsset(input.AssetID, "image")
	if err != nil {
		return UnderstandGridSliceResult{}, err
	}
	toolkit := m.understandingToolkit()
	width, height, err := toolkit.ImageSize(ctx, path)
	if err != nil {
		return UnderstandGridSliceResult{}, err
	}
	if width <= 0 || height <= 0 {
		return UnderstandGridSliceResult{}, fmt.Errorf("asset %q has no readable pixel size (got %dx%d)", asset.Name, width, height)
	}
	regions, err := understand.GridRegions(width, height, input.Rows, input.Cols, input.GutterPx)
	if err != nil {
		return UnderstandGridSliceResult{}, err
	}
	tempDir, err := os.MkdirTemp(m.store.MediaRoot(), "understand-grid-")
	if err != nil {
		return UnderstandGridSliceResult{}, err
	}
	defer os.RemoveAll(tempDir)
	panels := make([]UnderstandGridPanel, 0, len(regions))
	for index, region := range regions {
		targetPath := filepath.Join(tempDir, fmt.Sprintf("panel-%03d.png", index))
		if err := toolkit.CropImage(ctx, path, targetPath, region); err != nil {
			return UnderstandGridSliceResult{}, err
		}
		content, err := os.ReadFile(targetPath)
		if err != nil {
			return UnderstandGridSliceResult{}, err
		}
		saved, err := m.saveDerivedAsset(content, "image", "image/png", fmt.Sprintf("panel-%s-%s.png", asset.ID, region.Coord()), "understand", "", map[string]any{
			"source":      "understand",
			"sourceAsset": asset.ID,
			"coord":       region.Coord(),
			"row":         region.Row,
			"col":         region.Col,
			"x":           region.X,
			"y":           region.Y,
			"width":       region.Width,
			"height":      region.Height,
		})
		if err != nil {
			return UnderstandGridSliceResult{}, err
		}
		panels = append(panels, UnderstandGridPanel{
			Row: region.Row, Col: region.Col, Coord: region.Coord(), Shot: index + 1,
			AssetID: saved.ID, X: region.X, Y: region.Y, Width: region.Width, Height: region.Height,
		})
	}
	return UnderstandGridSliceResult{
		AssetID: asset.ID, Rows: input.Rows, Cols: input.Cols,
		Width: width, Height: height, Panels: panels,
	}, nil
}

// UnderstandSheetCell is one contact-sheet cell coordinate. AssetID is empty
// because cells are not persisted; only the composite sheet is an asset.
type UnderstandSheetCell struct {
	AtSec   float64 `json:"atSec"`
	AssetID string  `json:"assetId"`
	Label   string  `json:"label,omitempty"`
}

// UnderstandContactSheetResult is the contactSheet tool envelope.
type UnderstandContactSheetResult struct {
	AssetID      string                `json:"assetId"`
	SheetAssetID string                `json:"sheetAssetId"`
	Probe        understand.Probe      `json:"probe"`
	Cells        []UnderstandSheetCell `json:"cells"`
	Columns      int                   `json:"columns"`
	Rows         int                   `json:"rows"`
	CellPx       int                   `json:"cellPx"`
}

// UnderstandContactSheetInput is the typed contactSheet request.
type UnderstandContactSheetInput struct {
	AssetID           string
	StartSec          *float64
	EndSec            *float64
	Interval          float64
	Columns           int
	CellPx            int
	TranscriptAssetID string
}

// UnderstandContactSheet extracts evenly spaced frames and composites a
// timecoded (and optionally word-labelled) sheet, saved as one workspace-level
// asset. Cells are not persisted individually; callers that need single frames
// use UnderstandFrames.
func (m *MediaService) UnderstandContactSheet(ctx context.Context, input UnderstandContactSheetInput) (UnderstandContactSheetResult, error) {
	asset, path, err := m.readableMediaAsset(input.AssetID, "video", "image")
	if err != nil {
		return UnderstandContactSheetResult{}, err
	}
	toolkit := m.understandingToolkit()
	probe, err := toolkit.Probe(ctx, path)
	if err != nil {
		return UnderstandContactSheetResult{}, err
	}
	if !(input.Interval > 0) {
		return UnderstandContactSheetResult{}, errors.New("contactSheet requires a positive intervalSec")
	}
	times, err := understand.PlanFrames(understand.FramePlanRequest{
		IntervalSec: input.Interval,
		StartSec:    input.StartSec,
		EndSec:      input.EndSec,
		DurationSec: probe.DurationSec,
	})
	if err != nil {
		return UnderstandContactSheetResult{}, err
	}
	labels := make([]string, len(times))
	if strings.TrimSpace(input.TranscriptAssetID) != "" {
		segments, err := m.transcriptSegments(input.TranscriptAssetID)
		if err != nil {
			return UnderstandContactSheetResult{}, err
		}
		labels = understand.LabelsForTimes(segments, times)
	}
	tempDir, err := os.MkdirTemp(m.store.MediaRoot(), "understand-sheet-")
	if err != nil {
		return UnderstandContactSheetResult{}, err
	}
	defer os.RemoveAll(tempDir)
	extracted, err := toolkit.ExtractFrames(ctx, path, times, tempDir)
	if err != nil {
		return UnderstandContactSheetResult{}, err
	}
	// Analysis intermediates stay workspace-level and are not persisted per cell:
	// a contact sheet is one reviewable asset (the composite), not N frame assets.
	// Callers that genuinely need individual frames use recut.media.frames.
	cells := make([]UnderstandSheetCell, 0, len(extracted))
	sheetCells := make([]understand.SheetCell, 0, len(extracted))
	for index, frame := range extracted {
		label := timecode(frame.AtSec)
		if index < len(labels) && labels[index] != "" {
			label = label + " " + labels[index]
		}
		cells = append(cells, UnderstandSheetCell{AtSec: frame.AtSec, Label: label})
		sheetCells = append(sheetCells, understand.SheetCell{AtSec: frame.AtSec, Path: frame.Path, Label: label})
	}
	sheetPath := filepath.Join(tempDir, "contact-sheet.png")
	plan, err := toolkit.ContactSheet(ctx, understand.ContactSheetRequest{
		Cells: sheetCells, Columns: input.Columns, CellPx: input.CellPx, OutputPath: sheetPath,
	})
	if err != nil {
		return UnderstandContactSheetResult{}, err
	}
	sheetContent, err := os.ReadFile(sheetPath)
	if err != nil {
		return UnderstandContactSheetResult{}, err
	}
	sheet, err := m.saveDerivedAsset(sheetContent, "image", "image/png", fmt.Sprintf("contact-sheet-%s.png", asset.ID), "understand", "", map[string]any{
		"source":       "understand",
		"sourceAsset":  asset.ID,
		"cells":        cells,
		"transcriptId": strings.TrimSpace(input.TranscriptAssetID),
	})
	if err != nil {
		return UnderstandContactSheetResult{}, err
	}
	return UnderstandContactSheetResult{
		AssetID: asset.ID, SheetAssetID: sheet.ID, Probe: probe, Cells: cells,
		Columns: plan.Columns, Rows: plan.Rows, CellPx: plan.CellPx,
	}, nil
}

// UnderstandBoundariesInput is the typed boundaries request.
type UnderstandBoundariesInput struct {
	AssetID   string
	Threshold float64
	MinGapSec float64
}

// UnderstandBoundariesResult is the boundaries tool envelope.
type UnderstandBoundariesResult struct {
	AssetID    string                `json:"assetId"`
	Boundaries []understand.Boundary `json:"boundaries"`
	Threshold  float64               `json:"threshold"`
	MinGapSec  float64               `json:"minGapSec"`
	Note       string                `json:"note"`
}

// UnderstandBoundaries detects scene changes with PySceneDetect. Scores are
// best-effort; the note always states the detector's known limits.
func (m *MediaService) UnderstandBoundaries(ctx context.Context, input UnderstandBoundariesInput) (UnderstandBoundariesResult, error) {
	asset, path, err := m.readableMediaAsset(input.AssetID, "video")
	if err != nil {
		return UnderstandBoundariesResult{}, err
	}
	boundaries, err := m.understandingToolkit().Boundaries(ctx, path, input.Threshold, input.MinGapSec)
	if err != nil {
		return UnderstandBoundariesResult{}, err
	}
	if boundaries == nil {
		boundaries = []understand.Boundary{}
	}
	return UnderstandBoundariesResult{
		AssetID: asset.ID, Boundaries: boundaries, Threshold: input.Threshold, MinGapSec: input.MinGapSec,
		Note: "PySceneDetect 结果；快摇、强运动与叠化仍可能误检，score 缺失表示该检测器版本未提供置信度。",
	}, nil
}

// UnderstandClipResult is the clip tool envelope.
type UnderstandClipResult struct {
	AssetID     string  `json:"assetId"`
	ClipAssetID string  `json:"clipAssetId"`
	StartSec    float64 `json:"startSec"`
	EndSec      float64 `json:"endSec"`
}

// UnderstandClip re-encodes [startSec,endSec] into a new video asset.
func (m *MediaService) UnderstandClip(ctx context.Context, assetID string, startSec, endSec float64, projectID string) (UnderstandClipResult, error) {
	asset, path, err := m.readableMediaAsset(assetID, "video")
	if err != nil {
		return UnderstandClipResult{}, err
	}
	probe, err := m.understandingToolkit().Probe(ctx, path)
	if err != nil {
		return UnderstandClipResult{}, err
	}
	if startSec < 0 || endSec <= startSec || endSec > probe.DurationSec+1e-3 {
		return UnderstandClipResult{}, fmt.Errorf("clip range [%.3f, %.3f] is outside the source duration %.3f", startSec, endSec, probe.DurationSec)
	}
	tempDir, err := os.MkdirTemp(m.store.MediaRoot(), "understand-clip-")
	if err != nil {
		return UnderstandClipResult{}, err
	}
	defer os.RemoveAll(tempDir)
	clipPath := filepath.Join(tempDir, "clip.mp4")
	if err := m.understandingToolkit().Clip(ctx, path, clipPath, startSec, endSec); err != nil {
		return UnderstandClipResult{}, err
	}
	content, err := os.ReadFile(clipPath)
	if err != nil {
		return UnderstandClipResult{}, err
	}
	clip, err := m.saveDerivedAsset(content, "video", "video/mp4", fmt.Sprintf("clip-%s-%.2f-%.2fs.mp4", asset.ID, startSec, endSec), "understand", projectID, map[string]any{
		"source":      "understand",
		"sourceAsset": asset.ID,
		"startSec":    startSec,
		"endSec":      endSec,
	})
	if err != nil {
		return UnderstandClipResult{}, err
	}
	return UnderstandClipResult{AssetID: asset.ID, ClipAssetID: clip.ID, StartSec: startSec, EndSec: endSec}, nil
}

// MeasureRequestInput is the typed measure request.
type MeasureRequestInput struct {
	Text     string
	Language string
	Pace     float64
}

// UnderstandMeasure estimates narration duration locally (no model call).
func (m *MediaService) UnderstandMeasure(input MeasureRequestInput) map[string]any {
	seconds := understand.EstimateDuration(understand.MeasureRequest{Text: input.Text, Language: input.Language, Pace: input.Pace})
	return map[string]any{"estimatedDurationSec": seconds, "language": input.Language, "pace": input.Pace}
}

// readableMediaAsset resolves an asset to a readable local path and validates
// its kind. It fails closed with an actionable message for every miss.
func (m *MediaService) readableMediaAsset(assetID string, kinds ...string) (MediaAsset, string, error) {
	asset, err := m.GetAsset(strings.TrimSpace(assetID))
	if err != nil {
		return MediaAsset{}, "", fmt.Errorf("media asset %q not found", assetID)
	}
	if asset.Status != "completed" {
		return MediaAsset{}, "", fmt.Errorf("asset %q is %s; understanding needs a completed local file", asset.Name, asset.Status)
	}
	allowed := false
	for _, kind := range kinds {
		if asset.Kind == kind {
			allowed = true
			break
		}
	}
	if !allowed {
		return MediaAsset{}, "", fmt.Errorf("asset %q is %s; this tool requires %s", asset.Name, asset.Kind, strings.Join(kinds, "/"))
	}
	path, _ := asset.Metadata["path"].(string)
	if strings.TrimSpace(path) == "" {
		return MediaAsset{}, "", fmt.Errorf("asset %q has no local file; import it before understanding", asset.Name)
	}
	if _, err := os.Stat(path); err != nil {
		return MediaAsset{}, "", fmt.Errorf("asset %q file is not readable: %w", asset.Name, err)
	}
	return asset, path, nil
}

// transcriptSegments loads segments from an imported transcript asset's JSON
// part. Word labels are a convenience; a transcript without segments yields an
// empty list rather than an error.
func (m *MediaService) transcriptSegments(transcriptAssetID string) ([]understand.Segment, error) {
	asset, err := m.GetAsset(strings.TrimSpace(transcriptAssetID))
	if err != nil {
		return nil, fmt.Errorf("transcript asset %q not found", transcriptAssetID)
	}
	_, content, err := m.GetAssetPart(asset.ID, "json")
	if err != nil {
		return nil, fmt.Errorf("transcript asset %q has no json part", transcriptAssetID)
	}
	var decoded struct {
		Segments []understand.Segment `json:"segments"`
	}
	if err := json.Unmarshal(content, &decoded); err != nil {
		return nil, fmt.Errorf("transcript asset %q is malformed: %w", transcriptAssetID, err)
	}
	return decoded.Segments, nil
}

func timecode(atSec float64) string {
	minutes := int(atSec) / 60
	seconds := int(atSec) % 60
	frames := int((atSec - float64(int(atSec))) * 100)
	return fmt.Sprintf("%02d:%02d.%02d", minutes, seconds, frames)
}

// TranscriptWordLevel reports whether an imported transcript asset carries
// word-level timing (segments[].words[]).
func (m *MediaService) TranscriptWordLevel(transcriptAssetID string) (bool, error) {
	asset, err := m.GetAsset(strings.TrimSpace(transcriptAssetID))
	if err != nil {
		return false, fmt.Errorf("transcript asset %q not found", transcriptAssetID)
	}
	_, content, err := m.GetAssetPart(asset.ID, "json")
	if err != nil {
		return false, fmt.Errorf("transcript asset %q has no json part", transcriptAssetID)
	}
	var decoded struct {
		Segments []struct {
			Words []any `json:"words"`
		} `json:"segments"`
	}
	if err := json.Unmarshal(content, &decoded); err != nil {
		return false, fmt.Errorf("transcript asset %q is malformed: %w", transcriptAssetID, err)
	}
	for _, segment := range decoded.Segments {
		if len(segment.Words) > 0 {
			return true, nil
		}
	}
	return false, nil
}
