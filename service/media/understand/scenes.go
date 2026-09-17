/*
 * [INPUT]: 依赖 Toolkit 的平台 Python 与 sceneScript
 * [OUTPUT]: 边界检测 Boundaries：调用 PySceneDetect 得到切点（kind/score 可选），按 minGapSec 过滤
 * [POS]: media/understand 的场景切分 adapter；结果如实标注置信度与限制，不冒充精确镜头切分
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package understand

import (
	"context"
	"fmt"
)

// Boundaries returns scene-change candidates. threshold 0 means the detector
// default; minGapSec 0 means no de-clustering.
func (t *Toolkit) Boundaries(ctx context.Context, path string, threshold, minGapSec float64) ([]Boundary, error) {
	if t.Python == "" {
		return nil, t.requirePython("scenedetect")
	}
	payload := map[string]any{
		"path":      path,
		"threshold": threshold,
	}
	var result struct {
		Boundaries []Boundary `json:"boundaries"`
		Error      string     `json:"error"`
	}
	if err := t.runPythonJSON(ctx, sceneScript, payload, &result); err != nil {
		return nil, err
	}
	if result.Error != "" {
		return nil, &MissingDependencyError{Tool: "scenedetect", Hint: fmt.Sprintf("PySceneDetect 不可用（%s）；请调用 recut.media.understand.prepare 准备平台 Python 环境。", result.Error)}
	}
	return FilterBoundaries(normalizeBoundaries(result.Boundaries), minGapSec), nil
}
