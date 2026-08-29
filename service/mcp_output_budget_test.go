/*
 * [INPUT]: 依赖 mcp.go 的 tools/call 截断漏斗（truncateMCPToolResult / writeMCPToolOverflow）、
 * media 包的 ListAssetsFiltered 分页过滤与 mediaAssetFilterFromInput 参数映射，以及测试 Store/App 目录
 * [OUTPUT]: 覆盖三条输出预算策略：超长工具输出落盘为截断信封（skills.read 端到端 + 单元）、
 * list_assets 的 ids/kind/query/limit/offset SQL 过滤与 total 分页、参数解析与 cliScanError 包装
 * [POS]: 平台「工具输出预算」策略的回归测试；不测媒体生成的 provider 路径
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func newMediaTestService(t *testing.T) (*Store, *MediaService) {
	t.Helper()
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	return store, NewMediaService(store)
}

func TestMediaListAssetsFilterAndPaginate(t *testing.T) {
	_, media := newMediaTestService(t)
	first, err := media.ImportMedia("alpha.png", "image/png", []byte("alpha"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := media.ImportMedia("beta.mp4", "video/mp4", []byte("beta"))
	if err != nil {
		t.Fatal(err)
	}
	third, err := media.ImportMedia("gamma.mp3", "audio/mpeg", []byte("gamma"))
	if err != nil {
		t.Fatal(err)
	}

	// Exact ids lookup wins over kind/query and returns full records.
	page, err := media.ListAssetsFiltered("", MediaAssetFilter{IDs: []string{first.ID, third.ID}, Kind: "video"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 2 || len(page.Items) != 2 {
		t.Fatalf("ids lookup = total %d, items %d; want 2/2", page.Total, len(page.Items))
	}
	gotIDs := map[string]bool{page.Items[0].ID: true, page.Items[1].ID: true}
	if !gotIDs[first.ID] || !gotIDs[third.ID] {
		t.Fatalf("ids lookup returned %v", gotIDs)
	}

	page, err = media.ListAssetsFiltered("", MediaAssetFilter{Kind: "video"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || page.Items[0].ID != second.ID {
		t.Fatalf("kind=video filter = %#v", page)
	}

	page, err = media.ListAssetsFiltered("", MediaAssetFilter{Query: "gamma"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || page.Items[0].ID != third.ID {
		t.Fatalf("query=gamma filter = %#v", page)
	}

	// Pagination keeps the full filtered count while slicing items.
	page, err = media.ListAssetsFiltered("", MediaAssetFilter{Limit: 2, Offset: 0})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 3 || len(page.Items) != 2 || page.Limit != 2 {
		t.Fatalf("page one = %#v", page)
	}
	page, err = media.ListAssetsFiltered("", MediaAssetFilter{Limit: 2, Offset: 2})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 3 || len(page.Items) != 1 {
		t.Fatalf("page two = %#v", page)
	}

	// An explicit status filter replaces the default tombstone exclusion; an
	// unknown status therefore matches nothing rather than everything.
	page, err = media.ListAssetsFiltered("", MediaAssetFilter{Status: "completed", Kind: "image"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 {
		t.Fatalf("status=completed kind=image = %#v", page)
	}
}

func TestMediaAssetFilterFromInputParsing(t *testing.T) {
	filter := mediaAssetFilterFromInput(map[string]any{
		"ids":    []any{"asset-1", "asset-2"},
		"kind":   "image",
		"query":  "cover",
		"limit":  float64(50),
		"offset": float64(10),
	})
	if !reflect.DeepEqual(filter, MediaAssetFilter{IDs: []string{"asset-1", "asset-2"}, Kind: "image", Query: "cover", Limit: 50, Offset: 10}) {
		t.Fatalf("filter = %#v", filter)
	}
	filter = mediaAssetFilterFromInput(map[string]any{"ids": "asset-1, asset-2"})
	if !reflect.DeepEqual(filter, MediaAssetFilter{IDs: []string{"asset-1", "asset-2"}}) {
		t.Fatalf("string ids filter = %#v", filter)
	}
	if filter := mediaAssetFilterFromInput(map[string]any{}); !reflect.DeepEqual(filter, MediaAssetFilter{}) {
		t.Fatalf("empty filter = %#v", filter)
	}
}

func TestTruncateMCPToolResultSpillsOversizedText(t *testing.T) {
	small := map[string]any{"content": []map[string]string{{"type": "text", "text": `{"ok":true}`}}, "structuredContent": map[string]any{"ok": true}}
	if result := truncateMCPToolResult(small); !reflect.DeepEqual(result, small) {
		t.Fatalf("small envelope was modified: %#v", result)
	}

	big := map[string]any{"content": []map[string]string{{"type": "text", "text": strings.Repeat("x", 60<<10)}}, "structuredContent": map[string]any{"items": []string{"x"}}}
	result, ok := truncateMCPToolResult(big).(map[string]any)
	if !ok {
		t.Fatalf("oversized envelope = %#v", result)
	}
	text := result["content"].([]map[string]string)[0]["text"]
	notice := map[string]any{}
	if err := json.Unmarshal([]byte(text), &notice); err != nil {
		t.Fatalf("truncation notice is not JSON: %v", err)
	}
	if notice["truncated"] != true || notice["totalBytes"] != float64(60<<10) {
		t.Fatalf("notice = %#v", notice)
	}
	path, _ := notice["fullOutputPath"].(string)
	if path == "" {
		t.Fatalf("notice missing fullOutputPath: %#v", notice)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) != 60<<10 {
		t.Fatalf("spilled file size = %d", len(data))
	}
	if preview, _ := notice["preview"].(string); len(preview) != mcpToolPreviewBytes {
		t.Fatalf("preview size = %d", len(preview))
	}
	if notice["hint"] == "" {
		t.Fatalf("notice missing hint: %#v", notice)
	}
}

func TestHandleMCPTruncatesOversizedSkillBody(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "big.app")
	if err := os.MkdirAll(filepath.Join(appDir, "skills", "big-skill"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"big.app","name":"Big","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	body := "big skill body. " + strings.Repeat("payload ", 8<<10)
	writeTestFile(t, filepath.Join(appDir, "skills", "big-skill", "SKILL.md"), body)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	bridge := NewAgentBridge(store)
	session, _, err := bridge.CreateSession(SessionContext{})
	if err != nil {
		t.Fatal(err)
	}
	request := mcpRequest{Method: "tools/call", Params: json.RawMessage(`{"name":"recut.skills.read","arguments":{"appId":"big.app","skillId":"big-skill"}}`)}
	result, err := handleMCP(bridge, nil, nil, session, request)
	if err != nil {
		t.Fatal(err)
	}
	envelope, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("result = %#v", result)
	}
	text := envelope["content"].([]map[string]string)[0]["text"]
	notice := map[string]any{}
	if err := json.Unmarshal([]byte(text), &notice); err != nil {
		t.Fatalf("expected truncation notice, got: %.200s", text)
	}
	if notice["truncated"] != true {
		t.Fatalf("notice = %#v", notice)
	}
	path, _ := notice["fullOutputPath"].(string)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var full map[string]any
	if err := json.Unmarshal(data, &full); err != nil {
		t.Fatalf("spilled payload is not the original envelope: %v", err)
	}
	// The spill is the untouched original text payload; the skill body must
	// survive byte-for-byte so the Agent can read it from the file.
	if full["body"] != body {
		t.Fatalf("spilled skill body lost content")
	}
}

func TestCLIScanErrorWrapsTokenTooLong(t *testing.T) {
	err := cliScanError(bufio.ErrTooLong)
	if err == nil || !strings.Contains(err.Error(), "单行上限") {
		t.Fatalf("cliScanError = %v", err)
	}
	other := fmt.Errorf("other")
	if cliScanError(other) != other {
		t.Fatalf("cliScanError must pass unrelated errors through")
	}
}
