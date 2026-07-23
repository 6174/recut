/*
 * [INPUT]: 依赖 Store 的项目会话目录、creack/pty 的伪终端和标准库进程管理能力
 * [OUTPUT]: 对外提供 TerminalManager 及会话的启动、输入、尺寸、输出订阅、持久化和终止能力
 * [POS]: service 的通用终端包装层；不理解 Codex、Claude 或任何具体 CLI 语义
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
)

type TerminalStart struct {
	ProjectID  string
	Command    string
	Args       []string
	CWD        string
	SessionDir string
	Cols       uint16
	Rows       uint16
}

type TerminalSession struct {
	ID        string     `json:"id"`
	ProjectID string     `json:"projectId"`
	Command   string     `json:"command"`
	Args      []string   `json:"args"`
	CWD       string     `json:"cwd"`
	Running   bool       `json:"running"`
	StartedAt time.Time  `json:"startedAt"`
	ExitedAt  *time.Time `json:"exitedAt,omitempty"`
}

type terminal struct {
	TerminalSession
	pty            *os.File
	sessionDir     string
	transcriptPath string
	subscribers    map[uint64]chan string
	nextSubID      uint64
}

type TerminalManager struct {
	mu        sync.RWMutex
	store     *Store
	terminals map[string]*terminal
}

func NewTerminalManager(store *Store) (*TerminalManager, error) {
	manager := &TerminalManager{store: store, terminals: map[string]*terminal{}}
	return manager, manager.load()
}

func (m *TerminalManager) Start(input TerminalStart) (TerminalSession, error) {
	if strings.TrimSpace(input.Command) == "" {
		return TerminalSession{}, errors.New("terminal command is required")
	}
	if strings.TrimSpace(input.CWD) == "" || strings.TrimSpace(input.SessionDir) == "" {
		return TerminalSession{}, errors.New("terminal working directory is required")
	}
	if err := os.MkdirAll(input.SessionDir, 0o755); err != nil {
		return TerminalSession{}, fmt.Errorf("create terminal session: %w", err)
	}
	id, err := newID()
	if err != nil {
		return TerminalSession{}, err
	}
	sessionDir := filepath.Join(input.SessionDir, id)
	cols, rows := terminalSize(input.Cols, input.Rows)
	command := exec.Command(input.Command, input.Args...)
	command.Dir = input.CWD
	file, err := pty.StartWithSize(command, &pty.Winsize{Cols: cols, Rows: rows})
	if err != nil {
		return TerminalSession{}, fmt.Errorf("start terminal: %w", err)
	}
	current := &terminal{
		TerminalSession: TerminalSession{ID: id, ProjectID: input.ProjectID, Command: input.Command, Args: input.Args, CWD: input.CWD, Running: true, StartedAt: time.Now().UTC()},
		pty:             file,
		sessionDir:      sessionDir,
		transcriptPath:  filepath.Join(sessionDir, "transcript.log"),
		subscribers:     map[uint64]chan string{},
	}
	if err := m.persist(current); err != nil {
		_ = file.Close()
		return TerminalSession{}, err
	}
	m.mu.Lock()
	m.terminals[current.ID] = current
	m.mu.Unlock()
	go m.read(current, command)
	return current.TerminalSession, nil
}

func (m *TerminalManager) List() []TerminalSession {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]TerminalSession, 0, len(m.terminals))
	for _, current := range m.terminals {
		result = append(result, current.TerminalSession)
	}
	return result
}

func (m *TerminalManager) Write(id, data string) error {
	m.mu.RLock()
	current := m.terminals[id]
	if current == nil || !current.Running || current.pty == nil {
		m.mu.RUnlock()
		return errors.New("terminal session not found or not running")
	}
	_, err := current.pty.WriteString(data)
	m.mu.RUnlock()
	return err
}

func (m *TerminalManager) Resize(id string, cols, rows uint16) error {
	m.mu.RLock()
	current := m.terminals[id]
	if current == nil || !current.Running || current.pty == nil {
		m.mu.RUnlock()
		return errors.New("terminal session not found or not running")
	}
	cols, rows = terminalSize(cols, rows)
	err := pty.Setsize(current.pty, &pty.Winsize{Cols: cols, Rows: rows})
	m.mu.RUnlock()
	return err
}

func (m *TerminalManager) Stop(id string) error {
	m.mu.RLock()
	current := m.terminals[id]
	if current == nil || !current.Running || current.pty == nil {
		m.mu.RUnlock()
		return errors.New("terminal session not found or not running")
	}
	err := current.pty.Close()
	m.mu.RUnlock()
	return err
}

func (m *TerminalManager) Subscribe(id string) (string, <-chan string, func(), error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	current := m.terminals[id]
	if current == nil {
		return "", nil, nil, errors.New("terminal session not found")
	}
	history, err := os.ReadFile(current.transcriptPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", nil, nil, err
	}
	current.nextSubID++
	subscriberID := current.nextSubID
	output := make(chan string, 128)
	current.subscribers[subscriberID] = output
	return string(history), output, func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		delete(current.subscribers, subscriberID)
	}, nil
}

func (m *TerminalManager) read(current *terminal, command *exec.Cmd) {
	buffer := make([]byte, 4096)
	for {
		count, err := current.pty.Read(buffer)
		if count > 0 {
			m.recordOutput(current, string(buffer[:count]))
		}
		if err != nil {
			break
		}
	}
	_ = command.Wait()
	m.mu.Lock()
	current.Running = false
	current.pty = nil
	now := time.Now().UTC()
	current.ExitedAt = &now
	m.mu.Unlock()
	_ = m.persist(current)
	m.recordOutput(current, "\r\n[terminal exited]\r\n")
}

func (m *TerminalManager) recordOutput(current *terminal, chunk string) {
	file, err := os.OpenFile(current.transcriptPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err == nil {
		_, _ = file.WriteString(chunk)
		_ = file.Close()
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, output := range current.subscribers {
		select {
		case output <- chunk:
		default:
		}
	}
}

func (m *TerminalManager) persist(current *terminal) error {
	if err := os.MkdirAll(current.sessionDir, 0o755); err != nil {
		return err
	}
	return writeProjectJSON(filepath.Join(current.sessionDir, "session.json"), current.TerminalSession)
}

func (m *TerminalManager) load() error {
	if err := m.loadSessions(m.store.workspaceTerminalSessionsDir()); err != nil {
		return err
	}
	projects, err := m.store.List()
	if err != nil {
		return err
	}
	for _, project := range projects {
		if err := m.loadSessions(m.store.terminalSessionsDir(project.ID)); err != nil {
			return err
		}
	}
	return nil
}

func (m *TerminalManager) loadSessions(root string) error {
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		current := &terminal{sessionDir: filepath.Join(root, entry.Name()), subscribers: map[uint64]chan string{}}
		if err := readProjectJSON(filepath.Join(current.sessionDir, "session.json"), &current.TerminalSession); err != nil {
			continue
		}
		current.Running = false
		current.transcriptPath = filepath.Join(current.sessionDir, "transcript.log")
		m.terminals[current.ID] = current
	}
	return nil
}

func terminalSize(cols, rows uint16) (uint16, uint16) {
	if cols == 0 {
		cols = 100
	}
	if rows == 0 {
		rows = 30
	}
	return cols, rows
}
