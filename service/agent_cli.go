/*
 * [INPUT]: 依赖 Store 数据根、常驻 service PATH、当前用户的 login shell 与标准库的可执行文件检查
 * [OUTPUT]: 对外提供 AgentCommandResolver，为 Agent runtime 单飞缓存并解析可执行 CLI 的绝对路径和动态 PATH
 * [POS]: service 的 Agent 运行时环境适配器；以持久化定位缓存避免重复启动 login shell，并以用户 shell 的动态 PATH 补足 launchd/systemd 与交互 shell 的环境差异
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const agentShellLookupTimeout = 8 * time.Second

// agentNotFoundTTL bounds how long a failed CLI resolution stays cached. The
// login-shell scan can take several seconds per missing command, and the agent
// panel checks all three CLIs on every refresh; caching failures keeps those
// refreshes snappy while still picking up an install within the TTL.
const agentNotFoundTTL = 30 * time.Second

type AgentCommandDiagnostic struct {
	Command      string                 `json:"command"`
	ServicePath  string                 `json:"servicePath"`
	ResolvedPath string                 `json:"resolvedPath,omitempty"`
	Resolution   string                 `json:"resolution,omitempty"`
	Shells       []AgentShellDiagnostic `json:"shells"`
}

type AgentShellDiagnostic struct {
	Shell        string `json:"shell"`
	Path         string `json:"path,omitempty"`
	ResolvedPath string `json:"resolvedPath,omitempty"`
	Error        string `json:"error,omitempty"`
}

type AgentProcessCommand struct {
	Path string
	Env  []string
}

type agentCommandCacheEntry struct {
	Path       string   `json:"path"`
	Env        []string `json:"env,omitempty"`
	Resolution string   `json:"resolution,omitempty"`
}

type agentCommandCache struct {
	Commands map[string]agentCommandCacheEntry `json:"commands"`
}

// AgentCommandResolver keeps the expensive login-shell lookup out of normal
// UI refreshes. A cached path is trusted only while it remains executable.
type AgentCommandResolver struct {
	path      string
	mu        sync.Mutex
	loaded    bool
	commands  map[string]agentCommandCacheEntry
	notFound  map[string]time.Time
	resolving map[string]*agentCommandLookup
	resolve   func(string) AgentCommandDiagnostic
}

type agentCommandLookup struct {
	done    chan struct{}
	process AgentProcessCommand
	err     error
}

func newAgentCommandResolver(root string) *AgentCommandResolver {
	return &AgentCommandResolver{
		path:      filepath.Join(root, "config", "agent-commands.json"),
		commands:  map[string]agentCommandCacheEntry{},
		notFound:  map[string]time.Time{},
		resolving: map[string]*agentCommandLookup{},
		resolve:   func(command string) AgentCommandDiagnostic { return resolveAgentCommand(command, false) },
	}
}

func (r *AgentCommandResolver) Find(command string) (AgentProcessCommand, error) {
	if !isAgentCommand(command) {
		return AgentProcessCommand{}, exec.ErrNotFound
	}
	r.mu.Lock()
	r.loadLocked()
	if process, ok := agentCommandFromCache(r.commands[command]); ok {
		r.mu.Unlock()
		return process, nil
	}
	if at, ok := r.notFound[command]; ok && time.Since(at) < agentNotFoundTTL {
		r.mu.Unlock()
		return AgentProcessCommand{}, exec.ErrNotFound
	}
	if lookup := r.resolving[command]; lookup != nil {
		r.mu.Unlock()
		<-lookup.done
		return lookup.process, lookup.err
	}
	delete(r.commands, command)
	delete(r.notFound, command)
	lookup := &agentCommandLookup{done: make(chan struct{})}
	r.resolving[command] = lookup
	r.mu.Unlock()
	return r.resolveAndCache(command, lookup)
}

func (r *AgentCommandResolver) resolveAndCache(command string, lookup *agentCommandLookup) (AgentProcessCommand, error) {
	entry, ok := agentCommandEntry(r.resolve(command))
	r.mu.Lock()
	delete(r.resolving, command)
	if ok {
		r.commands[command] = entry
		delete(r.notFound, command)
		_ = r.saveLocked()
		lookup.process, _ = agentCommandFromCache(entry)
	} else {
		r.notFound[command] = time.Now().UTC()
		lookup.err = exec.ErrNotFound
	}
	close(lookup.done)
	r.mu.Unlock()
	return lookup.process, lookup.err
}

func agentCommandEntry(diagnostic AgentCommandDiagnostic) (agentCommandCacheEntry, bool) {
	if diagnostic.ResolvedPath == "" {
		return agentCommandCacheEntry{}, false
	}
	path, err := filepath.Abs(diagnostic.ResolvedPath)
	if err != nil || !isExecutableFile(path) {
		return agentCommandCacheEntry{}, false
	}
	entry := agentCommandCacheEntry{Path: path, Resolution: diagnostic.Resolution}
	for _, shell := range diagnostic.Shells {
		if shell.ResolvedPath == path && shell.Path != "" {
			entry.Env = []string{"PATH=" + shell.Path}
			break
		}
	}
	return entry, true
}

func (r *AgentCommandResolver) Available(command string) (AgentProcessCommand, bool) {
	process, err := r.Find(command)
	return process, err == nil
}

func (r *AgentCommandResolver) Invalidate(command string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.loadLocked()
	delete(r.commands, command)
	delete(r.notFound, command)
	_ = r.saveLocked()
}

func (r *AgentCommandResolver) Start(ctx context.Context, command string, arguments []string, directory string, overrides []string) (*exec.Cmd, io.ReadCloser, io.ReadCloser, error) {
	var startError error
	for attempt := 0; attempt < 2; attempt++ {
		process, err := r.Find(command)
		if err != nil {
			return nil, nil, nil, err
		}
		cmd := exec.CommandContext(ctx, process.Path, arguments...)
		cmd.Dir = directory
		environment := append([]string{}, process.Env...)
		environment = append(environment, overrides...)
		cmd.Env = environmentWithOverrides(os.Environ(), environment)
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			return nil, nil, nil, err
		}
		stderr, err := cmd.StderrPipe()
		if err != nil {
			return nil, nil, nil, err
		}
		if err := cmd.Start(); err == nil {
			return cmd, stdout, stderr, nil
		} else {
			startError = err
		}
		_ = stdout.Close()
		_ = stderr.Close()
		r.Invalidate(command)
	}
	return nil, nil, nil, fmt.Errorf("start %s after resolving its CLI location: %w", command, startError)
}

func agentCommandFromCache(entry agentCommandCacheEntry) (AgentProcessCommand, bool) {
	if !filepath.IsAbs(entry.Path) || !isExecutableFile(entry.Path) {
		return AgentProcessCommand{}, false
	}
	return AgentProcessCommand{Path: entry.Path, Env: entry.Env}, true
}

func (r *AgentCommandResolver) loadLocked() {
	if r.loaded {
		return
	}
	r.loaded = true
	data, err := os.ReadFile(r.path)
	if err != nil {
		return
	}
	cache := agentCommandCache{}
	if json.Unmarshal(data, &cache) == nil && cache.Commands != nil {
		r.commands = cache.Commands
	}
}

func (r *AgentCommandResolver) saveLocked() error {
	directory := filepath.Dir(r.path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(agentCommandCache{Commands: r.commands}, "", "  ")
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, ".agent-commands-")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(append(data, '\n')); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, r.path)
}

func inspectAgentCommand(command string) AgentCommandDiagnostic {
	return resolveAgentCommand(command, true)
}

func resolveAgentCommand(command string, inspectShells bool) AgentCommandDiagnostic {
	diagnostic := AgentCommandDiagnostic{Command: command, ServicePath: os.Getenv("PATH"), Shells: []AgentShellDiagnostic{}}
	if !isAgentCommand(command) {
		return diagnostic
	}
	if path, err := exec.LookPath(command); err == nil {
		diagnostic.ResolvedPath, diagnostic.Resolution = path, "service PATH"
		if !inspectShells {
			return diagnostic
		}
	}
	for _, shell := range agentShells() {
		shellDiagnostic := inspectAgentCommandInShell(shell, command)
		diagnostic.Shells = append(diagnostic.Shells, shellDiagnostic)
		if diagnostic.ResolvedPath == "" && shellDiagnostic.ResolvedPath != "" {
			diagnostic.ResolvedPath = shellDiagnostic.ResolvedPath
			diagnostic.Resolution = "login shell " + shell
		}
		if diagnostic.ResolvedPath != "" && !inspectShells {
			return diagnostic
		}
	}
	return diagnostic
}

func inspectAgentCommandInShell(shell, command string) AgentShellDiagnostic {
	diagnostic := AgentShellDiagnostic{Shell: shell}
	if runtime.GOOS == "windows" || !isExecutableFile(shell) || !isAgentCommand(command) {
		diagnostic.Error = "shell is unavailable"
		return diagnostic
	}
	ctx, cancel := context.WithTimeout(context.Background(), agentShellLookupTimeout)
	defer cancel()
	output, err := exec.CommandContext(ctx, shell, "-lic", "printf '__RECUT_PATH__%s\\n' \"$PATH\"; command -v -- "+command).CombinedOutput()
	diagnostic.Path = agentShellPathFromOutput(string(output))
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			diagnostic.Error = "shell startup exceeded 8 seconds before command lookup completed"
			return diagnostic
		}
		diagnostic.Error = err.Error()
		return diagnostic
	}
	diagnostic.ResolvedPath = agentCommandPathFromOutput(command, string(output))
	if diagnostic.ResolvedPath == "" {
		diagnostic.Error = "command was not found in shell PATH"
	}
	return diagnostic
}

func agentShells() []string {
	candidates := []string{os.Getenv("SHELL"), "/bin/zsh", "/bin/bash", "/bin/sh"}
	shells := make([]string, 0, len(candidates))
	seen := map[string]bool{}
	for _, shell := range candidates {
		if shell != "" && !seen[shell] {
			seen[shell] = true
			shells = append(shells, shell)
		}
	}
	return shells
}

func isAgentCommand(command string) bool {
	for _, character := range command {
		if !(character == '-' || character == '_' || character >= 'a' && character <= 'z') {
			return false
		}
	}
	return command != ""
}

func agentCommandPathFromOutput(command, output string) string {
	for _, field := range strings.Fields(output) {
		if filepath.Base(field) == command && filepath.IsAbs(field) && isExecutableFile(field) {
			return field
		}
	}
	return ""
}

func agentShellPathFromOutput(output string) string {
	const marker = "__RECUT_PATH__"
	for _, line := range strings.Split(output, "\n") {
		if strings.HasPrefix(line, marker) {
			return strings.TrimSpace(strings.TrimPrefix(line, marker))
		}
	}
	return ""
}

func isExecutableFile(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return runtime.GOOS == "windows" || info.Mode()&0o111 != 0
}

func environmentWithOverrides(environment, overrides []string) []string {
	replaced := make(map[string]bool, len(overrides))
	for _, override := range overrides {
		name, _, found := strings.Cut(override, "=")
		if found {
			replaced[name] = true
		}
	}
	merged := make([]string, 0, len(environment)+len(overrides))
	for _, value := range environment {
		name, _, found := strings.Cut(value, "=")
		if !found || !replaced[name] {
			merged = append(merged, value)
		}
	}
	return append(merged, overrides...)
}
