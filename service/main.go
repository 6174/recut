/*
 * [INPUT]: 依赖本目录的 Catalog、Store、TerminalManager、Server 和标准库运行时能力
 * [OUTPUT]: 对外提供 recut 本地 shell service 可执行程序入口与 Agent Session Host 组合
 * [POS]: service 的组合根，负责运行时配置而不承载领域逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"flag"
	"log"
	"os"
	"path/filepath"
)

func main() {
	dataDir := flag.String("data-dir", defaultDataDir(), "local Recut data directory")
	appsDir := flag.String("apps-dir", "../apps", "directory containing App packages")
	address := flag.String("address", "127.0.0.1:17373", "loopback API address")
	mcpStdio := flag.Bool("mcp-stdio", false, "serve the App Agent Bridge over stdio")
	flag.Parse()

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
	bridge := NewAgentBridge(store)
	host := NewAppHost(apps, store)
	media := NewMediaService(store)
	if recovered, err := media.RecoverInterruptedJobs(); err != nil {
		log.Fatal(err)
	} else if recovered > 0 {
		log.Printf("Marked %d interrupted media job(s) as failed", recovered)
	}
	if *mcpStdio {
		if err := RunMCPStdio(bridge, host, media, os.Stdin, os.Stdout); err != nil {
			log.Fatal(err)
		}
		return
	}
	terminals, err := NewTerminalManager(store)
	if err != nil {
		log.Fatal(err)
	}
	agents := NewAgentManager(store, bridge, media)
	log.Printf("Recut local API listening on http://%s", *address)
	log.Fatal(NewServer(apps, store, terminals, bridge, agents, host, media).ListenAndServe(*address))
}

func defaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".recutvideo"
	}
	return filepath.Join(home, ".recutvideo")
}
