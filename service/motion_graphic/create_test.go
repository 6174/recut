/*
 * [INPUT]: 无外部依赖；直接调用 service.create 的三个分支。
 * [OUTPUT]: 约束 motion-graphic.create 的默认直通/author 分支：既无 source 又无 author 报错；
 *           author:true 返回 SubAgentRequest（不落 draft）。
 * [POS]: motion_graphic 包的轻量单测；真实构建链路由 motion_graphic_e2e_test.go（gated）覆盖。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package motion_graphic

import "testing"

func TestCreateRequiresSourceOrAuthor(t *testing.T) {
	s := &service{}
	if _, err := s.create(map[string]any{}); err == nil {
		t.Fatal("create with neither source nor author should fail")
	}

	res, err := s.create(map[string]any{"author": true, "items": []any{map[string]any{"brief": "fullscreen title"}}})
	if err != nil {
		t.Fatalf("author-mode create: %v", err)
	}
	if _, ok := res.(map[string]any)["subAgent"]; !ok {
		t.Fatalf("author-mode create should return a subAgent request: %#v", res)
	}
}
