/*
 * [INPUT]: 依赖 media 的 extensionFor
 * [OUTPUT]: 锁定存储扩展名按 MIME 规范化（image/jpeg → .jpg），避免 macOS 上
 *           mime.ExtensionsByType 返回顺序把图片落成 .jpe 造成路径与 mimeType 不一致
 * [POS]: media 存储文件命名的确定性回归门禁
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import "testing"

func TestExtensionForUsesCanonicalExtensions(t *testing.T) {
	cases := map[string]string{
		"image/jpeg":         ".jpg",
		"image/png":          ".png",
		"audio/mpeg":         ".mp3",
		"audio/x-wav":        ".wav",
		"video/quicktime":    ".mov",
		"application/x-nope": ".bin",
	}
	for mimeType, want := range cases {
		if got := extensionFor(mimeType); got != want {
			t.Fatalf("extensionFor(%q) = %q, want %q", mimeType, got, want)
		}
	}
}
