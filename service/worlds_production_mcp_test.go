/*
 * [INPUT]: 依赖 handleMCP / AgentBridge 与生产层 plan/apply/production 工具
 * [OUTPUT]: M0–M3 的端到端验收（走 MCP 面，而非直接调 Go 函数）：默认集收口 → childTypes →
 *   plan（草稿、零花费、不产 revision）→ production（树）→ apply（一次转正、产 1 revision）
 * [POS]: service 的生产层 MCP 端到端测试；证明工具接线与契约（§12 验收的一部分）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"testing"
)

func TestWorldsMCPProductionChain(t *testing.T) {
	worlds, store, _ := newTestWorldStore(t)
	bridge := NewAgentBridge(store)
	media := NewMediaService(store)
	call := func(name, args string) (any, error) {
		return handleMCP(bridge, NewAppHost(nil, store), media, AgentSession{ID: "s1"}, mcpRequest{
			Method: "tools/call",
			Params: json.RawMessage(`{"name":"` + name + `","arguments":` + args + `}`),
		})
	}
	structured := func(res any) map[string]any {
		return res.(map[string]any)["structuredContent"].(map[string]any)
	}

	created, err := call("recut.worlds.create", `{"name":"Prod Chain","type":"fiction_world"}`)
	if err != nil {
		t.Fatal(err)
	}
	world := created.(map[string]any)["structuredContent"].(WorldDetail)

	// M0：新世界默认目录 = work/character/location/prop/script（不含退役类型），且 script 带 childTypes。
	typesRes, err := call("recut.worlds.entityTypes.list", `{"worldId":"`+world.ID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	rawItems := structured(typesRes)["items"].([]WorldEntityType)
	byID := map[string]WorldEntityType{}
	for _, item := range rawItems {
		byID[item.ID] = item
	}
	for _, id := range []string{"work", "character", "location", "prop", "script"} {
		if _, ok := byID[id]; !ok {
			t.Fatalf("preset %q missing from the default directory", id)
		}
	}
	for _, id := range []string{"object", "story", "style", "rule", "reference"} {
		if _, ok := byID[id]; ok {
			t.Fatalf("retired preset %q must not be in the default directory", id)
		}
	}
	if got := byID["script"].ChildTypes; len(got) != 2 || got[0] != "scene" || got[1] != "shot" {
		t.Fatalf("script.childTypes = %#v, want [scene shot]", got)
	}
	if got := byID[EntityTypeWork].ChildTypes; len(got) != 1 || got[0] != "script" {
		t.Fatalf("work.childTypes = %#v, want [script]", got)
	}
	if len(rawItems) != 5 {
		t.Fatalf("default directory = %d types, want exactly 5 (work/character/location/prop/script)", len(rawItems))
	}

	// 建作品（work）→ 视频脚本（script）：一个作品可以有多个脚本。
	workRes, err := call("recut.worlds.entity", `{"worldId":"`+world.ID+`","op":"create","typeId":"work","name":"《深夜电台》"}`)
	if err != nil {
		t.Fatal(err)
	}
	work := workRes.(map[string]any)["structuredContent"].(WorldEntity)
	scriptRes, err := call("recut.worlds.entity", `{"worldId":"`+world.ID+`","op":"create","typeId":"script","name":"口播版 45s","parentId":"`+work.ID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	script := scriptRes.(map[string]any)["structuredContent"].(WorldEntity)

	beforePlan, err := worlds.GetWorld(world.ID)
	if err != nil {
		t.Fatal(err)
	}

	// M3：plan 在**脚本**下派生「场次 → 镜头」。
	planRes, err := call("recut.worlds.production.plan", `{"worldId":"`+world.ID+`","parentId":"`+script.ID+`","scenes":[{"name":"第 1 场","shots":[{"name":"S01-01"},{"name":"S01-02"}]}]}`)
	if err != nil {
		t.Fatal(err)
	}
	plan := planRes.(map[string]any)["structuredContent"].(ProductionPlanResult)
	if len(plan.SceneIDs) != 1 || len(plan.ShotIDs) != 2 {
		t.Fatalf("plan = %d scenes / %d shots, want 1/2", len(plan.SceneIDs), len(plan.ShotIDs))
	}
	// 树：作品 → 脚本 → 场次 → 2 镜头。
	root := plan.Production.Roots
	if len(root) != 1 || root[0].TypeID != EntityTypeWork || len(root[0].Children) != 1 {
		t.Fatalf("plan tree root = %#v, want work → script", root)
	}
	if root[0].Children[0].TypeID != EntityTypeScript || len(root[0].Children[0].Children) != 1 {
		t.Fatalf("plan tree script = %#v, want script → scene", root[0].Children)
	}
	afterPlan, err := worlds.GetWorld(world.ID)
	if err != nil {
		t.Fatal(err)
	}
	if afterPlan.CurrentRevisionID != beforePlan.CurrentRevisionID {
		t.Fatalf("plan must not produce a revision: %q -> %q", beforePlan.CurrentRevisionID, afterPlan.CurrentRevisionID)
	}

	// M1：production 读回同一棵树（作品 + 脚本 + 场次 + 2 镜头 = 5 个节点，全 planned）。
	prodRes, err := call("recut.worlds.production", `{"worldId":"`+world.ID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	production := prodRes.(map[string]any)["structuredContent"].(WorldProduction)
	if len(production.Roots) != 1 || len(production.Roots[0].Children) != 1 || len(production.Roots[0].Children[0].Children) != 1 || len(production.Roots[0].Children[0].Children[0].Children) != 2 {
		t.Fatalf("production tree = %#v", production.Roots)
	}
	if production.Counts[ProductionPlanned] != 5 {
		t.Fatalf("planned count = %d, want 5 (work + script + scene + 2 shots)", production.Counts[ProductionPlanned])
	}

	// M3：apply 一次转正（**plan 建的都是草稿**：场次 + 2 镜头 = 3；作品与脚本是既有正式实体，不在其列）。
	applyRes, err := call("recut.worlds.production.apply", `{"worldId":"`+world.ID+`","workId":"`+work.ID+`","expectedRevisionId":"`+afterPlan.CurrentRevisionID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	applied := applyRes.(map[string]any)["structuredContent"].(ProductionApplyResult)
	if applied.Confirmed != 3 {
		t.Fatalf("confirmed = %d, want 3 (scene + 2 shots)", applied.Confirmed)
	}
	final, err := worlds.GetWorld(world.ID)
	if err != nil {
		t.Fatal(err)
	}
	if final.CurrentRevisionID == afterPlan.CurrentRevisionID {
		t.Fatal("apply must produce a revision")
	}
}
