/*
 * [INPUT]: 依赖 mcp.go 的平台工具定义、Store 与本地 HTTP 测试服务
 * [OUTPUT]: 锁定 recut.context 不携带项目默认值、按媒体类型拆分的 MCP 工具名称、终态等待输入 schema、按全局/App 分组的工具清单（GET /v1/mcp/tools）、数组型 structuredContent 的 record 包装，以及长图片请求不阻塞素材查询
 * [POS]: service MCP Host 的公开工具契约与并发回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestMediaMCPToolDefinitionsSeparateGenerationContracts(t *testing.T) {
	tools := map[string]map[string]any{}
	for _, tool := range mediaMCPToolDefinitions(DefaultLocale) {
		tools[tool["name"].(string)] = tool
	}
	for _, name := range []string{"recut.media.generate", "recut.media.generate_async", "recut.video.generate_async", "recut.speech.generate_async"} {
		if _, exists := tools[name]; exists {
			t.Fatalf("legacy async/multiplexed tool %q must not be exposed", name)
		}
	}
	for _, name := range []string{"recut.image.generate", "recut.video.generate", "recut.speech.generate", "recut.media.wait_for_job", "recut.media.import_image"} {
		tool, ok := tools[name]
		if !ok {
			t.Fatalf("missing media tool %q", name)
		}
		schema := tool["inputSchema"].(map[string]any)
		properties := schema["properties"].(map[string]any)
		if _, exists := properties["capability"]; exists {
			t.Fatalf("%s must encode its capability in the tool name", name)
		}
		if name != "recut.media.import_image" && name != "recut.media.wait_for_job" {
			if _, exists := properties["text"]; !exists {
				t.Fatalf("%s must require text", name)
			}
		}
		if name == "recut.media.import_image" {
			if _, exists := properties["path"]; !exists {
				t.Fatalf("%s must require a project-relative path", name)
			}
		}
		if name == "recut.media.wait_for_job" {
			if _, exists := properties["jobId"]; !exists {
				t.Fatalf("%s must require a jobId", name)
			}
		}
	}
	video := tools["recut.video.generate"]["inputSchema"].(map[string]any)["properties"].(map[string]any)
	if _, ok := video["imageAssetIds"]; !ok {
		t.Fatal("video generation must accept image references")
	}
	if _, ok := video["audioAssetIds"]; !ok {
		t.Fatal("video generation must accept audio references")
	}
	if _, ok := video["videoAssetIds"]; !ok {
		t.Fatal("video generation must accept video references")
	}
	speech := tools["recut.speech.generate"]["inputSchema"].(map[string]any)["properties"].(map[string]any)
	if _, ok := speech["imageAssetIds"]; ok {
		t.Fatal("speech generation must not advertise image references")
	}
	if _, ok := speech["voiceId"]; !ok {
		t.Fatal("speech generation must expose a voiceId")
	}
	if _, ok := tools["recut.media.list_voices"]; !ok {
		t.Fatal("speech generation must expose voice discovery")
	}
}

func TestProjectMCPToolCreatesListedProject(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(CreateInput{Name: "Source", AppID: "example.app"}); err != nil {
		t.Fatal(err)
	}
	result, err := handleMCP(NewAgentBridge(store), NewAppHost(apps, store), NewMediaService(store), AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.project.create","arguments":{"name":"Agent Loop 概念","appId":"example.app"}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	project, ok := result.(map[string]any)["structuredContent"].(Project)
	if !ok || project.Name != "Agent Loop 概念" || project.AppID != "example.app" {
		t.Fatalf("project tool result = %#v", result)
	}
	projects, err := store.List()
	found := false
	for _, candidate := range projects {
		found = found || candidate.ID == project.ID
	}
	if err != nil || len(projects) != 2 || !found {
		t.Fatalf("listed projects = %#v, err = %v", projects, err)
	}
	tool := projectMCPToolDefinition(DefaultLocale)
	if tool["name"] != "recut.project.create" {
		t.Fatalf("project tool definition = %#v", tool)
	}
}

func TestRecutContextReportsAppsWithoutProjectDefault(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(CreateInput{Name: "Current page", AppID: "example.app"}); err != nil {
		t.Fatal(err)
	}
	result, err := recutContextTool(NewAgentBridge(store), NewMediaService(store), AgentSession{ID: "s1"}, DefaultLocale)
	if err != nil {
		t.Fatal(err)
	}
	structured := result.(map[string]any)["structuredContent"].(map[string]any)
	if _, exists := structured["workspace"]; exists {
		t.Fatalf("recut.context must not report a workspace project default: %#v", structured)
	}
	appsReported := structured["apps"].([]map[string]any)
	if len(appsReported) != 1 || appsReported[0]["appId"] != "example.app" {
		t.Fatalf("recut.context apps = %#v", appsReported)
	}
	readiness := structured["media"].(map[string]any)["readiness"].(map[string]map[string]string)
	if readiness["image.generate"]["status"] != "not-configured" {
		t.Fatalf("unconfigured image readiness = %#v", readiness)
	}
	integrations := structured["integrations"].(map[string]any)
	audioStudio := integrations["audioStudio"].(map[string]any)
	if audioStudio["status"] != "not-installed" || audioStudio["mcpReady"] != false {
		t.Fatalf("audio studio integration = %#v", audioStudio)
	}
	if audioStudio["repository"] == "" {
		t.Fatalf("audio studio integration missing install repository: %#v", audioStudio)
	}
}

func TestRecutContextReportsAudioStudioMCPReadiness(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "audio-studio")
	if err := os.MkdirAll(filepath.Join(appDir, "ui"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"recut.audio-studio","name":"Audio Studio","author":"Test","description":"Test audio studio.","version":"1.0.0","type":"standalone","background":"background.js","ui":{"standaloneView":"ui/index.html"},"operations":[{"name":"transcribe","description":"Transcribe audio.","surfaces":["mcp"],"inputSchema":{"type":"object"}}]}`)
	writeTestFile(t, filepath.Join(appDir, "background.js"), "")
	writeTestFile(t, filepath.Join(appDir, "ui", "index.html"), "ok")
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	result, err := recutContextTool(NewAgentBridge(store), NewMediaService(store), AgentSession{ID: "s1"}, DefaultLocale)
	if err != nil {
		t.Fatal(err)
	}
	structured := result.(map[string]any)["structuredContent"].(map[string]any)
	audioStudio := structured["integrations"].(map[string]any)["audioStudio"].(map[string]any)
	if audioStudio["status"] != "ready" || audioStudio["mcpReady"] != true {
		t.Fatalf("audio studio ready integration = %#v", audioStudio)
	}
}

func TestRecutContextReportsConfiguredMediaReadiness(t *testing.T) {
	root := t.TempDir()
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	media := NewMediaService(store)
	credential, err := media.SaveCredential(MediaCredential{Provider: "openai-compatible", Name: "Image Provider", APIBase: "http://127.0.0.1:1"}, "secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := media.SaveRoute(MediaRoute{ID: "image.generate.default", Capability: ImageGenerate, ModelID: "openai-compatible/image", CredentialID: credential.ID, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	result, err := recutContextTool(NewAgentBridge(store), media, AgentSession{ID: "s1"}, DefaultLocale)
	if err != nil {
		t.Fatal(err)
	}
	structured := result.(map[string]any)["structuredContent"].(map[string]any)
	readiness := structured["media"].(map[string]any)["readiness"].(map[string]map[string]string)
	if readiness["image.generate"]["status"] != "ready" || readiness["image.generate"]["modelId"] != "openai-compatible/image" {
		t.Fatalf("configured image readiness = %#v", readiness)
	}
}

func TestMediaMCPToolExplainsMissingRoute(t *testing.T) {
	root := t.TempDir()
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	_, err = mediaMCPTool(store, NewMediaService(store), AgentSession{ID: "s1"}, "recut.image.generate", map[string]any{"text": "test"})
	if err == nil || !strings.Contains(err.Error(), "no route configured for image.generate") || !strings.Contains(err.Error(), "open Recut settings") {
		t.Fatalf("missing route error = %v", err)
	}
}

// TestLocalAudioRouteConfiguredReadinessAndDefaultVoice 覆盖本地 TTS（Audio Studio）路由端到端：
// 保存无凭据的 local-audio 路由 → readiness 报 ready+local+该 modelId → list_voices 返回默认音 →
// 无 voiceId 的 speech.generate 由注入的本地执行桥完成并可交代真实 Asset。
func TestLocalAudioRouteConfiguredReadinessAndDefaultVoice(t *testing.T) {
	root := t.TempDir()
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	media := NewMediaService(store)

	// 本地路由无凭据即可保存
	route, err := media.SaveRoute(MediaRoute{ID: "speech.generate.default", Capability: SpeechGenerate, ModelID: "local-audio/cosyvoice2", CredentialID: "", Enabled: true})
	if err != nil {
		t.Fatalf("save local-audio route with empty credential: %v", err)
	}
	if route.CredentialID != "" {
		t.Fatalf("local route should keep empty credential, got %q", route.CredentialID)
	}

	// readiness：ready + local + modelId
	result, err := recutContextTool(NewAgentBridge(store), media, AgentSession{ID: "s1"}, DefaultLocale)
	if err != nil {
		t.Fatal(err)
	}
	structured := result.(map[string]any)["structuredContent"].(map[string]any)
	readiness := structured["media"].(map[string]any)["readiness"].(map[string]map[string]string)
	speech := readiness["speech.generate"]
	if speech["status"] != "ready" || speech["local"] != "true" || speech["modelId"] != "local-audio/cosyvoice2" {
		t.Fatalf("local speech readiness = %#v", speech)
	}

	// list_voices：local-audio 或空 credential → 默认音
	voices, err := media.ListVoices("local-audio")
	if err != nil || len(voices) != 1 || voices[0].ID != "__cosyvoice_default__" {
		t.Fatalf("list local voices = %#v, err=%v", voices, err)
	}

	// 注入本地执行桥：无 voiceId 也应默认用默认音并产出真实 Asset
	media.SetLocalSpeechExecutor(func(job MediaJob, model MediaModel, voiceID string) (MediaAsset, error) {
		if voiceID != "__cosyvoice_default__" {
			t.Fatalf("executor voiceID = %q, want default", voiceID)
		}
		return media.SaveGeneratedAudio(job, []byte("RIFF...."), "audio/wav", nil)
	})
	job, err := media.GenerateSync(GenerateMediaInput{Capability: SpeechGenerate, Prompt: "你好"})
	if err != nil {
		t.Fatalf("generate local speech: %v", err)
	}
	if len(job.AssetIDs) != 1 {
		t.Fatalf("local speech job assets = %#v", job.AssetIDs)
	}
	asset, err := media.GetAsset(job.AssetIDs[0])
	if err != nil || asset.Kind != "audio" {
		t.Fatalf("local speech asset = %#v, err=%v", asset, err)
	}
}

func TestMediaMCPToolsBypassAppToolBoundary(t *testing.T) {
	for _, name := range []string{
		"recut.image.generate",
		"recut.video.generate",
		"recut.speech.generate",
		"recut.media.list_voices",
		"recut.media.get_job",
		"recut.media.wait_for_job",
		"recut.media.list_assets",
		"recut.media.import_image",
		"recut.media.attach",
	} {
		if !isMediaMCPTool(name) {
			t.Fatalf("platform media tool %q was not recognized", name)
		}
	}
	if isMediaMCPTool("recut.vox-broll.create_resource") {
		t.Fatal("App tool was misclassified as a platform media tool")
	}
}

func TestMCPStructuredContentWrapsListsInRecord(t *testing.T) {
	wrapped, ok := structuredMCPContent([]MediaVoice{}).(map[string]any)
	if !ok {
		t.Fatalf("list structuredContent = %#v", structuredMCPContent([]MediaVoice{}))
	}
	if _, ok := wrapped["items"].([]MediaVoice); !ok {
		t.Fatalf("wrapped list = %#v", wrapped)
	}
	object := map[string]any{"assetId": "asset-1"}
	if structured := structuredMCPContent(object); !reflect.DeepEqual(structured, object) {
		t.Fatalf("object structuredContent changed to %#v", structured)
	}
}

func TestMediaJobViewExposesJobIdForWaiting(t *testing.T) {
	view := mediaJobView(MediaJob{ID: "job-1", Status: "queued", Capability: ImageGenerate, AssetIDs: []string{"asset-1"}, ModelID: "atlas-cloud/openai/gpt-image-2"})
	if view["jobId"] != "job-1" || view["status"] != "queued" {
		t.Fatalf("job view = %#v", view)
	}
	assets, ok := view["assetIds"].([]string)
	if !ok || len(assets) != 1 || assets[0] != "asset-1" {
		t.Fatalf("job view assetIds = %#v", view["assetIds"])
	}
	raw, _ := json.Marshal(view)
	if !strings.Contains(string(raw), `"jobId":"job-1"`) {
		t.Fatalf("job view JSON must carry jobId for wait_for_job: %s", raw)
	}
}

func TestMCPListAssetsIsNotBlockedByImageGeneration(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(CreateInput{Name: "Test", AppID: "example.app"}); err != nil {
		t.Fatal(err)
	}
	provider := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/images/generations" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		time.Sleep(100 * time.Millisecond)
		_, _ = writer.Write([]byte(`{"data":[{"b64_json":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9JwQAAAABJRU5ErkJggg=="}]}`))
	}))
	defer provider.Close()
	media := NewMediaService(store)
	credential, err := media.SaveCredential(MediaCredential{Provider: "openai-compatible", Name: "Test", APIBase: provider.URL}, "test-key")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := media.SaveRoute(MediaRoute{Capability: ImageGenerate, ModelID: "openai-compatible/image", CredentialID: credential.ID, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	bridge := NewAgentBridge(store)
	session, _, err := bridge.CreateSession(SessionContext{})
	if err != nil {
		t.Fatal(err)
	}
	host := NewAppHost(apps, store)
	slow := mcpRequest{Method: "tools/call", Params: json.RawMessage(`{"name":"recut.image.generate","arguments":{"text":"slow image"}}`)}
	fast := mcpRequest{Method: "tools/call", Params: json.RawMessage(`{"name":"recut.media.list_assets","arguments":{}}`)}
	slowDone := make(chan error, 1)
	fastDone := make(chan error, 1)
	go func() { _, err := handleMCP(bridge, host, media, session, slow); slowDone <- err }()
	time.Sleep(20 * time.Millisecond)
	go func() { _, err := handleMCP(bridge, host, media, session, fast); fastDone <- err }()
	select {
	case err := <-fastDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("list_assets was blocked behind image generation")
	}
	if err := <-slowDone; err != nil {
		t.Fatal(err)
	}
}

func TestMCPHTTPResolvesSessionViaHeaders(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	if err := os.MkdirAll(appsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	apps, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	media := NewMediaService(store)
	bridge := NewAgentBridge(store)
	server := NewServer(apps, store, nil, bridge, nil, NewAppHost(apps, store), media)
	httpServer := httptest.NewServer(server.routes())
	defer httpServer.Close()

	call := func(sessionID, token, bearer string) (*http.Response, []byte) {
		payload := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"recut.context","arguments":{}}}`
		req, err := http.NewRequest(http.MethodPost, httpServer.URL+"/v1/mcp", strings.NewReader(payload))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("MCP-Protocol-Version", mcpProtocolVersion)
		if sessionID != "" {
			req.Header.Set("X-Recut-Session", sessionID)
			req.Header.Set("X-Recut-Token", token)
		}
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatal(err)
		}
		return resp, body
	}

	// Global Streamable HTTP requires a machine token; anonymous requests are
	// never allowed to invoke local creation tools merely because they reached
	// the loopback listener.
	resp, body := call("", "", "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous /v1/mcp = %d, want 401: %s", resp.StatusCode, body)
	}
	_, bearer, err := store.CreateDeviceToken(nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	resp, body = call("", "", bearer)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("bearer /v1/mcp = %d: %s", resp.StatusCode, body)
	}
	var anonymous struct {
		Result struct {
			StructuredContent map[string]any `json:"structuredContent"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &anonymous); err != nil {
		t.Fatal(err)
	}
	if anonymous.Result.StructuredContent["session"] == nil {
		t.Fatalf("external context = %s", body)
	}

	// With a valid session header the real bridge session is restored.
	session, token, err := bridge.CreateSession(SessionContext{})
	if err != nil {
		t.Fatal(err)
	}
	resp, body = call(session.ID, token, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("session /v1/mcp = %d: %s", resp.StatusCode, body)
	}
	var identified struct {
		Result struct {
			StructuredContent struct {
				Session struct {
					ID string `json:"id"`
				} `json:"session"`
			} `json:"structuredContent"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &identified); err != nil {
		t.Fatal(err)
	}
	if identified.Result.StructuredContent.Session.ID != session.ID {
		t.Fatalf("session header resolved to %q, want %q", identified.Result.StructuredContent.Session.ID, session.ID)
	}

	// A wrong token for a known session must be rejected.
	resp, body = call(session.ID, "wrong", "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong session token = %d, want 401: %s", resp.StatusCode, body)
	}
}

func TestMCPHTTPUsesStreamableHTTPContract(t *testing.T) {
	root := t.TempDir()
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	_, bearer, err := store.CreateDeviceToken(nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(apps, store, nil, NewAgentBridge(store), nil, NewAppHost(apps, store), NewMediaService(store))
	httpServer := httptest.NewServer(server.routes())
	defer httpServer.Close()

	request, err := http.NewRequest(http.MethodPost, httpServer.URL+"/v1/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	request.Header.Set("Authorization", "Bearer "+bearer)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("MCP-Protocol-Version") != mcpProtocolVersion {
		t.Fatalf("initialize status=%d protocol=%q", response.StatusCode, response.Header.Get("MCP-Protocol-Version"))
	}

	request, err = http.NewRequest(http.MethodPost, httpServer.URL+"/v1/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+bearer)
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing protocol version status=%d, want 400", response.StatusCode)
	}

	request, err = http.NewRequest(http.MethodPost, httpServer.URL+"/v1/mcp", strings.NewReader(`{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("MCP-Protocol-Version", mcpProtocolVersion)
	request.Header.Set("Authorization", "Bearer "+bearer)
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("notification status=%d, want 202", response.StatusCode)
	}
}

func TestImportNativeImageArchivesProjectFileAndRejectsEscapes(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Test", AppID: "example.app"})
	if err != nil {
		t.Fatal(err)
	}
	bridge := NewAgentBridge(store)
	session, _, err := bridge.CreateSession(SessionContext{})
	if err != nil {
		t.Fatal(err)
	}
	workspace := store.SessionWorkspaceDir(session.ID)
	content, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9JwQAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	imagePath := filepath.Join(workspace, "cover.png")
	if err := os.WriteFile(imagePath, content, 0o600); err != nil {
		t.Fatal(err)
	}
	media := NewMediaService(store)
	asset, err := importNativeImage(store, media, session, map[string]any{"path": "cover.png", "projectId": project.ID})
	if err != nil {
		t.Fatal(err)
	}
	if asset.Origin != "codex-native" || len(asset.ProjectIDs) != 1 || asset.ProjectIDs[0] != project.ID {
		t.Fatalf("native import = %#v", asset)
	}
	if _, err := importNativeImage(store, media, session, map[string]any{"path": "../outside.png"}); err == nil {
		t.Fatal("native import accepted a path outside the workspace")
	}
	outsidePath := filepath.Join(root, "outside.png")
	if err := os.WriteFile(outsidePath, content, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outsidePath, filepath.Join(workspace, "escape.png")); err != nil {
		t.Fatal(err)
	}
	if _, err := importNativeImage(store, media, session, map[string]any{"path": "escape.png"}); err == nil {
		t.Fatal("native import accepted a symbolic-link escape")
	}
}

func TestMCPToolGroupsSeparateGlobalAndAppTools(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"operations":[{"name":"where","description":"Report target.","surfaces":["api","mcp"],"inputSchema":{"type":"object"}}]}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	groups := mcpToolGroups(NewAgentBridge(store))

	global, ok := groups["global"].([]map[string]any)
	if !ok || len(global) == 0 {
		t.Fatalf("global tools missing: %#v", groups["global"])
	}
	globalNames := map[string]bool{}
	for _, tool := range global {
		globalNames[tool["name"].(string)] = true
	}
	if !globalNames["recut.context"] || !globalNames["recut.project.list"] || !globalNames["recut.image.generate"] {
		t.Fatalf("global group must carry platform tools, got %#v", globalNames)
	}
	if globalNames["example.app.where"] {
		t.Fatal("app operation leaked into the global group")
	}

	appGroups, ok := groups["apps"].([]map[string]any)
	if !ok || len(appGroups) != 1 {
		t.Fatalf("app groups = %#v", groups["apps"])
	}
	app := appGroups[0]
	if app["appId"] != "example.app" || app["name"] != "Example" || app["kind"] != "project" {
		t.Fatalf("app group metadata = %#v", app)
	}
	tools, ok := app["tools"].([]map[string]any)
	if !ok || len(tools) != 1 || tools[0]["name"] != "example.app.where" {
		t.Fatalf("app group tools = %#v", app["tools"])
	}
}

func TestMCPToolsEndpointServesGroupedTools(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"operations":[{"name":"where","description":"Report target.","surfaces":["api","mcp"],"inputSchema":{"type":"object"}}]}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	server := NewServer(apps, store, nil, NewAgentBridge(store), nil, NewAppHost(apps, store), NewMediaService(store))
	httpServer := httptest.NewServer(server.routes())
	defer httpServer.Close()

	resp, err := http.Get(httpServer.URL + "/v1/mcp/tools")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/mcp/tools = %d: %s", resp.StatusCode, body)
	}
	var groups struct {
		Global []map[string]any `json:"global"`
		Apps   []map[string]any `json:"apps"`
	}
	if err := json.Unmarshal(body, &groups); err != nil {
		t.Fatal(err)
	}
	if len(groups.Global) == 0 || groups.Global[0]["name"] == nil {
		t.Fatalf("global tools = %s", body)
	}
	if len(groups.Apps) != 1 || groups.Apps[0]["appId"] != "example.app" {
		t.Fatalf("app groups = %s", body)
	}
}

func TestRecutJobMCPToolsSurfaceLocalShellJobs(t *testing.T) {
	store, project := testShellJobScope(t)
	job, err := NewShellJobManager(store).Start(ShellJobStart{ProjectID: project.ID, AppID: project.AppID, Command: "sh", Args: []string{"-c", "printf job-mcp-tool"}, Dir: t.TempDir(), TimeoutSeconds: 5})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewShellJobManager(store).WaitByID(job.ID, 10*time.Second); err != nil {
		t.Fatal(err)
	}
	host := NewAppHost(store.catalog, store)
	checks := []struct{ name, arguments, want string }{
		{"recut.job.status", `{"jobId":"` + job.ID + `"}`, `"status":"completed"`},
		{"recut.job.wait", `{"jobId":"` + job.ID + `","timeoutSeconds":2}`, `"status":"completed"`},
		{"recut.job.logs", `{"jobId":"` + job.ID + `","limit":10}`, "job-mcp-tool"},
	}
	for _, check := range checks {
		result, err := handleMCP(NewAgentBridge(store), host, NewMediaService(store), AgentSession{ID: "s1"}, mcpRequest{
			Method: "tools/call",
			Params: json.RawMessage(`{"name":"` + check.name + `","arguments":` + check.arguments + `}`),
		})
		if err != nil {
			t.Fatalf("%s: %v", check.name, err)
		}
		text := result.(map[string]any)["content"].([]map[string]string)[0]["text"]
		if !strings.Contains(text, check.want) {
			t.Fatalf("%s text = %s, want substring %q", check.name, text, check.want)
		}
	}

	// The global tool list exposes the platform job group.
	definitions := map[string]map[string]any{}
	for _, tool := range platformMCPToolDefinitions(DefaultLocale) {
		definitions[tool["name"].(string)] = tool
	}
	for _, name := range []string{"recut.job.status", "recut.job.wait", "recut.job.logs", "recut.job.cancel"} {
		if _, exists := definitions[name]; !exists {
			t.Fatalf("platform tool %q is not exposed", name)
		}
	}

	// Cancelling a missing job surfaces a clear error.
	if _, err := handleMCP(NewAgentBridge(store), host, NewMediaService(store), AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.job.cancel","arguments":{"jobId":"missing"}}`),
	}); err == nil {
		t.Fatal("recut.job.cancel accepted a missing job")
	}
}

func TestUnifiedJobObservationCoversShellAndMedia(t *testing.T) {
	store, project := testShellJobScope(t)
	media := NewMediaService(store)

	// A shell job is observable through recut.job.status with kind=shell.
	shellJob, err := NewShellJobManager(store).Start(ShellJobStart{ProjectID: project.ID, AppID: project.AppID, Command: "sh", Args: []string{"-c", "true"}, Dir: t.TempDir(), TimeoutSeconds: 5})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewShellJobManager(store).WaitByID(shellJob.ID, 10*time.Second); err != nil {
		t.Fatal(err)
	}
	host := NewAppHost(store.catalog, store)

	// A media job is queued synchronously; record its jobId and assetId.
	credential, err := media.SaveCredential(MediaCredential{Provider: "openai-compatible", Name: "Image", APIBase: "http://127.0.0.1:1"}, "secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := media.SaveRoute(MediaRoute{Capability: ImageGenerate, ModelID: "openai-compatible/image", CredentialID: credential.ID, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	mediaJob, err := media.Generate(GenerateMediaInput{Capability: ImageGenerate, Prompt: "unified", IdempotencyKey: "unified-job"})
	if err != nil {
		t.Fatal(err)
	}

	checks := []struct {
		jobID, wantKind, wantStatus string
	}{
		{shellJob.ID, "shell", "completed"},
		{mediaJob.ID, "media", "queued"},
	}
	for _, check := range checks {
		result, err := handleMCP(NewAgentBridge(store), host, media, AgentSession{ID: "s1"}, mcpRequest{
			Method: "tools/call",
			Params: json.RawMessage(`{"name":"recut.job.status","arguments":{"jobId":"` + check.jobID + `"}}`),
		})
		if err != nil {
			t.Fatalf("recut.job.status(%s): %v", check.jobID, err)
		}
		text := result.(map[string]any)["content"].([]map[string]string)[0]["text"]
		if !strings.Contains(text, `"kind":"`+check.wantKind+`"`) {
			t.Fatalf("recut.job.status(%s) text = %s, want kind=%s", check.jobID, text, check.wantKind)
		}
		if !strings.Contains(text, `"status":"`+check.wantStatus+`"`) {
			t.Fatalf("recut.job.status(%s) text = %s, want status=%s", check.jobID, text, check.wantStatus)
		}
	}

	// A media jobId also works through the unified wait surface.
	result, err := handleMCP(NewAgentBridge(store), host, media, AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.job.wait","arguments":{"jobId":"` + mediaJob.ID + `","timeoutSeconds":1}}`),
	})
	if err != nil {
		t.Fatalf("recut.job.wait(media): %v", err)
	}
	text := result.(map[string]any)["content"].([]map[string]string)[0]["text"]
	if !strings.Contains(text, `"kind":"media"`) {
		t.Fatalf("recut.job.wait(media) text = %s", text)
	}

	// Unknown jobIds are reported uniformly.
	if _, err := handleMCP(NewAgentBridge(store), host, media, AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.job.status","arguments":{"jobId":"does-not-exist"}}`),
	}); err == nil {
		t.Fatal("recut.job.status accepted an unknown jobId")
	}
}
