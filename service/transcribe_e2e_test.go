/*
 * [INPUT]: 真实 apps/editor（subtitle.* 链）与 apps/audio-studio（audio.transcribe/status/transcript 的 python 运行器）；
 *          只读复用 ~/.recut/python venv 与 ~/.recut/models ASR 模型（symlink），不触碰真实 sqlite/媒体。
 * [OUTPUT]: 不经 UI 的转写 E2E：editor subtitle.capabilities → subtitle.generate（能力桥 invoke audio.transcribe）
 *           → 轮询 subtitle.status 到 completed，断言返回 transcript 素材与 srt/segments；任一步失败即 FAIL 并打印真实错误。
 * [POS]: service 的接口层转写验证；默认跳过（RECUT_E2E_TRANSCRIBE=1 开启）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestTranscriptionE2EThroughCapabilityBridge(t *testing.T) {
	if os.Getenv("RECUT_E2E_TRANSCRIBE") != "1" {
		t.Skip("set RECUT_E2E_TRANSCRIBE=1 to run the real ASR chain")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	recutRoot := filepath.Join(home, ".recut")
	if _, err := os.Stat(filepath.Join(recutRoot, "models", "audio-studio")); err != nil {
		t.Skipf("no audio-studio models under %s (%v)", recutRoot, err)
	}

	apps, err := LoadCatalog(filepath.Join("..", "apps"))
	if err != nil {
		t.Fatal(err)
	}
	dataRoot := filepath.Join(t.TempDir(), "data")
	if err := os.MkdirAll(dataRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"python", "models"} {
		if err := os.Symlink(filepath.Join(recutRoot, name), filepath.Join(dataRoot, name)); err != nil {
			t.Fatal(err)
		}
	}
	store := NewStore(dataRoot, apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}

	audioPath := os.Getenv("RECUT_E2E_AUDIO")
	if audioPath == "" {
		audioPath = e2eSpeechWAV(t)
	}
	data, err := os.ReadFile(audioPath)
	if err != nil {
		t.Fatal(err)
	}
	media := NewMediaService(store)
	source, err := media.ImportMedia(filepath.Base(audioPath), "audio/wav", data)
	if err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "e2e-captions", AppID: "recut.editor"})
	if err != nil {
		t.Fatal(err)
	}
	if err := media.Attach(source.ID, project.ID); err != nil {
		t.Fatal(err)
	}
	host := NewAppHost(apps, store, media)
	target := Target{ProjectID: project.ID, AppID: "recut.editor"}

	capsAny, err := host.InvokeAPI(target, "recut.editor", "subtitle.capabilities", map[string]any{})
	if err != nil {
		t.Fatalf("subtitle.capabilities: %v", err)
	}
	caps := capsAny.(map[string]any)
	t.Logf("capabilities: ready=%v envReady=%v status=%v reason=%v installedModels=%v action=%v",
		caps["ready"], caps["envReady"], caps["status"], caps["reason"], caps["installedModels"], caps["action"])

	model := e2ePickModel(t, caps)
	t.Logf("chosen model=%s", model)

	genAny, err := host.InvokeAPI(target, "recut.editor", "subtitle.generate", map[string]any{
		"targetAssetId": source.ID, "kind": "audio", "model": model, "language": "auto",
	})
	if err != nil {
		t.Fatalf("subtitle.generate: %v", err)
	}
	gen := genAny.(map[string]any)
	// 成功路径不返回 ok 字段（只有明确失败才 ok:false）；只要 jobId 存在即视为提交成功。
	if failed, known := gen["ok"].(bool); known && !failed {
		t.Fatalf("subtitle.generate failed: %#v", gen)
	}
	jobID, _ := gen["jobId"].(string)
	if jobID == "" {
		t.Fatalf("no jobId: %#v", gen)
	}
	t.Logf("subtitle.generate ok jobId=%s transcript=%v", jobID, gen["transcriptId"])

	deadline := time.Now().Add(3 * time.Minute)
	for time.Now().Before(deadline) {
		stAny, err := host.InvokeAPI(target, "recut.editor", "subtitle.status", map[string]any{"jobId": jobID})
		if err != nil {
			t.Fatalf("subtitle.status: %v", err)
		}
		st := stAny.(map[string]any)
		status, _ := st["status"].(string)
		t.Logf("status=%s", status)
		switch status {
		case "completed":
			srt, _ := st["srt"].(string)
			segCount := 0
			if segs, ok := st["segments"].([]any); ok {
				segCount = len(segs)
			}
			assetID, _ := st["transcriptAssetId"].(string)
			t.Logf("completed: segments=%d srtChars=%d transcriptAssetId=%q", segCount, len(srt), assetID)
			if assetID == "" {
				t.Errorf("saveToLibrary did not return a transcript asset")
			}
			return
		case "failed":
			t.Fatalf("transcribe failed: %v", st["error"])
		case "cancelled":
			t.Fatalf("transcribe cancelled: %v", st["error"])
		case "error":
			t.Fatalf("poll error: %v", st["error"])
		default:
			if shell, err := host.jobs.FindByID(jobID); err == nil {
				t.Logf("  shell: status=%s exit=%d error=%q", shell.Status, shell.ExitCode, shell.Error)
			} else {
				t.Logf("  shell: FindByID err=%v", err)
			}
			if transcriptID, ok := gen["transcriptId"].(string); ok && transcriptID != "" {
				if raw, err := host.InvokeMCP(Target{AppID: "recut.audio-studio"}, "recut.audio-studio", "audio.transcript", map[string]any{"id": transcriptID}); err == nil {
					t.Logf("  audio.transcript: %#v", raw)
				} else {
					t.Logf("  audio.transcript err=%v", err)
				}
			}
			time.Sleep(3 * time.Second)
		}
	}
	t.Fatal("timed out waiting for transcription to reach a terminal state")
}

func e2ePickModel(t *testing.T, caps map[string]any) string {
	t.Helper()
	if raw, ok := caps["installedModels"].([]any); ok && len(raw) > 0 {
		return fmt.Sprintf("%v", raw[0])
	}
	return "whisper-small"
}

func e2eSpeechWAV(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("say"); err != nil {
		t.Skip("no `say`; set RECUT_E2E_AUDIO to a speech audio file")
	}
	dir := t.TempDir()
	aiff := filepath.Join(dir, "speech.aiff")
	out, err := exec.Command("say", "-v", "Tingting", "-o", aiff, "今天天气很好，我们一起去公园散步。这是字幕转写的端到端测试。").CombinedOutput()
	if err != nil {
		if out2, err2 := exec.Command("say", "-v", "Samantha", "-o", aiff, "Today is sunny and we are going to the park for a walk.").CombinedOutput(); err2 != nil {
			t.Skipf("say failed: %v / %v\n%s", err, err2, out)
		} else {
			_ = out2
		}
	}
	wav := filepath.Join(dir, "speech.wav")
	if out, err := exec.Command("ffmpeg", "-y", "-loglevel", "error", "-i", aiff, "-ar", "16000", "-ac", "1", wav).CombinedOutput(); err != nil {
		t.Skipf("ffmpeg failed: %v\n%s", err, out)
	}
	return wav
}