/*
 * [INPUT]: 依赖 Store 的 workspace.sqlite（async_ops 平台表）与项目事件账本（AppendEvent）
 * [OUTPUT]: 对外提供 AsyncOpsManager：统一异步 Handle 注册表（deferred 类，与 shell/media 并列由
 *           recut.job.* 观察）。App 经 ctx.job.create/complete/fail 或 ctx.project.callUI 创建，
 *           UI 回包经 rpc.reply 解析，超时/取消由平台收敛；Handle 生命周期一律落项目事件账本。
 * [POS]: 平台通讯契约（docs/platform-comms-contract.md §5）的持久层；App 不直接访问本表，
 *        只经 ctx.job / ctx.project.callUI / recut.job.* 交互。无独立状态，只有表与生命周期逻辑。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// AsyncOpStatus 是统一异步 Handle 的状态机：pending → running → 终态。
type AsyncOpStatus string

const (
	AsyncOpPending   AsyncOpStatus = "pending"
	AsyncOpRunning   AsyncOpStatus = "running"
	AsyncOpCompleted AsyncOpStatus = "completed"
	AsyncOpFailed    AsyncOpStatus = "failed"
	AsyncOpCancelled AsyncOpStatus = "cancelled"
	AsyncOpTimedOut  AsyncOpStatus = "timed_out"
)

// AsyncOp 是 async_ops 表的一行：App 或 UI 回包完成的无进程异步 Handle。
type AsyncOp struct {
	ID         string
	ScopeType  string
	ProjectID  string
	AppID      string
	Kind       string // "deferred"；shell/media 复用各自表，仅观察视图走这里
	Method     string
	CompleteOp string
	Status     AsyncOpStatus
	Payload    []byte
	Result     []byte
	Error      []byte
	TimeoutAt  string
	CreatedAt  string
	UpdatedAt  string
}

const asyncOpColumns = "id, scope_type, project_id, app_id, kind, method, complete_op, status, payload_json, result_json, error_json, timeout_at, created_at, updated_at"

// AsyncOpsManager 管理 async_ops 表；实例由 AppHost 持有，全局按 jobId 查找。
type AsyncOpsManager struct {
	store *Store
}

func NewAsyncOpsManager(store *Store) *AsyncOpsManager {
	return &AsyncOpsManager{store: store}
}

func (m *AsyncOpsManager) db() (*sql.DB, error) { return m.store.WorkspaceDatabase() }

func (m *AsyncOpsManager) ensureSchema(db *sql.DB) error {
	_, err := db.Exec(`
create table if not exists async_ops (
  id            text primary key,
  scope_type    text not null default 'project',
  project_id    text not null default '',
  app_id        text not null,
  kind          text not null default 'deferred',
  method        text not null default '',
  complete_op   text not null default '',
  status        text not null default 'pending',
  payload_json  text not null default '{}',
  result_json   text not null default '',
  error_json    text not null default '',
  timeout_at    text not null default '',
  created_at    text not null,
  updated_at    text not null
);
create index if not exists idx_async_ops_scope on async_ops(project_id, app_id, created_at desc);
create index if not exists idx_async_ops_status on async_ops(status);`)
	return err
}

func (m *AsyncOpsManager) withDB(fn func(*sql.DB) error) error {
	db, err := m.db()
	if err != nil {
		return err
	}
	if err := m.ensureSchema(db); err != nil {
		return err
	}
	return fn(db)
}

func (m *AsyncOpsManager) eventTarget(op *AsyncOp) string {
	if op.ScopeType == "appstate" {
		return ""
	}
	return op.ProjectID
}

func (m *AsyncOpsManager) record(op *AsyncOp, eventType string, extra map[string]any) {
	projectID := m.eventTarget(op)
	if projectID == "" {
		return
	}
	payload := map[string]any{
		"type":   eventType,
		"appId":  op.AppID,
		"id":     op.ID,
		"method": op.Method,
		"status": string(op.Status),
	}
	for k, v := range extra {
		payload[k] = v
	}
	m.store.AppendEvent(projectID, payload)
}

// Create 注册一个新的 deferred Handle。timeoutMs<=0 表示无超时（默认 120s）。
func (m *AsyncOpsManager) Create(scopeType, projectID, appID, method string, payload any, completeOp string, timeoutMs int) (*AsyncOp, error) {
	id, err := newID()
	if err != nil {
		return nil, err
	}
	if scopeType == "" {
		scopeType = "project"
	}
	if timeoutMs <= 0 {
		timeoutMs = 120000
	}
	now := time.Now().UTC()
	op := &AsyncOp{
		ID:         id,
		ScopeType:  scopeType,
		ProjectID:  projectID,
		AppID:      appID,
		Kind:       "deferred",
		Method:     method,
		CompleteOp: completeOp,
		Status:     AsyncOpPending,
		TimeoutAt:  now.Add(time.Duration(timeoutMs) * time.Millisecond).UTC().Format(time.RFC3339Nano),
		CreatedAt:  now.Format(time.RFC3339Nano),
		UpdatedAt:  now.Format(time.RFC3339Nano),
	}
	if raw, err := json.Marshal(payload); err == nil {
		op.Payload = raw
	}
	err = m.withDB(func(db *sql.DB) error {
		_, err := db.Exec(
			"insert into async_ops ("+asyncOpColumns+") values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			op.ID, op.ScopeType, op.ProjectID, op.AppID, op.Kind, op.Method, op.CompleteOp,
			string(op.Status), string(op.Payload), string(op.Result), string(op.Error),
			op.TimeoutAt, op.CreatedAt, op.UpdatedAt,
		)
		return err
	})
	if err != nil {
		return nil, err
	}
	m.record(op, "async.op.created", nil)
	return op, nil
}

func (m *AsyncOpsManager) get(db *sql.DB, id string) (*AsyncOp, error) {
	row := db.QueryRow("select "+asyncOpColumns+" from async_ops where id = ?", id)
	return scanAsyncOp(row)
}

// FindByID 按全局 jobId 查找，供 recut.job.* 统一观察；对过期 Handle 做惰性终态化。
func (m *AsyncOpsManager) FindByID(id string) (*AsyncOp, error) {
	var op *AsyncOp
	err := m.withDB(func(db *sql.DB) error {
		var err error
		op, err = m.get(db, id)
		return err
	})
	if err != nil {
		return nil, err
	}
	if op == nil {
		return nil, sql.ErrNoRows
	}
	m.settleTimeout(op)
	return op, nil
}

// settleTimeout 把过期未终态的 Handle 惰性收敛为 timed_out。
func (m *AsyncOpsManager) settleTimeout(op *AsyncOp) {
	if op.Status != AsyncOpPending && op.Status != AsyncOpRunning {
		return
	}
	if op.TimeoutAt == "" {
		return
	}
	deadline, err := time.Parse(time.RFC3339Nano, op.TimeoutAt)
	if err != nil || time.Now().UTC().Before(deadline) {
		return
	}
	_ = m.withDB(func(db *sql.DB) error {
		res, err := db.Exec(
			"update async_ops set status = ?, updated_at = ? where id = ? and status in ('pending','running')",
			string(AsyncOpTimedOut), time.Now().UTC().Format(time.RFC3339Nano), op.ID,
		)
		if err == nil {
			if rows, _ := res.RowsAffected(); rows > 0 {
				op.Status = AsyncOpTimedOut
				op.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
				m.record(op, "async.op.timed_out", nil)
			}
		}
		return nil
	})
}

// Resolve 标记完成并写入结果；completeOp 已由调用方先执行，result 即最终结果。
func (m *AsyncOpsManager) Resolve(id string, result any) (*AsyncOp, error) {
	raw, _ := json.Marshal(result)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var op *AsyncOp
	err := m.withDB(func(db *sql.DB) error {
		var err error
		op, err = m.get(db, id)
		if err != nil {
			return err
		}
		if op.Status == AsyncOpCompleted || op.Status == AsyncOpFailed ||
			op.Status == AsyncOpCancelled || op.Status == AsyncOpTimedOut {
			return nil // 幂等：已终态不覆盖
		}
		_, err = db.Exec(
			"update async_ops set status = ?, result_json = ?, updated_at = ? where id = ?",
			string(AsyncOpCompleted), string(raw), now, id,
		)
		return err
	})
	if err != nil {
		return nil, err
	}
	if op != nil {
		op.Status = AsyncOpCompleted
		op.Result = raw
		op.UpdatedAt = now
		m.record(op, "async.op.completed", nil)
	}
	return op, nil
}

// Fail 标记失败并写入统一错误信封。
func (m *AsyncOpsManager) Fail(id string, errValue any) (*AsyncOp, error) {
	raw, _ := json.Marshal(errValue)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var op *AsyncOp
	err := m.withDB(func(db *sql.DB) error {
		var err error
		op, err = m.get(db, id)
		if err != nil {
			return err
		}
		if op.Status == AsyncOpCompleted || op.Status == AsyncOpFailed ||
			op.Status == AsyncOpCancelled || op.Status == AsyncOpTimedOut {
			return nil
		}
		_, err = db.Exec(
			"update async_ops set status = ?, error_json = ?, updated_at = ? where id = ?",
			string(AsyncOpFailed), string(raw), now, id,
		)
		return err
	})
	if err != nil {
		return nil, err
	}
	if op != nil {
		op.Status = AsyncOpFailed
		op.Error = raw
		op.UpdatedAt = now
		m.record(op, "async.op.failed", nil)
	}
	return op, nil
}

// Cancel 取消一个未终态的 Handle；UI 侧收到 app.rpc.cancel 事件可中止。
func (m *AsyncOpsManager) Cancel(id string) (*AsyncOp, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var op *AsyncOp
	err := m.withDB(func(db *sql.DB) error {
		var err error
		op, err = m.get(db, id)
		if err != nil {
			return err
		}
		if op.Status == AsyncOpCompleted || op.Status == AsyncOpFailed ||
			op.Status == AsyncOpCancelled || op.Status == AsyncOpTimedOut {
			return nil
		}
		_, err = db.Exec(
			"update async_ops set status = ?, updated_at = ? where id = ?",
			string(AsyncOpCancelled), now, id,
		)
		return err
	})
	if err != nil {
		return nil, err
	}
	if op != nil {
		op.Status = AsyncOpCancelled
		op.UpdatedAt = now
		m.record(op, "async.op.cancelled", nil)
	}
	return op, nil
}

// SweepExpired 把过期 Handle 收敛为 timed_out（启动时与周期清理兜底，读路径已有惰性收敛）。
func (m *AsyncOpsManager) SweepExpired() (int, error) {
	count := 0
	err := m.withDB(func(db *sql.DB) error {
		now := time.Now().UTC().Format(time.RFC3339Nano)
		rows, err := db.Query(
			"select id from async_ops where status in ('pending','running') and timeout_at <> '' and timeout_at < ?",
			now,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			op, err := m.get(db, id)
			if err != nil {
				continue
			}
			if err := m.markTimedOut(db, op); err == nil {
				count++
			}
		}
		return rows.Err()
	})
	return count, err
}

func (m *AsyncOpsManager) markTimedOut(db *sql.DB, op *AsyncOp) error {
	res, err := db.Exec(
		"update async_ops set status = ?, updated_at = ? where id = ? and status in ('pending','running')",
		string(AsyncOpTimedOut), time.Now().UTC().Format(time.RFC3339Nano), op.ID,
	)
	if err != nil {
		return err
	}
	if rows, _ := res.RowsAffected(); rows > 0 {
		op.Status = AsyncOpTimedOut
		m.record(op, "async.op.timed_out", nil)
	}
	return nil
}

func scanAsyncOp(row *sql.Row) (*AsyncOp, error) {
	var op AsyncOp
	var payload, result, errJSON, status string
	err := row.Scan(&op.ID, &op.ScopeType, &op.ProjectID, &op.AppID, &op.Kind, &op.Method,
		&op.CompleteOp, &status, &payload, &result, &errJSON, &op.TimeoutAt, &op.CreatedAt, &op.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, sql.ErrNoRows
	}
	if err != nil {
		return nil, err
	}
	op.Status = AsyncOpStatus(status)
	op.Payload = []byte(payload)
	op.Result = []byte(result)
	op.Error = []byte(errJSON)
	return &op, nil
}

// asyncOpView 投影 async_ops 为统一 job 观察视图（recut.job.*）。
func asyncOpView(op *AsyncOp) map[string]any {
	var result any
	if len(op.Result) > 0 {
		_ = json.Unmarshal(op.Result, &result)
	}
	var errValue any
	if len(op.Error) > 0 {
		_ = json.Unmarshal(op.Error, &errValue)
	}
	var payload any
	if len(op.Payload) > 0 {
		_ = json.Unmarshal(op.Payload, &payload)
	}
	return map[string]any{
		"jobId":     op.ID,
		"id":        op.ID,
		"kind":      "deferred",
		"appId":     op.AppID,
		"method":    op.Method,
		"status":    string(op.Status),
		"result":    result,
		"error":     errValue,
		"payload":   payload,
		"createdAt": op.CreatedAt,
		"updatedAt": op.UpdatedAt,
	}
}