/*
 * [INPUT]: 依赖 MediaService、Store 与测试目录中的临时工作区
 * [OUTPUT]: 验证媒体凭据加密保存、能力路由、受校验的模型/凭据直连、图片导入和幂等生成任务的持久化契约
 * [POS]: service 的 Media Platform 回归测试；不调用真实模型提供商
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMediaRouteAndJobUseOpaqueCredential(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
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
	media := NewMediaService(store)
	credential, err := media.SaveCredential(MediaCredential{Provider: "openai-compatible", Name: "Test", APIBase: "http://127.0.0.1:1"}, "secret-value")
	if err != nil {
		t.Fatal(err)
	}
	credentials, err := media.ListCredentials()
	if err != nil || len(credentials) != 1 || !credentials[0].SecretSet {
		t.Fatalf("credential metadata = %#v, %v", credentials, err)
	}
	if credentials[0].Name == "secret-value" {
		t.Fatal("credential leaked its secret")
	}
	if _, err := media.SaveRoute(MediaRoute{Capability: ImageGenerate, ModelID: "openai-compatible/image", CredentialID: credential.ID, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	job, err := media.Generate(GenerateMediaInput{Capability: ImageGenerate, Prompt: "test", ProjectID: project.ID, IdempotencyKey: "idempotent"})
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := media.Generate(GenerateMediaInput{Capability: ImageGenerate, Prompt: "test", ProjectID: project.ID, IdempotencyKey: "idempotent"})
	if err != nil || duplicate.ID != job.ID {
		t.Fatalf("idempotency failed: %#v, %v", duplicate, err)
	}
	direct, _, err := media.resolveRoute(GenerateMediaInput{Capability: ImageGenerate, ModelID: "openai-compatible/image", CredentialID: credential.ID})
	if err != nil || direct.ModelID != "openai-compatible/image" {
		t.Fatalf("direct model route = %#v, %v", direct, err)
	}
	if _, _, err := media.resolveRoute(GenerateMediaInput{Capability: ImageGenerate, ModelID: "openai/gpt-image-2", CredentialID: credential.ID}); err == nil {
		t.Fatal("direct generation accepted a credential from a different provider")
	}
}

func TestMediaProvidersOwnTheirModelLists(t *testing.T) {
	provider, ok := providerByID("atlas-cloud")
	if !ok || provider.Protocol != "openai-compatible" {
		t.Fatalf("Atlas provider = %#v", provider)
	}
	model, ok := modelByID("atlas-cloud/bytedance/seedance-2.0")
	if !ok || model.Capability != VideoGenerate {
		t.Fatalf("Atlas model = %#v", model)
	}
	if model.Provider != provider.ID {
		t.Fatalf("model is not owned by Atlas: %#v", model)
	}
}

func TestOpenAICompatibleDefaultsToWorkingGPTImage2(t *testing.T) {
	model, ok := modelByID("openai-compatible/image")
	if !ok || model.APIModelID != "gpt-image-2" {
		t.Fatalf("OpenAI-compatible model = %#v", model)
	}
}

func TestMediaReferenceKindsFollowCreationCapability(t *testing.T) {
	if !referenceKindsFor(ImageGenerate)["image"] || referenceKindsFor(ImageGenerate)["audio"] {
		t.Fatal("image creation must accept images only")
	}
	if !referenceKindsFor(VideoGenerate)["image"] || !referenceKindsFor(VideoGenerate)["audio"] {
		t.Fatal("video creation must accept image and audio context")
	}
}

func TestImportedImageRejectsNonImageContent(t *testing.T) {
	media := &MediaService{}
	if _, err := media.ImportImage("note.txt", "text/plain", []byte("not an image")); err == nil {
		t.Fatal("non-image import was accepted")
	}
}

func TestMediaSystemProjectIsHiddenFromUserProjects(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	for _, app := range []struct{ dir, manifest string }{{"example", `{"manifestVersion":1,"id":"example.app","name":"Example","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`}, {"media", `{"manifestVersion":1,"id":"recut.media-library","name":"Media","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`}} {
		if err := os.MkdirAll(filepath.Join(appsDir, app.dir), 0o755); err != nil {
			t.Fatal(err)
		}
		writeTestFile(t, filepath.Join(appsDir, app.dir, "manifest.json"), app.manifest)
	}
	apps, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.EnsureMediaSystemProject()
	if err != nil || project.ID != mediaSystemProjectID {
		t.Fatalf("system project = %#v, %v", project, err)
	}
	projects, err := store.List()
	if err != nil || len(projects) != 0 {
		t.Fatalf("visible projects = %#v, %v", projects, err)
	}
}
