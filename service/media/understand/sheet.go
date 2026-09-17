/*
 * [INPUT]: 依赖 Toolkit 的平台 Python 与 sheetScript、已抽出的帧文件与可选字体
 * [OUTPUT]: 接触表 ContactSheet：网格布局 + 时间码/词标签合成，输出单张 PNG 到调用方指定路径
 * [POS]: media/understand 的图像合成 adapter；时间码由 Python/Pillow 渲染，CJK 缺字时退化为可用标签
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package understand

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// SheetCell is one frame placed on the contact sheet.
type SheetCell struct {
	AtSec float64
	Path  string
	Label string
}

// ContactSheetRequest assembles a sheet from already-extracted frames.
type ContactSheetRequest struct {
	Cells      []SheetCell
	Columns    int
	CellPx     int
	OutputPath string
	FontPath   string
}

// ContactSheet composites the cells and returns the resolved layout.
func (t *Toolkit) ContactSheet(ctx context.Context, req ContactSheetRequest) (SheetPlan, error) {
	if t.Python == "" {
		return SheetPlan{}, t.requirePython("PIL")
	}
	plan, err := PlanSheet(len(req.Cells), req.Columns, req.CellPx)
	if err != nil {
		return SheetPlan{}, err
	}
	cells := make([]map[string]any, 0, len(req.Cells))
	for _, cell := range req.Cells {
		cells = append(cells, map[string]any{"path": cell.Path, "label": cell.Label})
	}
	fontPath := req.FontPath
	if fontPath == "" {
		fontPath = t.resolveFont()
	}
	payload := map[string]any{
		"cells":    cells,
		"columns":  plan.Columns,
		"rows":     plan.Rows,
		"cellPx":   plan.CellPx,
		"output":   req.OutputPath,
		"fontPath": fontPath,
	}
	if err := os.MkdirAll(filepath.Dir(req.OutputPath), 0o700); err != nil {
		return SheetPlan{}, err
	}
	var result struct {
		OK     bool   `json:"ok"`
		Width  int    `json:"width"`
		Height int    `json:"height"`
		Error  string `json:"error"`
	}
	if err := t.runPythonJSON(ctx, sheetScript, payload, &result); err != nil {
		return SheetPlan{}, err
	}
	if !result.OK {
		return SheetPlan{}, fmt.Errorf("contact sheet compositing failed: %s", result.Error)
	}
	return plan, nil
}

// resolveFont picks the first usable font in the platform fonts directory so CJK
// labels render; "" leaves the Python default (ASCII-only) font.
func (t *Toolkit) resolveFont() string {
	entries, err := os.ReadDir(t.FontsDir)
	if err != nil {
		return ""
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		switch strings.ToLower(filepath.Ext(entry.Name())) {
		case ".ttf", ".otf", ".ttc":
			return filepath.Join(t.FontsDir, entry.Name())
		}
	}
	return ""
}
