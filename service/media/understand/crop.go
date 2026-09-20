/*
 * [INPUT]: 依赖 Toolkit 的 ffmpeg 路径与 Runner
 * [OUTPUT]: 规则网格切分：GridRegions（纯函数，等分 + 可选缝隙，可单测）与 CropImage（ffmpeg crop 导出单格 PNG）
 * [POS]: media/understand 的图像网格 adapter；分镜表（storyboard sheet）按 R{r}C{c} 坐标切格时使用，只产出本地临时文件
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

// GridRegion is one equal-grid cell in pixel space (origin top-left).
type GridRegion struct {
	Row    int // 0-based row, top→bottom
	Col    int // 0-based col, left→right
	X      int
	Y      int
	Width  int
	Height int
}

// Coord renders the cell's human/grid coordinate, e.g. R2C3 (1-based).
func (r GridRegion) Coord() string { return fmt.Sprintf("R%dC%d", r.Row+1, r.Col+1) }

// GridRegions splits width×height into rows×cols equal cells, optionally
// trimming gutterPx from every side of each cell (clamped so a cell never
// collapses). Boundaries are rounded so cells tile the image exactly with no
// gaps or overlaps.
func GridRegions(width, height, rows, cols, gutterPx int) ([]GridRegion, error) {
	if width <= 0 || height <= 0 {
		return nil, fmt.Errorf("gridSlice needs a positive image size, got %dx%d", width, height)
	}
	if rows <= 0 || cols <= 0 {
		return nil, fmt.Errorf("gridSlice needs positive rows/cols, got %dx%d", rows, cols)
	}
	if gutterPx < 0 {
		gutterPx = 0
	}
	regions := make([]GridRegion, 0, rows*cols)
	for row := 0; row < rows; row++ {
		y0 := row * height / rows
		y1 := (row + 1) * height / rows
		for col := 0; col < cols; col++ {
			x0 := col * width / cols
			x1 := (col + 1) * width / cols
			x, y, w, h := x0+gutterPx, y0+gutterPx, (x1 - x0) - 2*gutterPx, (y1 - y0) - 2*gutterPx
			if w < 1 || h < 1 { // gutter too large for this cell; keep at least 1px
				x, y, w, h = x0, y0, x1-x0, y1-y0
			}
			if x+w > width {
				w = width - x
			}
			if y+h > height {
				h = height - y
			}
			regions = append(regions, GridRegion{Row: row, Col: col, X: x, Y: y, Width: w, Height: h})
		}
	}
	return regions, nil
}

// CropImage writes one crop of sourcePath into targetPath as PNG.
func (t *Toolkit) CropImage(ctx context.Context, sourcePath, targetPath string, region GridRegion) error {
	if err := t.requireFFmpeg(); err != nil {
		return err
	}
	if region.Width < 1 || region.Height < 1 {
		return fmt.Errorf("crop region %s has a non-positive size %dx%d", region.Coord(), region.Width, region.Height)
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o700); err != nil {
		return err
	}
	filter := fmt.Sprintf("crop=%s:%s:%s:%s",
		strconv.Itoa(region.Width), strconv.Itoa(region.Height), strconv.Itoa(region.X), strconv.Itoa(region.Y))
	args := []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-i", sourcePath,
		"-vf", filter,
		"-frames:v", "1",
		targetPath,
	}
	if _, err := t.Runner.Run(ctx, t.FFmpeg, args...); err != nil {
		return err
	}
	if _, err := os.Stat(targetPath); err != nil {
		return fmt.Errorf("ffmpeg produced no crop for %s", region.Coord())
	}
	return nil
}
