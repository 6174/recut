/*
 * [INPUT]: 依赖 motion_graphic.Build 的纯 Go 构建闸（esbuild + 静态扫描 + 形状校验）。
 * [OUTPUT]: 构建结果回归：确定性哈希、错误类型分类与 bundle 落盘。
 * [POS]: 平台组件构建工具链的单测；替代原 apps/editor/scripts/component-build.js 行为基线。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package motion_graphic

import (
	"os"
	"path/filepath"
	"testing"
)

const goldenComponentSource = `import { anim, num } from "@recut/runtime";

export default {
  surface: "react",
  getBaseSize: () => ({ width: 640, height: 360 }),
  getContentBounds: () => ({ x: 20, y: 20, width: 600, height: 320 }),
  render: (ctx: any) => {
    const u = ctx.progress;
    const opacity = anim.lerp(0, 1, u);
    const size = num(ctx.params, "size", 48);
    return (
      <div style={{ opacity, fontSize: size, color: "#fff" }}>
        <span>Hello Motion</span>
      </div>
    );
  },
};
`

// goldenBundleHash 由原 Node 工具链（esbuild 0.17.19，tsx/automatic/@recut/runtime/esm/chrome130/inline map）
// 对同一源码产出，用于锁定 Go 构建与既有 bundleHash 的一致性。
const goldenBundleHash = "f9f048589604d1aa28bff41f37df258757687fa85d4a05ce8c98932fcd631c26"

func TestBuildGoldenHashMatchesNodeToolchain(t *testing.T) {
	result := Build(t.TempDir(), "ai-golden@1", goldenComponentSource)
	if !result.OK {
		t.Fatalf("build failed: %#v", result.Error)
	}
	if result.BundleHash != goldenBundleHash {
		t.Fatalf("bundleHash drifted from Node toolchain baseline:\n got %s\nwant %s", result.BundleHash, goldenBundleHash)
	}
}

func TestBuildIsDeterministicAndWritesBundle(t *testing.T) {
	root := t.TempDir()
	first := Build(root, "ai-det@1", goldenComponentSource)
	second := Build(root, "ai-det@1", goldenComponentSource)
	if !first.OK || !second.OK {
		t.Fatalf("build failed: %#v / %#v", first.Error, second.Error)
	}
	if first.BundleHash != second.BundleHash || first.Bundle != second.Bundle {
		t.Fatal("identical source produced different bundles")
	}
	if _, err := os.Stat(filepath.Join(root, "components", "ai-det@1.js")); err != nil {
		t.Fatalf("bundle was not written: %v", err)
	}
}

func TestBuildRejectsDeterminismViolations(t *testing.T) {
	cases := map[string]string{
		"wall clock": `export default { render: () => Date.now() };`,
		"random":     `export default { render: () => Math.random() };`,
		"bad import": "import gsap from \"gsap\";\nexport default { render: () => null };",
		"autoplay gsap": `import { anim } from "@recut/runtime";
export default { render: () => gsap.timeline() };`,
	}
	for name, source := range cases {
		result := Build(t.TempDir(), "ai-bad@1", source)
		if result.OK {
			t.Fatalf("%s: determinism violation was accepted", name)
		}
		if result.Error["type"] != "determinism" {
			t.Fatalf("%s: expected determinism error, got %#v", name, result.Error)
		}
	}
}

func TestBuildShapeCheck(t *testing.T) {
	missingRender := `export default { surface: "react", getBaseSize: () => ({ width: 10, height: 10 }) };`
	if result := Build(t.TempDir(), "ai-shape@1", missingRender); result.OK || result.Error["type"] != "shape" {
		t.Fatalf("missing render accepted: %#v", result.Error)
	}

	badSurface := `export default { surface: "svg", render: () => null };`
	if result := Build(t.TempDir(), "ai-shape@2", badSurface); result.OK || result.Error["type"] != "shape" {
		t.Fatalf("invalid surface accepted: %#v", result.Error)
	}

	functionComponent := `export default function Comp(ctx: any) { return null; }`
	if result := Build(t.TempDir(), "ai-shape@3", functionComponent); !result.OK {
		t.Fatalf("function component rejected: %#v", result.Error)
	}

	methodShorthand := `export default { surface: "html", render(ctx: any) { return null; } };`
	if result := Build(t.TempDir(), "ai-shape@4", methodShorthand); !result.OK {
		t.Fatalf("method shorthand rejected: %#v", result.Error)
	}
}
