/*
 * [INPUT]: 依赖已完成的本地视频/音频 Asset、FFmpeg 与受限的两轨时间线参数
 * [OUTPUT]: 对外提供确定性视频合成；每次导出均创建一个带时间线 metadata 的新 video Asset
 * [POS]: media 的本地导出边界；不调用模型或 Provider，只把 App 提供的两条顺序轨道渲染为成片
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const ffmpegInstallHint = "未检测到 FFmpeg，且无法自动安装。请安装 Homebrew 后运行 `brew install ffmpeg`，或让 Codex 排查本机导出环境。"

// Compose renders a fixed video track and an optional fixed audio track. It
// accepts no shell fragments: every FFmpeg argument is constructed from a
// validated local Asset path or a finite platform setting.
func (m *MediaService) Compose(input ComposeMediaInput) (MediaAsset, error) {
	if err := ensureFFmpeg(); err != nil {
		return MediaAsset{}, err
	}
	if err := validateComposition(input); err != nil {
		return MediaAsset{}, err
	}

	videoAssets, err := m.compositionAssets(input.VideoTimeline, "video")
	if err != nil {
		return MediaAsset{}, err
	}
	audioAssets, err := m.compositionAssets(input.AudioTimeline, "audio")
	if err != nil {
		return MediaAsset{}, err
	}

	temporary, err := os.MkdirTemp(m.store.MediaRoot(), "timeline-export-")
	if err != nil {
		return MediaAsset{}, err
	}
	defer os.RemoveAll(temporary)
	outputPath := filepath.Join(temporary, "export.mp4")
	args, err := compositionCommand(videoAssets, audioAssets, input, outputPath)
	if err != nil {
		return MediaAsset{}, err
	}
	if output, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
		message := strings.TrimSpace(string(output))
		if len(message) > 1200 {
			message = message[len(message)-1200:]
		}
		return MediaAsset{}, fmt.Errorf("FFmpeg 导出失败：%s", message)
	}
	content, err := os.ReadFile(outputPath)
	if err != nil {
		return MediaAsset{}, err
	}
	metadata := map[string]any{
		"source":        "timeline-export",
		"videoTimeline": input.VideoTimeline,
		"audioTimeline": input.AudioTimeline,
		"settings":      input.Settings,
	}
	return m.saveDerivedAsset(content, "video", "video/mp4", "timeline-export.mp4", "timeline-export", input.ProjectID, metadata)
}

// ensureFFmpeg makes the export path self-healing on a standard macOS Recut
// install. It only installs the single declared dependency and returns an
// actionable diagnostic when Homebrew is unavailable or the install fails.
func ensureFFmpeg() error {
	if _, err := exec.LookPath("ffmpeg"); err == nil {
		return nil
	}
	brew, err := exec.LookPath("brew")
	if err != nil {
		return errors.New(ffmpegInstallHint)
	}
	output, err := exec.Command(brew, "install", "ffmpeg").CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if len(message) > 800 {
			message = message[len(message)-800:]
		}
		return fmt.Errorf("自动安装 FFmpeg 失败：%s", message)
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return errors.New(ffmpegInstallHint)
	}
	return nil
}

func validateComposition(input ComposeMediaInput) error {
	if strings.TrimSpace(input.ProjectID) == "" {
		return errors.New("projectId is required for export")
	}
	if err := validateTrack(input.VideoTimeline, "视频", true); err != nil {
		return err
	}
	if err := validateTrack(input.AudioTimeline, "音频", false); err != nil {
		return err
	}
	if input.Settings.Width < 320 || input.Settings.Width > 3840 || input.Settings.Height < 320 || input.Settings.Height > 3840 || input.Settings.Width%2 != 0 || input.Settings.Height%2 != 0 {
		return errors.New("导出尺寸必须是 320–3840 之间的偶数")
	}
	if input.Settings.FPS != 24 && input.Settings.FPS != 30 {
		return errors.New("导出帧率只支持 24 或 30 fps")
	}
	if input.Settings.Quality != "high" && input.Settings.Quality != "balanced" && input.Settings.Quality != "small" {
		return errors.New("导出质量必须是 high、balanced 或 small")
	}
	return nil
}

func validateTrack(track []TimelineClip, label string, required bool) error {
	if required && len(track) == 0 {
		return fmt.Errorf("至少选择一个%s片段", label)
	}
	expectedStart := 0.0
	for index, clip := range track {
		if strings.TrimSpace(clip.AssetID) == "" || !finitePositive(clip.DurationSec) {
			return fmt.Errorf("%s轨第 %d 段缺少素材或有效时长", label, index+1)
		}
		if math.Abs(clip.StartSec-expectedStart) > 0.01 {
			return fmt.Errorf("%s轨必须按顺序连续排列", label)
		}
		expectedStart += clip.DurationSec
	}
	return nil
}

func finitePositive(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value > 0 && value <= 3600
}

func (m *MediaService) compositionAssets(track []TimelineClip, expectedKind string) ([]MediaAsset, error) {
	assets := make([]MediaAsset, 0, len(track))
	for _, clip := range track {
		asset, err := m.GetAsset(clip.AssetID)
		if err != nil {
			return nil, fmt.Errorf("导出素材 %s 不存在", clip.AssetID)
		}
		if asset.Status != "completed" || asset.Kind != expectedKind {
			return nil, fmt.Errorf("素材“%s”必须是已完成的%s", asset.Name, expectedKind)
		}
		if path, _ := asset.Metadata["path"].(string); path == "" {
			return nil, fmt.Errorf("素材“%s”缺少本地文件", asset.Name)
		} else if _, err := os.Stat(path); err != nil {
			return nil, fmt.Errorf("素材“%s”的文件不可读取", asset.Name)
		}
		assets = append(assets, asset)
	}
	return assets, nil
}

func compositionCommand(videos, audios []MediaAsset, input ComposeMediaInput, outputPath string) ([]string, error) {
	args := []string{"-hide_banner", "-y"}
	paths := append([]MediaAsset{}, videos...)
	paths = append(paths, audios...)
	for _, asset := range paths {
		path, _ := asset.Metadata["path"].(string)
		args = append(args, "-i", path)
	}
	filters := []string{}
	videoLabels := []string{}
	for index, clip := range input.VideoTimeline {
		label := fmt.Sprintf("v%d", index)
		filters = append(filters, fmt.Sprintf("[%d:v]trim=duration=%.3f,setpts=PTS-STARTPTS,scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1[%s]", index, clip.DurationSec, input.Settings.Width, input.Settings.Height, input.Settings.Width, input.Settings.Height, label))
		videoLabels = append(videoLabels, "["+label+"]")
	}
	filters = append(filters, strings.Join(videoLabels, "")+fmt.Sprintf("concat=n=%d:v=1:a=0[vout]", len(videoLabels)))

	hasAudio := len(audios) > 0
	if hasAudio {
		audioLabels := []string{}
		for index, clip := range input.AudioTimeline {
			inputIndex := len(videos) + index
			label := fmt.Sprintf("a%d", index)
			filters = append(filters, fmt.Sprintf("[%d:a]atrim=duration=%.3f,asetpts=PTS-STARTPTS[%s]", inputIndex, clip.DurationSec, label))
			audioLabels = append(audioLabels, "["+label+"]")
		}
		filters = append(filters, strings.Join(audioLabels, "")+fmt.Sprintf("concat=n=%d:v=0:a=1[aout]", len(audioLabels)))
	}
	quality := map[string]string{"high": "18", "balanced": "23", "small": "28"}[input.Settings.Quality]
	args = append(args, "-filter_complex", strings.Join(filters, ";"), "-map", "[vout]")
	if hasAudio {
		args = append(args, "-map", "[aout]", "-c:a", "aac", "-b:a", "192k")
	} else {
		args = append(args, "-an")
	}
	args = append(args, "-r", fmt.Sprint(input.Settings.FPS), "-c:v", "libx264", "-crf", quality, "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath)
	return args, nil
}
