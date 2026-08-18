/*
 * [INPUT]: 依赖 AgentBridge 的 subagent 注册表与 job 生命周期、AgentManager 的子会话持久化/事件账本、
 *          subagent 实时流 hub 与统一 job REST
 * [OUTPUT]: 锁定子 Agent 会话同构契约：注册表 1:1 消费、子会话落账本且不出现在普通会话列表、
 *           job 生命周期（三阶段 + 终态）写入审计账本与实时流、终态同步子会话状态、subagentId 注入字段、
 *           GET/POST /v1/jobs/{id} 与 /v1/jobs/{id}/cancel
 * [POS]: service 子 Agent 任务卡片/全局预览的回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newSubagentTestStore(t *testing.T) *Store {
	t.Helper()
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	if err := os.MkdirAll(appsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	apps, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	return store
}

func newSubagentTestBridge(t *testing.T) (*AgentBridge, *AgentManager, *Store) {
	t.Helper()
	store := newSubagentTestStore(t)
	bridge := NewAgentBridge(store)
	agents := NewAgentManager(store, bridge, NewMediaService(store))
	bridge.SetAgentManager(agents)
	return bridge, agents, store
}

func TestSubagentToolCallRegistryConsumeOnce(t *testing.T) {
	bridge, _, _ := newSubagentTestBridge(t)
	fields, ok := bridge.consumeSubagentToolCall("session-a")
	if ok || fields.SubagentID != "" {
		t.Fatalf("consume with no registration = %+v, %v; want empty", fields, ok)
	}
	bridge.registerSubagentToolCall("session-a", "job-1", "recut.editor", "component.create")
	fields, ok = bridge.consumeSubagentToolCall("session-a")
	if !ok || fields.SubagentID != "job-1" || fields.AppID != "recut.editor" || fields.Operation != "component.create" {
		t.Fatalf("consume after register = %+v, %v", fields, ok)
	}
	if _, ok := bridge.consumeSubagentToolCall("session-a"); ok {
		t.Fatal("second consume must be empty (1:1)")
	}
	bridge.registerSubagentToolCall("session-b", "job-2", "recut.editor", "component.revise")
	bridge.clearSubagentToolCall("session-b")
	if _, ok := bridge.consumeSubagentToolCall("session-b"); ok {
		t.Fatal("cleared registration must not be consumed")
	}
}

func TestCreateChildSessionPersistedAndHiddenFromList(t *testing.T) {
	bridge, agents, _ := newSubagentTestBridge(t)
	parent, err := agents.Create("codex", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	child, err := agents.CreateChildSession(parent.ID, "job-1", "codex", "gpt-5.6-terra", "high", "", "子 Agent · component.create", []string{"recut.editor.component.commit"})
	if err != nil {
		t.Fatal(err)
	}
	detail, err := agents.Detail(child.ID)
	if err != nil {
		t.Fatalf("child Detail = %v", err)
	}
	if detail.Status != "running" || detail.Runtime != "codex" {
		t.Fatalf("child detail status/runtime = %s/%s", detail.Status, detail.Runtime)
	}
	sessions, err := agents.List("", "general")
	if err != nil {
		t.Fatal(err)
	}
	for _, session := range sessions {
		if session.ID == child.ID {
			t.Fatal("child session must not appear in the normal session list")
		}
	}
	if _, err := agents.SessionByJob("job-1"); err != nil {
		t.Fatalf("SessionByJob = %v", err)
	}
	agents.UpdateChildSessionStatus(child.ID, "completed")
	if detail, _ := agents.Detail(child.ID); detail.Status != "completed" {
		t.Fatalf("child status after sync = %s", detail.Status)
	}
	// bridge 后向引用已注入（SetAgentManager）
	if bridge.agents == nil || bridge.agents != agents {
		t.Fatal("bridge.agents must be wired")
	}
}

func TestAgentJobLifecycleEventsWriteLedgerAndStream(t *testing.T) {
	bridge, agents, _ := newSubagentTestBridge(t)
	var childID string
	run := func(ctx context.Context, jobID string) (any, error) {
		child, err := agents.CreateChildSession("parent", jobID, "codex", "gpt-5.6-terra", "high", "", "子 Agent · component.create", []string{"recut.editor.component.commit"})
		if err != nil {
			return nil, err
		}
		childID = child.ID
		bridge.setAgentJobChild(jobID, childID)
		bridge.setAgentJobPhase(jobID, "authorizing")
		time.Sleep(10 * time.Millisecond)
		bridge.setAgentJobPhase(jobID, "finalizing")
		return map[string]any{"components": []map[string]any{{"componentId": "c1"}}}, nil
	}
	job, err := bridge.startAgentJob(Target{}, run)
	if err != nil {
		t.Fatal(err)
	}
	_, output, unsubscribe := bridge.SubscribeSubagentStream(job.ID)
	defer unsubscribe()
	select {
	case event := <-output:
		// 中间 job.updated（child 关联/阶段）之后才是终态；循环读至 job.completed。
		for event.Event != "job.completed" {
			select {
			case next := <-output:
				event = next
			case <-time.After(5 * time.Second):
				t.Fatalf("timed out waiting for terminal event, last = %s", event.Event)
			}
		}
		if event.Job["status"] != "completed" || event.Job["childSessionId"] != childID {
			t.Fatalf("terminal view = %v", event.Job)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for terminal event")
	}
	// 终态后再订阅：历史回放应包含全部生命周期事件（含最早的 running/authoring）。
	replayed, _, _ := bridge.SubscribeSubagentStream(job.ID)
	if len(replayed) < 4 {
		t.Fatalf("replayed history must contain lifecycle events, got %d: %+v", len(replayed), replayed)
	}
	var sawTerminal bool
	for _, entry := range replayed {
		if entry.Event == "job.completed" {
			sawTerminal = true
		}
	}
	if !sawTerminal {
		t.Fatal("replayed history must include the terminal job.completed")
	}
	view, ok := bridge.agentJobView(job.ID)
	if !ok || view["phase"] != "complete" || view["operation"] != "" {
		t.Fatalf("job view = %v, %v", view, ok)
	}
	if view, ok := bridge.agentJobView("missing"); ok {
		t.Fatalf("missing job view = %v", view)
	}
	// 审计账本：子会话应含 subagent.job 事件，且终态已同步到子会话行。
	events, err := agents.Events(childID, 0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, event := range events {
		if event.Type == "subagent.job" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("child ledger must contain subagent.job audit events")
	}
	if detail, _ := agents.Detail(childID); detail.Status != "completed" {
		t.Fatalf("child status after job completion = %s", detail.Status)
	}
}

func TestSubagentJobRESTGetAndCancel(t *testing.T) {
	store := newSubagentTestStore(t)
	apps, err := LoadCatalog(store.catalog.dir)
	if err != nil {
		t.Fatal(err)
	}
	bridge := NewAgentBridge(store)
	agents := NewAgentManager(store, bridge, NewMediaService(store))
	bridge.SetAgentManager(agents)
	server := NewServer(apps, store, nil, bridge, agents, NewAppHost(apps, store), NewMediaService(store))
	httpServer := httptest.NewServer(server.routes())
	defer httpServer.Close()

	run := func(ctx context.Context, jobID string) (any, error) {
		time.Sleep(2 * time.Second)
		return map[string]any{"ok": true}, nil
	}
	job, err := bridge.startAgentJob(Target{}, run)
	if err != nil {
		t.Fatal(err)
	}
	view, err := getSubagentJobView(httpServer.URL, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if view["id"] != job.ID || view["status"] != "running" {
		t.Fatalf("GET /v1/jobs view = %v", view)
	}
	resp, body, err := postSubagentJobCancel(httpServer.URL, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("cancel status = %d: %s", resp.StatusCode, body)
	}
	if strings.Contains(string(body), `"cancelled":false`) {
		t.Fatalf("cancel body = %s", body)
	}
	resp, body, _ = postSubagentJobCancel(httpServer.URL, "missing-job")
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("cancel missing status = %d: %s", resp.StatusCode, body)
	}
}

func getSubagentJobView(base, jobID string) (map[string]any, error) {
	resp, err := http.Get(base + "/v1/jobs/" + jobID)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var view map[string]any
	if err := json.Unmarshal(body, &view); err != nil {
		return nil, err
	}
	return view, nil
}

func postSubagentJobCancel(base, jobID string) (*http.Response, []byte, error) {
	resp, err := http.Post(base+"/v1/jobs/"+jobID+"/cancel", "application/json", nil)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	return resp, body, err
}

func TestSubagentToolFieldsInjection(t *testing.T) {
	bridge, agents, _ := newSubagentTestBridge(t)
	// 未注册：空字段
	if fields := agents.subagentToolFields("session-x"); len(fields) != 0 {
		t.Fatalf("fields without registration = %v", fields)
	}
	bridge.registerSubagentToolCall("session-x", "job-9", "recut.editor", "component.create")
	fields := agents.subagentToolFields("session-x")
	if fields["subagentId"] != "job-9" || fields["subagentAppId"] != "recut.editor" || fields["subagentOperation"] != "component.create" {
		t.Fatalf("injected fields = %v", fields)
	}
	// 1:1 消费后为空
	if fields := agents.subagentToolFields("session-x"); len(fields) != 0 {
		t.Fatalf("fields after consume = %v", fields)
	}
}

// 主 Agent 的 MCP 工具调用以 bridge session 鉴权（注册在 bridge ID 下），而事件流用 chat session ID；
// subagentToolFields 必须经 chat->bridge 映射消费到。
func TestSubagentToolFieldsResolvesBridgeSessionMapping(t *testing.T) {
	bridge, agents, _ := newSubagentTestBridge(t)
	agents.recordBridgeSession("chat-1", "bridge-1")
	bridge.registerSubagentToolCall("bridge-1", "job-10", "recut.editor", "component.revise")
	fields := agents.subagentToolFields("chat-1")
	if fields["subagentId"] != "job-10" || fields["subagentAppId"] != "recut.editor" || fields["subagentOperation"] != "component.revise" {
		t.Fatalf("fields via bridge mapping = %v", fields)
	}
	// 无映射且无注册：空
	if fields := agents.subagentToolFields("chat-2"); len(fields) != 0 {
		t.Fatalf("fields without mapping = %v", fields)
	}
}
