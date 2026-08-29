/*
 * [INPUT]: 依赖 RecutSkillsManager、HTTP JSON 边界与请求体大小限制
 * [OUTPUT]: 对外提供平台 Recut Skill 的安装状态与显式创建 Agent 软链接，以及按全局/App 分组列出全部 Skill 并链接任意 Skill 的 HTTP API
 * [POS]: service 的 Recut Skill 传输层；浏览器只声明目标，路径判定与不覆盖保护始终留在 daemon
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// skillLinkSummary is one skill as rendered by the settings panel: its Agent
// link targets plus the source directory the links point at.
type skillLinkSummary struct {
	ID          string             `json:"id"`
	AppID       string             `json:"appId"`
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Source      string             `json:"source"`
	Version     string             `json:"version,omitempty"`
	Targets     []RecutSkillTarget `json:"targets"`
}

// skillGroup is one App group in the settings panel: every skill shipped by an
// installed App, together with the App identity used as its group label.
type skillGroup struct {
	AppID       string             `json:"appId"`
	Name        string             `json:"name"`
	Kind        string             `json:"kind"`
	Description string             `json:"description"`
	Skills      []skillLinkSummary `json:"skills"`
}

// skillCatalogStatus mirrors the MCP tools panel: platform skills always form
// the "全局" group and every installed App forms its own group.
type skillCatalogStatus struct {
	Global []skillLinkSummary `json:"global"`
	Apps   []skillGroup       `json:"apps"`
}

type skillLinksRequest struct {
	AppID   string   `json:"appId"`
	SkillID string   `json:"skillId"`
	Targets []string `json:"targets"`
}

func (s *Server) recutSkillStatus(w http.ResponseWriter, _ *http.Request) {
	if s.skills == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("Recut Skill manager is unavailable"))
		return
	}
	status, err := s.skills.Status()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) linkRecutSkill(w http.ResponseWriter, r *http.Request) {
	if s.skills == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("Recut Skill manager is unavailable"))
		return
	}
	request := recutSkillLinksRequest{}
	if err := json.NewDecoder(io.LimitReader(r.Body, 32<<10)).Decode(&request); err != nil && err != io.EOF {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read Recut Skill targets: %w", err))
		return
	}
	status, err := s.skills.Link(request.Targets)
	if err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	writeJSON(w, http.StatusOK, status)
}

// skillsStatus lists every discoverable skill grouped by owning App. Every
// platform skill discovered under service/skills forms the "全局" group; each
// installed App forms its own group.
func (s *Server) skillsStatus(w http.ResponseWriter, _ *http.Request) {
	if s.skills == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("Recut Skill manager is unavailable"))
		return
	}
	skills, err := s.skills.Skills()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	global := make([]skillLinkSummary, 0, len(skills))
	for _, skill := range skills {
		status, statusErr := s.skills.SkillStatus(skill.ID)
		if statusErr != nil {
			continue
		}
		global = append(global, skillLinkSummary{
			ID: skill.ID, AppID: platformSkillAppID, Name: skill.Name, Description: skill.Description,
			Source: status.Source, Version: status.Version, Targets: status.Targets,
		})
	}
	catalog := skillCatalogStatus{Global: global}
	if s.apps != nil {
		apps, appErr := s.apps.List()
		if appErr != nil {
			writeError(w, http.StatusInternalServerError, appErr)
			return
		}
		for _, app := range apps {
			skills, skillsErr := app.Skills()
			if skillsErr != nil || len(skills) == 0 {
				continue
			}
			group := skillGroup{AppID: app.Manifest.ID, Name: app.Manifest.Name, Kind: string(app.Manifest.Kind), Description: app.Manifest.Description}
			for _, skill := range skills {
				targets, targetErr := s.skills.skillStatus(skill.Root, skill.ID)
				if targetErr != nil {
					continue
				}
				group.Skills = append(group.Skills, skillLinkSummary{
					ID: skill.ID, AppID: app.Manifest.ID, Name: skill.Name, Description: skill.Description,
					Source: skill.Root, Targets: targets,
				})
			}
			if len(group.Skills) > 0 {
				catalog.Apps = append(catalog.Apps, group)
			}
		}
	}
	writeJSON(w, http.StatusOK, catalog)
}

// linkSkill enables an arbitrary skill (platform or App-owned) for the
// requested Agent targets. MCP-enabled platform skills keep their MCP
// registration; every other skill is linked as a file only.
func (s *Server) linkSkill(w http.ResponseWriter, r *http.Request) {
	if s.skills == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("Recut Skill manager is unavailable"))
		return
	}
	request := skillLinksRequest{}
	if err := json.NewDecoder(io.LimitReader(r.Body, 32<<10)).Decode(&request); err != nil && err != io.EOF {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read Skill link request: %w", err))
		return
	}
	source, summary, err := s.resolveSkillSource(request.AppID, request.SkillID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	if request.AppID == platformSkillAppID && s.skills.mcpEnabled(request.SkillID) {
		status, linkErr := s.skills.Link(request.Targets)
		if linkErr != nil {
			writeError(w, http.StatusConflict, linkErr)
			return
		}
		summary.Targets = status.Targets
		summary.Source = status.Source
		summary.Version = status.Version
		writeJSON(w, http.StatusOK, summary)
		return
	}
	targets, linkErr := s.skills.LinkSkill(source, request.SkillID, request.Targets)
	if linkErr != nil {
		writeError(w, http.StatusConflict, linkErr)
		return
	}
	summary.Targets = targets
	summary.Source = source
	writeJSON(w, http.StatusOK, summary)
}

// resolveSkillSource locates a skill's source directory and display summary by
// App + Skill id. Platform skills live under the data-dir skills tree; App
// skills live inside the installed App package.
func (s *Server) resolveSkillSource(appID, skillID string) (string, skillLinkSummary, error) {
	if strings.TrimSpace(skillID) == "" {
		return "", skillLinkSummary{}, fmt.Errorf("skillId is required")
	}
	if appID == platformSkillAppID {
		skills, err := s.skills.Skills()
		if err != nil {
			return "", skillLinkSummary{}, err
		}
		for _, skill := range skills {
			if skill.ID == skillID {
				return s.skills.SourceDir(skill.ID), skillLinkSummary{ID: skill.ID, AppID: appID, Name: skill.Name, Description: skill.Description}, nil
			}
		}
		return "", skillLinkSummary{}, fmt.Errorf("unknown platform skill %q", skillID)
	}
	if s.apps == nil {
		return "", skillLinkSummary{}, fmt.Errorf("skill catalog is unavailable")
	}
	app, ok := s.apps.Get(appID)
	if !ok {
		return "", skillLinkSummary{}, fmt.Errorf("app %q is unavailable", appID)
	}
	skills, err := app.Skills()
	if err != nil {
		return "", skillLinkSummary{}, err
	}
	for _, skill := range skills {
		if skill.ID == skillID {
			return skill.Root, skillLinkSummary{ID: skill.ID, AppID: app.Manifest.ID, Name: skill.Name, Description: skill.Description}, nil
		}
	}
	return "", skillLinkSummary{}, fmt.Errorf("skill %q is not provided by app %q", skillID, appID)
}
