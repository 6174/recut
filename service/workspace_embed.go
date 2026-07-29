/*
 * [INPUT]: 依赖 Go embed 与 ui/assets 中由 Makefile 生成的本地工作台静态导出
 * [OUTPUT]: 对外提供供 HTTP 静态处理器读取的内嵌工作台文件系统
 * [POS]: service 的发布资源边界；把本地 UI 随同 daemon 二进制更新，不包含 Cloudflare 安装包
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"embed"
	"io/fs"
)

//go:embed all:ui/assets
var embeddedWorkspace embed.FS

func localWorkspaceFiles() fs.FS {
	assets, err := fs.Sub(embeddedWorkspace, "ui/assets")
	if err != nil {
		panic(err)
	}
	return assets
}
