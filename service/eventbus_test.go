/*
 * [INPUT]: 依赖 EventBus、realtimeWS、Store 项目事件账本与 MediaService durable 账本
 * [OUTPUT]: 验证单 WS 通道：EventBus 订阅匹配/清理、realtimeWS 协议（subscribe/ping/pong/project.event）、media forwarder 增量扇出
 * [POS]: service 实时通道回归测试；确保每页单连接下各 channel 增量可达、断线不影响其他客户端
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestEventBusWildcardAndKeyed(t *testing.T) {
	bus := newEventBus()
	wild := newWSClient()
	keyed := newWSClient()
	other := newWSClient()
	bus.Register(wild)
	bus.Register(keyed)
	bus.Register(other)
	bus.Subscribe(wild, "media", "")
	bus.Subscribe(keyed, "project", "p1")
	bus.Subscribe(other, "project", "p2")

	bus.Publish("media", "", []byte("m"))
	bus.Publish("project", "p1", []byte("p1"))
	bus.Publish("project", "p2", []byte("p2"))
	bus.Publish("nobody", "", []byte("x"))

	got := map[*wsClient]string{}
	for _, c := range []*wsClient{wild, keyed, other} {
		select {
		case f := <-c.send:
			got[c] = string(f)
		default:
			got[c] = ""
		}
	}
	if got[wild] != "m" {
		t.Fatalf("wildcard media got %q", got[wild])
	}
	if got[keyed] != "p1" {
		t.Fatalf("keyed project p1 got %q", got[keyed])
	}
	if got[other] != "p2" {
		t.Fatalf("keyed project p2 got %q", got[other])
	}

	// 退订与断开清理不能影响其他订阅者。
	bus.Unsubscribe(keyed, "project", "p1")
	bus.Unregister(other)
	bus.Publish("project", "p1", []byte("p1b"))
	bus.Publish("project", "p2", []byte("p2b"))
	bus.Publish("media", "", []byte("m2"))
	if f := <-wild.send; string(f) != "m2" {
		t.Fatalf("wildcard media after cleanup got %q", f)
	}
	if len(keyed.send) != 0 {
		t.Fatalf("unsubscribed keyed client received %d frames", len(keyed.send))
	}
	if len(other.send) != 0 {
		t.Fatalf("unregistered client received %d frames", len(other.send))
	}
}

func testRealtimeServer(t *testing.T) (*httptest.Server, *Server) {
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
	project, err := store.Create(CreateInput{Name: "Source", AppID: "example.app"})
	if err != nil {
		t.Fatal(err)
	}
	_ = project
	media := NewMediaService(store)
	server := NewServer(apps, store, nil, nil, nil, nil, media)
	srv := httptest.NewServer(server.routes())
	t.Cleanup(srv.Close)
	return srv, server
}

func dialRealtime(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/v1/events"
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func readWSFrame(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read ws frame: %v", err)
	}
	var frame map[string]any
	if err := json.Unmarshal(data, &frame); err != nil {
		t.Fatalf("decode ws frame: %v", err)
	}
	return frame
}

func TestRealtimeWSProjectAndMediaChannels(t *testing.T) {
	srv, server := testRealtimeServer(t)
	conn := dialRealtime(t, srv)

	projects, err := server.store.List()
	if err != nil {
		t.Fatal(err)
	}
	projectID := projects[0].ID

	subscribe := map[string]any{
		"type": "subscribe",
		"channels": []map[string]any{
			{"channel": "project", "projectId": projectID},
			{"channel": "project", "projectId": "nonexistent"}, // 无效项目应被忽略
			{"channel": "media"},
		},
	}
	if err := conn.WriteJSON(subscribe); err != nil {
		t.Fatal(err)
	}
	ack := readWSFrame(t, conn)
	if ack["type"] != "subscribed" {
		t.Fatalf("subscribe ack = %#v", ack)
	}

	// project 事件：AppendEvent 落库并唤醒 projectEvents hub，WS 轮询器应送达。
	server.store.AppendEvent(projectID, map[string]any{"kind": "ping-event"})
	frame := readWSFrame(t, conn)
	if frame["type"] != "project.event" || frame["event"].(map[string]any)["kind"] != "ping-event" {
		t.Fatalf("project frame = %#v", frame)
	}

	// media 增量：直接向 bus 发布（等价于 media forwarder 输出）。
	busFrame, _ := json.Marshal(map[string]any{"type": "event", "channel": "media", "data": map[string]any{"event": "asset.updated", "id": 7}})
	server.bus.Publish("media", "", busFrame)
	frame = readWSFrame(t, conn)
	if frame["type"] != "event" || frame["channel"] != "media" {
		t.Fatalf("media frame = %#v", frame)
	}

	// 心跳：客户端 ping → 服务端 pong。
	if err := conn.WriteJSON(map[string]any{"type": "ping"}); err != nil {
		t.Fatal(err)
	}
	frame = readWSFrame(t, conn)
	if frame["type"] != "pong" {
		t.Fatalf("pong frame = %#v", frame)
	}
}

func TestRealtimeSubscriptionsLifecycle(t *testing.T) {
	subs := newRealtimeSubscriptions()
	subs.addCursor("agent", "s1", 5)
	subs.addCursor("project", "p1", 0)
	if got := subs.cursorSnapshot()["agent"]["s1"]; got != 5 {
		t.Fatalf("agent cursor = %d", got)
	}
	subs.advanceCursor("agent", "s1", 9)
	if got := subs.cursorSnapshot()["agent"]["s1"]; got != 9 {
		t.Fatalf("agent cursor after advance = %d", got)
	}
	subs.removeCursor("agent", "s1")
	if _, ok := subs.cursorSnapshot()["agent"]["s1"]; ok {
		t.Fatal("agent cursor not removed")
	}

	handle, isNew := subs.startStream("cli:s1")
	if !isNew {
		t.Fatal("expected new cli stream")
	}
	if _, again := subs.startStream("cli:s1"); again {
		t.Fatal("cli stream should be idempotent")
	}
	subs.stopStream("cli:s1")
	select {
	case <-handle.stop:
	default:
		t.Fatal("stream stop channel not closed")
	}
}

func TestMediaForwarderPublishesAssetUpdates(t *testing.T) {
	srv, server := testRealtimeServer(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server.StartRealtimeForwarders(ctx)

	conn := dialRealtime(t, srv)
	if err := conn.WriteJSON(map[string]any{"type": "subscribe", "channels": []map[string]any{{"channel": "media"}}}); err != nil {
		t.Fatal(err)
	}
	if ack := readWSFrame(t, conn); ack["type"] != "subscribed" {
		t.Fatalf("ack = %#v", ack)
	}

	if _, err := server.media.ImportImage("forwarded.png", "image/png", []byte("forwarded")); err != nil {
		t.Fatal(err)
	}

	// 等待 forwarder 推送：进程内 mediaEvents hub 应即时唤醒。
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, data, err := conn.ReadMessage()
		if err != nil {
			time.Sleep(50 * time.Millisecond)
			continue
		}
		var frame map[string]any
		if err := json.Unmarshal(data, &frame); err != nil {
			t.Fatal(err)
		}
		if frame["type"] == "event" && frame["channel"] == "media" {
			dataMap, _ := frame["data"].(map[string]any)
			asset, _ := dataMap["asset"].(map[string]any)
			if asset["name"] == "forwarded.png" {
				return
			}
		}
	}
	t.Fatal("media forwarder did not deliver asset.updated in time")
}
