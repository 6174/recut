/*
 * [INPUT]: 依赖本目录的 Catalog、Store、MediaService、TerminalManager、Server 和标准库运行时能力
 * [OUTPUT]: 对外提供含内嵌局域网工作台、内置 App 启动同步与进程启动时间 health 的 recut shell service 可执行程序入口、隔离短请求与事件流的双 HTTP 监听、启动同步的 Recut Skill、注入媒体能力的 AppHost、服务重启后 Agent 状态收敛、常驻媒体任务调度与 SIGINT/SIGTERM 优雅关停组合
 * [POS]: service 的组合根；只负责运行时配置、能力装配、平台 scope/Skill 初始化、长生命周期媒体回收启动和进程关停，不承载领域逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
)

// serviceVersion 在发布构建时由 Makefile 注入。开发态保留可读标记，
// 使远程工作台不会把正在运行的源码服务误判为过期版本。
var serviceVersion = "dev"

// serviceStartedAt 在进程初始化时固定下来，供 health API 和浏览器确认重启完成。
var serviceStartedAt = time.Now().UTC()

func main() {
	dataDir := flag.String("data-dir", defaultDataDir(), "local Recut data directory")
	appsDir := flag.String("apps-dir", "", "directory containing App packages (default: <data-dir>/apps)")
	address := flag.String("address", ":17373", "LAN HTTP address")
	streamAddress := flag.String("stream-address", ":17374", "LAN HTTP address reserved for browser event streams")
	mcpForward := flag.Bool("mcp", false, "forward stdio MCP to the running Recut daemon (single persistent MCP host)")
	mcpTarget := flag.String("mcp-target", defaultMCPTarget, "Recut daemon HTTP origin for --mcp forwarding")
	flag.Parse()
	if err := configureServiceLogging(*dataDir); err != nil {
		log.Fatalf("ERROR configure service logging: %v", err)
	}
	if *mcpForward {
		// 短生命周期、无状态转发器：只把外部/会话 Agent 的 stdio JSON-RPC
		// 转发到常驻 daemon，绝不做状态收敛（RecoverInterrupted 等只允许
		// daemon 在启动时执行），因此这里必须在任何 Recover* 之前返回。
		if err := RunMCPForward(*mcpTarget, os.Stdin, os.Stdout); err != nil {
			log.Fatalf("ERROR run MCP forwarder: %v", err)
		}
		return
	}
	if *appsDir == "" {
		*appsDir = filepath.Join(*dataDir, "apps")
	}
	if err := activateManagedToolPath(*dataDir); err != nil {
		log.Printf("WARN activate managed tools: %v", err)
	}

	if err := os.MkdirAll(*appsDir, 0o755); err != nil {
		log.Fatalf("ERROR create apps directory: %v", err)
	}
	builtinApps := NewBuiltinAppManager(*appsDir)
	if err := builtinApps.Ensure(); err != nil {
		log.Fatalf("ERROR synchronize built-in Apps: %v", err)
	}
	skillManager := NewRecutSkillManager(*dataDir)
	if err := skillManager.Ensure(); err != nil {
		log.Fatalf("ERROR synchronize Recut Skill: %v", err)
	}
	if err := skillManager.EnableDefaultTargets(); err != nil {
		log.Printf("WARN enable Recut Skill targets: %v", err)
	}
	designSystemManager := NewDesignSystemManager(*dataDir)
	if err := designSystemManager.Ensure(); err != nil {
		log.Printf("WARN synchronize design-system Skill: %v", err)
	}
	if err := designSystemManager.EnableDefaultTargets(); err != nil {
		log.Printf("WARN enable design-system Skill targets: %v", err)
	}
	apps, err := LoadCatalog(*appsDir)
	if err != nil {
		log.Fatalf("ERROR load app catalog: %v", err)
	}
	store := NewStore(*dataDir, apps)
	if err := store.Ensure(); err != nil {
		log.Fatalf("ERROR initialize workspace store: %v", err)
	}
	media := NewMediaService(store)
	bridge := NewAgentBridge(store)
	bridge.SetDesignSystemManager(designSystemManager)
	host := NewAppHost(apps, store, media)
	if recovered, err := host.jobs.RecoverInterrupted(); err != nil {
		log.Fatalf("ERROR recover interrupted shell jobs: %v", err)
	} else if recovered > 0 {
		log.Printf("INFO reconciled interrupted shell jobs count=%d", recovered)
	}
	if recovered, err := media.RecoverInterruptedJobs(); err != nil {
		log.Fatalf("ERROR recover interrupted media jobs: %v", err)
	} else if recovered > 0 {
		log.Printf("INFO reconciled interrupted media jobs count=%d", recovered)
	}
	// The daemon, not a short-lived MCP child or browser, owns remote task
	// recovery. It discovers newly submitted durable jobs and keeps their
	// Asset state current until each provider reaches a terminal result.
	stopMediaReconciler := media.StartReconciler(5 * time.Second)
	defer stopMediaReconciler()
	terminals, err := NewTerminalManager(store)
	if err != nil {
		log.Fatalf("ERROR initialize terminal manager: %v", err)
	}
	agents := NewAgentManager(store, bridge, media)
	bridge.SetAgentManager(agents)
	if recovered, err := agents.RecoverInterruptedTurns(); err != nil {
		log.Fatalf("ERROR recover interrupted agent turns: %v", err)
	} else if recovered > 0 {
		log.Printf("INFO reconciled interrupted agent turns count=%d", recovered)
	}
	service := NewServer(apps, store, terminals, bridge, agents, host, media, NewServiceUpdater())
	service.StartRealtimeForwarders(context.Background())
	server := service.HTTPServer(*address)
	streamServer := service.StreamHTTPServer(*streamAddress)
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)

	log.Printf("INFO Recut local workspace and API listening on http://%s (event streams http://%s)", *address, *streamAddress)
	if err := serveHTTPServersUntilSignal([]*http.Server{server, streamServer}, signals); err != nil {
		log.Fatalf("ERROR serve HTTP API: %v", err)
	}
}

func activateManagedToolPath(dataDir string) error {
	platformVenv := filepath.Join(dataDir, "python", "platform", platformPythonVersion)
	bin := filepath.Join(platformVenv, "bin")
	ffmpeg := "ffmpeg"
	if runtime.GOOS == "windows" {
		bin = filepath.Join(platformVenv, "Scripts")
		ffmpeg = "ffmpeg.exe"
	}
	if _, err := os.Stat(filepath.Join(bin, ffmpeg)); err != nil {
		return err
	}
	path := os.Getenv("PATH")
	if path == "" {
		return os.Setenv("PATH", bin)
	}
	return os.Setenv("PATH", bin+string(os.PathListSeparator)+path)
}

func serveUntilSignal(server *http.Server, signals <-chan os.Signal) error {
	return serveHTTPServersUntilSignal([]*http.Server{server}, signals)
}

func serveHTTPServersUntilSignal(servers []*http.Server, signals <-chan os.Signal) error {
	serveErr := make(chan error, len(servers))
	for _, server := range servers {
		go func(server *http.Server) { serveErr <- server.ListenAndServe() }(server)
	}
	shutdown := func() error {
		shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		for _, server := range servers {
			if err := server.Shutdown(shutdownContext); err != nil {
				return err
			}
		}
		return nil
	}

	select {
	case err := <-serveErr:
		if shutdownErr := shutdown(); shutdownErr != nil {
			return shutdownErr
		}
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case received := <-signals:
		log.Printf("INFO received signal=%s; shutting down HTTP service", received)
		if err := shutdown(); err != nil {
			return err
		}
		for range servers {
			if err := <-serveErr; !errors.Is(err, http.ErrServerClosed) {
				return err
			}
		}
		return nil
	}
}

func ServiceVersion() string { return serviceVersion }

func defaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".recut"
	}
	return filepath.Join(home, ".recut")
}
