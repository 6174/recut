/*
 * [INPUT]: 依赖 WorldStore 的写路径（worlds_mcp.go / worlds_canvas_doc.go 等）与标准库
 * [OUTPUT]: 对外提供 WorldEventPublisher 契约与 WorldStore 的写事件出口：把 AI/Agent 经 MCP 完成的
 *           World 变更汇聚成一条粗粒度 world.changed 通知（携带 worldId/contextId/tool），
 *           由 daemon 组合根接到实时 EventBus 的 "world" channel
 * [POS]: service 的 World 写事件层；补齐「headless MCP 写后已打开画布无反馈」的实时缺口，
 *        只做通知不做状态复制（客户端据此走既有 REST 重新拉取）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import "encoding/json"

// WorldEventPublisher 把一个已完成的 World 变更交给宿主实时层。worldID 作为
// 订阅 key（"" 表示广播所有世界）；data 至少包含 event/worldId/key。
type WorldEventPublisher func(worldID string, data map[string]any)

// SetEventPublisher 注入写事件出口；组合根在创建 WorldStore 后调用一次。
func (w *WorldStore) SetEventPublisher(publish WorldEventPublisher) {
	if w == nil {
		return
	}
	w.publish = publish
}

// worldMutatingTools 是经 MCP 能改变 World 内容/画布的工具集合。读工具不在其中。
var worldMutatingTools = map[string]bool{
	"recut.worlds.create":                true,
	"recut.worlds.update":                true,
	"recut.worlds.entities.upsert":       true,
	"recut.worlds.entities.create_child": true,
	"recut.worlds.entities.promote":      true,
	"recut.worlds.entityTypes.upsert":    true,
	"recut.worlds.relations.create":      true,
	"recut.worlds.relations.update":      true,
	"recut.worlds.canvas.doc.update":     true,
	"recut.worlds.canvas.promote":        true,
}

// publishWorldChanged 在 MCP 写成功后发出一条世界变更通知。worldId 缺失（如新建
// 世界）或未注入出口时静默跳过；通知是"去重拉取"提示，不是状态通道。
func (w *WorldStore) publishWorldChanged(tool string, input map[string]any) {
	if w == nil || w.publish == nil {
		return
	}
	worldID := stringValue(input["worldId"])
	if worldID == "" {
		return
	}
	data := map[string]any{
		"event":   "world.changed",
		"worldId": worldID,
		"key":     worldID,
		"tool":    tool,
		"source":  "mcp",
	}
	if contextID := stringValue(input["contextId"]); contextID != "" {
		data["contextId"] = contextID
	}
	w.publish(worldID, data)
}

// publishCanvasLock 广播 AI 画布锁的建立/释放。前台据此暂停或恢复本地保存，
// 是 advisory 提示而非服务端强校验。
func (w *WorldStore) publishCanvasLock(worldID string, locked bool, owner string) {
	if w == nil || w.publish == nil || worldID == "" {
		return
	}
	event := "world.canvas.unlock"
	if locked {
		event = "world.canvas.lock"
	}
	w.publish(worldID, map[string]any{
		"event": event, "worldId": worldID, "key": worldID, "locked": locked, "owner": owner,
	})
}

// publishWorldEvent 是 Server 侧的 WorldEventPublisher：把通知包成实时帧投递到
// "world" channel，按 worldId 作 key 路由到订阅了该世界的客户端。
func (s *Server) publishWorldEvent(worldID string, data map[string]any) {
	if s == nil || s.bus == nil || worldID == "" {
		return
	}
	frame, err := json.Marshal(map[string]any{"type": "event", "channel": "world", "data": data})
	if err != nil {
		return
	}
	s.bus.Publish("world", worldID, frame)
}
