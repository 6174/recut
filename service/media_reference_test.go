/*
 * [INPUT]: 依赖 MediaService 的 MCP 工具面
 * [OUTPUT]: 验证理解/引入/素材工具已注册，且 evidence 与 content-first 占位工具已下线
 * [POS]: service 的素材工具面回归测试；不调用 ffmpeg/Python、不触发任何生成
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import "testing"

func TestUnderstandMCPToolsAreRegistered(t *testing.T) {
	for _, name := range []string{
		"recut.media.probe", "recut.media.frames", "recut.media.contactSheet",
		"recut.media.boundaries", "recut.media.clip", "recut.media.words", "recut.media.measure",
		"recut.media.import", "recut.media.asset.get", "recut.media.asset.update",
		"recut.media.understand.status", "recut.media.understand.prepare",
	} {
		if !isMediaMCPTool(name) {
			t.Fatalf("MCP tool %q is not registered", name)
		}
	}
	// The evidence flow and the content-first placeholder are gone in the new
	// asset model: none of these may be exposed or dispatchable.
	for _, name := range []string{
		"recut.media.reference.mark", "recut.media.reference.attach",
		"recut.media.asset.create", "recut.media.import_media", "recut.media.reference.link",
	} {
		if isMediaMCPTool(name) {
			t.Fatalf("retired media tool %q must not be registered", name)
		}
	}
}
