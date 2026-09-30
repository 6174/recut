/*
 * [INPUT]: 依赖标准库 testing 与被测的 ResolvePromptReferences
 * [OUTPUT]: 覆盖提交串改写契约：按 kind 分组编号（图/视频/音频）、文件名优先取标签声明的 label/name、
 *   未绑定 id fail closed、无标签与无 id 的提示词原样透传
 * [POS]: media 包提交串边界的门禁测试（generation-reference-protocol RFC §5）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
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
	if _, err := ResolvePromptReferences(`<reference id="ghost" kind="image" role="pov" label="幻觉" />`, refs, nil); err == nil {
		t.Fatal("expected an error for an unbound reference id")
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
