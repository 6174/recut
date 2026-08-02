/*
 * [INPUT]: 依赖内嵌工作台文件系统与标准库 HTTP 静态文件服务
 * [OUTPUT]: 对外提供本地工作台静态资源、项目/App 深链壳与不可变 Next 资源缓存
 * [POS]: service 的本地 UI 传输边界；API 路由优先于此兜底，静态导出不理解业务数据
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

func localWorkspaceHandler(files fs.FS) http.Handler {
	if _, err := fs.Stat(files, "index.html"); err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "local workspace is unavailable; rebuild the service with make service-build", http.StatusServiceUnavailable)
		})
	}
	static := http.FileServer(http.FS(files))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}
		assetPath := localWorkspaceAssetPath(r.URL.Path)
		if strings.HasPrefix(assetPath, "/_next/static/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		request := r.Clone(r.Context())
		url := *r.URL
		url.Path = assetPath
		request.URL = &url
		static.ServeHTTP(w, request)
	})
}

func localWorkspaceAssetPath(requestPath string) string {
	cleaned := path.Clean("/" + requestPath)
	if localWorkspaceDynamicRoute(cleaned, "/projects/") {
		return "/projects/app/"
	}
	if localWorkspaceDynamicRoute(cleaned, "/workspace-app/") {
		return "/workspace-app/app/"
	}
	if localWorkspaceDynamicRoute(cleaned, "/apps/") {
		return "/apps/app/"
	}
	return cleaned
}

func localWorkspaceDynamicRoute(requestPath, prefix string) bool {
	segment := strings.TrimPrefix(requestPath, prefix)
	return segment != requestPath && segment != "" && !strings.Contains(segment, "/")
}
