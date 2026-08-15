package main

import "testing"

func TestParseTranscriptSrt(t *testing.T) {
	input := "1\n00:00:00,500 --> 00:00:02,000\n你好，世界\n\n2\n00:00:02,500 --> 00:00:04,000\n{\\an8}第二句字幕\n"
	segments := parseTranscriptSrt(input)
	if len(segments) != 2 {
		t.Fatalf("expected 2 segments, got %d", len(segments))
	}
	first := segments[0].(map[string]any)
	if first["start"] != 0.5 || first["end"] != 2.0 {
		t.Fatalf("unexpected first segment timing: %#v", first)
	}
	if first["text"] != "你好，世界" {
		t.Fatalf("unexpected first segment text: %v", first["text"])
	}
	second := segments[1].(map[string]any)
	if second["text"] != "第二句字幕" {
		t.Fatalf("ASS inline tag was not stripped: %v", second["text"])
	}
}
