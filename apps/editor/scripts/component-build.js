/**
 * [INPUT]: 单文件 TS/TSX 组件源码（仅允许外部 import @recut/runtime）+ 可选 SDK d.ts 目录
 * [OUTPUT]: ESM bundle（external @recut/runtime，jsxImportSource=@recut/runtime）+ 内容寻址 hash；
 *           确定性静态扫描（禁墙钟/随机源）；可选 tsc 类型检查
 * [POS]: 服务端 AI 组件构建工具链（component.define 调用）；结果以 JSON 写 stdout
 * [PROTOCOL]: 变更时更新此头部
 *
 * 用法: node component-build.js <sourceFile> <outFile> [sdkDtsDir|--loose]
 *
 * --loose（AI 作者路径）：跳过 strict tsc 类型检查，保留 shape 校验 + 确定性扫描 + esbuild 可编译
 * ——"运行安全"闸不变，类型卫生只属于受信路径（rfc/2026-08-19 架构 P3：平台拥有框架，模型只拥有内容）。
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

function resolveFrom(pkg, fromDir) {
	return require.resolve(pkg, { paths: [fromDir] });
}

function fail(payload) {
	console.log(JSON.stringify(payload));
	process.exit(1);
}

/** 静态扫描：拒绝墙钟/随机源，且只允许 @recut/runtime 外部 import（单文件组件白名单）。 */
function staticScan(source) {
	const issues = [];
	const FORBIDDEN = [
		"Math.random",
		"Date.now",
		"performance.now",
		"new Date(",
		"setTimeout(",
		"setInterval(",
		"requestAnimationFrame",
		"crypto.random",
		// GSAP 确定性纪律（rfc/2026-08-20 §7）：自动播放 / 禁插件 / 随机一律拒绝。
		// 禁插件的 import 已被下方白名单拦截（只能 import @recut/runtime，而它不导出交互/滚动类）；
		// 这里再拦最容易出现的裸引用。Draggable/Inertia/Observer 不列入以避免与
		// ResizeObserver 等浏览器 API 误伤，由 import 白名单兜底。
		".play(",
		".restart(",
		".resume(",
		"paused: false",
		"paused:false",
		"ScrollTrigger",
		"ScrollSmoother",
		"ScrollToPlugin",
		"Draggable",
		"InertiaPlugin",
		"Observer",
		"gsap.utils.random",
		'"random(',
		"'random(",
	];
	for (const token of FORBIDDEN) {
		if (source.includes(token)) issues.push(token);
	}
	// 裸 gsap.timeline() 必须带 paused:true（否则自动播放走 rAF 时钟，破坏确定性）。
	const timelineRe = /gsap\.timeline\s*\(/g;
	let m;
	while ((m = timelineRe.exec(source)) !== null) {
		const chunk = source.slice(m.index, m.index + 200);
		if (!/paused\s*:\s*true/.test(chunk)) {
			issues.push("gsap.timeline 必须 paused:true（只经 seek/progress 驱动）");
		}
	}
	// html 承载面每帧 innerHTML 重写、无 DOM ref，禁 GSAP；要走 GSAP 请改 surface: react。
	if (
		/surface\s*:\s*["']html["']/.test(source) &&
		/(useTimeline|useGSAP|gsap\.)/.test(source)
	) {
		issues.push("surface html 不支持 GSAP（无 DOM ref / 每帧 innerHTML 重写）；请改用 surface: react");
	}
	// 白名单 import：只允许 @recut/runtime（及其 /jsx-runtime），其余一律拒绝。
	const ALLOWED = ["@recut/runtime"];
	const importRe = /(?:^|\n)\s*import\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
	let match;
	while ((match = importRe.exec(source)) !== null) {
		const specifier = match[1];
		if (!ALLOWED.includes(specifier) && !specifier.startsWith("@recut/runtime/")) {
			issues.push(`非法 import: ${specifier}`);
		}
	}
	return issues;
}

const COMPONENT_SURFACES = ["html", "react", "r3f"];

function isFunctionLike(node, tsc) {
	return (
		tsc.isArrowFunction(node) ||
		tsc.isFunctionExpression(node) ||
		tsc.isFunctionDeclaration(node) ||
		tsc.isMethodDeclaration(node)
	);
}

/** 校验定义对象字面量：必须有函数 render，surface（若有）合法，getContentBounds（若有）是函数。 */
function validateObjectDefinition(node, tsc) {
	const props = new Map();
	for (const prop of node.properties) {
		let key = null;
		if (tsc.isPropertyAssignment(prop) && tsc.isIdentifier(prop.name)) key = prop.name.text;
		else if (tsc.isMethodDeclaration(prop) && tsc.isIdentifier(prop.name)) key = prop.name.text;
		else if (tsc.isShorthandPropertyAssignment(prop) && tsc.isIdentifier(prop.name)) key = prop.name.text;
		if (key) props.set(key, prop);
	}
	const renderProp = props.get("render");
	if (!renderProp) return ["default 定义对象缺少 render 方法：组件无法渲染"];
	if (tsc.isPropertyAssignment(renderProp) && !isFunctionLike(renderProp.initializer, tsc)) {
		return ["default 定义对象的 render 必须是函数"];
	}
	const surfaceProp = props.get("surface");
	if (surfaceProp && tsc.isPropertyAssignment(surfaceProp) && tsc.isStringLiteralLike(surfaceProp.initializer)) {
		const value = surfaceProp.initializer.text;
		if (!COMPONENT_SURFACES.includes(value)) return [`surface 非法: ${value}（必须为 ${COMPONENT_SURFACES.join("/")}）`];
	}
	const boundsProp = props.get("getContentBounds");
	if (boundsProp && tsc.isPropertyAssignment(boundsProp) && !isFunctionLike(boundsProp.initializer, tsc)) {
		return ["getContentBounds 必须是函数"];
	}
	return [];
}

/** 形状校验：default export 必须是「定义对象」或「纯函数组件」，否则 verified 也可能无法运行。 */
function runShapeCheck(sourcePath) {
	const tsc = require(resolveFrom("typescript", path.join(__dirname, "..", "ui")));
	const source = fs.readFileSync(sourcePath, "utf8");
	const sf = tsc.createSourceFile(path.basename(sourcePath), source, tsc.ScriptTarget.Latest, true, tsc.ScriptKind.TSX);

	let defaultExport = null; // { kind, node, name? }
	for (const stmt of sf.statements) {
		if (tsc.isExportAssignment(stmt)) {
			const expr = stmt.expression;
			if (tsc.isObjectLiteralExpression(expr)) defaultExport = { kind: "object", node: expr };
			else if (isFunctionLike(expr, tsc)) defaultExport = { kind: "function", node: expr };
			else if (tsc.isClassExpression(expr)) defaultExport = { kind: "class", node: expr };
			else if (tsc.isIdentifier(expr)) defaultExport = { kind: "identifier", name: expr.text };
			else defaultExport = { kind: "other", node: expr };
			break;
		}
		if (
			(tsc.isFunctionDeclaration(stmt) || tsc.isClassDeclaration(stmt)) &&
			stmt.modifiers && stmt.modifiers.some((m) => m.kind === tsc.SyntaxKind.DefaultKeyword)
		) {
			defaultExport = { kind: tsc.isFunctionDeclaration(stmt) ? "function" : "class", node: stmt };
			break;
		}
	}
	if (!defaultExport) return ["缺少 default export：组件必须导出定义对象（含 render）或纯函数组件"];

	if (defaultExport.kind === "object") {
		return validateObjectDefinition(defaultExport.node, tsc);
	}
	if (defaultExport.kind === "identifier") {
		// 解析标识符指向的顶层声明；解析不出时放行（运行时仍有兜底校验）。
		for (const stmt of sf.statements) {
			if (tsc.isVariableStatement(stmt)) {
				for (const decl of stmt.declarationList.declarations) {
					if (tsc.isIdentifier(decl.name) && decl.name.text === defaultExport.name) {
						const init = decl.initializer;
						if (!init) return [];
						if (isFunctionLike(init, tsc) || tsc.isClassExpression(init)) return [];
						if (tsc.isObjectLiteralExpression(init)) return validateObjectDefinition(init, tsc);
						return [];
					}
				}
			} else if (
				(tsc.isFunctionDeclaration(stmt) || tsc.isClassDeclaration(stmt)) &&
				stmt.name && stmt.name.text === defaultExport.name
			) {
				return [];
			}
		}
		return [];
	}
	if (defaultExport.kind === "other") {
		return ["default export 必须是定义对象（含 render 方法）或纯函数组件"];
	}
	// function / class → 纯函数组件（或类组件）形态，合法。
	return [];
}

async function main() {
	const args = process.argv.slice(2);
	const sourcePath = args[0];
	const outPath = args[1];
	const maybeDts = args[2];
	const loose = maybeDts === "--loose";
	const sdkDtsDir = loose ? null : maybeDts;
	if (!sourcePath || !outPath) {
		fail({ ok: false, type: "usage", error: "用法: node component-build.js <sourceFile> <outFile> [sdkDtsDir|--loose]" });
	}

	let source;
	try {
		source = fs.readFileSync(sourcePath, "utf8");
	} catch (error) {
		fail({ ok: false, type: "read", error: String((error && error.message) || error) });
	}

	const issues = staticScan(source);
	if (issues.length > 0) {
		fail({ ok: false, type: "determinism", issues });
	}

	let esbuild;
	try {
		esbuild = require(resolveFrom("esbuild", path.join(__dirname, "..", "ui")));
	} catch (error) {
		fail({ ok: false, type: "esbuild", error: "esbuild 不可用: " + String((error && error.message) || error) });
	}

	let result;
	try {
		result = await esbuild.transform(source, {
			loader: "tsx",
			jsx: "automatic",
			jsxImportSource: "@recut/runtime",
			format: "esm",
			target: "chrome130",
			sourcemap: "inline",
		});
	} catch (error) {
		fail({ ok: false, type: "compile", error: String((error && error.message) || error) });
	}

	const bundle = result.code;
	const bundleHash = crypto.createHash("sha256").update(bundle).digest("hex");

	let typeErrors = [];
	if (!loose && sdkDtsDir) {
		typeErrors = runTypecheck({ sourcePath, sdkDtsDir });
		if (typeErrors.length > 0) {
			fail({ ok: false, type: "typecheck", errors: typeErrors });
		}
	}
	// shape 校验与确定性扫描是"运行安全"闸：任何路径（含 --loose）都必须通过。
	const shapeErrors = runShapeCheck(sourcePath);
	if (shapeErrors.length > 0) {
		fail({ ok: false, type: "shape", errors: shapeErrors });
	}

	fs.writeFileSync(outPath, bundle, "utf8");
	console.log(
		JSON.stringify({ ok: true, bundleHash, bytes: Buffer.byteLength(bundle) }),
	);
}

function runTypecheck({ sourcePath, sdkDtsDir }) {
	try {
		const tsc = require(resolveFrom("typescript", path.join(__dirname, "..", "ui")));
		const dtsPath = path.join(sdkDtsDir, "runtime.d.ts");
		if (!fs.existsSync(dtsPath)) {
			return [`SDK d.ts 不存在: ${dtsPath}`];
		}
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recut-comp-"));
		const localDts = path.join(tmpDir, "runtime.d.ts");
		fs.copyFileSync(dtsPath, localDts);
		const program = tsc.createProgram({
			rootNames: [sourcePath, localDts],
			options: {
				noEmit: true,
				strict: true,
				jsx: tsc.JsxEmit.ReactJSX,
				jsxImportSource: "@recut/runtime",
				module: tsc.ModuleKind.ESNext,
				moduleResolution: tsc.ModuleResolutionKind.Bundler,
				target: tsc.ScriptTarget.ES2022,
				lib: ["lib.dom.d.ts", "lib.es2022.d.ts"],
				skipLibCheck: true,
				types: [],
			},
		});
		const diagnostics = tsc.getPreEmitDiagnostics(program);
		return diagnostics
			.filter((d) => d.file && !d.file.fileName.endsWith("runtime.d.ts"))
			.map((d) => {
				const pos = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : null;
				const line = pos ? pos.line + 1 : "?";
				const col = pos ? pos.character + 1 : "?";
				return `(${line},${col}) TS${d.code}: ${tsc.flattenDiagnosticMessageText(d.messageText, "\n")}`;
			});
	} catch (error) {
		return [`typecheck 不可用: ${String((error && error.message) || error)}`];
	}
}

main().catch((error) => {
	fail({ ok: false, error: String((error && error.stack) || error) });
});
