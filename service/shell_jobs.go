/*
 * [INPUT]: 依赖 Store 的 workspace.sqlite（shell_jobs 平台表）、App 文件根、项目事件日志、userBaseEnv 用户 shell 环境与标准库非交互进程能力
 * [OUTPUT]: 对外提供 ShellJobManager、平台 shell_jobs 表的持久 Job 状态（记录入库、stdout/stderr 日志仍为 JSONL 文件）、顺序日志、不含命令参数的生命周期审计、取消、重启收敛与按 jobId 的全局查找/等待；任务从合并后的最终 PATH 解析命令，取消/超时按进程组终止整棵任务树（不残留孙进程）
 * [POS]: service 的本地任务执行边界；为 App shell 和 Python runtime 复用，不使用 PTY 或业务专属协议
 * [PROTOCOL]: TimeoutSeconds 0 = 无期限（仅 Start 服务型长驻进程，如 Remotion Studio 预览）；阻塞 Execute 必须给有限超时。变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

type ShellJobStatus string

const (
	ShellJobQueued      ShellJobStatus = "queued"
	ShellJobRunning     ShellJobStatus = "running"
	ShellJobCompleted   ShellJobStatus = "completed"
	ShellJobFailed      ShellJobStatus = "failed"
	ShellJobCancelled   ShellJobStatus = "cancelled"
	ShellJobInterrupted ShellJobStatus = "interrupted"
)

type ShellJob struct {
	ID        string         `json:"id"`
	ProjectID string         `json:"projectId"`
	AppID     string         `json:"appId"`
	Status    ShellJobStatus `json:"status"`
	Command   string         `json:"command"`
	Args      []string       `json:"args"`
	ExitCode  int            `json:"exitCode,omitempty"`
	Error     string         `json:"error,omitempty"`
	StartedAt *time.Time     `json:"startedAt,omitempty"`
	EndedAt   *time.Time     `json:"endedAt,omitempty"`
	CreatedAt *time.Time     `json:"createdAt,omitempty"`
	UpdatedAt *time.Time     `json:"updatedAt,omitempty"`
}

type ShellJobLog struct {
	JobID     string    `json:"jobId"`
	Sequence  int64     `json:"sequence"`
	Stream    string    `json:"stream"`
	Text      string    `json:"text"`
	Timestamp time.Time `json:"timestamp"`
}

type ShellJobStart struct {
	ProjectID      string
	AppID          string
	Command        string
	Args           []string
	Dir            string
	Env            []string
	TimeoutSeconds int
}

type activeShellJob struct {
	cancel    context.CancelFunc
	cancelled bool
}

type ShellJobManager struct {
	store  *Store
	mu     sync.Mutex
	active map[string]activeShellJob
	logs   map[string]int64
}

func NewShellJobManager(store *Store) *ShellJobManager {
	return &ShellJobManager{store: store, active: map[string]activeShellJob{}, logs: map[string]int64{}}
}

func (m *ShellJobManager) RecoverInterrupted() (int, error) {
	if err := m.importLegacyFiles(); err != nil {
		return 0, err
	}
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return 0, err
	}
	rows, err := db.Query("select id, project_id, app_id from shell_jobs where status in ('queued', 'running')")
	if err != nil {
		return 0, err
	}
	type active struct{ id, projectID, appID string }
	activeRows := []active{}
	for rows.Next() {
		var item active
		if err := rows.Scan(&item.id, &item.projectID, &item.appID); err != nil {
			rows.Close()
			return 0, err
		}
		activeRows = append(activeRows, item)
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	now := time.Now().UTC()
	count := 0
	for _, item := range activeRows {
		job, err := m.read(item.projectID, item.id)
		if err != nil {
			continue
		}
		job.Status, job.Error, job.EndedAt = ShellJobInterrupted, "service restarted before the job finished", &now
		if err := m.persist(job); err != nil {
			return count, err
		}
		m.store.AppendEvent(job.ProjectID, map[string]any{"type": "shell.job.completed", "appId": job.AppID, "job": job})
		count++
	}
	return count, nil
}

// importLegacyFiles migrates shell jobs persisted as per-project JSON files by
// earlier versions into the platform shell_jobs table, then removes the JSON
// record files. Log JSONL files are untouched and remain the job log store.
func (m *ShellJobManager) importLegacyFiles() error {
	entries, err := os.ReadDir(m.store.projectsDir())
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	scopes := []string{""}
	for _, entry := range entries {
		if entry.IsDir() {
			scopes = append(scopes, entry.Name())
		}
	}
	for _, projectID := range scopes {
		jobFiles, err := os.ReadDir(m.jobsDir(projectID))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		for _, file := range jobFiles {
			if file.IsDir() || filepath.Ext(file.Name()) != ".json" {
				continue
			}
			path := filepath.Join(m.jobsDir(projectID), file.Name())
			job := ShellJob{}
			if err := readProjectJSON(path, &job); err != nil || job.ID == "" {
				continue
			}
			now := time.Now().UTC()
			if job.CreatedAt == nil {
				job.CreatedAt = &now
			}
			job.ProjectID = projectID
			if err := m.persist(job); err != nil {
				return err
			}
			_ = os.Remove(path)
		}
	}
	return nil
}

func (m *ShellJobManager) Start(input ShellJobStart) (ShellJob, error) {
	if input.Command == "" || input.Dir == "" || input.TimeoutSeconds < 0 || input.TimeoutSeconds > 7200 {
		return ShellJob{}, errors.New("invalid shell job")
	}
	id, err := newID()
	if err != nil {
		return ShellJob{}, err
	}
	now := time.Now().UTC()
	job := ShellJob{ID: id, ProjectID: input.ProjectID, AppID: input.AppID, Status: ShellJobQueued, Command: input.Command, Args: input.Args, CreatedAt: &now}
	if err := m.persist(job); err != nil {
		return ShellJob{}, err
	}
	log.Printf("INFO shell job queued job_id=%s project_id=%s app_id=%s", job.ID, job.ProjectID, job.AppID)
	var ctx context.Context
	var cancel context.CancelFunc
	if input.TimeoutSeconds == 0 {
		// 0 = indefinite, reserved for server-style long-running processes
		// (e.g. Remotion Studio preview). Blocking Execute rejects it below.
		ctx, cancel = context.WithCancel(context.Background())
	} else {
		ctx, cancel = context.WithTimeout(context.Background(), time.Duration(input.TimeoutSeconds)*time.Second)
	}
	m.mu.Lock()
	m.active[job.ID] = activeShellJob{cancel: cancel}
	m.mu.Unlock()
	go m.run(job, input, ctx, cancel)
	return job, nil
}

func (m *ShellJobManager) run(job ShellJob, input ShellJobStart, ctx context.Context, cancel context.CancelFunc) {
	m.mu.Lock()
	activeJob := m.active[job.ID]
	m.mu.Unlock()
	if activeJob.cancelled {
		m.finishCancelled(job)
		cancel()
		return
	}
	now := time.Now().UTC()
	job.Status, job.StartedAt = ShellJobRunning, &now
	_ = m.persist(job)
	m.store.AppendEvent(job.ProjectID, map[string]any{"type": "shell.job.started", "appId": job.AppID, "job": job})
	environment := mergeEnv(userBaseEnv(), input.Env)
	command := exec.CommandContext(ctx, resolveShellCommand(input.Command, environment), input.Args...)
	configureShellJobCommand(command)
	command.Dir = input.Dir
	command.Env = environment
	stdout, err := command.StdoutPipe()
	if err == nil {
		stderr, nextErr := command.StderrPipe()
		err = nextErr
		if err == nil {
			err = command.Start()
			if err == nil {
				var group sync.WaitGroup
				group.Add(2)
				go func() { defer group.Done(); m.capture(job, "stdout", stdout) }()
				go func() { defer group.Done(); m.capture(job, "stderr", stderr) }()
				err = command.Wait()
				group.Wait()
			}
		}
	}
	m.mu.Lock()
	activeJob, active := m.active[job.ID]
	delete(m.active, job.ID)
	m.mu.Unlock()
	cancel()
	ended := time.Now().UTC()
	job.EndedAt = &ended
	if errors.Is(ctx.Err(), context.Canceled) && active && activeJob.cancelled {
		job.Status, job.Error = ShellJobCancelled, "cancelled"
	} else if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		job.Status, job.Error = ShellJobFailed, "process timed out"
	} else if err != nil {
		job.Status, job.Error = ShellJobFailed, err.Error()
		if exit, ok := err.(*exec.ExitError); ok {
			job.ExitCode = exit.ExitCode()
		}
	} else {
		job.Status = ShellJobCompleted
	}
	_ = m.persist(job)
	m.store.AppendEvent(job.ProjectID, map[string]any{"type": "shell.job.completed", "appId": job.AppID, "job": job})
	switch job.Status {
	case ShellJobCompleted:
		log.Printf("INFO shell job completed job_id=%s exit_code=%d", job.ID, job.ExitCode)
	case ShellJobCancelled:
		log.Printf("WARN shell job cancelled job_id=%s", job.ID)
	default:
		log.Printf("ERROR shell job failed job_id=%s exit_code=%d", job.ID, job.ExitCode)
	}
}

// resolveShellCommand 在 exec.Command 解析命令名之前应用子进程的最终 PATH。
// 否则 venv 的 PATH 虽会进入子进程环境，却无法影响 daemon 已选定的可执行文件。
func resolveShellCommand(name string, environment []string) string {
	if filepath.IsAbs(name) || strings.ContainsRune(name, filepath.Separator) {
		return name
	}
	path := environmentValue(environment, "PATH")
	if path == "" {
		return name
	}
	extensions := []string{""}
	if runtime.GOOS == "windows" && filepath.Ext(name) == "" {
		extensions = strings.Split(environmentValue(environment, "PATHEXT"), ";")
		if len(extensions) == 0 || extensions[0] == "" {
			extensions = []string{".com", ".exe", ".bat", ".cmd"}
		}
	}
	// Windows 系统与 venv 只提供 python.exe（python3 常被商店别名截胡），
	// App 代码里的 python3 回退解析到 python。
	names := []string{name}
	if runtime.GOOS == "windows" && name == "python3" {
		names = append(names, "python")
	}
	for _, directory := range filepath.SplitList(path) {
		if directory == "" {
			directory = "."
		}
		for _, candidate := range names {
			for _, extension := range extensions {
				executable := filepath.Join(directory, candidate+extension)
				info, err := os.Stat(executable)
				if err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
					return executable
				}
			}
		}
	}
	return name
}

func environmentValue(environment []string, name string) string {
	prefix := name + "="
	for index := len(environment) - 1; index >= 0; index-- {
		if strings.HasPrefix(environment[index], prefix) {
			return strings.TrimPrefix(environment[index], prefix)
		}
	}
	return ""
}

func (m *ShellJobManager) finishCancelled(job ShellJob) {
	m.mu.Lock()
	delete(m.active, job.ID)
	m.mu.Unlock()
	now := time.Now().UTC()
	job.Status, job.Error, job.EndedAt = ShellJobCancelled, "cancelled", &now
	_ = m.persist(job)
	m.store.AppendEvent(job.ProjectID, map[string]any{"type": "shell.job.completed", "appId": job.AppID, "job": job})
	log.Printf("WARN shell job cancelled job_id=%s", job.ID)
}

func (m *ShellJobManager) capture(job ShellJob, stream string, reader io.Reader) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), cliStreamScanLimit)
	for scanner.Scan() {
		m.appendLog(job, stream, scanner.Text()+"\n")
	}
}

func (m *ShellJobManager) appendLog(job ShellJob, stream, text string) {
	m.mu.Lock()
	sequence := m.logs[job.ID]
	m.logs[job.ID]++
	path := m.logsPath(job.ProjectID, job.ID)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		m.mu.Unlock()
		return
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		m.mu.Unlock()
		return
	}
	entry := ShellJobLog{JobID: job.ID, Sequence: sequence, Stream: stream, Text: text, Timestamp: time.Now().UTC()}
	raw, _ := json.Marshal(entry)
	_, _ = file.Write(append(raw, '\n'))
	_ = file.Close()
	m.mu.Unlock()
	m.store.AppendEvent(job.ProjectID, map[string]any{"type": "shell.job.log", "appId": job.AppID, "log": entry})
}

func (m *ShellJobManager) Status(projectID, appID, id string) (ShellJob, error) {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return ShellJob{}, err
	}
	row := db.QueryRow(shellJobColumns+" from shell_jobs where id = ? and project_id = ? and app_id = ?", id, projectID, appID)
	job, err := scanShellJob(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ShellJob{}, errors.New("shell job not found")
	}
	return job, err
}
func (m *ShellJobManager) Cancel(projectID, appID, id string) error {
	job, err := m.Status(projectID, appID, id)
	if err != nil {
		return err
	}
	if job.Status != ShellJobQueued && job.Status != ShellJobRunning {
		return nil
	}
	m.mu.Lock()
	active, ok := m.active[id]
	if ok {
		active.cancelled = true
		m.active[id] = active
	}
	m.mu.Unlock()
	if !ok {
		return errors.New("shell job is no longer running")
	}
	active.cancel()
	return nil
}
func (m *ShellJobManager) persist(job ShellJob) error {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return err
	}
	now := iso(time.Now().UTC())
	args, _ := json.Marshal(job.Args)
	startedAt, endedAt, createdAt := "", "", now
	if job.StartedAt != nil {
		startedAt = iso(*job.StartedAt)
	}
	if job.EndedAt != nil {
		endedAt = iso(*job.EndedAt)
	}
	if job.CreatedAt != nil {
		createdAt = iso(*job.CreatedAt)
	}
	_, err = db.Exec(`
insert into shell_jobs (id, project_id, app_id, status, command, args_json, exit_code, error, started_at, ended_at, created_at, updated_at)
values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
on conflict(id) do update set
  status = excluded.status, exit_code = excluded.exit_code, error = excluded.error,
  started_at = excluded.started_at, ended_at = excluded.ended_at, updated_at = excluded.updated_at`,
		job.ID, job.ProjectID, job.AppID, string(job.Status), job.Command, string(args), job.ExitCode, job.Error, startedAt, endedAt, createdAt, now)
	return err
}

const shellJobColumns = "select id, project_id, app_id, status, command, args_json, exit_code, error, started_at, ended_at, created_at"

func (m *ShellJobManager) read(projectID, id string) (ShellJob, error) {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return ShellJob{}, err
	}
	return scanShellJob(db.QueryRow(shellJobColumns+" from shell_jobs where id = ? and project_id = ?", id, projectID))
}

func scanShellJob(row *sql.Row) (ShellJob, error) {
	var job ShellJob
	var status, args, startedAt, endedAt, createdAt string
	err := row.Scan(&job.ID, &job.ProjectID, &job.AppID, &status, &job.Command, &args, &job.ExitCode, &job.Error, &startedAt, &endedAt, &createdAt)
	if err != nil {
		return ShellJob{}, err
	}
	job.Status = ShellJobStatus(status)
	_ = json.Unmarshal([]byte(args), &job.Args)
	if startedAt != "" {
		if parsed, parseErr := time.Parse(time.RFC3339Nano, startedAt); parseErr == nil {
			job.StartedAt = &parsed
		}
	}
	if endedAt != "" {
		if parsed, parseErr := time.Parse(time.RFC3339Nano, endedAt); parseErr == nil {
			job.EndedAt = &parsed
		}
	}
	if createdAt != "" {
		if parsed, parseErr := time.Parse(time.RFC3339Nano, createdAt); parseErr == nil {
			job.CreatedAt = &parsed
		}
	}
	return job, nil
}
func (m *ShellJobManager) jobsDir(projectID string) string {
	return filepath.Join(m.store.projectDir(projectID), "shell-jobs")
}
func (m *ShellJobManager) logsPath(projectID, id string) string {
	return filepath.Join(m.jobsDir(projectID), id+".log.jsonl")
}

func (m *ShellJobManager) Wait(projectID, appID, id string) (ShellJob, error) {
	for {
		job, err := m.Status(projectID, appID, id)
		if err != nil || (job.Status != ShellJobQueued && job.Status != ShellJobRunning) {
			return job, err
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func (m *ShellJobManager) Output(projectID, id string) string {
	logs, _ := m.Logs(projectID, id)
	var output string
	for _, entry := range logs {
		output += entry.Text
	}
	return output
}

func (m *ShellJobManager) Logs(projectID, id string) ([]ShellJobLog, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	file, err := os.Open(m.logsPath(projectID, id))
	if errors.Is(err, os.ErrNotExist) {
		return []ShellJobLog{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	logs := []ShellJobLog{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), cliStreamScanLimit)
	for scanner.Scan() {
		entry := ShellJobLog{}
		if err := json.Unmarshal(scanner.Bytes(), &entry); err != nil {
			return nil, err
		}
		logs = append(logs, entry)
	}
	return logs, scanner.Err()
}

func (m *ShellJobManager) Execute(input ShellJobStart) (ShellJob, error) {
	if input.TimeoutSeconds == 0 {
		return ShellJob{}, errors.New("blocking shell execution requires a finite timeoutSeconds")
	}
	job, err := m.Start(input)
	if err != nil {
		return ShellJob{}, err
	}
	return m.Wait(input.ProjectID, input.AppID, job.ID)
}

func shellJobError(job ShellJob) error {
	if job.Status == ShellJobCompleted {
		return nil
	}
	return fmt.Errorf("shell job %s: %s", job.Status, job.Error)
}

// FindByID locates a persisted shell job by its unique id across project and
// standalone appstate scopes. The shell_jobs table is the single job record
// store; the owning scope (projectId / appId) is carried on the record.
func (m *ShellJobManager) FindByID(id string) (ShellJob, error) {
	if strings.TrimSpace(id) == "" || strings.ContainsAny(id, `/\`) {
		return ShellJob{}, errors.New("invalid shell job id")
	}
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return ShellJob{}, err
	}
	job, err := scanShellJob(db.QueryRow(shellJobColumns+" from shell_jobs where id = ?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return ShellJob{}, errors.New("shell job not found")
	}
	return job, err
}

// WaitByID waits up to timeout for a job to reach a terminal state, mirroring
// the media-layer wait contract for the platform job observation tools.
func (m *ShellJobManager) WaitByID(id string, timeout time.Duration) (ShellJob, error) {
	if timeout <= 0 {
		timeout = 300 * time.Second
	}
	deadline := time.Now().Add(timeout)
	for {
		job, err := m.FindByID(id)
		if err != nil {
			return ShellJob{}, err
		}
		if job.Status != ShellJobQueued && job.Status != ShellJobRunning {
			return job, nil
		}
		if time.Now().After(deadline) {
			return job, nil
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func (m *ShellJobManager) LogsByID(id string) ([]ShellJobLog, error) {
	job, err := m.FindByID(id)
	if err != nil {
		return nil, err
	}
	return m.Logs(job.ProjectID, job.ID)
}

func (m *ShellJobManager) CancelByID(id string) error {
	job, err := m.FindByID(id)
	if err != nil {
		return err
	}
	return m.Cancel(job.ProjectID, job.AppID, job.ID)
}
