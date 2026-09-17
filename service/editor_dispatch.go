/*
 * [INPUT]: 依赖 AppHost.invoke 的 editor 分流、editorNativeHandlers 与 editorContext。
 * [OUTPUT]: recut.editor 的 Go 原生执行路径；未迁移的 op（如 component.*，属 M2）继续走 goja background。
 * [POS]: service editor 域与 App runtime 的接缝；Go 与 goja 共享同一 appstate DB，保证单写入口不分裂。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"fmt"
	"time"
)

// invokeEditorNative 执行一个 Go 原生 editor operation：构建 editorContext → 调 handler → 审计事件。
func (h *AppHost) invokeEditorNative(target Target, app App, name string, input map[string]any, locale Locale) (_ any, err error) {
	c, err := newEditorContext(h, target, app, locale)
	if err != nil {
		return nil, err
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("editor native handler %s panicked: %v", name, recovered)
		}
	}()
	result, err := editorNativeHandlers[name](c, input)
	if err != nil {
		return nil, err
	}
	if target.IsProject() {
		h.store.AppendEvent(target.ProjectID, map[string]any{
			"type": "app.capability.completed", "appId": app.Manifest.ID, "kind": "operation", "name": name, "at": time.Now().UTC(),
		})
	}
	return result, nil
}
