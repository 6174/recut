/*
 * [INPUT]: 依赖内存静态文件系统与本地工作台 HTTP 处理器
 * [OUTPUT]: 验证首页、项目/App 深链、Next 不可变缓存与静态文件边界
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
		"index.html":              {Data: []byte("home")},
		"projects/app/index.html": {Data: []byte("project")},
		"apps/app/index.html":     {Data: []byte("app")},
		"_next/static/chunk.js":   {Data: []byte("chunk")},
	}
	handler := localWorkspaceHandler(files)
	for requestPath, want := range map[string]string{"/": "home", "/projects/first": "project", "/apps/example": "app", "/_next/static/chunk.js": "chunk"} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, requestPath, nil))
		if recorder.Code != http.StatusOK || recorder.Body.String() != want {
			t.Fatalf("GET %s = %d %q", requestPath, recorder.Code, recorder.Body.String())
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
