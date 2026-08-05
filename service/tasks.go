/*
 * [INPUT]: 依赖 Store 的 workspace SQLite
 * [OUTPUT]: 对外提供 Agent Task 的创建、活跃查询、完成与显式 Doc 访问审计记录
 * [POS]: service 的 Agent 任务审计层；Task 记录输入/输出 Doc 与每次显式 target 访问，跨会话与 MCP 调用共享
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

type AgentTask struct {
	ID             string     `json:"id"`
	SessionID      string     `json:"sessionId"`
	Status         string     `json:"status"`
	InputDocIDs    []string   `json:"inputDocIds"`
	OutputDocIDs   []string   `json:"outputDocIds"`
	AccessedDocIDs []string   `json:"accessedDocIds"`
	CreatedAt      time.Time  `json:"createdAt"`
	CompletedAt    *time.Time `json:"completedAt,omitempty"`
}

func (s *Store) CreateTask(sessionID string) (AgentTask, error) {
	id, err := newID()
	if err != nil {
		return AgentTask{}, err
	}
	now := time.Now().UTC()
	task := AgentTask{ID: id, SessionID: sessionID, Status: "running", InputDocIDs: []string{}, OutputDocIDs: []string{}, AccessedDocIDs: []string{}, CreatedAt: now}
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return AgentTask{}, err
	}
	if _, err := db.Exec("insert into agent_tasks (id, session_id, status, input_doc_ids_json, output_doc_ids_json, accessed_doc_ids_json, created_at, completed_at) values (?, ?, ?, ?, ?, ?, ?, ?)", task.ID, task.SessionID, task.Status, jsonList(task.InputDocIDs), jsonList(task.OutputDocIDs), jsonList(task.AccessedDocIDs), iso(now), nil); err != nil {
		return AgentTask{}, err
	}
	return task, nil
}

// ActiveTask returns the newest running Task of a session, or nil when none exists.
func (s *Store) ActiveTask(sessionID string) (*AgentTask, error) {
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return nil, err
	}
	row := db.QueryRow("select id, session_id, status, input_doc_ids_json, output_doc_ids_json, accessed_doc_ids_json, created_at, completed_at from agent_tasks where session_id = ? and status = 'running' order by created_at desc limit 1", sessionID)
	task, err := scanAgentTask(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &task, nil
}

func (s *Store) CompleteTask(taskID string) error {
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return err
	}
	_, err = db.Exec("update agent_tasks set status = 'completed', completed_at = ? where id = ?", iso(time.Now().UTC()), taskID)
	return err
}

// AppendTaskAccess records an explicit target Doc access in the Task audit trail.
func (s *Store) AppendTaskAccess(taskID, projectID string) {
	if taskID == "" || projectID == "" {
		return
	}
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return
	}
	var raw string
	if err := db.QueryRow("select accessed_doc_ids_json from agent_tasks where id = ?", taskID).Scan(&raw); err != nil {
		return
	}
	ids := []string{}
	_ = json.Unmarshal([]byte(raw), &ids)
	for _, existing := range ids {
		if existing == projectID {
			return
		}
	}
	ids = append(ids, projectID)
	_, _ = db.Exec("update agent_tasks set accessed_doc_ids_json = ? where id = ?", jsonList(ids), taskID)
}

func jsonList(values []string) string {
	data, _ := json.Marshal(values)
	return string(data)
}

func scanAgentTask(row scanner) (AgentTask, error) {
	var task AgentTask
	var input, output, accessed, created string
	var completed sql.NullString
	err := row.Scan(&task.ID, &task.SessionID, &task.Status, &input, &output, &accessed, &created, &completed)
	if err != nil {
		return AgentTask{}, err
	}
	if err := json.Unmarshal([]byte(input), &task.InputDocIDs); err != nil {
		return AgentTask{}, err
	}
	if err := json.Unmarshal([]byte(output), &task.OutputDocIDs); err != nil {
		return AgentTask{}, err
	}
	if err := json.Unmarshal([]byte(accessed), &task.AccessedDocIDs); err != nil {
		return AgentTask{}, err
	}
	if task.CreatedAt, err = time.Parse(time.RFC3339Nano, created); err != nil {
		return AgentTask{}, err
	}
	if completed.Valid {
		parsed, parseErr := time.Parse(time.RFC3339Nano, completed.String)
		if parseErr != nil {
			return AgentTask{}, parseErr
		}
		task.CompletedAt = &parsed
	}
	return task, nil
}
