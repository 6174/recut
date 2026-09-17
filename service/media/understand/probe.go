/*
 * [INPUT]: 依赖 Toolkit 的 ffprobe 路径与 Runner
 * [OUTPUT]: Probe 观察：解析 ffprobe JSON 得到时长/尺寸/帧率/是否有音轨
 * [POS]: media/understand 的媒体探测 adapter；只读客观量，不做任何判断
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package understand

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

type ffprobeOutput struct {
	Streams []struct {
		CodecType    string `json:"codec_type"`
		Width        int    `json:"width"`
		Height       int    `json:"height"`
		AvgFrameRate string `json:"avg_frame_rate"`
		RFrameRate   string `json:"r_frame_rate"`
		Duration     string `json:"duration"`
		SampleRate   string `json:"sample_rate"`
		Channels     int    `json:"channels"`
	} `json:"streams"`
	Format struct {
		Duration string `json:"duration"`
	} `json:"format"`
}

// Probe runs ffprobe and returns the objective media facts.
func (t *Toolkit) Probe(ctx context.Context, path string) (Probe, error) {
	if err := t.requireFFprobe(); err != nil {
		return Probe{}, err
	}
	output, err := t.Runner.Run(ctx, t.FFprobe,
		"-v", "error",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		path,
	)
	if err != nil {
		return Probe{}, err
	}
	return parseProbe(output)
}

func parseProbe(data []byte) (Probe, error) {
	var parsed ffprobeOutput
	if err := json.Unmarshal(data, &parsed); err != nil {
		return Probe{}, fmt.Errorf("cannot parse ffprobe output: %w", err)
	}
	probe := Probe{}
	probe.DurationSec = firstPositive(parseSeconds(parsed.Format.Duration))
	for _, stream := range parsed.Streams {
		switch stream.CodecType {
		case "video":
			if probe.Width == 0 && stream.Width > 0 {
				probe.Width, probe.Height = stream.Width, stream.Height
			}
			if probe.FPS == 0 {
				probe.FPS = parseFrameRate(stream.AvgFrameRate)
				if probe.FPS == 0 {
					probe.FPS = parseFrameRate(stream.RFrameRate)
				}
			}
			if probe.DurationSec == 0 {
				probe.DurationSec = firstPositive(parseSeconds(stream.Duration))
			}
		case "audio":
			probe.HasAudio = true
			if probe.DurationSec == 0 {
				probe.DurationSec = firstPositive(parseSeconds(stream.Duration))
			}
		}
	}
	if probe.DurationSec == 0 {
		return Probe{}, fmt.Errorf("ffprobe returned no duration for this file")
	}
	return probe, nil
}

func parseSeconds(value string) float64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	seconds, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0
	}
	return seconds
}

// parseFrameRate converts ffprobe's "num/den" rate into a float.
func parseFrameRate(value string) float64 {
	value = strings.TrimSpace(value)
	if value == "" || value == "0/0" {
		return 0
	}
	numerator, denominator, found := strings.Cut(value, "/")
	if !found {
		rate, _ := strconv.ParseFloat(value, 64)
		return rate
	}
	top, errTop := strconv.ParseFloat(strings.TrimSpace(numerator), 64)
	bottom, errBottom := strconv.ParseFloat(strings.TrimSpace(denominator), 64)
	if errTop != nil || errBottom != nil || bottom == 0 {
		return 0
	}
	return top / bottom
}

func firstPositive(values ...float64) float64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}
