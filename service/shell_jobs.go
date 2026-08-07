/*
 * [INPUT]: 依赖 Store 的 App 文件根、项目事件日志、userBaseEnv 用户 shell 环境与标准库非交互进程能力
 * [OUTPUT]: 对外提供 ShellJobManager、持久 Job 状态、顺序 stdout/stderr 日志、不含命令参数的生命周期审计、取消及服务重启收敛；任务从合并后的最终 PATH 解析命令，取消/超时按进程组终止整棵任务树（不残留孙进程）
 * [POS]: service 的本地任务执行边界；为 App shell 和 Python runtime 复用，不使用 PTY 或业务专属协议
 * [PROTOCOL]: TimeoutSeconds 0 = 无期限（仅 Start 服务型长驻进程，如 Remotion Studio 预览）；阻塞 Execute 必须给有限超时。变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bufio"
	"context"
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
	entries, err := os.ReadDir(m.store.projectsDir())
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	count := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		jobs, err := os.ReadDir(filepath.Join(m.store.projectDir(entry.Name()), "shell-jobs"))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return count, err
		}
		for _, file := range jobs {
			if file.IsDir() || filepath.Ext(file.Name()) != ".json" {
				continue
			}
			job, err := m.read(entry.Name(), file.Name()[:len(file.Name())-5])
			if err != nil || (job.Status != ShellJobQueued && job.Status != ShellJobRunning) {
				continue
			}
			now := time.Now().UTC()
			job.Status, job.Error, job.EndedAt = ShellJobInterrupted, "service restarted before the job finished", &now
			if err := m.persist(job); err != nil {
				return count, err
			}
			m.store.AppendEvent(job.ProjectID, map[string]any{"type": "shell.job.completed", "appId": job.AppID, "job": job})
			count++
		}
	}
	return count, nil
}

func (m *ShellJobManager) Start(input ShellJobStart) (ShellJob, error) {
	if input.Command == "" || input.Dir == "" || input.TimeoutSeconds < 0 || input.TimeoutSeconds > 7200 {
		return ShellJob{}, errors.New("invalid shell job")
	}
	id, err := newID()
	if err != nil {
		return ShellJob{}, err
	}
	job := ShellJob{ID: id, ProjectID: input.ProjectID, AppID: input.AppID, Status: ShellJobQueued, Command: input.Command, Args: input.Args}
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
	for _, directory := range filepath.SplitList(path) {
		if directory == "" {
			directory = "."
		}
		for _, extension := range extensions {
			candidate := filepath.Join(directory, name+extension)
			info, err := os.Stat(candidate)
			if err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
				return candidate
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
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	for scanner.Scan() {
		m.appendLog(job, stream, scanner.Text()+"\n")
	}
}

func (m *ShellJobManager) appendLog(job ShellJob, stream, text string) {
	m.mu.Lock()
	sequence := m.logs[job.ID]
	m.logs[job.ID]++
	path := m.logsPath(job.ProjectID, job.ID)
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
	m.mu.Lock()
	defer m.mu.Unlock()
	job, err := m.read(projectID, id)
	if err != nil || job.AppID != appID {
		return ShellJob{}, errors.New("shell job not found")
	}
	return job, nil
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
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := os.MkdirAll(m.jobsDir(job.ProjectID), 0o700); err != nil {
		return err
	}
	return writeProjectJSON(filepath.Join(m.jobsDir(job.ProjectID), job.ID+".json"), job)
}
func (m *ShellJobManager) read(projectID, id string) (ShellJob, error) {
	job := ShellJob{}
	if err := readProjectJSON(filepath.Join(m.jobsDir(projectID), id+".json"), &job); err != nil {
		return ShellJob{}, err
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
	scanner.Buffer(make([]byte, 4096), 1024*1024)
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
