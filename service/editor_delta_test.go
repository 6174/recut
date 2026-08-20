/**
 * [INPUT]: 依赖 editor_agent_test.go 的真实 Editor App setup、MCP 调用与项目事件读取辅助。
 * [OUTPUT]: 锁定 timeline.delta 的版本边界、操作顺序、折叠 document 与事件 payload 契约。
 * [POS]: Editor Agent 服务层增量同步回归；验证 App background 到持久化事件账本的完整链路。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import "testing"

// TestEditorTimelineDeltaContract 锁定版本缺口时的 Host 可见契约：返回有序操作与当前
// 折叠 document，而不是只发送要求完整重载的通知。
func TestEditorTimelineDeltaContract(t *testing.T) {
	_, store, host, project := setupEditorTestApp(t)
	invoke(t, host, project, "project.create", map[string]any{})

	insert := invoke(t, host, project, "timeline.command", map[string]any{"op": map[string]any{
		"type": "insert",
		"payload": map[string]any{
			"element": map[string]any{"type": "image", "name": "hero", "mediaId": "asset-hero", "startSec": float64(0), "durationSec": float64(2)},
		},
	}})
	if !boolOf(insert["ok"]) || numOf(insert["version"]) != 2 {
		t.Fatalf("insert = %#v", insert)
	}
	ref := insert["result"].(map[string]any)["element"].(map[string]any)
	update := invoke(t, host, project, "timeline.command", map[string]any{"op": map[string]any{
		"type": "param",
		"payload": map[string]any{
			"ref":    ref,
			"params": map[string]any{"opacity": float64(0.8)},
		},
	}})
	if !boolOf(update["ok"]) || numOf(update["version"]) != 3 {
		t.Fatalf("param = %#v", update)
	}

	delta := invoke(t, host, project, "timeline.delta", map[string]any{"fromVersion": float64(1)})
	if !boolOf(delta["ok"]) || numOf(delta["fromVersion"]) != 1 || numOf(delta["toVersion"]) != 3 {
		t.Fatalf("delta versions = %#v", delta)
	}
	operations, ok := delta["operations"].([]any)
	if !ok || len(operations) != 2 {
		t.Fatalf("delta operations = %#v", delta["operations"])
	}
	if operationType(operations[0]) != "insert" || operationType(operations[1]) != "param" {
		t.Fatalf("delta operation order = %#v", operations)
	}
	document, ok := delta["document"].(map[string]any)
	if !ok || numOf(document["version"]) != 3 {
		t.Fatalf("delta document = %#v", delta["document"])
	}
	if countProjectElements(document) != 1 {
		t.Fatalf("delta document should contain folded result: %#v", document)
	}

	events := projectEvents(store, project.ID)
	var latest map[string]any
	for _, event := range events {
		if event["type"] == "project.document.changed" && numOf(event["toVersion"]) == 3 {
			latest = event
		}
	}
	if latest == nil {
		t.Fatalf("missing document event for version 3: %#v", events)
	}
	if numOf(latest["fromVersion"]) != 2 || numOf(latest["version"]) != 3 {
		t.Fatalf("event versions = %#v", latest)
	}
	eventOperations, ok := latest["operations"].([]any)
	if !ok || len(eventOperations) != 1 || operationType(eventOperations[0]) != "param" {
		t.Fatalf("event operations = %#v", latest["operations"])
	}
	eventDocument, ok := latest["document"].(map[string]any)
	if !ok || numOf(eventDocument["version"]) != 3 || countProjectElements(eventDocument) != 1 {
		t.Fatalf("event document = %#v", latest["document"])
	}
}

func operationType(value any) string {
	operation, _ := value.(map[string]any)
	return stringOf(operation["type"])
}

func countProjectElements(document map[string]any) int {
	scenes, _ := document["scenes"].([]any)
	count := 0
	for _, sceneValue := range scenes {
		scene, _ := sceneValue.(map[string]any)
		tracks, _ := scene["tracks"].(map[string]any)
		for _, trackValue := range []any{tracks["main"]} {
			track, _ := trackValue.(map[string]any)
			elements, _ := track["elements"].([]any)
			count += len(elements)
		}
		for _, groupName := range []string{"overlay", "audio"} {
			group, _ := tracks[groupName].([]any)
			for _, trackValue := range group {
				track, _ := trackValue.(map[string]any)
				elements, _ := track["elements"].([]any)
				count += len(elements)
			}
		}
	}
	return count
}
