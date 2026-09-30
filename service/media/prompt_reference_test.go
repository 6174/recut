/*
 * [INPUT]: 依赖标准库 testing 与被测的 ResolvePromptReferences
 * [OUTPUT]: 覆盖提交串改写契约：按 kind 分组编号（图/视频/音频）、文件名优先取标签声明的 label/name、
 *   未绑定 id fail closed、无标签与无 id 的提示词原样透传；以及创建/更新期门禁 ValidatePromptReferences
 *   一次报出全部未绑定 id（ValidationError.unbound_prompt_reference）
 * [POS]: media 包提交串边界的门禁测试（generation-reference-protocol RFC §5）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"errors"
	"strings"
	"testing"
)

func TestResolvePromptReferencesNumbersPerKindInAttachmentOrder(t *testing.T) {
	refs := []MediaReference{
		{Kind: "image", Source: "asset", Value: "img_1"},
		{Kind: "image", Source: "asset", Value: "img_2"},
		{Kind: "video", Source: "asset", Value: "clip_1"},
		{Kind: "audio", Source: "asset", Value: "voice_1"},
	}
	prompt := "参考锚定表\n" +
		`<reference id="img_2" kind="image" role="character" label="阿蛋人像" /> 作为人物锚定` + "\n" +
		`<media type="image" assetid="img_1" name="镜1关键帧" />` + "\n" +
		`<reference id="clip_1" kind="video" role="motion-ref" label="参考片" /> 作为运动参考` + "\n" +
		`<reference id="voice_1" kind="audio" role="voice" label="阿蛋音色" /> 仅用于音色` + "\n" +
		"音轨"
	resolved, err := ResolvePromptReferences(prompt, refs, nil)
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	want := "参考锚定表\n" +
		"参考图2「阿蛋人像」 作为人物锚定\n" +
		"参考图1「镜1关键帧」\n" +
		"参考视频1「参考片」 作为运动参考\n" +
		"音频1「阿蛋音色」 仅用于音色\n" +
		"音轨"
	if resolved != want {
		t.Fatalf("resolved prompt mismatch:\n got %q\nwant %q", resolved, want)
	}
	// 模型串里不得残留任何身份 id 或标签语法。
	for _, leaked := range []string{"img_1", "img_2", "clip_1", "voice_1", "<reference", "<media", "assetid"} {
		if strings.Contains(resolved, leaked) {
			t.Fatalf("resolved prompt still leaks %q: %q", leaked, resolved)
		}
	}
}

func TestResolvePromptReferencesFallsBackToReferenceName(t *testing.T) {
	refs := []MediaReference{{Kind: "image", Source: "asset", Value: "img_1"}}
	names := map[string]string{"img_1": "镜1关键帧"}
	nameOf := func(value string) string { return names[value] }

	resolved, err := ResolvePromptReferences(`<reference id="img_1" kind="image" role="storyboard" />`, refs, nameOf)
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if resolved != "参考图1「镜1关键帧」" {
		t.Fatalf("unexpected alias: %q", resolved)
	}
	// 无名称可回退时只输出编号。
	resolved, err = ResolvePromptReferences(`<reference id="img_1" kind="image" role="storyboard" />`, refs, nil)
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if resolved != "参考图1" {
		t.Fatalf("unexpected alias: %q", resolved)
	}
}

func TestResolvePromptReferencesFailsClosedOnUnboundID(t *testing.T) {
	refs := []MediaReference{{Kind: "image", Source: "asset", Value: "img_1"}}
	_, err := ResolvePromptReferences(`<reference id="ghost" kind="image" role="pov" label="幻觉" />`, refs, nil)
	var invalid *ValidationError
	if !errors.As(err, &invalid) || invalid.Code != "unbound_prompt_reference" {
		t.Fatalf("err = %v; want unbound_prompt_reference ValidationError", err)
	}
	// 没有任何参考时，正文里的标签同样视为未绑定。
	if _, err := ResolvePromptReferences(`<media type="image" assetid="img_1" name="图" />`, nil, nil); err == nil {
		t.Fatal("expected an error when no references are attached")
	}
}

func TestResolvePromptReferencesPassesThroughUntouched(t *testing.T) {
	refs := []MediaReference{{Kind: "image", Source: "asset", Value: "img_1"}}
	for _, prompt := range []string{
		"纯文本提示词，无任何标签。",
		"历史写法 {{Mixed 1}} 不解析，仅作为普通文本透传。",
		// 无 id 的标签没有可绑定身份，保持作者原文。
		`<reference kind="image" role="pov" label="残缺" />`,
	} {
		resolved, err := ResolvePromptReferences(prompt, refs, nil)
		if err != nil {
			t.Fatalf("resolve failed for %q: %v", prompt, err)
		}
		if resolved != prompt {
			t.Fatalf("prompt changed unexpectedly:\n got %q\nwant %q", resolved, prompt)
		}
	}
}

// ValidatePromptReferences is the creation/update-time gate: it must report
// every unbound id (not just the first, unlike the submit rewrite) so a caller
// can fix its prompt in one pass.
func TestValidatePromptReferencesReportsEveryUnboundID(t *testing.T) {
	refs := []MediaReference{{Kind: "image", Source: "asset", Value: "img_1"}}
	prompt := `<reference id="ghost_a" kind="image" role="pov" /> 与 ` +
		`<reference id="ghost_b" kind="image" role="color-card" />，再次 ` +
		`<media assetid="ghost_a" />，并绑定 <media assetid="img_1" />`
	ids := UnboundPromptReferenceIDs(prompt, refs)
	if len(ids) != 2 || ids[0] != "ghost_a" || ids[1] != "ghost_b" {
		t.Fatalf("unbound ids = %v; want [ghost_a ghost_b]", ids)
	}
	err := ValidatePromptReferences(prompt, refs)
	var invalid *ValidationError
	if !errors.As(err, &invalid) {
		t.Fatalf("err = %v; want *ValidationError", err)
	}
	if invalid.Code != "unbound_prompt_reference" {
		t.Fatalf("code = %q", invalid.Code)
	}
	reported, ok := invalid.Data["unboundReferenceIds"].([]string)
	if !ok || len(reported) != 2 || reported[0] != "ghost_a" || reported[1] != "ghost_b" {
		t.Fatalf("data = %#v", invalid.Data)
	}
	// 全部绑定后放行。
	bound := append(refs,
		MediaReference{Kind: "image", Source: "asset", Value: "ghost_a"},
		MediaReference{Kind: "image", Source: "asset", Value: "ghost_b"},
	)
	if err := ValidatePromptReferences(prompt, bound); err != nil {
		t.Fatalf("fully bound prompt must pass: %v", err)
	}
	// 无标签/无 id 的提示词不产生未绑定项。
	for _, plain := range []string{"纯文本", `<reference kind="image" label="残缺" />`} {
		if ids := UnboundPromptReferenceIDs(plain, refs); len(ids) != 0 {
			t.Fatalf("prompt %q reported unbound ids %v", plain, ids)
		}
	}
}

func TestResolvePromptReferencesKeepsFirstNumberForRepeatedReference(t *testing.T) {
	refs := []MediaReference{
		{Kind: "image", Source: "asset", Value: "img_1"},
		{Kind: "image", Source: "asset", Value: "img_2"},
	}
	prompt := `<reference id="img_2" label="二" /> 与 <reference id="img_2" label="二" />`
	resolved, err := ResolvePromptReferences(prompt, refs, nil)
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if resolved != "参考图2「二」 与 参考图2「二」" {
		t.Fatalf("unexpected alias: %q", resolved)
	}
}
