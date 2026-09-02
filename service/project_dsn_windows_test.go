//go:build windows

package main

import (
	"strings"
	"testing"
)

// TestSQLiteDSNBackslashInput 在真实 Windows 语义下锁定反斜杠路径必须被
// filepath.ToSlash 归一化，DSN 中不允许残留任何反斜杠转义。
func TestSQLiteDSNBackslashInput(t *testing.T) {
	dsn := sqliteDSN(`C:\Users\chen\.recut\index.db`)
	if strings.Contains(dsn, "%5C") || strings.Contains(dsn, `\`) {
		t.Fatalf("DSN must not contain backslashes or percent escapes: %s", dsn)
	}
	if !strings.HasPrefix(dsn, "file:///C:/") {
		t.Fatalf("DSN must be an absolute file URI, got %s", dsn)
	}
}
