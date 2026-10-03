/*
 * [INPUT]: 依赖 WorldStore 的 PatchCanvasDocument / UpdateCanvasDocumentOps（RFC 2026-10-03 字段级合并）
 * [OUTPUT]: 验证画布并发写的合并语义：不同字段互补、同字段后者胜、删除显式、版本冲突可检出
 * [POS]: service 的画布并发合并回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"errors"
	"testing"
)

// 不同写者改同一元素的不同字段时必须互补（人拖 geometry + AI 改 props），同字段则后者胜。
func TestPatchCanvasDocumentMergesFieldsByKey(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	worldID := createTestWorld(t, worlds)
	noteKind := "note"

	// 客户端先建元素：一次补丁即插入（kind 必填），显式几何保留。
	doc, err := worlds.PatchCanvasDocument(PatchCanvasDocumentInput{
		WorldID: worldID, ContextID: "",
		Elements: []CanvasElementPatch{{
			ID:       "shape:note-1",
			Kind:     &noteKind,
			Props:    map[string]any{"text": "hi"},
			Geometry: map[string]any{"x": float64(10), "y": float64(20), "width": float64(150), "height": float64(100)},
		}},
		ExpectedVersion: 0,
	})
	if err != nil {
		t.Fatalf("insert patch: %v", err)
	}

	// 写者 A 只动 geometry.x；写者 B 只动 props.text —— 两边都必须保留。
	doc, err = worlds.PatchCanvasDocument(PatchCanvasDocumentInput{
		WorldID: worldID, ContextID: "",
		Elements:        []CanvasElementPatch{{ID: "shape:note-1", Geometry: map[string]any{"x": float64(99)}}},
		ExpectedVersion: doc.Version,
	})
	if err != nil {
		t.Fatalf("geometry patch: %v", err)
	}
	doc, err = worlds.PatchCanvasDocument(PatchCanvasDocumentInput{
		WorldID: worldID, ContextID: "",
		Elements:        []CanvasElementPatch{{ID: "shape:note-1", Props: map[string]any{"text": "moved on"}}},
		ExpectedVersion: doc.Version,
	})
	if err != nil {
		t.Fatalf("props patch: %v", err)
	}
	note := canvasElementOf(t, doc.Elements, "shape:note-1")
	if x, _ := numericGeometry(note.Geometry["x"]); x != 99 {
		t.Fatalf("geometry from writer A was lost: %#v", note.Geometry)
	}
	if y, _ := numericGeometry(note.Geometry["y"]); y != 20 {
		t.Fatalf("untouched geometry key was lost: %#v", note.Geometry)
	}
	if note.Props["text"] != "moved on" {
		t.Fatalf("props from writer B was lost: %#v", note.Props)
	}

	// 同字段并发：后者胜。
	doc, err = worlds.PatchCanvasDocument(PatchCanvasDocumentInput{
		WorldID: worldID, ContextID: "",
		Elements:        []CanvasElementPatch{{ID: "shape:note-1", Props: map[string]any{"text": "second"}}},
		ExpectedVersion: doc.Version,
	})
	if err != nil {
		t.Fatalf("second props patch: %v", err)
	}
	if note = canvasElementOf(t, doc.Elements, "shape:note-1"); note.Props["text"] != "second" {
		t.Fatalf("same field must be last-writer-wins, got %#v", note.Props)
	}

	// 删除是显式的（Removed），不是「没出现即删除」。
	doc, err = worlds.PatchCanvasDocument(PatchCanvasDocumentInput{
		WorldID: worldID, ContextID: "", Removed: []string{"shape:note-1"}, ExpectedVersion: doc.Version,
	})
	if err != nil {
		t.Fatalf("remove patch: %v", err)
	}
	for _, element := range doc.Elements {
		if element.ID == "shape:note-1" {
			t.Fatal("removed element should be gone")
		}
	}

	// 过期 version 必须被检出（调用方据此重发补丁）。
	_, err = worlds.PatchCanvasDocument(PatchCanvasDocumentInput{
		WorldID: worldID, ContextID: "",
		Elements:        []CanvasElementPatch{{ID: "shape:note-1", Props: map[string]any{"text": "stale"}}},
		ExpectedVersion: 1,
	})
	var conflict *WorldsError
	if !errors.As(err, &conflict) || conflict.Code != WorldsErrCanvasConflict {
		t.Fatalf("stale version should be a canvas conflict, got %v", err)
	}
}

// AI 的 doc.update 语义不变，但 update 的 props/style 变为按 key 合并（不再整体替换）。
func TestCanvasDocUpdateMergesPropsByKey(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	worldID := createTestWorld(t, worlds)

	doc, err := worlds.UpdateCanvasDocumentOps(worldID, "", []CanvasDocOp{{
		Op:      "insert",
		Element: &UpsertCanvasElementInput{WorldID: worldID, ElementID: "shape:note-9", Kind: "note", Props: map[string]any{"a": float64(1), "b": float64(2)}},
	}})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}

	doc, err = worlds.UpdateCanvasDocumentOps(worldID, "", []CanvasDocOp{{
		Op:      "update",
		Element: &UpsertCanvasElementInput{WorldID: worldID, ElementID: "shape:note-9", Kind: "note", Props: map[string]any{"b": float64(3)}},
	}})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	note := canvasElementOf(t, doc.Elements, "shape:note-9")
	if note.Props["a"] != float64(1) {
		t.Fatalf("untouched props key was dropped by a partial update: %#v", note.Props)
	}
	if note.Props["b"] != float64(3) {
		t.Fatalf("updated props key was not applied: %#v", note.Props)
	}
}

// 整包替换路径必须拒绝缺 id/kind 的元素：否则一个字段补丁载荷误落到该路径会静默清空文档。
func TestValidateWholeCanvasElementsRejectsPatchShapedBody(t *testing.T) {
	if err := validateWholeCanvasElements([]WorldCanvasElement{{ID: "shape:n1", Kind: "note"}}); err != nil {
		t.Fatalf("full element should pass: %v", err)
	}
	if err := validateWholeCanvasElements([]WorldCanvasElement{}); err != nil {
		t.Fatalf("empty document is allowed: %v", err)
	}
	if err := validateWholeCanvasElements([]WorldCanvasElement{{ID: "shape:n1"}}); err == nil {
		t.Fatal("element without kind must be rejected")
	}
	if err := validateWholeCanvasElements([]WorldCanvasElement{{Kind: "note"}}); err == nil {
		t.Fatal("element without id must be rejected")
	}
}

func canvasElementOf(t *testing.T, elements []WorldCanvasElement, id string) WorldCanvasElement {
	t.Helper()
	for _, element := range elements {
		if element.ID == id {
			return element
		}
	}
	t.Fatalf("element %q not found", id)
	return WorldCanvasElement{}
}
