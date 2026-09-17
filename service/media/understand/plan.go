/*
 * [INPUT]: 无运行时依赖（纯函数 + 标准库）
 * [OUTPUT]: 参考理解的纯计算核心：抽帧时间点展开、接触表网格布局、朗读时长估算、
 *   边界结果的解析/最小间隔过滤、词标签选取；所有函数无 ffmpeg/文件系统/网络副作用
 * [POS]: media/understand 的决策层；ffmpeg/Python adapter 只负责 IO，可单测的部分全部集中在此
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package understand

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"unicode"
)

const (
	// DefaultMaxFrames bounds a single frames/contactSheet extraction when the
	// caller does not set one; HardMaxFrames is the absolute ceiling.
	DefaultMaxFrames = 24
	HardMaxFrames    = 120
	// MaxAtSecPoints bounds explicit atSec lists the same way.
	MaxAtSecPoints = HardMaxFrames

	DefaultCellPx = 320
	MinCellPx     = 96
	MaxCellPx     = 720

	timeEpsilon = 1e-3
)

// Probe is the objective media observation returned by ffprobe.
type Probe struct {
	DurationSec float64 `json:"durationSec"`
	Width       int     `json:"width"`
	Height      int     `json:"height"`
	FPS         float64 `json:"fps"`
	HasAudio    bool    `json:"hasAudio"`
}

// FramePlanRequest is the pure input of frame-time expansion. DurationSec must
// be the probed source duration; AtSec wins over the interval form.
type FramePlanRequest struct {
	AtSec       []float64
	IntervalSec float64
	StartSec    *float64
	EndSec      *float64
	MaxFrames   int
	DurationSec float64
}

// PlanFrames expands a frame request into ordered, de-duplicated source times.
// An explicit atSec list is validated against the duration; otherwise the
// [start,end] window is walked at IntervalSec. Exceeding MaxFrames fails closed
// so the caller narrows the interval instead of silently truncating evidence.
func PlanFrames(req FramePlanRequest) ([]float64, error) {
	if !(req.DurationSec > 0) {
		return nil, errors.New("source duration is required before planning frames")
	}
	maxFrames := req.MaxFrames
	if maxFrames <= 0 {
		maxFrames = DefaultMaxFrames
	}
	if maxFrames > HardMaxFrames {
		maxFrames = HardMaxFrames
	}
	if len(req.AtSec) > 0 {
		if len(req.AtSec) > maxFrames {
			return nil, fmt.Errorf("frame count %d exceeds maxFrames %d", len(req.AtSec), maxFrames)
		}
		times := make([]float64, 0, len(req.AtSec))
		for _, at := range req.AtSec {
			if math.IsNaN(at) || math.IsInf(at, 0) || at < 0 || at > req.DurationSec+timeEpsilon {
				return nil, fmt.Errorf("atSec %.3f is outside the source range [0, %.3f]", at, req.DurationSec)
			}
			times = append(times, clampTime(at, req.DurationSec))
		}
		return dedupeSorted(times), nil
	}
	if !(req.IntervalSec > 0) {
		return nil, errors.New("intervalSec is required when atSec is empty")
	}
	start := 0.0
	if req.StartSec != nil {
		start = *req.StartSec
	}
	end := req.DurationSec
	if req.EndSec != nil {
		end = *req.EndSec
	}
	if start < 0 || start >= req.DurationSec+timeEpsilon {
		return nil, fmt.Errorf("startSec %.3f is outside the source range [0, %.3f]", start, req.DurationSec)
	}
	if end > req.DurationSec+timeEpsilon || end <= start {
		return nil, fmt.Errorf("endSec %.3f must be greater than startSec %.3f and within the source duration", end, start)
	}
	end = clampTime(end, req.DurationSec)
	times := []float64{}
	for at := start; at < end-timeEpsilon; at += req.IntervalSec {
		times = append(times, clampTime(at, req.DurationSec))
		if len(times) > maxFrames {
			return nil, fmt.Errorf("interval %.3fs over [%.3f, %.3f] produces more than maxFrames %d; increase intervalSec or bound the range", req.IntervalSec, start, end, maxFrames)
		}
	}
	if len(times) == 0 {
		return nil, errors.New("the requested range produces no frames")
	}
	return dedupeSorted(times), nil
}

func clampTime(value, duration float64) float64 {
	if value < 0 {
		return 0
	}
	if value > duration {
		return duration
	}
	return value
}

func dedupeSorted(values []float64) []float64 {
	sort.Float64s(values)
	result := values[:0]
	for _, value := range values {
		if len(result) > 0 && math.Abs(result[len(result)-1]-value) < timeEpsilon {
			continue
		}
		result = append(result, value)
	}
	return result
}

// SheetPlan is the deterministic contact-sheet grid layout.
type SheetPlan struct {
	Columns int `json:"columns"`
	Rows    int `json:"rows"`
	CellPx  int `json:"cellPx"`
	Width   int `json:"width"`
	Height  int `json:"height"`
}

// PlanSheet derives the grid from the cell count. columns 0 means "as square as
// possible"; cellPx 0 means DefaultCellPx. Out-of-range values are clamped so a
// caller can never request an unbounded bitmap.
func PlanSheet(count, columns, cellPx int) (SheetPlan, error) {
	if count <= 0 {
		return SheetPlan{}, errors.New("contact sheet needs at least one cell")
	}
	if cellPx <= 0 {
		cellPx = DefaultCellPx
	}
	if cellPx < MinCellPx {
		cellPx = MinCellPx
	}
	if cellPx > MaxCellPx {
		cellPx = MaxCellPx
	}
	if columns <= 0 {
		columns = int(math.Ceil(math.Sqrt(float64(count))))
	}
	if columns < 1 {
		columns = 1
	}
	if columns > count {
		columns = count
	}
	rows := (count + columns - 1) / columns
	return SheetPlan{Columns: columns, Rows: rows, CellPx: cellPx, Width: columns * cellPx, Height: rows * cellPx}, nil
}

// MeasureRequest is the pure input of speaking-duration estimation.
type MeasureRequest struct {
	Text     string
	Language string
	Pace     float64
}

// EstimateDuration estimates how long a narration line takes to read. It is a
// pure local calculation (no model): CJK runs are counted by character, latin
// by word, punctuation adds a short pause, and Pace (default 1.0) scales the
// result so a caller can express faster/slower delivery.
func EstimateDuration(req MeasureRequest) float64 {
	text := strings.TrimSpace(req.Text)
	if text == "" {
		return 0
	}
	pace := req.Pace
	if pace <= 0 {
		pace = 1
	}
	if pace < 0.5 {
		pace = 0.5
	}
	if pace > 2 {
		pace = 2
	}
	cjk := 0
	latinWords := 0
	longPause := 0
	shortPause := 0
	currentWord := false
	for _, r := range text {
		switch {
		case isCJK(r):
			cjk++
			currentWord = false
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			if !currentWord {
				latinWords++
				currentWord = true
			}
		case r == '\'' || r == '’':
			// word-internal apostrophe keeps the current word open
		default:
			currentWord = false
			switch r {
			case '。', '！', '？', '；', '.', '!', '?', ';', '\n':
				longPause++
			case '，', '、', ',', ':', '：':
				shortPause++
			}
		}
	}
	seconds := float64(cjk)/4.5 + float64(latinWords)/2.5
	seconds += float64(longPause)*0.18 + float64(shortPause)*0.08
	seconds /= pace
	return math.Round(seconds*100) / 100
}

func isCJK(r rune) bool {
	return unicode.Is(unicode.Han, r) ||
		unicode.Is(unicode.Hiragana, r) ||
		unicode.Is(unicode.Katakana, r) ||
		unicode.Is(unicode.Hangul, r)
}

// Boundary is one detected scene change. Score is optional because not every
// detector version reports a confidence value.
type Boundary struct {
	AtSec float64  `json:"atSec"`
	Kind  string   `json:"kind"`
	Score *float64 `json:"score,omitempty"`
}

// ParseBoundaries decodes the detector's JSON output (a bare array or an object
// with a boundaries array). An empty document yields no boundaries, never an
// error, so a clip with no cuts is a valid observation.
func ParseBoundaries(data []byte) ([]Boundary, error) {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" {
		return []Boundary{}, nil
	}
	var direct []Boundary
	if err := json.Unmarshal([]byte(trimmed), &direct); err == nil {
		return normalizeBoundaries(direct), nil
	}
	var envelope struct {
		Boundaries []Boundary `json:"boundaries"`
	}
	if err := json.Unmarshal([]byte(trimmed), &envelope); err != nil {
		return nil, fmt.Errorf("cannot parse boundary detector output: %w", err)
	}
	return normalizeBoundaries(envelope.Boundaries), nil
}

func normalizeBoundaries(in []Boundary) []Boundary {
	out := make([]Boundary, 0, len(in))
	for _, item := range in {
		if item.AtSec < 0 || math.IsNaN(item.AtSec) || math.IsInf(item.AtSec, 0) {
			continue
		}
		kind := strings.TrimSpace(item.Kind)
		if kind == "" {
			kind = "hard-cut"
		}
		item.Kind = kind
		out = append(out, item)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].AtSec < out[j].AtSec })
	return out
}

// FilterBoundaries removes cuts closer together than minGapSec (keeping the
// earliest of each cluster) so a noisy detector cannot flood the evidence.
func FilterBoundaries(in []Boundary, minGapSec float64) []Boundary {
	sorted := append([]Boundary(nil), in...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].AtSec < sorted[j].AtSec })
	out := make([]Boundary, 0, len(sorted))
	for _, item := range sorted {
		if len(out) > 0 && item.AtSec-out[len(out)-1].AtSec < minGapSec {
			continue
		}
		out = append(out, item)
	}
	return out
}

// Segment is one transcript segment used for word/line labelling.
type Segment struct {
	StartSec float64 `json:"start"`
	EndSec   float64 `json:"end"`
	Text     string  `json:"text"`
}

// LabelsForTimes returns, for every requested time, the transcript text active
// at that moment (or the most recently finished segment). Times with no
// preceding speech yield an empty label.
func LabelsForTimes(segments []Segment, times []float64) []string {
	labels := make([]string, len(times))
	for index, at := range times {
		label := ""
		for _, segment := range segments {
			if at+timeEpsilon >= segment.StartSec && at <= segment.EndSec+timeEpsilon {
				label = segment.Text
				break
			}
			if segment.EndSec <= at+timeEpsilon {
				label = segment.Text
			}
		}
		labels[index] = strings.TrimSpace(label)
	}
	return labels
}
