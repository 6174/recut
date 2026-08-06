/*
 * [INPUT]: 依赖本目录的 Catalog、Store、MediaService、TerminalManager、Server 和标准库运行时能力
 * [OUTPUT]: 对外提供含内嵌局域网工作台与进程启动时间 health 的 recut shell service 可执行程序入口、注入媒体能力的 AppHost、服务重启后 Agent 状态收敛与常驻媒体任务调度组合
 * [POS]: service 的组合根；只负责运行时配置、能力装配、平台 scope 初始化和长生命周期媒体回收启动，不承载领域逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"flag"
	"log"
	"os"
	"path/filepath"
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

	if err := os.MkdirAll(*appsDir, 0o755); err != nil {
		log.Fatalf("ERROR create apps directory: %v", err)
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
	if recovered, err := agents.RecoverInterruptedTurns(); err != nil {
		log.Fatalf("ERROR recover interrupted agent turns: %v", err)
	} else if recovered > 0 {
		log.Printf("INFO reconciled interrupted agent turns count=%d", recovered)
	}
	log.Printf("INFO Recut local workspace and API listening on http://%s", *address)
	if err := NewServer(apps, store, terminals, bridge, agents, host, media, NewServiceUpdater()).ListenAndServe(*address); err != nil {
		log.Fatalf("ERROR serve HTTP API: %v", err)
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
