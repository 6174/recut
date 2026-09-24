/*
 * [INPUT]: 依赖 ContributedMediaProvider 的 executor.resultIdPath 契约与 providerResultID/stringByPath
 * [OUTPUT]: 锁定本地 provider 生成结果记录 id 的提取：默认 generation.id、executor 声明的
 *          synthesis.id 等点路径都能取到字符串值，路径缺失返回空
 * [POS]: service 的「App 贡献本地 media provider」桥回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import "testing"

func TestProviderResultIDResolvesDotPath(t *testing.T) {
	cases := []struct {
		name         string
		contribution ContributedMediaProvider
		raw          any
		want         string
	}{
		{
			name:         "default generation.id",
			contribution: ContributedMediaProvider{},
			raw:          map[string]any{"generation": map[string]any{"id": "gen-1"}},
			want:         "gen-1",
		},
		{
			name:         "executor synthesis.id",
			contribution: ContributedMediaProvider{Executor: &ContributedMediaExecutor{ResultIDPath: "synthesis.id"}},
			raw:          map[string]any{"synthesis": map[string]any{"id": "syn-1"}},
			want:         "syn-1",
		},
		{
			name:         "missing path",
			contribution: ContributedMediaProvider{},
			raw:          map[string]any{"generation": map[string]any{}},
			want:         "",
		},
		{
			name:         "non-string id",
			contribution: ContributedMediaProvider{},
			raw:          map[string]any{"generation": map[string]any{"id": 7}},
			want:         "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := providerResultID(tc.contribution, tc.raw); got != tc.want {
				t.Fatalf("providerResultID() = %q, want %q", got, tc.want)
			}
		})
	}
}
