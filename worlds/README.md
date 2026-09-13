# worlds/

平台 World 的**源格式 v2** 目录（PGC 内容层，见 [rfc/2026-09-13-world-content-format-v2.md](../rfc/2026-09-13-world-content-format-v2.md)；历史见 [rfc/2026-08-28-pgc-platform-worlds.md](../rfc/2026-08-28-pgc-platform-worlds.md)）。

**一个对象一个文件**：world 是索引，entity / asset 各自成文，canvas 单列。这样大配置轻、diff 细、可复用，同一素材协议也用于 UGC 导出与生成配方（recipe）血缘。

```text
worlds/<slug>/
  world.json        # 世界索引：身份 + entityTypes + relations + provenance（不含 entities）
  entities/         # 一实体一文件：<entityId>.json（typeId/name/intro/detail/attrs）
  assets/           # 一素材一包：<assetId>.json（sidecar）+ 原二进制（可在 examples/ 等目录）
  canvas.json       # 只读画布布局：{ docVersion, canvases:[{ contextId, elements }] }
  world.md          # ★ 世界核心技能（生产工作流、资源使用口径、交付标准）
  references/       # 事实性长文（detail 用 $file 引用）
  examples/         # 世界自带资源（sidecar 可用 file: "../examples/x.png" 指向）
```

## 构建与发布

```bash
node scripts/worlds-migrate-v2.mjs --check  # 校验 v1 → v2 迁移计划（幂等，已迁移则 skip）
node scripts/worlds-migrate-v2.mjs          # 迁移 v1 源目录（拆分实体 / 素材协议 / 自动画布）
node scripts/worlds-publish.mjs --check     # 只校验 + 打印 manifest hash 预览（CI 防漂移）
node scripts/worlds-publish.mjs             # 构建 + 镜像资源到 cdn/buckets/worlds/ + catalog
node scripts/worlds-publish.mjs --seed      # 同时生成 service/worldcatalog/ 嵌入种子
```

产物：

- `cdn/buckets/worlds/<id>/<version>/world.json` —— 单文件自包含 manifest v2（确定性序列化，SHA-256 进 catalog）
- `cdn/buckets/worlds/<id>/<version>/assets/*` —— 镜像资源
- `cdn/buckets/worlds/catalog.json` —— 单一 World Catalog（platform + 未来 published）

发布到 CDN 走既有 `make worlds-publish` / `make cd-upload` 链路（R2 `recut-assets` 桶 `worlds/` 前缀），访问域名 `https://cdn.recut.video/worlds/…`。**内容改到 v2 后必须重新上传 CDN，官网与 daemon 才会看到新 manifest。**

## 导入 / 导出（工作台功能）

World 的导入/导出是**产品能力**（service + 工作台 UI），不是脚本：

- **导入**：工作台 Worlds 列表右上「导入 World」选择 zip → 创建一个本地可编辑 World；素材按内容哈希去重，不会重复入库。
- **导出**：World 详情右上「导出为 zip」→ 下载 v2 源格式 zip（`world.json + entities/ + assets/ + canvas.json + world.md`，媒体内嵌）。
- HTTP：`POST /v1/worlds/import`（multipart `file`）、`GET /v1/worlds/{worldID}/export`（zip 下载）。

把仓库里的 `worlds/<slug>/` 目录导入工作台：先打成 zip 再导入

```bash
(cd worlds && zip -r ../output/worlds-<slug>.zip <slug>)
# 工作台 Worlds 列表 →「导入 World」选该 zip
```

## 结构校验（无浏览器）

```bash
node scripts/worlds-inspect.mjs --all          # 布局/连线/重叠/悬空引用，非零退出=有结构问题
node scripts/worlds-publish.mjs --check        # manifest 校验 + hash
node scripts/worlds-migrate-v2.mjs --canvas    # 改了实体后按类型分带重排 canvas.json
cd service && go test . -run TestEmbeddedSeedManifestsMaterialize   # 真实种子全部可物化
```

## 画布与连线（link）

- `canvas.json` 是**只读画布布局**：`canvases[].elements[]` 用 `refId` 引用源实体 id；物化时命名空间化。
- 自动布局 = 按 `typeId` 分带（角色→物件→场景→故事→风格→规则，每带 ≤4 列，角色置顶）。
- **连线（link）来自语义关系** `world.json.relations[]`（受控词表 `relationType`），物化后由画布自动渲染为箭头；
  没有 relations 就没有连线。示例：

```json
"relations": [
  { "id": "r-1", "type": "appears_in", "from": "xiaohei", "to": "style-dna", "scope": null }
]
```

- 精细布局的推荐工作流：本地把世界 Fork 成 local → 在画布上拖拽/连线 → `worlds.export` 导出覆盖
  `worlds/<slug>/canvas.json`（PID 未实现前，手工编辑 `canvas.json` 的 `geometry` 亦可，`--check` 会校验）。

## 源格式规则

- `world.md` 是目录约定（同 SKILL.md）：构建时内联为 manifest 的 `world.skillMd`；可缺省（空技能）。
- 实体长文本：`detail: { "$file": "../references/x.md" }`，路径须在世界目录内（禁止 `..` 逃逸）。
- 素材协议：`assets/<id>.json` = `{ id, name, kind, file, recipe?, provenance? }`；`file` 相对 `assets/` 目录（允许 `../examples/...`）。实体/画布只写 `{ "asset": "<id>" }`，构建期展开为 CDN 绝对 `{ url, kind, name, recipe? }`。
- 画布 `canvas.json` 的元素 `refId` / `contextId` 用源实体 id；物化时命名空间化为 `<worldId>:<id>`。
- 引用的素材 id / 实体 id / 关系两端必须在同一 bundle 内命中（构建期硬校验）。
- `evidence[]` 已退役；示例图改为实体上的 `type: "media"` attr。
- 其余字段与发布格式一致（manifest 规则见 RFC）。
