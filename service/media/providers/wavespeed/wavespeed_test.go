/*
 * [INPUT]: 依赖 WaveSpeed 适配器的媒体上传与受控 HTTP 测试客户端
 * [OUTPUT]: 验证媒体上传走两项式票据流程：POST /api/v3/media/uploads 领票后 PUT 字节
 * [POS]: wavespeed provider 的媒体上传协议回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package wavespeed

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUploadMediaUsesTicketFlow(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v3/media/uploads":
			if request.Method != http.MethodPost || request.Header.Get("Authorization") != "Bearer ws-key" || request.Header.Get("Content-Type") != "application/json" {
				t.Fatalf("unexpected ticket request: %s %#v", request.URL, request.Header)
			}
			_, _ = fmt.Fprintf(w, `{"code":200,"message":"success","data":{"download_url":"https://storage.example/audio.mp3","upload":{"method":"PUT","url":%q,"headers":{"Content-Type":"audio/mpeg"}}}}`, server.URL+"/storage/audio.mp3")
		case "/storage/audio.mp3":
			if request.Method != http.MethodPut {
				t.Fatalf("storage request method = %s", request.Method)
			}
			if request.Header.Get("Authorization") != "" {
				t.Fatal("the WaveSpeed credential must not be forwarded to the storage URL")
			}
			if request.Header.Get("Content-Type") != "audio/mpeg" {
				t.Fatalf("storage headers = %#v", request.Header)
			}
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
		}
	}))
	defer server.Close()

	url, err := UploadMedia(server.Client(), server.URL, "ws-key", MediaUpload{Name: "generated.mp3", ContentType: "audio/mpeg", Content: []byte("ID3audio")})
	if err != nil || url != "https://storage.example/audio.mp3" {
		t.Fatalf("UploadMedia() = %q, %v", url, err)
	}
}

func TestUploadMediaRejectsTicketWithoutUploadURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		_, _ = w.Write([]byte(`{"code":200,"message":"success","data":{"download_url":"https://storage.example/audio.mp3"}}`))
	}))
	defer server.Close()

	if _, err := UploadMedia(server.Client(), server.URL, "ws-key", MediaUpload{Name: "generated.mp3", ContentType: "audio/mpeg", Content: []byte("ID3audio")}); err == nil {
		t.Fatal("a ticket without an upload URL must be rejected")
	}
}
