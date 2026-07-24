/*
 * [INPUT]: 依赖 Store 的 append-only 项目事件日志与 gorilla/websocket 传输能力
 * [OUTPUT]: 对外提供 ProjectEventsWS，支持订阅项目事件与发送客户端控制消息
 * [POS]: service 的实时事件总线适配器；UI 与 Agent 通过项目事件而非终端文本同步
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gorilla/websocket"
)

var wsUpgrader = websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}

func (s *Server) projectEventsWS(w http.ResponseWriter, r *http.Request) {
	connection, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer connection.Close()
	connection.SetReadDeadline(time.Now().Add(30 * time.Second))
	_, data, err := connection.ReadMessage()
	if err != nil {
		return
	}
	request := struct {
		Type      string `json:"type"`
		ProjectID string `json:"projectId"`
	}{}
	if json.Unmarshal(data, &request) != nil || request.Type != "subscribe" {
		return
	}
	if _, err := s.store.Get(request.ProjectID); err != nil {
		_ = connection.WriteJSON(map[string]any{"type": "error", "message": "project not found"})
		return
	}
	path := filepath.Join(s.store.projectDir(request.ProjectID), "state", "events.jsonl")
	var offset int64
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		file, err := os.Open(path)
		if err != nil {
			continue
		}
		_, _ = file.Seek(offset, 0)
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			var event any
			if json.Unmarshal(scanner.Bytes(), &event) == nil {
				if connection.WriteJSON(map[string]any{"type": "project.event", "projectId": request.ProjectID, "event": event}) != nil {
					_ = file.Close()
					return
				}
			}
		}
		offset, _ = file.Seek(0, 1)
		_ = file.Close()
	}
}
