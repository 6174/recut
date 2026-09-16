/*
 * [INPUT]: 依赖 worldsMCPToolDefinitions / worldMutatingTools / iso，以及 service/skills 下的 Skill markdown
 * [OUTPUT]: World/画布 MCP 面的契约守护：工具清单精确匹配、写工具必广播 world.changed、
 *   skill 提到的 recut.worlds.* 必须是真实工具（退役工具只能在否定语境出现）、iso 时间戳按字符串即按时间排序
 * [POS]: service 的 World MCP 契约回归；防「工具改名/下线后文档或事件表漂移」这类静默腐化
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
)

// worldsReadTools 是 recut.worlds.* 的只读工具（无副作用）。
var worldsReadTools = []string{
	"recut.worlds.list", "recut.worlds.get", "recut.worlds.entities.list", "recut.worlds.entities.get",
	"recut.worlds.entityTypes.list", "recut.worlds.doc", "recut.worlds.docs",
	"recut.worlds.revisions.list", "recut.worlds.export", "recut.worlds.proposals.list",
}

// worldsSessionTools 是画布会话锁，不属于读/写语义。
var worldsSessionTools = []string{"recut.worlds.lock", "recut.worlds.unlock"}

// worldsContentWriteTools 是经画布接口写内容（产/可产 revision）的工具。
var worldsContentWriteTools = []string{
	"recut.worlds.entity", "recut.worlds.relation", "recut.worlds.entityType",
	"recut.worlds.doc.update", "recut.worlds.promote",
}

// worldsLifecycleTools 是世界级生命周期/元数据工具（不是实体内容编辑）。
var worldsLifecycleTools = []string{
	"recut.worlds.create", "recut.worlds.update", "recut.worlds.fork", "recut.worlds.delete",
	"recut.worlds.revert", "recut.worlds.import",
}

// worldsMutatingTools 是必须广播 world.changed 的工具集合（= world_events.go 的 map）。
var worldsBroadcastTools = []string{
	"recut.worlds.create", "recut.worlds.update", "recut.worlds.doc.update", "recut.worlds.promote",
	"recut.worlds.entity", "recut.worlds.relation", "recut.worlds.entityType", "recut.worlds.revert",
	"recut.worlds.import",
}

// retiredWorldsTools 是已从 MCP 面下线的工具（方案 A 收口）。
var retiredWorldsTools = []string{
	"recut.worlds.entities.upsert", "recut.worlds.entities.create_child", "recut.worlds.entities.promote",
	"recut.worlds.relations.create", "recut.worlds.relations.update", "recut.worlds.entityTypes.upsert",
	"recut.worlds.references.attach", "recut.worlds.evidence.attach", "recut.worlds.evidence.update",
	// 已从 MCP 面移除（并入 get / 仅保留 HTTP 与 App runtime）：evidence 已退役、readiness 并入
	// get.missing、resolve/bind_project 只服务运行时、relations.list 由 get/entities.get 覆盖。
	"recut.worlds.evidence.list", "recut.worlds.evidence.archive", "recut.worlds.readiness",
	"recut.worlds.resolve", "recut.worlds.relations.list", "recut.worlds.bind_project",
}

func worldsToolInventory() []string {
	return concatStrings(worldsReadTools, worldsSessionTools, worldsContentWriteTools, worldsLifecycleTools)
}

func TestWorldsMCPToolInventoryIsExact(t *testing.T) {
	defs := worldsMCPToolDefinitions(LocaleZh)
	got := map[string]bool{}
	for _, def := range defs {
		got[def["name"].(string)] = true
	}
	want := map[string]bool{}
	for _, name := range worldsToolInventory() {
		want[name] = true
		if !got[name] {
			t.Fatalf("inventory tool %q is not registered", name)
		}
	}
	for name := range got {
		if !want[name] {
			t.Fatalf("tool %q is registered but absent from the inventory test (update the inventory if intended)", name)
		}
	}
	for _, name := range retiredWorldsTools {
		if got[name] {
			t.Fatalf("retired tool %q must not be registered", name)
		}
	}
}

// 每个会改变 World 内容的 MCP 工具都必须在 worldMutatingTools 里（否则画布不刷新）。
func TestWorldsMutatingToolsCoverEveryWrite(t *testing.T) {
	want := map[string]bool{}
	for _, name := range worldsBroadcastTools {
		want[name] = true
	}
	if len(worldMutatingTools) != len(want) {
		t.Fatalf("worldMutatingTools has %d entries, want %d: %v", len(worldMutatingTools), len(want), worldMutatingTools)
	}
	for name := range want {
		if !worldMutatingTools[name] {
			t.Fatalf("write tool %q is missing from worldMutatingTools (no world.changed broadcast)", name)
		}
	}
	for name := range worldMutatingTools {
		if !want[name] {
			t.Fatalf("worldMutatingTools entry %q is not in the expected broadcast set", name)
		}
	}
}

var worldsToolMention = regexp.MustCompile(`recut\.worlds\.[a-z][a-z.]*`)
var negationWords = []string{"不存在", "已下线", "已移除", "frozen", "retired", "removed"}

// Skill 里出现的 recut.worlds.* 必须是真实工具；退役工具只允许出现在「不存在/已下线」的否定语境。
func TestWorldsSkillToolMentionsAreRealTools(t *testing.T) {
	real := map[string]bool{}
	for _, name := range worldsToolInventory() {
		real[name] = true
	}
	retired := map[string]bool{}
	for _, name := range retiredWorldsTools {
		retired[name] = true
	}
	err := filepath.WalkDir("skills", func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".md") {
			return nil
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		for _, line := range strings.Split(string(data), "\n") {
			negated := false
			for _, word := range negationWords {
				if strings.Contains(line, word) {
					negated = true
					break
				}
			}
			for _, match := range worldsToolMention.FindAllString(line, -1) {
				token := strings.TrimRight(match, ".")
				if token == "recut.worlds" || real[token] {
					continue
				}
				// 允许工具字段访问（recut.worlds.get.skillMd / .references[]）。
				fieldAccess := false
				for name := range real {
					if strings.HasPrefix(token, name+".") {
						fieldAccess = true
						break
					}
				}
				if fieldAccess {
					continue
				}
				if retired[token] && negated {
					continue
				}
				t.Errorf("%s: mentions unknown/retired Worlds tool %q (line: %s)", path, token, strings.TrimSpace(line))
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// iso 必须定宽输出，字符串序即时间序（含整秒与同秒内小数）。
func TestISOTimestampsSortChronologically(t *testing.T) {
	base := time.Date(2026, 9, 15, 21, 0, 0, 0, time.UTC)
	times := []time.Time{
		base,
		base.Add(900 * time.Millisecond),
		base.Add(time.Second), // 整秒：RFC3339Nano 会裁成 "...:01Z" 导致错序
		base.Add(time.Second + time.Nanosecond),
		base.Add(2 * time.Second),
	}
	encoded := make([]string, len(times))
	for i, tm := range times {
		encoded[i] = iso(tm)
	}
	if !sort.StringsAreSorted(encoded) {
		t.Fatalf("iso strings are not chronological: %v", encoded)
	}
	for _, value := range encoded {
		if len(value) != len(encoded[0]) {
			t.Fatalf("iso output is not fixed width: %v", encoded)
		}
	}
}

func concatStrings(groups ...[]string) []string {
	out := []string{}
	for _, group := range groups {
		out = append(out, group...)
	}
	return out
}
