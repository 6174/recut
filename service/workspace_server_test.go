/*
 * [INPUT]: 依赖内存静态文件系统与本地工作台 HTTP 处理器
 * [OUTPUT]: 验证首页、顶层 Tab 与 World/项目/App 深链无相对重定向、Next 不可变缓存与静态文件边界
 * [POS]: service 本地工作台传输层回归测试；不依赖真实 Next 构建或网络端口
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestLocalWorkspaceHandlerServesStaticAndDynamicShells(t *testing.T) {
	files := fstest.MapFS{
		"index.html":                   {Data: []byte("home")},
		"apps/index.html":              {Data: []byte("apps")},
		"media/index.html":             {Data: []byte("media")},
		"projects/index.html":          {Data: []byte("projects")},
		"projects/app/index.html":      {Data: []byte("project")},
		"workspace-app/app/index.html": {Data: []byte("workspace app")},
		"apps/app/index.html":          {Data: []byte("app")},
		"worlds/index.html":            {Data: []byte("worlds")},
		"worlds/app/index.html":        {Data: []byte("world")},
		"_next/static/chunk.js":        {Data: []byte("chunk")},
	}
	handler := localWorkspaceHandler(files)
	for requestPath, want := range map[string]string{
		"/":                      "home",
		"/apps":                  "apps",
		"/apps/":                 "apps",
		"/media":                 "media",
		"/projects":              "projects",
		"/projects/":             "projects",
		"/projects/first":        "project",
		"/workspace-app/example": "workspace app",
		"/apps/example":          "app",
		"/worlds":                "worlds",
		"/worlds/":               "worlds",
		"/worlds/cw-01":          "world",
		"/_next/static/chunk.js": "chunk",
	} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, requestPath, nil))
		if recorder.Code != http.StatusOK || recorder.Body.String() != want {
			t.Fatalf("GET %s = %d %q", requestPath, recorder.Code, recorder.Body.String())
		}
		if location := recorder.Header().Get("Location"); location != "" {
			t.Fatalf("GET %s unexpectedly redirected to %q", requestPath, location)
		}
	}

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/_next/static/chunk.js", nil))
	if recorder.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("static cache control = %q", recorder.Header().Get("Cache-Control"))
	}
}

func TestLocalWorkspaceHandlerRejectsUnknownMethods(t *testing.T) {
	handler := localWorkspaceHandler(fstest.MapFS{"index.html": {Data: []byte("home")}})
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/", strings.NewReader("ignored")))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("POST / = %d", recorder.Code)
	}
}
