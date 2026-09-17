/*
 * [INPUT]: 依赖 modernc sqlite 临时库与包内存储/提示词函数。
 * [OUTPUT]: motion_graphic 包的存储与提示词回归：#2「无版本历史、构建失败保留 last-good」、
 *           versionId 句柄、归档排除、author prompt 骨架/画布注入。
 * [POS]: 平台 MG 包的自包含测试；不依赖任何 App（apps/editor 已退役）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package motion_graphic

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := EnsureSchema(db); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestVersionIDRoundTrip(t *testing.T) {
	if got := VersionID("ai-abc", 3); got != "ai-abc@3" {
		t.Fatalf("VersionID = %q", got)
	}
	if got := IDFromVersion("ai-abc@3"); got != "ai-abc" {
		t.Fatalf("IDFromVersion = %q", got)
	}
	if got := IDFromVersion("no-version"); got != "no-version" {
		t.Fatalf("IDFromVersion(plain) = %q", got)
	}
}

// #2：单条 current code——调整原位覆盖并递增 code_version，不产生版本历史。
func TestCurrentCodeOverwriteHasNoVersionHistory(t *testing.T) {
	db := testDB(t)
	if err := InsertDraft(db, Material{ID: "mg-1", Name: "v1", Surface: "html", KeywordsJSON: "[]", InputsJSON: "[]", Mode: "local", Source: "code-v1", Bundle: "bundle-v1", BundleHash: "h1", Status: "draft", CodeVersion: 1}); err != nil {
		t.Fatal(err)
	}
	if err := SetVerified(db, "mg-1", `{"ok":true}`, ""); err != nil {
		t.Fatal(err)
	}
	// 第二次成功构建 = 覆盖 current code（不是新版本行）。
	if err := InsertDraft(db, Material{ID: "mg-1", Name: "v2", Surface: "html", KeywordsJSON: "[]", InputsJSON: "[]", Mode: "local", Source: "code-v2", Bundle: "bundle-v2", BundleHash: "h2", Status: "draft", CodeVersion: 2}); err != nil {
		t.Fatal(err)
	}
	m, ok := Read(db, "mg-1")
	if !ok {
		t.Fatal("material missing")
	}
	if m.Source != "code-v2" || m.Bundle != "bundle-v2" || m.CodeVersion != 2 {
		t.Fatalf("current code not overwritten: %#v", m)
	}
	if m.VersionID() != "mg-1@2" {
		t.Fatalf("versionId = %q", m.VersionID())
	}
	// 只有一行（无版本历史表）。
	rows, err := queryMaps(db, "select count(*) as n from mg_materials")
	if err != nil || len(rows) == 0 || int64(number(rows[0]["n"])) != 1 {
		t.Fatalf("expected exactly one material row: %#v (%v)", rows, err)
	}
}

// 构建失败只记录 last_error，绝不覆盖 last-good 的 source/bundle/status。
func TestRecordErrorPreservesLastGood(t *testing.T) {
	db := testDB(t)
	if err := InsertDraft(db, Material{ID: "mg-2", Name: "good", Surface: "react", KeywordsJSON: "[]", InputsJSON: "[]", Mode: "local", Source: "good-source", Bundle: "good-bundle", BundleHash: "h", Status: "draft", CodeVersion: 1}); err != nil {
		t.Fatal(err)
	}
	if err := SetVerified(db, "mg-2", `{"ok":true}`, ""); err != nil {
		t.Fatal(err)
	}
	if err := RecordError(db, Material{ID: "mg-2", Name: "bad", Source: "bad-source", Status: "failed", LastErrorJSON: `{"ok":false,"type":"determinism"}`}); err != nil {
		t.Fatal(err)
	}
	m, _ := Read(db, "mg-2")
	if m.Source != "good-source" || m.Bundle != "good-bundle" || m.Status != "verified" || m.CodeVersion != 1 {
		t.Fatalf("last-good clobbered by failed build: %#v", m)
	}
	if !strings.Contains(m.LastErrorJSON, "determinism") {
		t.Fatalf("last error not recorded: %q", m.LastErrorJSON)
	}
}

func TestListAllExcludesArchived(t *testing.T) {
	db := testDB(t)
	_ = InsertDraft(db, Material{ID: "mg-a", Name: "A", Surface: "html", KeywordsJSON: "[]", InputsJSON: "[]", Mode: "local", Source: "a", Status: "draft", CodeVersion: 1})
	_ = InsertDraft(db, Material{ID: "mg-b", Name: "B", Surface: "html", KeywordsJSON: "[]", InputsJSON: "[]", Mode: "local", Source: "b", Status: "draft", CodeVersion: 1})
	if err := Archive(db, "mg-b"); err != nil {
		t.Fatal(err)
	}
	list := ListAll(db)
	if len(list) != 1 || list[0].ID != "mg-a" {
		t.Fatalf("ListAll = %#v", list)
	}
	if got := ListByIDs(db, []string{"mg-b", "mg-a"}); len(got) != 2 {
		t.Fatalf("ListByIDs should include archived by explicit id: %#v", got)
	}
}

// author prompt：fullscreen 注入画布尺寸与 FULLSCREEN 说明，并携带骨架与 viewer job。
func TestCreatePromptInjectsCanvasAndSkeleton(t *testing.T) {
	items := []any{map[string]any{
		"nameHint": "Hero",
		"brief":    "全屏文字动画：主标题淡入",
		"role":     "fullscreen-text",
		"mode":     "fullscreen",
	}}
	prompt := CreatePrompt(items, map[string]any{"width": float64(1080), "height": float64(1920)}, nil)
	for _, must := range []string{"Hero", "FULLSCREEN", "1080", "1920", "Authoring contract", "getBaseSize"} {
		if !strings.Contains(prompt, must) {
			t.Fatalf("prompt missing %q:\n%s", must, prompt)
		}
	}
	if got := SkeletonSource(map[string]any{"mode": "fullscreen"}, nil); !strings.Contains(got, "getContentBounds") {
		t.Fatalf("fullscreen skeleton missing bounds: %s", got)
	}
	if got := SkeletonSource(map[string]any{"brief": "一个 chip"}, nil); got != "" {
		t.Fatalf("unexpected skeleton for plain brief: %s", got)
	}
}
