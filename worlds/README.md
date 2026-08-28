# worlds/

平台 World 的**源格式**目录（PGC 内容层，见 [rfc/2026-08-28-pgc-platform-worlds.md](../rfc/2026-08-28-pgc-platform-worlds.md)）。

每个世界是一个内聚目录：

```text
worlds/<slug>/
  world.json     # 元数据 + 实体 + 证据声明；长文本用 $file，资源用相对路径
  world.md       # ★ 世界核心技能（生产工作流、资源使用口径、交付标准）
  references/    # 事实性长文（$file 引用进实体 body）
  examples/      # 世界自带资源（相对路径证据，发布期镜像到 CDN）
```

## 构建与发布

```bash
node scripts/worlds-publish.mjs --check   # 只校验 + 打印 hash 预览（CI 防漂移）
node scripts/worlds-publish.mjs           # 构建 + 镜像资源到 cdn/buckets/worlds/ + catalog
node scripts/worlds-publish.mjs --seed    # 同时生成 service/worldcatalog/ 嵌入种子
```

产物：

- `cdn/buckets/worlds/<id>/<version>/world.json` —— 单文件自包含 manifest（确定性序列化，SHA-256 进 catalog）
- `cdn/buckets/worlds/<id>/<version>/examples/*.png` —— 内容寻址文件名的镜像资源
- `cdn/buckets/worlds/catalog.json` —— 单一 World Catalog（platform + 未来 published）

发布到 CDN 走既有 `make cd-upload` 链路（R2 `recut-assets` 桶 `worlds/` 前缀），访问域名 `https://cdn.recut.video/worlds/…`。

## 源格式规则

- `world.md` 是目录约定（同 SKILL.md）：构建时内联为 manifest 的 `world.skillMd`；可缺省（空技能）。
- 实体长文本：`content.body: { "$file": "references/x.md" }`，路径必须在世界目录内（禁止 `..`）。
- 证据资源：`evidence[].url` 允许世界目录内相对路径（构建期镜像并改写为 CDN 绝对 URL）或绝对 http(s) URL（构建期 HEAD 验证）。
- 其余字段与发布格式一致（manifest 规则见 RFC）。
