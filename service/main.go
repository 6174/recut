/*
 * [INPUT]: 依赖本目录的 Catalog、Store、TerminalManager、Server 和标准库运行时能力
 * [OUTPUT]: 对外提供 recut 本地 shell service 可执行程序入口
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
	flag.Parse()

	apps, err := LoadCatalog(*appsDir)
	if err != nil {
		log.Fatal(err)
	}
	store := NewStore(*dataDir, apps)
	if err := store.Ensure(); err != nil {
		log.Fatal(err)
	}
	terminals, err := NewTerminalManager(store)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Recut local API listening on http://%s", *address)
	log.Fatal(NewServer(apps, store, terminals).ListenAndServe(*address))
}

func defaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".recutvideo"
	}
	return filepath.Join(home, ".recutvideo")
}
