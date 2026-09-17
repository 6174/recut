/**
 * [INPUT]: 依赖真实 apps/editor/background.js（component.define/verify/list/source/resolve）与
 *          scripts/component-build.js（esbuild+tsc+确定性扫描），经 ctx 桩驱动
 * [OUTPUT]: 自动跑通 AI 组件核心链路：define→build→verify(head 跟随)→asset 引用→assetId 放置→resolve→迭代→失败防护
 * [POS]: AI 临时组件机制的 background 侧回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 *
 * 运行: node scripts/e2e-component-chain.test.js
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const { DatabaseSync } = require("node:sqlite");
const APP_ROOT = path.join(__dirname, "..");

const handlers = {};
global.recut = {
	operation: {
		register(name, handler) {
			handlers[name] = handler;
		},
	},
};
const manifest = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "manifest.json"), "utf8"));
const backgroundSource = [manifest.background, ...(manifest.backgroundModules || [])]
	.map((file) => fs.readFileSync(path.join(APP_ROOT, file), "utf8"))
	.join("\n");
require("node:vm").runInThisContext(backgroundSource, { filename: "recut-editor-background.js" });

const filesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "recut-files-"));
const db = new DatabaseSync(":memory:");

const projectEvents = [];
const ctx = {
	project: {
		id: "proj-e2e",
		emit(type, payload) {
			projectEvents.push({ type, ...payload });
		},
	},
	paths: { appRoot: APP_ROOT },
	sqlite: {
		execute(sql, params = []) {
			if (params.length > 0 && sql.includes("?")) {
				const result = db.prepare(sql).run(...params);
				return { rowsAffected: Number(result.changes ?? 0) };
			} else {
				db.exec(sql);
				return { rowsAffected: 0 };
			}
		},
		query(sql, params = []) {
			return params.length > 0 ? db.prepare(sql).all(...params) : db.prepare(sql).all();
		},
	},
	files: {
		writeText(p, content) {
			const full = path.join(filesRoot, p);
			fs.mkdirSync(path.dirname(full), { recursive: true });
			fs.writeFileSync(full, content);
		},
		readText(p) {
			return fs.readFileSync(path.join(filesRoot, p), "utf8");
		},
		writeBase64(p, content) {
			const full = path.join(filesRoot, p);
			fs.mkdirSync(path.dirname(full), { recursive: true });
			fs.writeFileSync(full, Buffer.from(content, "base64"));
		},
		url(p) {
			return `recut-test://${p}`;
		},
	},
	shell: {
		exec({ command, args, cwd }) {
			const base = cwd === "files" ? filesRoot : process.cwd();
			const result = spawnSync(command, args, { cwd: base, encoding: "utf8" });
			return { stdout: result.stdout || "", code: result.status ?? -1 };
		},
	},
};

const call = (name, input) => handlers[name](input, ctx);

const HTML_SOURCE = `import { str } from "@recut/runtime";
import type { ComponentRenderContext } from "@recut/runtime";

export default {
  surface: "html",
  name: "Countdown",
  keywords: ["countdown", "倒计时"],
  inputs: [
    { key: "color", type: "color", default: "#0ea5e9", label: "主色" },
  ],
  render(ctx: ComponentRenderContext) {
    const { params, progress, anim } = ctx;
    const color = str(params.color, "#0ea5e9");
    const n = Math.ceil((1 - progress) * 5);
    const scale = 1 + anim.pulse(progress, { speed: 2 }) * 0.1;
    return \`<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-family:sans-serif;color:\${color};font-weight:800;font-size:120px;transform:scale(\${scale.toFixed(3)});">\${n}</div>\`;
  },
};
`;

const R3F_SOURCE = `import { str } from "@recut/runtime";
import type { ComponentRenderContext } from "@recut/runtime";

export default {
  surface: "r3f",
  name: "Pulse Cube",
  keywords: ["cube", "方块"],
  inputs: [
    { key: "color", type: "color", default: "#ff2244", label: "主色" },
  ],
  render(ctx: ComponentRenderContext) {
    const { params, progress, anim } = ctx;
    const color = str(params.color, "#ff2244");
    const size = 100 + anim.pulse(progress) * 40;
    return <mesh><boxGeometry args={[size, size, size]} /><meshBasicMaterial color={color} /></mesh>;
  },
};
`;

const BAD_SOURCE = `import type { ComponentRenderContext } from "@recut/runtime";
export default {
  surface: "react",
  name: "Bad",
  inputs: [],
  render(ctx: ComponentRenderContext) {
    const r = Math.random();
    return <div>{r}</div>;
  },
};
`;

const ILLEGAL_IMPORT_SOURCE = `import { str } from "lodash";
export default {
  surface: "html",
  name: "Illegal",
  inputs: [],
  render() {
    return str("x");
  },
};
`;

// 纯函数组件 default export（react）：构建应通过（形态合法）。
const FN_COMPONENT_SOURCE = `const easeOutCubic = (p: number): number => 1 - Math.pow(1 - Math.min(Math.max(p, 0), 1), 3);
function Hello({ progress = 0, text = 'Hello', color = '#ffffff' }: { progress?: number; text?: string; color?: string }) {
  const p = Math.min(Math.max(progress, 0), 1);
  const e = easeOutCubic(p);
  return (
    <div style={{ position: 'absolute', inset: 0, width: 1920, height: 1080, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0b1a', color, fontSize: 320, fontWeight: 900 }}>
      {text}
    </div>
  );
}
Hello.getBaseSize = () => ({ width: 1920, height: 1080 });
Hello.getContentBounds = () => ({ x: 0, y: 0, width: 1920, height: 1080 });
export default Hello;
`;

// 定义对象缺 render：构建必须被 shape 校验拦下（verified 不再可能"能构建不能运行"）。
const NO_RENDER_SOURCE = `export default {
  surface: "react",
  name: "NoRender",
  inputs: [],
};
`;

let failures = 0;
function check(name, fn) {
	try {
		fn();
		console.log(`  ok: ${name}`);
	} catch (error) {
		failures += 1;
		console.error(`  FAIL: ${name}\n    ${error && error.message}`);
	}
}

// ---- 0. 受管创建：define(draft)→verify(verified) 进素材库（media），component.create 走 service 子 Agent，不在此 harness 直接出现 ----
function createVerifiedComponent(name, source) {
	const d = call("component.define", { name, surface: "html", keywords: ["chip"], inputs: [{ key: "title", type: "text", default: name, label: "标题" }], source });
	if (d.status !== "draft") throw new Error(`define failed: ${JSON.stringify(d)}`);
	call("component.verify", { versionId: d.versionId, revealLibrary: true, report: { ok: true, checks: [{ name: "smoke", pass: true }], mode: "headless-code" } });
	return d.componentId;
}
const fastComponentIds = [
	createVerifiedComponent("Feature Chip Remotion", HTML_SOURCE),
	createVerifiedComponent("Feature Chip Shader", HTML_SOURCE),
];
const fastComponentAssets = call("asset.list", {}).assets.filter((asset) => fastComponentIds.includes(asset.componentId));
check("verified 事件聚焦素材库 media，而非独立组件 tab", () => {
	const published = projectEvents.filter((event) => event.type === "project.components.changed" && event.status === "verified");
	assert.ok(published.length >= fastComponentIds.length);
	assert.ok(published.every((event) => event.library && event.library.tab === "media"));
});
check("受管创建立即拥有 verified head", () => {
	const resolved = call("component.resolve", { ids: [fastComponentIds[0]] });
	assert.equal(resolved.components[0].status, "verified");
	assert.ok(resolved.components[0].bundle.includes("@recut/runtime"));
});
check("组件 verified 后 asset.list 返回可交给 AI 的 assetId", () => {
	assert.equal(fastComponentAssets.length, fastComponentIds.length);
	assert.ok(fastComponentAssets.every((asset) => asset.assetId.startsWith("component:")));
});
const managedDraft = call("component.define", { name: "Managed Asset", surface: "html", source: HTML_SOURCE });
const managedCreate = call("component.create", {
	items: [{ brief: "managed test component", mode: "local" }],
	subAgentTools: [{ name: "recut.editor.component.commit", result: { versionId: managedDraft.versionId } }],
});
check("component.create 完成结果直接返回 assetId", () => {
	assert.equal(managedCreate.components[0].assetId, `component:${managedDraft.componentId}`);
	assert.deepEqual(managedCreate.assetIds, [managedCreate.components[0].assetId]);
	assert.equal(call("asset.list", {}).assets.some((asset) => asset.assetId === managedCreate.components[0].assetId), true);
});
const createdProject = call("project.create", { name: "Placement" });
const placedBatch = call("timeline.placeComponents", {
	baseVersion: createdProject.version,
	items: fastComponentAssets.map((asset) => ({ assetId: asset.assetId, startSec: 0, durationSec: 8 })),
});
check("timeline.placeComponents 原子分配并发组件", () => {
	assert.equal(placedBatch.ok, true, JSON.stringify(placedBatch));
	assert.equal(placedBatch.version, 2);
	assert.equal(placedBatch.result.refs.length, 2);
	assert.notEqual(placedBatch.result.refs[0].trackId, placedBatch.result.refs[1].trackId);
	const timeline = call("timeline.read", {});
	const componentClips = timeline.tracks.flatMap((track) => track.clips || []).filter((clip) => clip.type === "component");
	assert.ok(componentClips.every((clip) => clip.assetId && fastComponentAssets.some((asset) => asset.assetId === clip.assetId)));
});

// ---- 1. define（新建）→ draft ----
const defined = call("component.define", { name: "Countdown", surface: "html", keywords: ["countdown"], inputs: [{ key: "color", type: "color", default: "#0ea5e9", label: "主色" }], source: HTML_SOURCE });
check("define 新建返回 draft", () => {
	assert.equal(defined.status, "draft");
	assert.match(defined.componentId, /^ai-/);
	assert.equal(defined.version, 1);
	assert.equal(defined.versionId, `${defined.componentId}@1`);
});
check("draft 保留 latestVersionId 供重连后的验证器恢复", () => {
	const pending = call("component.list", {}).components.find((component) => component.componentId === defined.componentId);
	assert.ok(pending);
	assert.equal(pending.status, "draft");
	assert.equal(pending.latestVersionId, defined.versionId);
});

// ---- 2. resolve 精确版本 → bundle ----
const resolvedV1 = call("component.resolve", { versionId: defined.versionId });
check("resolve 精确版本返回编译产物", () => {
	assert.equal(resolvedV1.components.length, 1);
	assert.equal(resolvedV1.components[0].surface, "html");
	assert.ok(resolvedV1.components[0].bundle.length > 200);
	assert.equal(resolvedV1.components[0].bundleHash.length, 64);
	assert.ok(resolvedV1.components[0].bundle.includes('from "@recut/runtime"'));
	assert.deepEqual(resolvedV1.components[0].inputs.map((i) => i.key), ["color"]);
});

// ---- 3. verify ok → verified + head ----
call("component.verify", { versionId: defined.versionId, report: { ok: true, checks: [{ name: "smoke", pass: true }], cover: { fileBase64: "iVBORw0KGgo=", mimeType: "image/png", width: 640, height: 360 } } });
const resolvedHead = call("component.resolve", { ids: [defined.componentId] });
check("verify 通过后 head 生效", () => {
	assert.equal(resolvedHead.components[0].status, "verified");
	assert.equal(resolvedHead.components[0].versionId, defined.versionId);
	assert.equal(resolvedHead.components[0].bundleHash, resolvedV1.components[0].bundleHash);
});
check("verify 将 HTML-in-Canvas 封面持久化为组件私有 PNG", () => {
	assert.ok(fs.existsSync(path.join(filesRoot, "components", "covers", `${defined.versionId}.png`)));
	const resolved = call("component.resolve", { versionId: defined.versionId });
	assert.equal(resolved.components[0].coverUrl, `recut-test://components/covers/${defined.versionId}.png`);
});

// ---- 4. 迭代：同 componentId 新版本，head 不跟随未验证版本 ----
const v2 = call("component.define", { componentId: defined.componentId, surface: "html", source: HTML_SOURCE.replace("#0ea5e9", "#ff0000") });
check("迭代产生新版本 draft", () => {
	assert.equal(v2.version, 2);
	assert.equal(v2.status, "draft");
});
const headAfterV2 = call("component.resolve", { ids: [defined.componentId] });
check("未验证版本不覆盖 head", () => {
	assert.equal(headAfterV2.components[0].versionId, defined.versionId);
});
check("同一 verified head 不能并发创建第二个 revision draft", () => {
	assert.throws(
		() => call("component.define", { componentId: defined.componentId, baseVersionId: defined.versionId, surface: "html", source: HTML_SOURCE }),
		/stale baseVersionId/,
	);
});

// ---- 5. 验证 @2 → head 迁移 ----
call("component.verify", { versionId: v2.versionId, report: { ok: true } });
const headAfterV2Verified = call("component.resolve", { ids: [defined.componentId] });
check("验证 @2 后 head 迁移", () => {
	assert.equal(headAfterV2Verified.components[0].versionId, v2.versionId);
});
check("component.list 暴露当前 head version 供 revise 固定基线", () => {
	const listed = call("component.list", {}).components.find((component) => component.componentId === defined.componentId);
	assert.equal(listed.versionId, v2.versionId);
});
check("旧 head 不能覆盖并发产生的新版本", () => {
	assert.throws(
		() => call("component.define", { componentId: defined.componentId, baseVersionId: defined.versionId, surface: "html", source: HTML_SOURCE }),
		/stale baseVersionId/,
	);
});

// ---- 6. 失败防护：Math.random 被确定性扫描拦截 ----
const bad = call("component.define", { surface: "react", source: BAD_SOURCE });
check("墙钟/随机源被构建拦截", () => {
	assert.equal(bad.status, "failed");
	assert.equal(bad.buildError.type, "determinism");
	assert.deepEqual(bad.buildError.issues, ["Math.random"]);
});

// ---- 6b. 白名单：非 @recut/runtime 的外部 import 被拒绝 ----
const illegal = call("component.define", { surface: "html", source: ILLEGAL_IMPORT_SOURCE });
check("非法外部 import 被拒绝", () => {
	assert.equal(illegal.status, "failed");
	assert.ok(illegal.buildError.issues.some((i) => i.includes("非法 import")));
});

// ---- 6c. 纯函数组件 default export：构建合法（react 形态 B）----
const fn = call("component.define", { name: "Hello", surface: "react", source: FN_COMPONENT_SOURCE });
check("纯函数组件 default export 构建通过", () => {
	assert.equal(fn.status, "draft", JSON.stringify(fn.buildError));
	const r = call("component.resolve", { versionId: fn.versionId });
	assert.ok(r.components[0].bundle.includes("@recut/runtime"));
});

// ---- 6d. 定义对象缺 render：shape 校验拦截，verified 不再静默放行坏形状 ----
const noRender = call("component.define", { surface: "react", source: NO_RENDER_SOURCE });
check("缺 render 的定义对象被构建 shape 校验拦截", () => {
	assert.equal(noRender.status, "failed");
	assert.equal(noRender.buildError.type, "shape");
	assert.ok(noRender.buildError.errors.some((e) => e.includes("render")));
});

// ---- 7. source 可读（AI 二次调整输入） ----
const src = call("component.source", { componentId: defined.componentId });
check("component.source 返回最新源码", () => {
	assert.equal(src.versionId, v2.versionId);
	assert.ok(src.source.includes("#ff0000"));
});

// ---- 8. list ----
const list = call("component.list", {});
check("component.list 汇总", () => {
	const comp = list.components.find((c) => c.componentId === defined.componentId);
	assert.ok(comp);
	assert.equal(comp.status, "verified");
	assert.equal(comp.version, 2);
	assert.equal(comp.surface, "html");
});

// ---- 8b. 组件数据与素材引用分离 ----
check("verified 组件在项目素材索引中只有一条 component 引用", () => {
	const assets = call("asset.list", {}).assets;
	const asset = assets.find((item) => item.type === "component" && item.componentId === defined.componentId);
	assert.ok(asset);
	assert.equal(asset.assetId, `component:${defined.componentId}`);
	assert.equal(asset.refVersionId, v2.versionId);
});
check("asset.archive 隐藏组件素材但不删除组件数据，也不会被回填复活", () => {
	const archived = call("asset.archive", { type: "component", refId: defined.componentId });
	assert.equal(archived.status, "archived");
	assert.equal(call("asset.list", {}).assets.some((item) => item.componentId === defined.componentId), false);
	assert.equal(call("asset.list", {}).assets.some((item) => item.componentId === defined.componentId), false);
	assert.equal(call("component.list", {}).components.some((item) => item.componentId === defined.componentId), true);
	assert.equal(call("component.resolve", { ids: [defined.componentId] }).components[0].versionId, v2.versionId);
});

// ---- 9. r3f surface 编译含 jsx-runtime import ----
const r3f = call("component.define", { surface: "r3f", source: R3F_SOURCE });
check("r3f 组件编译通过", () => {
	assert.equal(r3f.status, "draft");
	const r = call("component.resolve", { versionId: r3f.versionId });
	assert.ok(r.components[0].bundle.includes('"@recut/runtime/jsx-runtime"'));
});

// ---- 10. verify failed 不覆盖 head ----
call("component.verify", { versionId: r3f.versionId, report: { ok: false, error: "render threw" } });
check("verify 失败置 failed 且 head 不动", () => {
	const st = call("component.verify", { versionId: r3f.versionId });
	assert.equal(st.status, "failed");
	assert.equal(st.report.ok, false);
	const stillHead = call("component.resolve", { ids: [defined.componentId] });
	assert.equal(stillHead.components[0].versionId, v2.versionId);
});

// ---- 11. 归档与项目隔离 ----
check("组件归档只隐藏素材库，不破坏已有时间线解析", () => {
	const archived = call("component.archive", { componentId: defined.componentId });
	assert.equal(archived.status, "archived");
	assert.equal(call("component.list", {}).components.some((item) => item.componentId === defined.componentId), false);
	assert.equal(call("component.resolve", { ids: [defined.componentId] }).components[0].versionId, v2.versionId);
});
check("组件版本读取严格限制在项目 scope 内", () => {
	const previousProject = ctx.project.id;
	ctx.project.id = "proj-other";
	assert.equal(call("component.resolve", { versionId: v2.versionId }).components.length, 0);
	assert.throws(() => call("component.source", { componentId: defined.componentId }), /无版本|no version/);
	assert.throws(() => call("component.source", { componentId: defined.componentId, versionId: v2.versionId }), /无版本|no version/);
	ctx.project.id = previousProject;
});

console.log(failures === 0 ? "\n✅ E2E background 链路全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
