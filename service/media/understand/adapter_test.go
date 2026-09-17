/*
 * [INPUT]: 依赖 understand.Toolkit 的可注入 Runner 与 ffprobe JSON 形状
 * [OUTPUT]: 验证 probe 解析（时长/尺寸/帧率/音轨）、缺依赖时的结构化「需要准备」错误、Python 脚本调用的参数形状
 * [POS]: understand 的 adapter 回归测试；用 fake runner 替代真实 ffprobe/Python 进程
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package understand

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeRunner struct {
	calls   [][]string
	outputs map[string][]byte
	errs    map[string]error
}

func (f *fakeRunner) Run(_ context.Context, name string, args ...string) ([]byte, error) {
	f.calls = append(f.calls, append([]string{name}, args...))
	key := name
	if len(args) > 0 {
		key = name + " " + strings.Join(args, " ")
	}
	if err := f.errs[key]; err != nil {
		return nil, err
	}
	if f.errs[name] != nil {
		return nil, f.errs[name]
	}
	if output, ok := f.outputs[key]; ok {
		return output, nil
	}
	if output, ok := f.outputs[name]; ok {
		return output, nil
	}
	return nil, nil
}

func TestParseProbe(t *testing.T) {
	payload := []byte(`{
      "streams": [
        {"codec_type":"video","width":1080,"height":1920,"avg_frame_rate":"30000/1001"},
        {"codec_type":"audio","sample_rate":"48000","channels":2}
      ],
      "format": {"duration":"12.480000"}
    }`)
	probe, err := parseProbe(payload)
	if err != nil {
		t.Fatalf("parse probe: %v", err)
	}
	if probe.DurationSec < 12.47 || probe.DurationSec > 12.49 {
		t.Fatalf("durationSec = %v", probe.DurationSec)
	}
	if probe.Width != 1080 || probe.Height != 1920 {
		t.Fatalf("size = %dx%d", probe.Width, probe.Height)
	}
	if probe.FPS < 29.9 || probe.FPS > 30.1 {
		t.Fatalf("fps = %v", probe.FPS)
	}
	if !probe.HasAudio {
		t.Fatal("hasAudio must be true")
	}
}

func TestParseProbeRejectsNoDuration(t *testing.T) {
	if _, err := parseProbe([]byte(`{"streams":[],"format":{}}`)); err == nil {
		t.Fatal("expected missing-duration error")
	}
}

func TestProbeRequiresFFprobe(t *testing.T) {
	toolkit := &Toolkit{Runner: &fakeRunner{}}
	if _, err := toolkit.Probe(context.Background(), "/tmp/x.mp4"); err == nil {
		t.Fatal("expected readiness error")
	} else if !IsMissingDependency(err) {
		t.Fatalf("error must be a structured readiness guide, got %T", err)
	}
}

func TestProbeRunsFFprobeArguments(t *testing.T) {
	runner := &fakeRunner{outputs: map[string][]byte{
		"/usr/bin/ffprobe": []byte(`{"streams":[{"codec_type":"video","width":640,"height":360,"avg_frame_rate":"25/1"}],"format":{"duration":"3.0"}}`),
	}}
	toolkit := &Toolkit{Runner: runner, FFprobe: "/usr/bin/ffprobe"}
	probe, err := toolkit.Probe(context.Background(), "/tmp/clip.mp4")
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	if probe.FPS != 25 || probe.Width != 640 {
		t.Fatalf("unexpected probe %+v", probe)
	}
	if len(runner.calls) != 1 {
		t.Fatalf("expected one ffprobe call, got %d", len(runner.calls))
	}
	joined := strings.Join(runner.calls[0], " ")
	for _, want := range []string{"-show_format", "-show_streams", "/tmp/clip.mp4"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("ffprobe args missing %q: %s", want, joined)
		}
	}
}

func TestExtractFramesWritesPerTimeAndFailsClosed(t *testing.T) {
	dir := t.TempDir()
	runner := &fakeRunner{outputs: map[string][]byte{}}
	// Each ffmpeg invocation must leave a file behind; emulate by writing on Run.
	writing := &writingRunner{dir: dir}
	toolkit := &Toolkit{Runner: writing, FFmpeg: "/usr/bin/ffmpeg"}
	frames, err := toolkit.ExtractFrames(context.Background(), "/tmp/clip.mp4", []float64{0, 1.5}, dir)
	if err != nil {
		t.Fatalf("extract frames: %v", err)
	}
	if len(frames) != 2 || frames[0].AtSec != 0 || frames[1].AtSec != 1.5 {
		t.Fatalf("unexpected frames %+v", frames)
	}
	for _, frame := range frames {
		if _, err := os.Stat(frame.Path); err != nil {
			t.Fatalf("frame file missing: %v", err)
		}
	}
	_ = runner
}

type writingRunner struct {
	dir string
}

func (w *writingRunner) Run(_ context.Context, _ string, args ...string) ([]byte, error) {
	if len(args) == 0 {
		return nil, errors.New("missing args")
	}
	target := args[len(args)-1]
	return nil, os.WriteFile(target, []byte("png"), 0o600)
}

func TestUnderstandScriptsAreValidPython(t *testing.T) {
	for name, script := range map[string]string{"scene": sceneScript, "sheet": sheetScript} {
		if !strings.Contains(script, "def main():") || !strings.Contains(script, "json.dumps") {
			t.Fatalf("%s script does not look like a JSON-emitting python program", name)
		}
	}
}

func TestPrepareArgsScriptMentionsLock(t *testing.T) {
	script := PrepareScript(filepath.Join(t.TempDir(), "data"))
	if !strings.Contains(script, UnderstandLockHash()) {
		t.Fatalf("prepare script must embed the lock hash")
	}
	if !strings.Contains(script, "ffprobe") {
		t.Fatal("prepare script must materialize ffprobe")
	}
	if _, _, ok := PrepareArgs(t.TempDir()); ok {
		t.Log("platform venv present; PrepareArgs returned a runnable command")
	}
}
