/**
 * [INPUT]: 依赖 editor_agent_test.go 的真实 Editor App setup 与 MCP 调用辅助。
 * [OUTPUT]: 锁定 work.checkpoint/work.cancel 按 command-log seq 回退、保留 redo 与版本递增。
 * [POS]: Editor Agent 服务层工作单元回归；防止把取消错误实现成按 version 回滚。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import "testing"

// TestEditorWorkUnitCancelBySequence 锁定用户打断只回退 checkpoint 之后的命令。
// undo 会产生一个新的项目 version，因此不能把“回到旧 version”作为成功条件。
func TestEditorWorkUnitCancelBySequence(t *testing.T) {
	_, _, host, project := setupEditorTestApp(t)
	invoke(t, host, project, "project.create", map[string]any{})

	locked := invoke(t, host, project, "project.lock", map[string]any{"owner": "agent-work-unit"})
	if !boolOf(locked["ok"]) {
		t.Fatalf("project.lock = %#v", locked)
	}
	lock := locked["lock"].(map[string]any)
	defer invoke(t, host, project, "project.unlock", map[string]any{"owner": lock["owner"], "token": lock["token"]})

	first := invoke(t, host, project, "timeline.command", map[string]any{"op": map[string]any{
		"type": "insert",
		"payload": map[string]any{
			"element": map[string]any{"type": "image", "name": "keep", "mediaId": "asset-keep", "startSec": float64(0), "durationSec": float64(2)},
		},
	}})
	if !boolOf(first["ok"]) || numOf(first["seq"]) != 1 || numOf(first["version"]) != 2 {
		t.Fatalf("first command = %#v", first)
	}
	checkpoint := invoke(t, host, project, "work.checkpoint", map[string]any{})
	if !boolOf(checkpoint["ok"]) || numOf(checkpoint["checkpointSeq"]) != 1 || numOf(checkpoint["version"]) != 2 {
		t.Fatalf("checkpoint = %#v", checkpoint)
	}

	second := invoke(t, host, project, "timeline.command", map[string]any{"op": map[string]any{
		"type": "insert",
		"payload": map[string]any{
			"element": map[string]any{"type": "image", "name": "cancel", "mediaId": "asset-cancel", "startSec": float64(2), "durationSec": float64(2)},
		},
	}})
	if !boolOf(second["ok"]) || numOf(second["seq"]) != 2 || numOf(second["version"]) != 3 {
		t.Fatalf("second command = %#v", second)
	}

	cancelled := invoke(t, host, project, "work.cancel", map[string]any{"checkpointSeq": checkpoint["checkpointSeq"], "owner": lock["owner"], "token": lock["token"]})
	if !boolOf(cancelled["ok"]) || numOf(cancelled["checkpointSeq"]) != 1 || numOf(cancelled["version"]) != 4 {
		t.Fatalf("work.cancel = %#v", cancelled)
	}
	undone, ok := cancelled["undoneSeqs"].([]any)
	if !ok || len(undone) != 1 || numOf(undone[0]) != 2 {
		t.Fatalf("work.cancel should undo only seq 2: %#v", cancelled)
	}
	read := invoke(t, host, project, "timeline.read", map[string]any{})
	clips, ok := read["clips"].([]any)
	if !ok || len(clips) != 1 || clips[0].(map[string]any)["name"] != "keep" {
		t.Fatalf("cancelled timeline = %#v", read)
	}

	noOpCancel := invoke(t, host, project, "work.cancel", map[string]any{"checkpointSeq": checkpoint["checkpointSeq"], "owner": lock["owner"], "token": lock["token"]})
	if !boolOf(noOpCancel["ok"]) || len(noOpCancel["undoneSeqs"].([]any)) != 0 || numOf(noOpCancel["version"]) != 4 {
		t.Fatalf("repeat work.cancel should be a no-op: %#v", noOpCancel)
	}

	redone := invoke(t, host, project, "history.redo", map[string]any{})
	if !boolOf(redone["ok"]) || numOf(redone["redidSeq"]) != 2 || numOf(redone["version"]) != 5 {
		t.Fatalf("redo after work.cancel = %#v", redone)
	}
	read = invoke(t, host, project, "timeline.read", map[string]any{})
	if clips = read["clips"].([]any); len(clips) != 2 {
		t.Fatalf("redo should restore the cancelled command: %#v", read)
	}
}
