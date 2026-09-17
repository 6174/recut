/*
 * [INPUT]: 依赖 Toolkit 的 ffmpeg 路径与 Runner
 * [OUTPUT]: 抽帧与剪辑：按精确 seek 导出单帧 PNG、按区间导出源片段 MP4
 * [POS]: media/understand 的 ffmpeg adapter；只产出本地临时文件，素材化由 media 层负责
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package understand

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

// ExtractedFrame is one written frame file at a source timestamp.
type ExtractedFrame struct {
	AtSec float64
	Path  string
}

// ExtractFrames writes one PNG per requested time into outDir using fast input
// seek plus a short decode, so long sources do not decode from zero.
func (t *Toolkit) ExtractFrames(ctx context.Context, sourcePath string, times []float64, outDir string) ([]ExtractedFrame, error) {
	if err := t.requireFFmpeg(); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(outDir, 0o700); err != nil {
		return nil, err
	}
	frames := make([]ExtractedFrame, 0, len(times))
	for index, at := range times {
		target := filepath.Join(outDir, fmt.Sprintf("frame-%04d.png", index))
		args := []string{
			"-hide_banner", "-loglevel", "error", "-y",
			"-ss", formatSeconds(at),
			"-i", sourcePath,
			"-frames:v", "1",
			"-q:v", "2",
			target,
		}
		if _, err := t.Runner.Run(ctx, t.FFmpeg, args...); err != nil {
			return nil, err
		}
		if _, err := os.Stat(target); err != nil {
			return nil, fmt.Errorf("ffmpeg produced no frame at %.3fs", at)
		}
		frames = append(frames, ExtractedFrame{AtSec: at, Path: target})
	}
	return frames, nil
}

// Clip re-encodes a source range into a self-contained MP4. Re-encoding keeps
// the requested boundaries frame-accurate; stream copy would snap to keyframes.
func (t *Toolkit) Clip(ctx context.Context, sourcePath, targetPath string, startSec, endSec float64) error {
	if err := t.requireFFmpeg(); err != nil {
		return err
	}
	if !(endSec > startSec) {
		return fmt.Errorf("clip endSec must be greater than startSec")
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o700); err != nil {
		return err
	}
	args := []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-ss", formatSeconds(startSec),
		"-to", formatSeconds(endSec),
		"-i", sourcePath,
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
		"-c:a", "aac",
		"-movflags", "+faststart",
		targetPath,
	}
	if _, err := t.Runner.Run(ctx, t.FFmpeg, args...); err != nil {
		return err
	}
	if _, err := os.Stat(targetPath); err != nil {
		return fmt.Errorf("ffmpeg produced no clip output")
	}
	return nil
}

func formatSeconds(value float64) string {
	return strconv.FormatFloat(value, 'f', 3, 64)
}
