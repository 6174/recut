/*
 * [INPUT]: 依赖 user_env.go 的合并与捕获逻辑
 * [OUTPUT]: 锁定 mergeEnv 覆盖语义与 captureUserShellEnv 从真实用户 shell 拿到含 PATH 的环境
 * [POS]: user_env 的单元回归；不依赖特定 shell 品牌
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"strings"
	"testing"
)

func TestMergeEnvOverlaysByKey(t *testing.T) {
	base := []string{"PATH=/usr/bin:/bin", "HOME=/tmp/recut", "KEEP=1"}
	override := []string{"PATH=/opt/homebrew/bin:/usr/bin", "NEW=2"}
	merged := mergeEnv(base, override)
	lookup := map[string]string{}
	for _, entry := range merged {
		if idx := strings.IndexByte(entry, '='); idx > 0 {
			lookup[entry[:idx]] = entry[idx+1:]
		}
	}
	if lookup["PATH"] != "/opt/homebrew/bin:/usr/bin" {
		t.Fatalf("override PATH should win: %v", lookup["PATH"])
	}
	if lookup["HOME"] != "/tmp/recut" || lookup["KEEP"] != "1" {
		t.Fatalf("base keys should persist: %#v", lookup)
	}
	if lookup["NEW"] != "2" {
		t.Fatalf("new keys should be added: %#v", lookup)
	}
}

func TestMergeEnvNilOverride(t *testing.T) {
	base := []string{"A=1"}
	merged := mergeEnv(base, nil)
	if len(merged) != 1 || merged[0] != "A=1" {
		t.Fatalf("nil override should return base: %#v", merged)
	}
}

func TestIsEnvName(t *testing.T) {
	cases := map[string]bool{
		"PATH":    true,
		"A_B9":    true,
		"":        false,
		"9BAD":    false,
		"A-B":     false,
		"FOO BAR": false,
	}
	for name, want := range cases {
		if got := isEnvName(name); got != want {
			t.Fatalf("isEnvName(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestCaptureUserShellEnvIncludesPath(t *testing.T) {
	env := captureUserShellEnv()
	if len(env) == 0 {
		t.Skip("no user login shell available to capture")
	}
	lookup := map[string]string{}
	for _, entry := range env {
		if idx := strings.IndexByte(entry, '='); idx > 0 {
			lookup[entry[:idx]] = entry[idx+1:]
		}
	}
	if lookup["PATH"] == "" {
		t.Fatalf("captured env must include PATH: %#v", env)
	}
	if lookup["HOME"] == "" {
		t.Fatalf("captured env must include HOME: %#v", env)
	}
}
