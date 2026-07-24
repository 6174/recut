/*
 * [INPUT]: 依赖 Store 的 append-only 项目事件日志与 gorilla/websocket 传输能力
 * [OUTPUT]: 对外提供 ProjectEventsWS，支持订阅项目事件与发送客户端控制消息
 * [POS]: service 的实时事件总线适配器；UI 与 Agent 通过项目事件而非终端文本同步
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"net/http"
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
	var lastID int64
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		db, err := s.store.ProjectDatabase(request.ProjectID)
		if err != nil {
			continue
		}
		rows, err := db.Query("select id, payload_json from events where id > ? order by id", lastID)
		if err != nil {
			_ = db.Close()
			continue
		}
		for rows.Next() {
			var id int64
			var payload string
			if rows.Scan(&id, &payload) != nil {
				continue
			}
			var event any
			if json.Unmarshal([]byte(payload), &event) == nil {
				if connection.WriteJSON(map[string]any{"type": "project.event", "projectId": request.ProjectID, "event": event}) != nil {
					_ = rows.Close()
					_ = db.Close()
					return
				}
			}
			lastID = id
		}
		_ = rows.Close()
		_ = db.Close()
	}
}
