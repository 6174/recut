/*
 * [INPUT]: 依赖 EventBus、Store 的项目事件账本、AgentManager 事件/CLI、TerminalManager、gorilla/websocket 传输能力与进程内 changeHub
 * [OUTPUT]: 对外提供单条全局实时 WS（/v1/events）：channels 订阅（project/media/app/agent/cli/terminal/subagent）、心跳保活、项目与 agent 事件轮询兜底、cli/terminal 事件驱动转发；subagent channel 经 AgentBridge 的 job 生命周期流转发（前端子 Agent 任务卡片/全局预览）；兼容旧 {type:"subscribe",projectId} 单项目协议
 * [POS]: service 的实时事件总线适配器；UI 与 iframe App 通过统一 channel 而非各自 SSE 同步
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var wsUpgrader = websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}

type channelFrame struct {
	Channel   string `json:"channel"`
	Key       string `json:"key,omitempty"`
	ProjectID string `json:"projectId,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	After     int64  `json:"after,omitempty"`
}

type wsSubscribeMessage struct {
	Type      string         `json:"type"`
	Channels  []channelFrame `json:"channels,omitempty"`
	ProjectID string         `json:"projectId,omitempty"` // 旧协议兼容
}

type streamHandle struct {
	stop chan struct{}
}

// realtimeSubscriptions tracks a single connection's channel subscriptions:
// cursor-based channels (project/agent) hold the last delivered event id, while
// event-driven channels (cli/terminal) hold a stop handle per active stream.
type realtimeSubscriptions struct {
	pollMu  sync.RWMutex
	pollSubs map[string]map[string]int64
	streamMu sync.Mutex
	streams  map[string]*streamHandle
}

func newRealtimeSubscriptions() *realtimeSubscriptions {
	return &realtimeSubscriptions{
		pollSubs: map[string]map[string]int64{
			"project": {},
			"agent":   {},
		},
		streams: map[string]*streamHandle{},
	}
}

func (r *realtimeSubscriptions) advanceCursor(channel, key string, last int64) {
	r.pollMu.Lock()
	defer r.pollMu.Unlock()
	if r.pollSubs[channel][key] < last {
		r.pollSubs[channel][key] = last
	}
}

func (r *realtimeSubscriptions) cursorSnapshot() map[string]map[string]int64 {
	r.pollMu.RLock()
	defer r.pollMu.RUnlock()
	snapshot := make(map[string]map[string]int64, len(r.pollSubs))
	for channel, subs := range r.pollSubs {
		cp := make(map[string]int64, len(subs))
		for id, last := range subs {
			cp[id] = last
		}
		snapshot[channel] = cp
	}
	return snapshot
}

func (r *realtimeSubscriptions) addCursor(channel, key string, after int64) {
	r.pollMu.Lock()
	defer r.pollMu.Unlock()
	if r.pollSubs[channel] == nil {
		r.pollSubs[channel] = map[string]int64{}
	}
	r.pollSubs[channel][key] = after
}

func (r *realtimeSubscriptions) removeCursor(channel, key string) {
	r.pollMu.Lock()
	defer r.pollMu.Unlock()
	delete(r.pollSubs[channel], key)
}

func (r *realtimeSubscriptions) startStream(key string) (*streamHandle, bool) {
	r.streamMu.Lock()
	defer r.streamMu.Unlock()
	if r.streams[key] != nil {
		return r.streams[key], false
	}
	handle := &streamHandle{stop: make(chan struct{})}
	r.streams[key] = handle
	return handle, true
}

func (r *realtimeSubscriptions) stopStream(key string) {
	r.streamMu.Lock()
	defer r.streamMu.Unlock()
	if handle := r.streams[key]; handle != nil {
		close(handle.stop)
		delete(r.streams, key)
	}
}

// realtimeWS serves the single global realtime channel. Clients open one
// connection, subscribe to the channels they care about, and receive a unified
// event frame per push. The legacy project-only protocol
// ({type:"subscribe",projectId}) is still accepted and maps to project:key.
func (s *Server) realtimeWS(w http.ResponseWriter, r *http.Request) {
	connection, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	client := newWSClient()
	s.bus.Register(client)
	defer func() {
		s.bus.Unregister(client)
		connection.Close()
	}()

	var doneOnce sync.Once
	done := make(chan struct{})
	closeDone := func() { doneOnce.Do(func() { close(done) }) }
	defer closeDone()

	// Writer goroutine owns all connection writes.
	go func() {
		defer closeDone()
		for {
			select {
			case <-done:
				return
			case frame := <-client.send:
				_ = connection.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := connection.WriteMessage(websocket.TextMessage, frame); err != nil {
					return
				}
			}
		}
	}()

	subs := newRealtimeSubscriptions()

	// Poller: project/agent events. In-process writes wake via changeHubs; a 1s
	// ticker catches durable writes from short-lived MCP processes.
	go func() {
		ticker := time.NewTicker(changeHubPollInterval)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-s.store.projectEvents.wait():
			case <-s.store.agentEvents.wait():
			case <-ticker.C:
			}
			cursors := subs.cursorSnapshot()
			for id, last := range cursors["project"] {
				events, err := s.store.ListProjectEvents(id, last)
				if err != nil {
					continue
				}
				for _, event := range events {
					var payload any
					if json.Unmarshal([]byte(event.Payload), &payload) == nil {
						frame, _ := json.Marshal(map[string]any{
							"type":      "project.event",
							"projectId": id,
							"event":     payload,
						})
						if !enqueueFrame(client, done, frame) {
							return
						}
					}
					last = event.ID
				}
				subs.advanceCursor("project", id, last)
			}
			if s.agents != nil {
				for id, last := range cursors["agent"] {
					events, err := s.agents.Events(id, last)
					if err != nil {
						continue
					}
					for _, event := range events {
						frame, _ := json.Marshal(map[string]any{
							"type":      "event",
							"channel":   "agent",
							"sessionId": id,
							"data":      event,
						})
						if !enqueueFrame(client, done, frame) {
							return
						}
						last = event.ID
					}
					subs.advanceCursor("agent", id, last)
				}
			}
		}
	}()

	// Heartbeat: protocol-level ping keeps the browser ponging so the read
	// deadline below can detect a dead peer; an app-level ping lets the client
	// JS watchdog confirm liveness and reconnect on a half-open connection.
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				frame, _ := json.Marshal(map[string]any{"type": "ping", "t": time.Now().Unix()})
				if !enqueueFrame(client, done, frame) {
					return
				}
				_ = connection.WriteControl(websocket.PingMessage, nil, time.Now().Add(10*time.Second))
			}
		}
	}()

	connection.SetReadLimit(1 << 20)
	_ = connection.SetReadDeadline(time.Now().Add(90 * time.Second))
	connection.SetPongHandler(func(string) error {
		return connection.SetReadDeadline(time.Now().Add(90 * time.Second))
	})

	for {
		_, data, err := connection.ReadMessage()
		if err != nil {
			return
		}
		var msg wsSubscribeMessage
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		switch msg.Type {
		case "ping":
			pong, _ := json.Marshal(map[string]any{"type": "pong", "t": time.Now().Unix()})
			if !enqueueFrame(client, done, pong) {
				return
			}
		case "subscribe", "unsubscribe":
			channels := msg.Channels
			if len(channels) == 0 && msg.ProjectID != "" { // 旧协议
				channels = []channelFrame{{Channel: "project", ProjectID: msg.ProjectID}}
			}
			for _, ch := range channels {
				key := ch.Key
				if key == "" && ch.ProjectID != "" {
					key = ch.ProjectID
				}
				if key == "" && ch.SessionID != "" {
					key = ch.SessionID
				}
				if msg.Type == "subscribe" {
					if !s.applySubscribe(client, ch.Channel, key, ch.After, subs, done) {
						return
					}
				} else {
					s.applyUnsubscribe(client, ch.Channel, key, subs)
				}
			}
			names := make([]string, 0, len(channels))
			for _, ch := range channels {
				names = append(names, ch.Channel)
			}
			ack, _ := json.Marshal(map[string]any{"type": "subscribed", "channels": names})
			if !enqueueFrame(client, done, ack) {
				return
			}
		}
	}
}

func enqueueFrame(client *wsClient, done <-chan struct{}, frame []byte) bool {
	select {
	case client.send <- frame:
		return true
	case <-done:
		return false
	}
}

// applySubscribe validates and registers a channel subscription, starting any
// event-driven cli/terminal stream forwarder.
func (s *Server) applySubscribe(
	client *wsClient,
	channel, key string,
	after int64,
	subs *realtimeSubscriptions,
	done <-chan struct{},
) bool {
	if channel == "project" && key != "" {
		if _, err := s.store.Get(key); err != nil {
			return true // 项目不存在则忽略订阅
		}
	}
	if channel == "project" || channel == "agent" {
		s.bus.Subscribe(client, channel, key)
		subs.addCursor(channel, key, after)
		return true
	}
	if channel == "cli" || channel == "terminal" {
		if key == "" {
			return true
		}
		s.bus.Subscribe(client, channel, key)
		streamKey := channel + ":" + key
		handle, isNew := subs.startStream(streamKey)
		if !isNew {
			return true
		}
		if channel == "cli" && s.agents != nil {
			go s.runCLIForwarder(client, done, key, handle)
		} else if channel == "terminal" && s.terminals != nil {
			go s.runTerminalForwarder(client, done, key, handle)
		}
		return true
	}
	if channel == "subagent" {
		if key == "" || s.bridge == nil {
			return true
		}
		s.bus.Subscribe(client, channel, key)
		streamKey := channel + ":" + key
		handle, isNew := subs.startStream(streamKey)
		if isNew {
			go s.runSubagentForwarder(client, done, key, handle)
		}
		return true
	}
	// media / app 等全局 channel
	s.bus.Subscribe(client, channel, key)
	return true
}

func (s *Server) applyUnsubscribe(
	client *wsClient,
	channel, key string,
	subs *realtimeSubscriptions,
) {
	s.bus.Unsubscribe(client, channel, key)
	if channel == "project" || channel == "agent" {
		subs.removeCursor(channel, key)
		return
	}
	if channel == "cli" || channel == "terminal" {
		subs.stopStream(channel + ":" + key)
		return
	}
	if channel == "subagent" {
		// 同一连接内若仍有其它逻辑订阅同一 job（如卡片 + 弹框），保留流，避免提前截断。
		if !client.subscribesTo(channel, key) {
			subs.stopStream(channel + ":" + key)
		}
		return
	}
}

// runSubagentForwarder 订阅一个 subagent job 的生命周期流：先回放历史，再实时推送。
// job 不存在时发送 unavailable 状态，客户端据此关闭或降级展示。
func (s *Server) runSubagentForwarder(client *wsClient, done <-chan struct{}, jobID string, handle *streamHandle) {
	history, output, unsubscribe := s.bridge.SubscribeSubagentStream(jobID)
	defer unsubscribe()
	send := func(payload any) bool {
		frame, err := json.Marshal(map[string]any{
			"type":      "event",
			"channel":   "subagent",
			"jobId":     jobID,
			"sessionId": jobID,
			"data":      payload,
		})
		if err != nil {
			return true
		}
		return enqueueFrame(client, done, frame)
	}
	for _, entry := range history {
		if !send(entry) {
			return
		}
	}
	if output == nil {
		_ = send(map[string]any{"available": false})
		return
	}
	for {
		select {
		case <-done:
			return
		case <-handle.stop:
			return
		case entry, ok := <-output:
			if !ok {
				_ = send(map[string]any{"available": false})
				return
			}
			if !send(entry) {
				return
			}
		}
	}
}

// runCLIForwarder relays a session's CLI output (replaying history first) onto
// the cli channel. When no live process is attached it sends an unavailable
// status so the client can close its panel.
func (s *Server) runCLIForwarder(client *wsClient, done <-chan struct{}, sessionID string, handle *streamHandle) {
	history, output, unsubscribe := s.agents.SubscribeCLIStream(sessionID)
	defer unsubscribe()
	send := func(payload any) bool {
		frame, err := json.Marshal(map[string]any{
			"type":      "event",
			"channel":   "cli",
			"sessionId": sessionID,
			"data":      payload,
		})
		if err != nil {
			return true
		}
		return enqueueFrame(client, done, frame)
	}
	for _, entry := range history {
		if !send(entry) {
			return
		}
	}
	if output == nil {
		_ = send(map[string]any{"available": false})
		return
	}
	for {
		select {
		case <-done:
			return
		case <-handle.stop:
			return
		case entry, ok := <-output:
			if !ok {
				_ = send(map[string]any{"available": false})
				return
			}
			if !send(entry) {
				return
			}
		}
	}
}

// runTerminalForwarder replays a terminal session's history and then relays
// live output onto the terminal channel.
func (s *Server) runTerminalForwarder(client *wsClient, done <-chan struct{}, sessionID string, handle *streamHandle) {
	history, output, unsubscribe, err := s.terminals.Subscribe(sessionID)
	if err != nil {
		return
	}
	defer unsubscribe()
	send := func(chunk string) bool {
		frame, err := json.Marshal(map[string]any{
			"type":      "event",
			"channel":   "terminal",
			"sessionId": sessionID,
			"data":      chunk,
		})
		if err != nil {
			return true
		}
		return enqueueFrame(client, done, frame)
	}
	if history != "" && !send(history) {
		return
	}
	for {
		select {
		case <-done:
			return
		case <-handle.stop:
			return
		case chunk, ok := <-output:
			if !ok {
				return
			}
			if !send(chunk) {
				return
			}
		}
	}
}

// projectEventsWS is kept as an alias for the generalized realtime handler so
// any code path or old route referencing the project-only adapter still works.
func (s *Server) projectEventsWS(w http.ResponseWriter, r *http.Request) {
	s.realtimeWS(w, r)
}
