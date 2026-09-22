/*
 * [INPUT]: 无（由宿主适配层实现）。
 * [OUTPUT]: Host 接口（平台 DB、构建/封面文件根、事件、验证回调）与结构化 Error 信封。
 * [POS]: motion_graphic 包与宿主的唯一接缝；包不依赖任何 App 或项目概念。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package motion_graphic

import "database/sql"

// Host 抽象 MG 操作所需的最小宿主能力：平台 DB、落盘/封面文件根、事件与验证回调。
// MG 是全局素材，Host 不提供任何项目语义；verified 只做全局投影（统一素材库），项目成员
// 关系由消费方（如 recut.editor）在需要使用时自行建立，MG 包不感知。
// 构建工具链归平台（build.go 的 Go esbuild + 静态扫描 + 形状校验），因此不再需要 App 根。
type Host interface {
	DB() (*sql.DB, error)
	FilesRoot() string
	WriteBase64(rel, b64 string) error
	FilesURL(rel string) string
	IsZh() bool
	Emit(eventType string, payload map[string]any)
	// OnVerified 让宿主在素材 verified 后做全局投影（如投影进统一素材库）。
	// 它不做任何项目引用登记——项目成员关系归消费方。
	OnVerified(id, versionID string)
}

// Error 是与平台错误信封字段对齐的结构化业务错误（由适配层翻译为 mcpError）。
type Error struct {
	Kind      string
	Code      string
	Message   string
	Hint      string
	Retryable bool
	Data      any
}

func (e *Error) Error() string { return e.Message }

func businessError(message string) error {
	return &Error{Kind: "business", Code: "invalid-request", Message: message}
}

func businessErrorWithCode(code, message, hint string) error {
	return &Error{Kind: "business", Code: code, Message: message, Hint: hint}
}
