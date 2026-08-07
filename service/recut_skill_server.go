/*
 * [INPUT]: 依赖 RecutSkillManager、HTTP JSON 边界与请求体大小限制
 * [OUTPUT]: 对外提供 Recut Skill 安装状态及显式创建 Agent 软链接的 HTTP API
 * [POS]: service 的 Recut Skill 传输层；浏览器只声明目标，路径判定与不覆盖保护始终留在 daemon
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

func (s *Server) recutSkillStatus(w http.ResponseWriter, _ *http.Request) {
	if s.skill == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("Recut Skill manager is unavailable"))
		return
	}
	status, err := s.skill.Status()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) linkRecutSkill(w http.ResponseWriter, r *http.Request) {
	if s.skill == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("Recut Skill manager is unavailable"))
		return
	}
	request := recutSkillLinksRequest{}
	if err := json.NewDecoder(io.LimitReader(r.Body, 32<<10)).Decode(&request); err != nil && err != io.EOF {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read Recut Skill targets: %w", err))
		return
	}
	status, err := s.skill.Link(request.Targets)
	if err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	writeJSON(w, http.StatusOK, status)
}
