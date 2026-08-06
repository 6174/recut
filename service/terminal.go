/*
 * [INPUT]: 依赖 Store 的项目会话目录、creack/pty 的伪终端、userBaseEnv 用户 shell 环境和标准库进程管理能力
 * [OUTPUT]: 对外提供 TerminalManager 及会话的启动、输入、尺寸、输出订阅、最新消息摘要、持久化、无参数启动/退出审计和终止能力
 * [POS]: service 的通用终端包装层；不理解 Codex、Claude 或任何具体 CLI 语义
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
)

type TerminalStart struct {
	ProjectID    string
	Command      string
	Args         []string
	CWD          string
	SessionDir   string
	Cols         uint16
	Rows         uint16
	Env          []string
	InitialInput string
	ManagedBy    string
}

type TerminalSession struct {
	ID             string     `json:"id"`
	ProjectID      string     `json:"projectId"`
	Command        string     `json:"command"`
	Args           []string   `json:"args"`
	CWD            string     `json:"cwd"`
	Running        bool       `json:"running"`
	StartedAt      time.Time  `json:"startedAt"`
	LastActivityAt *time.Time `json:"lastActivityAt,omitempty"`
	LastMessage    string     `json:"lastMessage,omitempty"`
	ExitedAt       *time.Time `json:"exitedAt,omitempty"`
	ManagedBy      string     `json:"managedBy,omitempty"`
}

type terminal struct {
	TerminalSession
	pty            *os.File
	sessionDir     string
	transcriptPath string
	previewBuffer  string
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
	command.Env = append(userBaseEnv(), input.Env...)
	file, err := pty.StartWithSize(command, &pty.Winsize{Cols: cols, Rows: rows})
	if err != nil {
		return TerminalSession{}, fmt.Errorf("start terminal: %w", err)
	}
	current := &terminal{
		TerminalSession: TerminalSession{ID: id, ProjectID: input.ProjectID, Command: input.Command, Args: input.Args, CWD: input.CWD, Running: true, StartedAt: time.Now().UTC(), ManagedBy: input.ManagedBy},
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
	if input.InitialInput != "" {
		_, _ = file.WriteString(input.InitialInput)
	}
	log.Printf("INFO terminal started terminal_id=%s project_id=%s command=%s", current.ID, current.ProjectID, current.Command)
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
	m.mu.RLock()
	current := m.terminals[id]
	if current == nil {
		m.mu.RUnlock()
		return "", nil, nil, errors.New("terminal session not found")
	}
	transcriptPath := current.transcriptPath
	m.mu.RUnlock()
	history, err := os.ReadFile(transcriptPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", nil, nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.terminals[id] != current {
		return "", nil, nil, errors.New("terminal session changed during subscription")
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
	log.Printf("INFO terminal exited terminal_id=%s project_id=%s command=%s", current.ID, current.ProjectID, current.Command)
	m.recordOutput(current, "\r\n[terminal exited]\r\n")
}

func (m *TerminalManager) recordOutput(current *terminal, chunk string) {
	file, err := os.OpenFile(current.transcriptPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err == nil {
		_, _ = file.WriteString(chunk)
		_ = file.Close()
	}
	if m.recordPreview(current, chunk) {
		_ = m.persist(current)
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

func (m *TerminalManager) recordPreview(current *terminal, chunk string) bool {
	lines, tail := terminalLines(current.previewBuffer + stripTerminalControlCodes(chunk))
	current.previewBuffer = tail
	if len(current.previewBuffer) > 512 {
		current.previewBuffer = current.previewBuffer[len(current.previewBuffer)-512:]
	}
	if tail != "" {
		lines = append(lines, tail)
	}
	message := latestMessage(lines)
	if message == "" {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if current.LastMessage == message {
		return false
	}
	now := time.Now().UTC()
	current.LastMessage = message
	current.LastActivityAt = &now
	return true
}

func (m *TerminalManager) persist(current *terminal) error {
	m.mu.RLock()
	session, sessionDir := current.TerminalSession, current.sessionDir
	m.mu.RUnlock()
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return err
	}
	return writeProjectJSON(filepath.Join(sessionDir, "session.json"), session)
}

func (m *TerminalManager) load() error {
	return m.loadSessions(m.store.TerminalSessionsDir())
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
		if current.LastMessage == "" {
			if transcript, err := os.ReadFile(current.transcriptPath); err == nil {
				lines, tail := terminalLines(stripTerminalControlCodes(string(transcript)))
				if tail != "" {
					lines = append(lines, tail)
				}
				current.LastMessage = latestMessage(lines)
			}
		}
		m.terminals[current.ID] = current
	}
	return nil
}

var ansiSequence = regexp.MustCompile(`\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\a]*(?:\a|\x1b\\))`)

func stripTerminalControlCodes(value string) string {
	value = ansiSequence.ReplaceAllString(value, "")
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' || r >= 32 {
			return r
		}
		return -1
	}, value)
}

func terminalLines(value string) ([]string, string) {
	parts := strings.Split(value, "\n")
	if len(parts) == 1 {
		return nil, parts[0]
	}
	return parts[:len(parts)-1], parts[len(parts)-1]
}

func latestMessage(lines []string) string {
	for index := len(lines) - 1; index >= 0; index-- {
		line := strings.Join(strings.Fields(strings.TrimSpace(lines[index])), " ")
		if len([]rune(line)) < 3 || strings.HasPrefix(line, ">") || strings.HasPrefix(line, "$") || line == "[terminal exited]" || strings.Contains(strings.ToLower(line), "esc to interrupt") {
			continue
		}
		if len([]rune(line)) > 180 {
			return string([]rune(line)[:177]) + "..."
		}
		return line
	}
	return ""
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
