#!/usr/bin/env node
/*
 * [INPUT]: snapshot.json（fetch-project.mjs 的产物，React Flow 格式 { nodes, edges, savedAt }）
 * [OUTPUT]: 在 stdout 打印 + 写 report.md / report.json：节点/边构成、模型与模式、生成参数、分组、用料边、
 *   失效标记、命名习惯、提示词长度、空间布局、引用绑定，以及「这张图是什么」的启发式判断
 * [POS]: docs/analyze-libtv 的核心分析器——把一张制作图翻译成人和 Agent 都能读的结论
 * [PROTOCOL]: 变更时更新此头部，然后检查 docs/analyze-libtv/README.md
 *
 * 用法:
 *   node docs/analyze-libtv/scripts/analyze-snapshot.mjs --in output/analyze-libtv/<uuid>
 *   node docs/analyze-libtv/scripts/analyze-snapshot.mjs --snapshot path/to/snapshot.json --out /tmp/x
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs, countBy, writeJson, writeText } from "./lib/env.mjs";

const args = parseArgs();

function resolveInput() {
  if (args.snapshot) return { file: path.resolve(args.snapshot), dir: path.dirname(path.resolve(args.snapshot)) };
  const inArg = args.in || args._[0];
  if (inArg) {
    const p = path.resolve(inArg);
    const stat = fs.existsSync(p) ? fs.statSync(p) : null;
    if (stat?.isDirectory()) return { file: path.join(p, "snapshot.json"), dir: p };
    return { file: p, dir: path.dirname(p) };
  }
  return null;
}

const input = resolveInput();
if (!input || !fs.existsSync(input.file)) {
  console.error("用法: node analyze-snapshot.mjs --in <dir>  或  --snapshot <snapshot.json>");
  process.exit(1);
}

const outDir = args.out ? path.resolve(args.out) : input.dir;
fs.mkdirSync(outDir, { recursive: true });

const snap = JSON.parse(fs.readFileSync(input.file, "utf8"));
const nodes = snap.nodes ?? [];
const edges = snap.edges ?? [];
const byId = new Map(nodes.map((n) => [n.id, n]));

// ---------- 1. 节点/动作/模型 ----------
const nodeTypes = countBy(nodes, (n) => n.type);
const actions = countBy(nodes, (n) => n.data?.action);
const generatorTypes = countBy(nodes, (n) => n.data?.generatorType);

const mediaNodes = nodes.filter((n) => n.data?.params);
const modelsByKind = {};
for (const kind of ["image", "video", "audio"]) {
  const list = nodes.filter((n) => n.type === kind && n.data?.params?.model);
  if (list.length) modelsByKind[kind] = countBy(list, (n) => n.data.params.model);
}
const modesByKind = {};
for (const kind of ["image", "video", "audio"]) {
  const list = nodes.filter((n) => n.type === kind && n.data?.params?.modeType);
  if (list.length) modesByKind[kind] = countBy(list, (n) => n.data.params.modeType);
}
const settings = countBy(mediaNodes, (n) => n.data?.params?.settings);
const counts = countBy(mediaNodes, (n) => n.data?.params?.count);
const camera = countBy(nodes, (n) => n.data?.params?.cameraControl?.focal);
const stale = countBy(nodes, (n) => String(n.data?.isStale));

// ---------- 2. 分组 ----------
const groups = nodes
  .filter((n) => n.type === "group")
  .map((n) => ({
    id: n.id,
    name: n.data?.name,
    children: n.data?.childNodeIds?.length ?? 0,
    layout: n.data?.groupLayoutMode,
  }));

// ---------- 3. 边 ----------
const edgePairs = countBy(edges, (e) => `${byId.get(e.source)?.type}->${byId.get(e.target)?.type}`);
const edgeHandles = countBy(edges, (e) => `${e.sourceHandle}->${e.targetHandle}`);

// 3.1 边是否 = 各节点的参考列表（imageListOrder / mixedListOrder / audioListOrder ...）
const ORDER_KEYS = [
  "imageListOrder", "imageList", "videoListOrder", "videoList",
  "audioListOrder", "audioList", "textList", "mixedListOrder", "mixedList",
];
const edgeSet = new Set(edges.map((e) => `${e.source}->${e.target}`));
let refsInLists = 0;
let refsWithEdge = 0;
let refsWithoutEdge = 0;
for (const n of nodes) {
  const p = n.data?.params ?? {};
  for (const k of ORDER_KEYS) {
    if (!Array.isArray(p[k])) continue;
    for (const src of p[k]) {
      if (typeof src !== "string" || !byId.has(src)) continue;
      refsInLists++;
      if (edgeSet.has(`${src}->${n.id}`)) refsWithEdge++;
      else refsWithoutEdge++;
    }
  }
}
const refNodes = nodes.filter((n) => {
  const p = n.data?.params ?? {};
  return ORDER_KEYS.some((k) => Array.isArray(p[k]) && p[k].length);
});
const avgRefs = refNodes.length
  ? Math.round(
      (refNodes.reduce(
        (a, n) => a + ORDER_KEYS.reduce((b, k) => b + (Array.isArray(n.data.params[k]) ? n.data.params[k].length : 0), 0),
        0,
      ) /
        refNodes.length) *
        10,
    ) / 10
  : 0;

const indeg = countBy(
  edges.map((e) => e.target),
  (id) => id,
);
const topIn = Object.entries(indeg)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 6)
  .map(([id, d]) => ({ type: byId.get(id)?.type, name: byId.get(id)?.data?.name, in: d }));

// ---------- 4. 命名 ----------
const namePrefix = countBy(nodes, (n) => (n.data?.name ?? "").replace(/[0-9].*$/, "").trim() || n.type);
const copyCount = nodes.filter((n) => /副本/.test(n.data?.name ?? "")).length;

// ---------- 5. 提示词 ----------
function promptStats(kind) {
  const list = nodes.filter((n) => n.type === kind && typeof n.data?.params?.prompt === "string");
  if (!list.length) return null;
  const lens = list.map((n) => n.data.params.prompt.length);
  return {
    n: list.length,
    avg: Math.round(lens.reduce((a, b) => a + b, 0) / lens.length),
    max: Math.max(...lens),
    min: Math.min(...lens),
  };
}
const prompts = { image: promptStats("image"), video: promptStats("video"), audio: promptStats("audio") };
const placeholderUsers = nodes.filter((n) => /\{\{\s*(Mixed|Image|Audio|Video)\s*\d+\s*\}\}/i.test(n.data?.params?.prompt ?? "")).length;

// ---------- 6. 空间 ----------
const pts = nodes.filter((n) => n.type !== "group");
const xs = pts.map((n) => n.position?.x ?? 0);
const ys = pts.map((n) => n.position?.y ?? 0);
const bounds = {
  x: [Math.round(Math.min(...xs)), Math.round(Math.max(...xs))],
  y: [Math.round(Math.min(...ys)), Math.round(Math.max(...ys))],
};

// ---------- 7. 参考 role（如果有） ----------
const refRoles = countBy(
  nodes.flatMap((n) => n.data?.params?.references ?? n.data?.references ?? []),
  (r) => r?.role ?? r?.kind,
);

const report = {
  source: input.file,
  savedAt: snap.savedAt ?? null,
  counts: { nodes: nodes.length, edges: edges.length, groups: groups.length },
  nodeTypes,
  actions,
  generatorTypes,
  modelsByKind,
  modesByKind,
  settings,
  genCounts: counts,
  camera,
  stale,
  groups,
  edgePairs,
  edgeHandles,
  referenceBindings: { refsInLists, refsWithEdge, refsWithoutEdge, avgRefsPerNode: avgRefs, refNodes: refNodes.length },
  topIn,
  namePrefix,
  copyCount,
  prompts,
  placeholderUsers,
  bounds,
  refRoles,
};

// ---------- 渲染 markdown ----------
const j = (o) => JSON.stringify(o ?? {}, null, 0).replace(/","/g, " · ").replace(/[{}"]/g, "");
const L = [];
L.push(`# 制作图分析：${path.basename(outDir)}`);
L.push("");
L.push(`来源：\`${input.file}\``);
L.push("");
L.push(`## 1. 规模`);
L.push(`- **${nodes.length} 个节点 / ${edges.length} 条边**（分组框 ${groups.length} 个）`);
L.push(`- 画布范围：x ${bounds.x[0]}–${bounds.x[1]}，y ${bounds.y[0]}–${bounds.y[1]}`);
L.push("");
L.push(`## 2. 节点类型`);
L.push(`- ${j(nodeTypes)}`);
L.push(`- 动作：${j(actions)}`);
L.push("");
L.push(`## 3. 模型 / 模式 / 参数`);
for (const [k, v] of Object.entries(modelsByKind)) L.push(`- ${k} 模型：${j(v)}`);
for (const [k, v] of Object.entries(modesByKind)) L.push(`- ${k} 模式：${j(v)}`);
L.push(`- 生成数量 count：${j(counts)}`);
L.push(`- 相机预设（focal）：${j(camera)}`);
L.push("");
L.push(`## 4. 连线 = 用料（关键判断）`);
L.push(`- 边类型组合：${j(edgePairs)}`);
L.push(`- 边句柄：${j(edgeHandles)}`);
L.push(
  `- 各节点"参考列表"里的引用：共 ${refsInLists} 条，其中 **${refsWithEdge} 条有对应连线**、${refsWithoutEdge} 条无连线`,
);
L.push(
  `- 有参考列表的节点 ${refNodes.length} 个，平均 ${avgRefs} 条参考 → **连线就是"这次生成用了哪些料"**，不是控制流`,
);
L.push("");
L.push(`## 5. 分组 = 场`);
for (const g of groups) L.push(`- ${g.name}（${g.children} 子节点，布局 ${g.layout ?? "-"}）`);
L.push("");
L.push(`## 6. 下游失效与提示词`);
L.push(`- isStale：${j(stale)}`);
for (const [k, s] of Object.entries(prompts)) if (s) L.push(`- ${k} 提示词：平均 ${s.avg} 字（${s.min}–${s.max}），${s.n} 条`);
L.push(`- 使用 {{Mixed N}} 等占位符的节点：${placeholderUsers} 个`);
L.push("");
L.push(`## 7. 命名习惯`);
L.push(`- 名前缀：${j(namePrefix)}`);
L.push(`- 含"副本"（人工版本管理痕迹）的节点：${copyCount} 个`);
L.push("");
L.push(`## 8. 判断结论（启发式）`);
L.push(`- 这是一张 **生成依赖图**，不是流程图：节点=一次生成（带配方），边=用料绑定。`);
L.push(`- 生产流程：文本/脚本 → 角色设定集 → 关键帧 → 镜头（可带音频）→ 拆首尾帧 →（图外）成片。`);
L.push(`- 版本管理靠"复制改名"（${copyCount} 个副本），一致性靠人眼——正是可被 Agent 化替代的部分。`);
L.push("");

const md = L.join("\n");
writeJson(path.join(outDir, "report.json"), report);
writeText(path.join(outDir, "report.md"), md);
console.log(md);
console.log(`\n已写入:\n  ${path.join(outDir, "report.md")}\n  ${path.join(outDir, "report.json")}`);
