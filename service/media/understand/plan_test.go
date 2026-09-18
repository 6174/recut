package understand

import (
	"math"
	"testing"
)

func TestPlanFramesExplicitAtSec(t *testing.T) {
	times, err := PlanFrames(FramePlanRequest{AtSec: []float64{5, 1, 3, 3}, DurationSec: 10, MaxFrames: 10})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []float64{1, 3, 5}
	if len(times) != len(want) {
		t.Fatalf("got %v want %v", times, want)
	}
	for index := range want {
		if math.Abs(times[index]-want[index]) > 1e-9 {
			t.Fatalf("got %v want %v", times, want)
		}
	}
}

func TestPlanFramesRejectsOutOfRange(t *testing.T) {
	if _, err := PlanFrames(FramePlanRequest{AtSec: []float64{11}, DurationSec: 10}); err == nil {
		t.Fatal("expected out-of-range error")
	}
}

func TestPlanFramesRejectsTooMany(t *testing.T) {
	if _, err := PlanFrames(FramePlanRequest{AtSec: []float64{1, 2, 3}, DurationSec: 10, MaxFrames: 2}); err == nil {
		t.Fatal("expected maxFrames error")
	}
}

func TestPlanFramesInterval(t *testing.T) {
	times, err := PlanFrames(FramePlanRequest{IntervalSec: 2, DurationSec: 7, MaxFrames: 10})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []float64{0, 2, 4, 6}
	if len(times) != len(want) {
		t.Fatalf("got %v want %v", times, want)
	}
}

func TestPlanFramesDefaultBudgetScalesWithDuration(t *testing.T) {
	times, err := PlanFrames(FramePlanRequest{IntervalSec: 5, DurationSec: 216})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(times) != 44 {
		t.Fatalf("got %d frames want 44", len(times))
	}
}

func TestPlanFramesIntervalRespectsHardCap(t *testing.T) {
	if _, err := PlanFrames(FramePlanRequest{IntervalSec: 1, DurationSec: 216}); err == nil {
		t.Fatal("expected hard cap error")
	}
}

func TestPlanFramesShortClipKeepsFloor(t *testing.T) {
	if _, err := PlanFrames(FramePlanRequest{IntervalSec: 0.1, DurationSec: 10}); err == nil {
		t.Fatal("expected default budget error")
	}
}

func TestFrameBudget(t *testing.T) {
	cases := []struct {
		maxFrames int
		duration  float64
		want      int
	}{
		{0, 10, DefaultMaxFrames},
		{0, 120, DefaultMaxFrames},
		{0, 216, 44},
		{0, 600, HardMaxFrames},
		{0, 1000, HardMaxFrames},
		{10, 216, 10},
		{200, 216, HardMaxFrames},
	}
	for _, tc := range cases {
		if got := frameBudget(tc.maxFrames, tc.duration); got != tc.want {
			t.Fatalf("frameBudget(%d, %v)=%d want %d", tc.maxFrames, tc.duration, got, tc.want)
		}
	}
}

func TestPlanFramesIntervalRequiresWindow(t *testing.T) {
	if _, err := PlanFrames(FramePlanRequest{IntervalSec: 0, DurationSec: 7}); err == nil {
		t.Fatal("expected interval requirement error")
	}
	start := 5.0
	end := 5.0
	if _, err := PlanFrames(FramePlanRequest{IntervalSec: 1, StartSec: &start, EndSec: &end, DurationSec: 10}); err == nil {
		t.Fatal("expected invalid window error")
	}
}

func TestPlanSheetSquare(t *testing.T) {
	plan, err := PlanSheet(12, 0, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if plan.Columns != 4 || plan.Rows != 3 {
		t.Fatalf("got columns=%d rows=%d want 4x3", plan.Columns, plan.Rows)
	}
	if plan.Width != 4*DefaultCellPx || plan.Height != 3*DefaultCellPx {
		t.Fatalf("unexpected size %dx%d", plan.Width, plan.Height)
	}
}

func TestPlanSheetClamps(t *testing.T) {
	plan, err := PlanSheet(2, 10, 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if plan.Columns != 2 {
		t.Fatalf("columns should clamp to count, got %d", plan.Columns)
	}
	if plan.CellPx != MinCellPx {
		t.Fatalf("cellPx should clamp to min, got %d", plan.CellPx)
	}
	if _, err := PlanSheet(0, 0, 0); err == nil {
		t.Fatal("expected empty sheet error")
	}
}

func TestEstimateDuration(t *testing.T) {
	if got := EstimateDuration(MeasureRequest{Text: "   "}); got != 0 {
		t.Fatalf("empty text should estimate 0, got %v", got)
	}
	cjk := EstimateDuration(MeasureRequest{Text: "你好世界"})
	if cjk <= 0 {
		t.Fatalf("expected positive estimate, got %v", cjk)
	}
	latin := EstimateDuration(MeasureRequest{Text: "hello world"})
	if latin <= 0 {
		t.Fatalf("expected positive estimate, got %v", latin)
	}
	faster := EstimateDuration(MeasureRequest{Text: "你好世界", Pace: 2})
	if !(faster < cjk) {
		t.Fatalf("faster pace should shorten duration: %v !< %v", faster, cjk)
	}
}

func TestParseAndFilterBoundaries(t *testing.T) {
	parsed, err := ParseBoundaries([]byte(`[{"atSec":4.0},{"atSec":1.0,"kind":"fade","score":22.5}]`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(parsed) != 2 || parsed[0].AtSec != 1.0 || parsed[0].Kind != "fade" {
		t.Fatalf("unexpected parse result %+v", parsed)
	}
	enveloped, err := ParseBoundaries([]byte(`{"boundaries":[{"atSec":3}]}`))
	if err != nil || len(enveloped) != 1 {
		t.Fatalf("envelope parse failed: %v %+v", err, enveloped)
	}
	filtered := FilterBoundaries(parsed, 5)
	if len(filtered) != 1 || filtered[0].AtSec != 1.0 {
		t.Fatalf("unexpected filter result %+v", filtered)
	}
}

func TestLabelsForTimes(t *testing.T) {
	segments := []Segment{{StartSec: 0, EndSec: 2, Text: "intro"}, {StartSec: 2, EndSec: 4, Text: "body"}}
	labels := LabelsForTimes(segments, []float64{1, 2.5, 9})
	want := []string{"intro", "body", "body"}
	for index := range want {
		if labels[index] != want[index] {
			t.Fatalf("label[%d]=%q want %q", index, labels[index], want[index])
		}
	}
}
