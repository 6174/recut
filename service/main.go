/*
 * [INPUT]: 依赖本目录的 Catalog、Store、MediaService、TerminalManager、Server 和标准库运行时能力
 * [OUTPUT]: 对外提供 recut 本地 shell service 可执行程序入口、注入媒体能力的 AppHost、Agent Session Host 与常驻媒体任务调度组合
 * [POS]: service 的组合根；只负责运行时配置、能力装配和长生命周期媒体回收启动，不承载领域逻辑
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

func main() {
	dataDir := flag.String("data-dir", defaultDataDir(), "local Recut data directory")
	appsDir := flag.String("apps-dir", "", "directory containing App packages (default: <data-dir>/apps)")
	address := flag.String("address", "127.0.0.1:17373", "loopback API address")
	mcpStdio := flag.Bool("mcp-stdio", false, "serve the App Agent Bridge over stdio")
	flag.Parse()
	if *appsDir == "" {
		*appsDir = filepath.Join(*dataDir, "apps")
	}

	if err := os.MkdirAll(*appsDir, 0o755); err != nil {
		log.Fatal(err)
	}
	apps, err := LoadCatalog(*appsDir)
	if err != nil {
		log.Fatal(err)
	}
	store := NewStore(*dataDir, apps)
	if err := store.Ensure(); err != nil {
		log.Fatal(err)
	}
	if _, err := store.EnsureMediaSystemProject(); err != nil {
		log.Fatal(err)
	}
	media := NewMediaService(store)
	bridge := NewAgentBridge(store)
	host := NewAppHost(apps, store, media)
	if *mcpStdio {
		if err := RunMCPStdio(bridge, host, media, os.Stdin, os.Stdout); err != nil {
			log.Fatal(err)
		}
		return
	}
	if recovered, err := media.RecoverInterruptedJobs(); err != nil {
		log.Fatal(err)
	} else if recovered > 0 {
		log.Printf("Reconciled %d interrupted media job(s)", recovered)
	}
	// The daemon, not a short-lived MCP child or browser, owns remote task
	// recovery. It discovers newly submitted durable jobs and keeps their
	// Asset state current until each provider reaches a terminal result.
	stopMediaReconciler := media.StartReconciler(5 * time.Second)
	defer stopMediaReconciler()
	terminals, err := NewTerminalManager(store)
	if err != nil {
		log.Fatal(err)
	}
	agents := NewAgentManager(store, bridge, media)
	log.Printf("Recut local API listening on http://%s", *address)
	log.Fatal(NewServer(apps, store, terminals, bridge, agents, host, media, NewServiceUpdater()).ListenAndServe(*address))
}

func ServiceVersion() string { return serviceVersion }

func defaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".recut"
	}
	return filepath.Join(home, ".recut")
}
