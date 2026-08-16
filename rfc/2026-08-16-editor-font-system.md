<!--
 * [INPUT]: 依赖编辑器现状：apps/editor/ui 的字体选择（font-picker.tsx 下拉 + font-atlas.json 全量 Google Fonts 目录 + font-chunk-*.avif 字体名预览图）、
 *          字体加载（google-fonts.ts 注入 fonts.googleapis.com CSS、SYSTEM_FONTS 硬编码 9 个系统字体）、
 *          文字渲染（primitives.ts 拼 ctx.font → runtime/components/text.tsx Canvas 纹理 → Three.js）、
 *          导出链路（background.js export.complete 收浏览器编码字节，无服务端渲染）、
 *          service（Go daemon：server.go 路由、media_server.go 素材 content 交付、workspace.sqlite 媒体资产）、
 *          编辑器 App 权限（manifest.json permissions: files + media.read/write）、
 *          现有 Google Fonts CDN 依赖与中文（CJK）字体缺位、Recut 自有 CDN 工作区（cdn/buckets + scripts/fetch-*.mjs + make upload PREFIX=）
 * [OUTPUT]: 定义编辑器字体的整体方案契约：Recut 自有 CDN 自托管字体（cdn/fonts/google，fetch-fonts.mjs 一次编制上传）、
 *          service 提供 /v1/fonts 目录与字体文件 API（首次从自家 CDN 抓取 + 内容寻址缓存 + 离线可用，运行期不依赖 Google）、
 *          Google Fonts / Local Fonts 双 Tab 面板、
 *          中文字体（CJK）策略、用户本机字体枚举（queryLocalFonts + SYSTEM_FONTS 扩充）与字体文件上传注册（FontFace + 存为资产/项目文件）、
 *          渲染与导出一致性的字体可用性保证，以及分阶段实施与基于 Playwright 的分层端到端验证方案（L1 Go httptest / L2 编辑器 E2E / L3 全链路）
 * [POS]: rfc 的编辑器字体系统实施蓝图；获批后落到 service 路由与编辑器 fonts/* 与 font-picker 面板，并反向更新 README
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: 编辑器字体系统——Service 字体 API、Google/Local 双 Tab 面板与中文支持

- 状态：实施中（Phase 0-3 已完成：Recut CDN 自托管字体源 fetch-fonts.mjs + cdn/buckets/fonts/google、service /v1/fonts*（目录/自托管 CSS/woff2 缓存/local 上传）、编辑器字体模块切自托管 + SYSTEM_FONTS 扩充中文 + queryLocalFonts 枚举、Google/Local 双 Tab FontPanel、L1 Go httptest + L2 Playwright fonts/* 已落地）
- 作者：Recut
- 日期：2026-08-16
- 决策范围：字体真相（目录与二进制来源）、Service 字体 API 契约、Google Fonts 自托管 vs CDN、Local Fonts 枚举与上传、CJK 中文字体策略、双 Tab 面板交互、渲染/导出字体可用性保证、缓存与离线、分阶段实施
- 关联：`apps/editor/ui/src/components/ui/font-picker.tsx`、`apps/editor/ui/src/fonts/*`（google-fonts.ts / system-fonts.ts / local-fonts.ts / service-catalog.ts / use-font-atlas.ts / types.ts）、`apps/editor/ui/public/fonts/*`（font-atlas.json + font-chunk-*.avif）、`apps/editor/ui/src/text/primitives.ts`、`apps/editor/ui/src/runtime/components/text.tsx`、`apps/editor/ui/src/core/managers/project-manager.ts`、`apps/editor/manifest.json`、`service/fonts.go`、`service/fonts_server.go`、`service/fonts_server_test.go`、`service/fonts_catalog.json`、`service/server.go`、`cdn/scripts/fetch-fonts.mjs`、`cdn/Makefile`、`cdn/buckets/fonts/google/*`、`apps/editor/ui/tests/e2e/fonts/*`、`ARCHITECTURE.md`
- 实施进展：已实施（除 L3 全链路套件待跑、CDN 实际上传待执行）

## 1. 背景与病灶

编辑器文字元素需要设置字体，但当前的字体体系有四类问题：

1. **字体目录只含英文**。`font-atlas.json` 是构建期生成的全量 Google Fonts 目录（11348 行 JSON，数千家族），但预览用的 `font-chunk-*.avif` 只渲染了拉丁字形；Google Fonts 的中文（CJK）家族（Noto Sans SC / 思源宋体 / ZCOOL 系列 / 马善政 / 龙藏等）未进目录，用户在界面上看不到、也选不到任何中文字体。
2. **系统字体硬编码且极少**。`system-fonts.ts` 只列了 9 个：Arial / Helvetica / Times New Roman / Courier New / Verdana / Georgia / monospace / sans-serif / serif。**没有一个是中文字体**（PingFang SC、微软雅黑、思源黑体等全部缺失），也没有枚举本机已装字体的机制——中文用户无法选用自己机器上天然可用的中文字体。
3. **字体文件依赖 Google CDN**。选中字体后 `loadFullFont`（`google-fonts.ts:56`）向 `https://fonts.googleapis.com/css2` 注入样式表加载字重 400/700。离线、内网或 Google 不可达时字体加载失败，成片文字回退 `sans-serif`。且每次项目加载（`project-manager.ts:170`）都对项目用到的字体拉 CDN。
4. **选择器是下拉列表，预览弱**。`font-picker.tsx` 是一个 Popover 内的单行虚拟列表，只有字体名的字形预览（FontSpritePreview），没有分类筛选、没有"我的字体"、没有真正的面板式网格与多信息展示。UI 里已有 "All fonts / My fonts / Favorites" 三个 Tab 骨架，但 My fonts 与 Favorites 均未实现。

**目标**：让中英文用户都能方便地找到、预览并选用字体，来源包括「平台提供的 Google Fonts 目录」与「用户自己的本地字体」；目录与字体文件统一由本地 service 提供 API，彻底摆脱 Google CDN 依赖；字体面板改为带真实预览的双 Tab 面板。

**边界**：本期只做 `google`（平台 curated 的 Google Fonts 目录）与 `local`（系统已装 + 用户上传）两类来源，不做 Favorites 收藏持久化；不做字体本身的上传 CDN/同步到云端；不改变文字渲染的 canvas 绘制链路（`primitives.ts` 与 `text.tsx`），只保证「字体在 `document.fonts` 里注册、渲染时可用」；不改导出架构（仍浏览器内编码）。

## 2. 关键不变量

1. **渲染/导出同源**：文字一律 canvas 绘制（`primitives.ts:71` 拼 `ctx.font` → `text.tsx` 画成纹理），导出也是浏览器内编码。因此**字体可用性的唯一要求 = 该 family 在渲染时的浏览器里 `document.fonts` 已注册**。这决定了本地字体的可行性（本机浏览器能看到 → 能渲染 → 能导出）。
2. **fontFamily 值保持字符串不变**：时间线 `params.fontFamily` 语义不变，仍是字面家族名；不引入新的字体引用字段（本期不做项目级字体资产引用，见开放问题）。
3. **目录与二进制解耦**：目录（名字/分类/字重/脚本/预览）与字体二进制（woff2）是两份数据；目录可随编辑器/服务版本更新，二进制按需下载并缓存。

## 3. 决策记录

| # | 决策 |
|---|---|
| D1 | **字体来源两类**：`google`（平台 curated 的 Google Fonts 目录，含 CJK 家族）与 `local`（本机系统已装字体 + 用户上传的字体文件）。编辑器面板为 **Google Fonts / Local Fonts 双 Tab** |
| D2 | **Service 提供字体 API**：新增 `GET /v1/fonts`（目录）、`GET /v1/fonts/google/{id}/css`（自托管 @font-face，含 unicode-range 分片）、`GET /v1/fonts/google/{id}/{subset}-{weight}.woff2`（字体文件）、`GET/POST /v1/fonts/local`（已装/上传列表与上传）。编辑器不再直连 Google CDN |
| D3 | **Google 字体二进制自托管到 Recut 自己的 CDN，service 本地缓存**：新增 `cdn/scripts/fetch-fonts.mjs` 把 curated 的 Google Fonts（含 CJK）一次性抓取为 woff2 分片，生成 `cdn/buckets/fonts/google/{id}.css`（@font-face + unicode-range，url 指向 CDN）+ `{id}/{subset}-{weight}.woff2` + `catalog.json`，经 `make upload PREFIX=fonts` 上传到 `https://cdn.recut.video/fonts/google/`。service 的 `/v1/fonts/google/{id}/{subset}-{weight}.woff2` 首次请求从**自己的 CDN**（而非 Google）抓取并落盘内容寻址缓存，此后完全离线可用；编辑器运行期不再依赖 `fonts.googleapis.com`/`fonts.gstatic.com` |
| D4 | **CJK 进目录**：curated Google 目录补进中文常用家族（Noto Sans SC、Noto Serif SC、思源黑体/宋体、ZCOOL 三款、马善政、龙藏、霞鹜文楷 LXGW WenKai、系统 PingFang/雅黑别名等），并在目录条目上标注 `scripts: ["zh"]` 供面板分组；分片沿用 unicode-range 只按需下载字形子集 |
| D5 | **Local Fonts 枚举用 `queryLocalFonts()` + 扩充的 SYSTEM_FONTS**：Chromium 桌面独有 API `window.queryLocalFonts()` 拿到本机真实已装字体（含 PingFang SC、微软雅黑等中文）；用 `document.fonts.check()` 探测作为兜底；`SYSTEM_FONTS` 扩充常用跨平台中文字体名。二者均不复制二进制，只作 family 名引用 |
| D6 | **用户上传字体走 FontFace + 存为项目文件/媒体资产**：编辑器 iframe 用 file input 选 `.ttf/.otf/.woff2`，读字节 → `new FontFace(family, buffer)` → `document.fonts.add()` 注册（渲染可用）；二进制经 App `files` 权限写入项目文件根并登记（或导入为 media Asset），随项目加载时回灌注册，保证跨机器/会话可复现 |
| D7 | **面板 UI 重写为双 Tab 面板**：替换 `font-picker.tsx` 的下拉 Popover；Google 页 = 搜索 + 分类/脚本筛选 + 字体卡片网格（复用 `font-chunk-*.avif` 字形预览，选中的实时加载真字重）；Local 页 = 系统已装（卡片即时预览）+ 已上传字体（可删）+ 上传入口 |
| D8 | **字重与负载控制**：面板预览用现有 atlas 字形图（轻量、零字体下载）；仅当用户选中某 family 时 `loadFullFont` 加载 400/700（或选中字重），CJK family 经 unicode-range 只取用到的子集，不整字库加载 |

## 4. 架构总览

```text
┌───────────────────────────── editor iframe (apps/editor/ui) ─────────────────────────────┐
│  FontPanel（双 Tab）                                                                      │
│   ├─ Google Fonts Tab：目录(GET /v1/fonts) → 分类/脚本筛选 → 卡片网格(现有 atlas 预览)      │
│   │      └─ 选中 → fetch /v1/fonts/google/{id}/css → @font-face(本地) → document.fonts     │
│   └─ Local Fonts Tab：queryLocalFonts()/SYSTEM_FONTS 枚举 → 即时预览                       │
│          └─ 上传 .ttf/.otf/.woff2 → FontFace 注册 → 经 files 权限存项目/资产                │
│  ├─ 渲染：primitives.ts ctx.font = "<family>, sans-serif"（与现在一致，字体已注册即生效）    │
│  └─ 导出：浏览器内编码（字体已注册即生效，Preview == Export）                               │
└───────────────▲────────────────────────────────────────────────────────────────────────┘
                │ fetch /v1/fonts*（同源 localhost：与 /v1/media/assets/{id}/content 一致）
┌───────────────┴────────────────────────── service (Go daemon) ──────────────────────────┐
│  /v1/fonts                   目录：curated google 目录 + local(系统枚举元数据/上传列表)      │
│  /v1/fonts/google/{id}/css   @font-face CSS（unicode-range 分片，url 指向本服务）           │
│  /v1/fonts/google/{id}/{s}-{w}.woff2  字体二进制：内容寻址缓存（首次从 Recut CDN 取，此后离线）│
│  /v1/fonts/local             GET 列表 / POST 上传（写 App files 区或 media Asset）           │
│  缓存目录 .recut/fonts/（或复用 media 内容寻址文件区）                                      │
└───────────────▲──────────────────────────────────────────────────────────────────────────┘
                │ 首次未命中时从 Recut 自有 CDN 抓取
┌───────────────┴────────────────────────── Recut CDN (Cloudflare R2) ────────────────────┐
│  cdn/buckets/fonts/google/              <- 由 cdn/scripts/fetch-fonts.mjs 生成            │
│    catalog.json                          curated 目录（含 CJK 家族）                        │
│    {id}.css                              @font-face + unicode-range（url 指向 CDN）         │
│    {id}/{subset}-{weight}.woff2          分片字体二进制                                     │
│  https://cdn.recut.video/fonts/google/...  <- make upload PREFIX=fonts                     │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

关键决策依据：

- **Service 承载字体与编辑器已有的媒体同构**：编辑器已用 `window.location.origin/v1/media/assets/{id}/content` 拿媒体二进制（`sdk.ts:97`），同一 origin 下加 `/v1/fonts/*` 无跨域/鉴权新问题。
- **自托管到 Recut CDN，杜绝 Google 不可达**：运行期任何请求都不指向 `fonts.googleapis.com`/`fonts.gstatic.com`。`fetch-fonts.mjs` 只在上游编制时访问 Google 一次，把 woff2 分片 + CSS + catalog 落入 `cdn/buckets/fonts/google` 并上传 R2；service 首次请求时从**自己的 CDN** 拉取并内容寻址落盘，之后离线可用。对无法访问 Google 的用户（大陆网络等）不再有加载失败。
- **Local Fonts 枚举只给"名字"**：`queryLocalFonts()` 拿到的字体直接以 family 名使用即可渲染（本机浏览器本来就装着），不需要把二进制拉进系统。只有**上传**的场景才真正产生二进制拷贝（用于跨机器复现与离线导出前的可靠性，见 §7）。

## 5. Service 字体 API 契约

### 5.1 `GET /v1/fonts`

返回目录摘要，供面板首屏（分页/分组）：

```json
{
  "version": 3,
  "sources": ["google", "local"],
  "google": [
    {
      "id": "noto-sans-sc",
      "family": "Noto Sans SC",
      "category": "sans-serif",
      "weights": [100, 200, 300, 400, 500, 700, 900],
      "scripts": ["latin", "zh"],
      "preview": { "ch": 0, "x": 0, "y": 0, "w": 152 }
    }
  ],
  "local": [
    { "id": "sys-pingfang", "family": "PingFang SC", "source": "system" },
    { "id": "up-abc123", "family": "MyCustom", "source": "upload", "assetId": "…" }
  ]
}
```

- `preview` 引用现有 `font-chunk-*.avif` 的字体名字形预览（Google 家族）；local 家族无 atlas 预览，用真实字体即时渲染。
- `local.source="system"` 由浏览器侧 `queryLocalFonts()`/探测得出（服务端只给"已上传"的列表），见 §6。
- Google 目录数据可内嵌服务端（`go:embed` 一份 curated JSON），也可复用编辑器现有 `font-atlas.json` 迁移而来；CJK 条目由 curated 补充。

### 5.2 `GET /v1/fonts/google/{id}/css`

返回自托管 @font-face 样式表，`src: url(...)` 全部指向本服务，沿用 Google Fonts 的 unicode-range 分片：

```css
/* Noto Sans SC，只声明需要的字重与子集 */
@font-face {
  font-family: "Noto Sans SC";
  font-style: normal;
  font-weight: 400;
  src: url("/v1/fonts/google/noto-sans-sc/cyrillic-400.woff2") format("woff2");
  unicode-range: U+0400-04FF; /* … */
}
@font-face {
  font-family: "Noto Sans SC";
  font-style: normal;
  font-weight: 400;
  src: url("/v1/fonts/google/noto-sans-sc/latin-400.woff2") format("woff2");
  unicode-range: U+0000-00FF; /* … */
}
@font-face {
  font-family: "Noto Sans SC";
  font-style: normal;
  font-weight: 400;
  src: url("/v1/fonts/google/noto-sans-sc/chinese-simplified-400.woff2") format("woff2");
  unicode-range: U+4E00-9FFF; /* … 大分片，按需下载 */
}
```

- 查询参数 `?weight=400;700`（多字重用分号，与 Google 一致）或 `?weights=400,700`，缺省 400;700。
- `Cache-Control` 长缓存（内容寻址，同 media 的 `completedMediaCacheControl`）。

### 5.3 `GET /v1/fonts/google/{id}/{subset}-{weight}.woff2`

- 首次请求：服务端解析 family/subset/weight → 从 Recut 自有 CDN（`https://cdn.recut.video/fonts/google/{id}/{subset}-{weight}.woff2`，`fonts.gstatic.com` 永远不出现）抓取 → 内容寻址落盘缓存（`sha256` 命名）→ 返回。
- 命中缓存：直接 ServeFile，长缓存；离线可完全工作。
- CDN 失败：返回 `502` + 结构化 error code，编辑器回退系统字体或提示离线（见 §6.4 兜底）。

### 5.4 `GET /v1/fonts/local` / `POST /v1/fonts/local`

- `GET`：返回已上传字体列表（family、文件名、weight、assetId/项目文件路径、注册来源）。
- `POST`：multipart 上传 `.ttf/.otf/.woff2`，校验魔数与大小上限（如 20MB），解析 family 名（从字体文件 name table 或前端上报），保存；返回列表项。
- 存储选型（开放问题 A）：优先走**编辑器 App 项目文件根**（manifest 已有 `files` 权限，`/v1/projects/{id}/apps/recut.editor/files/…` 交付，随项目走）；或导入为 **media Asset**（复用 `media_server.go` 的 content 交付，但当前 `importMediaAsset` 只接受 image/audio/video MIME，需放开 font MIME，见开放问题 B）。

### 5.5 鉴权与 CORS

与现有 `/v1/*` 一致：本地 loopback origin 或 `app.localhost`/LAN 私网来源放行（`server.go withLocalCORS`）；字体文件需要 `Cross-Origin-Resource-Policy: cross-origin` 以允许 iframe（editor UI 与 service 可能不同源）中 canvas 绘制，同时 `@font-face` 需要 `Access-Control-Allow-Origin`（同现有 media content 的交付方式核对补充）。

## 6. Local Fonts：枚举、上传与渲染可用性

### 6.1 系统字体枚举（不产生二进制）

- 首选 `window.queryLocalFonts()`（Local Font Access API，Chromium 桌面独有——**与编辑器 CanvasDrawElement 对 Chromium 149+ 的要求天然契合**）。返回真实已装字体（family/fullName/style/weight），含 PingFang SC、Microsoft YaHei、Source Han 等中文系统字体。需要用户授权（`showLocalFonts` 权限），一次授权在会话内可复用；拒绝时降级到 6.2。
- 兜底：`document.fonts.check('16px "<family>"')` 探测一份扩充后的候选清单；`SYSTEM_FONTS` 由 9 个扩到约 30 个常用跨平台中文字体名（PingFang SC、Hiragino Sans GB、Songti SC、Microsoft YaHei、Microsoft YaHei UI、SimHei、SimSun、NSimSun、KaiTi、FangSong、Source Han Sans/Serif CN、HarmonyOS Sans 等）。
- 渲染可用性：系统字体 family 名直接写进 `ctx.font` 即生效（浏览器原生可用），无需 `document.fonts.add`。

### 6.2 用户上传字体

- 前端：`<input type="file" accept=".ttf,.otf,.woff2">` → `arrayBuffer()` → 从文件解析 family（用 `FontFace(family, buffer)` 注册时需真实家族名；可先用 `DataView` 读 name table，或上传后由 service/前端工具解析）。
- 注册：`face = new FontFace(family, buffer); await face.load(); document.fonts.add(face);` → 渲染可用。
- 持久化：`POST /v1/fonts/local` 上传，二进制存项目文件根/资产；项目加载时（`project-manager.ts` 的 `loadFonts` 路径）按需回灌注册，跨机器复现。

### 6.3 项目加载路径（回灌）

`project-manager.ts:170` 现有的 `loadFonts({ families })` 扩展：
- 对 Google family → 走 `/v1/fonts/google/{id}/css`（D2）。
- 对系统 family → 跳过（本机可用）。
- 对上传 family → 读项目文件/资产字节 → `FontFace` 注册。

### 6.4 离线/上游失败兜底

- 字体 CSS/woff2 已缓存 → 完全离线可用。
- 未缓存且 Recut CDN 不可达 → `loadFullFont` 返回失败 → 渲染回退 `sans-serif`（与现状一致），面板显示该字体"未下载/离线"状态并允许重试。因为上游是自己的 CDN 而非 Google，正常网络下可用性显著提升。

## 7. 渲染与导出一致性

- 编辑器预览、首帧封面、导出全部在浏览器内 canvas 渲染，字体可用性依赖同一 `document.fonts`。**选字时即注册 → 预览与导出同源，无需额外处理**（这是现有架构的红利，RFC 明确不动渲染链路）。
- 上传字体的可靠性场景：用户在本机预览用的系统字体，换机器打开项目可能缺失；此时"上传"方案（D6）把二进制随项目走，比纯系统名引用更可靠。系统字体引用在换机时以探测降级提示（6.1）。

## 8. 编辑器面板 UI 设计（替换 font-picker.tsx）

### 8.1 结构

```text
FontPanel（Modal / 右侧面板，承载于参数面板 "font" 参数）
├─ 顶部：搜索框 + 关闭
├─ Tabs： [ Google Fonts ] [ Local Fonts ]
├─ Google Fonts Tab
│   ├─ 筛选条：分类(Sans/Serif/Display/Handwriting/中文) + 脚本(latin/zh/all)
│   └─ 卡片网格（虚拟滚动，复刻现有 react-window List 改网格）
│       └─ 卡片：字体名字形预览(FontSpritePreview) + family + 权重角标
│             └─ 点击 → 实时 loadFullFont 真字重预览 → 双击/确定 → onValueChange(family)
├─ Local Fonts Tab
│   ├─ 系统已装（queryLocalFonts / 探测）——卡片即时用真实字体渲染名字
│   ├─ 已上传字体（GET /v1/fonts/local）——同上 + 删除按钮
│   └─ 「上传字体」按钮 → file input → FontFace 注册 + POST /v1/fonts/local → 出现在列表
└─ 底部：当前选中字体名 + 应用（沿用参数面板的 commit 语义）
```

### 8.2 交互细节

- **预览性能**：网格浏览阶段只用 atlas 字形图（`font-chunk-*.avif`，mask 预览），零字体下载；悬停/选中某卡片才 `loadFullFont` 该 family 真实字重，供"选中态"放大预览。Local 页系统字体本机即渲染，零成本。
- **无 network 时**：Google Tab 显示目录（若目录已随包内嵌）+ 卡片标记"未下载"，点选走 6.4 兜底。
- **保留现有调用点**：`masks-tab.tsx:705` 与参数面板 `registry.ts:193` 的 `type: "font"` 渲染都改挂 FontPanel；`FontPicker` 组件名与 props（`defaultValue/onValueChange`）保持兼容，减少扩散改动。

## 9. 数据与接口契约汇总

| 契约 | 位置 | 语义 |
|---|---|---|
| `GET /v1/fonts` | service | 字体目录摘要（google curated + local 上传列表） |
| `GET /v1/fonts/google/{id}/css` | service | 自托管 @font-face（unicode-range 分片，本地 url） |
| `GET /v1/fonts/google/{id}/{subset}-{weight}.woff2` | service | 字体二进制（首次从 Recut CDN 抓取，内容寻址缓存，离线可用） |
| `cdn/buckets/fonts/google/*` + `make upload PREFIX=fonts` | `cdn/scripts/fetch-fonts.mjs` + `cdn/Makefile` | 自托管字体源（css/woff2/catalog），上传到 `https://cdn.recut.video/fonts/google/` |
| `GET/POST /v1/fonts/local` | service | 已上传字体列表 / 上传 `.ttf/.otf/.woff2` |
| `queryLocalFonts()` + `document.fonts.check` | 编辑器 iframe | 本机已装字体枚举（含中文） |
| `SYSTEM_FONTS` 扩充 | `fonts/system-fonts.ts` | 常用跨平台中文字体名兜底 |
| `FontFace` 注册 | 编辑器 iframe + 项目加载回灌 | 上传字体渲染可用 |
| `fontFamily` 字符串 | 时间线 params（不变） | 家族名字面值，向后兼容 |

## 10. 迁移路径与分阶段实施

**Phase 0 —— 自托管 CDN + service 字体服务**
1. 新增 `cdn/scripts/fetch-fonts.mjs`：从 Google Fonts CSS2 API 一次性抓取 curated 家族（含 CJK）的 woff2 分片，生成 `cdn/buckets/fonts/google/{id}.css` + `{id}/{subset}-{weight}.woff2` + `catalog.json`；`make -C cdn fetch-fonts` 后 `make -C cdn upload PREFIX=fonts` 上传到 `https://cdn.recut.video/fonts/google/`。
2. `service` 新增字体存储与缓存层（目录 JSON 内嵌 + woff2 内容寻址缓存目录，缓存根 `store.root/fonts/`）。
3. `GET /v1/fonts` 目录（内嵌 curated 数据，含 CJK 家族元数据）。
4. `GET /v1/fonts/google/{id}/css` 与 `…/{subset}-{weight}.woff2`（首次从 Recut CDN 抓取 + 落盘缓存 + 离线 ServeFile）。可独立验收：curl 目录/字体可用。

**Phase 1 —— 编辑器切自托管 + 系统字体**
5. `google-fonts.ts` 的 `loadFullFont` 改走 `/v1/fonts/google/{id}/css`，CDN 兜底。
6. `SYSTEM_FONTS` 扩充中文字体名；`project-manager.ts` 回灌路径区分 google/system/upload 三源。
7. Local 枚举接入 `queryLocalFonts()` + 探测兜底。

**Phase 2 —— 面板双 Tab**
7. `font-picker.tsx` 重写为 FontPanel（§8），`type:"font"` 参数渲染与 masks-tab 调用点切换。
8. Google Tab 分类/脚本筛选 + 选中即时真字重预览；Local Tab 系统 + 上传。

**Phase 3 —— 上传字体持久化**
9. `POST /v1/fonts/local` + 编辑器上传入口；字体二进制落项目文件根或 media Asset（按开放问题 A/B 决断）。
10. 项目加载回灌注册 + Local 页删除管理。

## 11. 测试与验证——基于 Playwright 的端到端完整方案

### 11.1 分层与既有设施

验证分两层，全部落到 Playwright 与 Go httptest 既有体系：

| 层 | 设施 | 位置 | 覆盖 |
|---|---|---|---|
| L1 Service API | Go `httptest` + `NewServer(...).routes()`（复用 `service/media_*_test.go` 模式） | `service/fonts_server_test.go` | `/v1/fonts*` 全部端点、缓存、CORS |
| L2 编辑器 E2E | Playwright Chromium + `demo.html?test=1` + `window.__recutTest` 桥（复用 `tests/e2e/helpers.ts` / `text-background.spec.ts` 像素断言模式） | `apps/editor/ui/tests/e2e/fonts/*.spec.ts` | 面板交互、字体加载注册、渲染像素、本地字体、上传、离线、CJK |
| L3 全链路（可选） | 真实 service + web 工作台 + 编辑器 iframe（复用 `real-project-card.spec.ts` 模式） | `apps/editor/ui/tests/e2e/fonts-fullstack.spec.ts` | 宿主 iframe 内完整链路的抽检 |

L2 是默认 `make editor-e2e` 跑的常驻套件（hermetic，不依赖真实 service）；L3 由环境变量门控（见 11.6）。

### 11.2 L1：Service API 用例清单（Go httptest）

`fonts_server_test.go` 用 `httptest.NewServer` 作为上游（模拟 Google Fonts），断言：

| 用例 | 断言 |
|---|---|
| `GET /v1/fonts` 目录 | 200 + `google[].family` 含 curated 英文与 CJK 家族（Noto Sans SC 等）、`scripts` 含 `zh`；`local` 数组结构正确 |
| `GET /v1/fonts/google/{id}/css` | 200 `text/css`；每条 `@font-face` 的 `src: url()` 指向**本服务** `/v1/fonts/google/…` 且带 unicode-range；`?weights=400,700` 控制字重；非法 family id → 404 结构化 error |
| `GET /v1/fonts/google/{id}/{subset}-{weight}.woff2` 首次 | 上游收到请求（断言上游 httptest 路径），落盘内容寻址缓存，返回 `application/font-woff2` + `Cache-Control` 长缓存 |
| 同上第二次 | 命中缓存：上游**不再**收到请求（httptest 计数），仍 200 |
| 上游失败 | 首次未缓存且上游 502 → 编辑器侧回退（服务返回 `502` + error code）；已缓存 → 照常 200 |
| `GET /v1/fonts/local` / `POST` | 上传魔数/大小/扩展名校验；`GET` 回显列表（family/assetId/来源） |
| CORS / CORP | `/v1/fonts*` 走 `withLocalCORS`；字体文件带 `Access-Control-Allow-Origin` 与 `Cross-Origin-Resource-Policy: cross-origin`（iframe canvas 需要） |

### 11.3 L2：测试设施扩展

在既有基础设施上加四样东西，不引入新框架：

1. **字体 API 可注入基址**：`google-fonts.ts` 的字体请求 base 不再硬编码 `window.location.origin`，改为可注入（测试 seam，`window.__recutTest?.fontsAPIBase ?? window.location.origin`，参照 `ai-components.ts` 的 `testSeam()` 先例）。这样 L2 在 demo 页（vite preview :5184）里用 `page.route` 拦 `/v1/fonts/**` 即可，不必起真实 service。
2. **`tests/e2e/fixtures/fonts/` 测试字体**：内置 2~3 个小型 woff2 fixture——一个有拉丁字形（如 Roboto 子集），一个含 CJK 字形（如 Noto Sans SC 子集，覆盖"中文"几个常见字），一个故意缺字形的（用于 fallback/fallback-detect 断言）。来源自随包种子/上游下载后子集化，提交进仓库（总大小控制在小几百 KB）。
3. **helpers 扩展**（`tests/e2e/helpers.ts`）：
   - `installFontAPIMock(page, fixtures)`：`page.route("**/v1/fonts/**")` 按 fixture 返回目录 JSON / css / woff2（内容寻址缓存语义在浏览器侧不测，那是 L1 的活）。
   - `assertFontRegistered(page, family, opts?)`：`page.evaluate(() => document.fonts.check('400 16px "' + family + '"'))` 轮询。
   - `setTextElementParam(page, elementId, key, value)`：`__recutTest.setElementParam` 传 string（现有桥 `value: number` 标注，Playwright 层可传字符串）。
   - `assertTextRenderedWith(page, elementId, family, otherFamily?)`：像素断言，见 11.5。
4. **demo 项目支持文本元素多字体切换**：`demo-project.ts` 的 `demo-el-text` 已存在（`fontFamily: "Arial, sans-serif"`），测试用 `setTextElementParam(..., "fontFamily", family)` 切换即可，无需改 demo 数据。若需中文内容，用 `__demoEditText("…")`（`demo/main.tsx` 已有）。

### 11.4 L2：测试文件与用例清单

`apps/editor/ui/tests/e2e/fonts/` 目录（单 spec 可独立跑，`test.describe` 组织）：

**`font-panel.spec.ts` —— 双 Tab 面板交互**
- 打开 font 参数面板：出现 [Google Fonts] [Local Fonts] 两个 Tab。
- Google Tab：目录渲染为卡片网格（复用 atlas 字形预览，无需下载字体）；搜索过滤生效；分类/脚本筛选（含"中文"分组）。
- 选中字体 → 触发 `loadFullFont` → `document.fonts.check(family)` 为 true → 时间线 `fontFamily` 参数写入该 family。
- Local Tab：系统字体列表出现（`queryLocalFonts` 桥 mock，见 11.5）；选中系统字体 → 参数写入且立即渲染。

**`font-loading.spec.ts` —— Google 字体加载与注册**
- 选中一个 latin family（fixture）→ `assertFontRegistered` true → `assertTextRenderedWith` 与 fallback 的像素不同（证明真实加载）。
- 选中 CJK family → 只发起对应 unicode-range 分片请求（`page.on("request")` 断言 woff2 请求数 ≤ N，验证按需加载非整库）。

**`local-fonts.spec.ts` —— 本机字体枚举**
- `queryLocalFonts` mock 返回一批中文系统字体（PingFang SC、Microsoft YaHei…）→ Local Tab 显示并可选，渲染即用（不产生二进制请求）。
- 权限拒绝降级：mock `queryLocalFonts` reject → 面板走 `document.fonts.check` 探测候选清单，仍能列出可用系统字体。

**`upload-font.spec.ts` —— 用户上传字体**
- `page.setInputFiles` 上传 fixture `.woff2` → `FontFace` 注册成功 → 出现在 Local Tab 已上传列表 → 文本元素改用后渲染正确 → 刷新页面后仍回灌注册（持久化路径断言）。

**`offline-cache.spec.ts` —— 离线与回退**
- mock 目录 + 已缓存 woff2 命中 → 渲染正确（"断网"用 `page.route` 不拦缓存路径模拟）。
- 未缓存字体 + 上游失败 → 面板标记"未下载"，渲染回退 `sans-serif` 不崩溃。

**`cjk-rendering.spec.ts` —— 中文渲染（tofu 检测）**
- 文本元素内容设为中文（`__demoEditText`）→ 选 CJK fixture family → 像素断言非 tofu（见 11.5）；与 fallback 对比证明中文字形确实来自目标字体。

**`subtitle-font.spec.ts` —— 字幕回归**
- 现有 ASS `fontname` 映射与字幕轨样式在新字体路径下渲染不变（对照 baseline 像素）。

### 11.5 关键断言技巧

- **字体注册**：`document.fonts.check('400 16px "<family>"')` + `document.fonts.ready`，Poll 到 true。
- **像素级证明"真的用了该字体"**：同一内容分别用目标 family 与 fallback 渲染，采样 canvas 对应区域像素（复用 `text-background.spec.ts` 的 `countTextBackgroundPixels`/`readPreviewPixels` 思路）——两套像素直方图不同 ⇒ 字体真实生效；相同 ⇒ 未加载、回退了。
- **CJK tofu 检测**：中文在缺失字体时渲染为方框（tofu）。对比"选中 CJK fixture"与"回退 sans-serif"两次截图的非背景像素密度/分布；tofu 方框与真实字形有稳定可判别的像素特征（角点空心 vs 实心笔画），用阈值断言，避免脆弱的逐像素相等。
- **queryLocalFonts 桥 mock**：`page.addInitScript` 把 `window.queryLocalFonts` 替换为返回 fixture 列表（`[{ family: "PingFang SC", … }, …]`）的假实现，并配合 `browserContext.grantPermissions(["local-fonts"])`；真实 Chromium 有该 API 时也可走真枚举（`--enable-features=LocalFonts` 或依赖默认开启），测试保持双路径兼容（探测到 API 用真、否则用 mock）。
- **请求计数**：`page.on("request")` 收集 `/v1/fonts/**` 的 woff2 请求，断言 unicode-range 按需分片数量与重载去重。

### 11.6 L3：全链路（可选，环境变量门控）

`fonts-fullstack.spec.ts` 复用 `real-project-card.spec.ts` 模式：需要真实 service（`:17373`）与 web 工作台（`:3000`）已在跑时执行（如 `make dev` 后）。用 `RECUT_FONTS_FULLSTACK=1` 门控：

- 在真实编辑器 iframe（`/v1/apps/recut.editor/`）内打开字体面板 → 选中 CJK 家族 → 预览画布像素断言中文渲染（复用 `readPreviewPixels`）。
- 上传字体经真实 `POST /v1/fonts/local` → 回显在 Local Tab。
- 回归：真实项目 Hello World 往返 seek 像素稳定（与 `real-project-card.spec.ts` 同断言）。

### 11.7 命令与 CI

- 常驻套件：`make editor-e2e`（`cd apps/editor/ui && npx playwright test`）跑 `tests/e2e/**` 全部（含新 `fonts/*`）；L1 并入 `make service-test`。
- 全链路：`RECUT_FONTS_FULLSTACK=1 npx playwright test tests/e2e/fonts-fullstack.spec.ts`（文档注明需要 `make dev`）。
- fixture 校验：CI 前置校验 `fixtures/fonts/*.woff2` 魔数与体积上限，防止误提交大字体。

## 12. 风险与取舍 / 开放问题

- **开放问题 A（上传字体存储）**：项目文件根（App `files` 权限，随项目目录走，编辑器自己有 `ctx.files` 读写）vs media Asset（复用素材库 content 交付，但 `importMediaAsset` 当前拒绝非 image/audio/video MIME，需放开 font MIME 并给字体 asset 一个 kind）。倾向：项目文件根更贴合"随项目走 + App 私有"，media Asset 更贴合"素材库统一管理"；需评审。
- **开放问题 B（CJK 字体体积）**：中文字体整字库数 MB，unicode-range 分片能按需加载，但首次下载中文子集仍可能数百 KB~数 MB。目录里 curated 多少 CJK 家族、是否需要"仅常用字"子集化，需权衡。
- **开放问题 C（queryLocalFonts 权限）**：Chromium 首次调用需用户授权弹窗；拒绝后的降级体验（探测候选清单）要够用。是否把枚举结果缓存到本地避免每次弹窗。
- **开放问题 D（Favorites）**：现有 Tab 骨架含 Favorites，本期不做；后续作为本地收藏（localStorage/偏好）独立 RFC。
- **取舍**：自托管 Google 字体把对 Google 的网络依赖彻底移除（运行期零 `fonts.googleapis.com` 请求），换取中文/受限网络用户可用性；代价是 CDN 多一份字体静态资源（由 `fetch-fonts.mjs` 一次编制上传）与 service 多一份缓存与抓取代码。CJK 整字库体量仍大，靠 unicode-range 分片只按需下载。

## 13. 验证验收清单（采纳后）

1. `curl /v1/fonts` 返回 google（含 CJK 家族）+ local 列表；`/v1/fonts/google/noto-sans-sc/css` 的 url 指向本服务且带 unicode-range。
2. 编辑器里中文用户：Google Tab 能看到并选用 Noto Sans SC / 思源 / ZCOOL；Local Tab 能看到自己机器的 PingFang SC 并直接使用；导出成片中文渲染正确。
3. 断网重启：已缓存字体渲染不变；面板对未缓存字体有离线提示。
4. 上传字体在项目加载后回灌注册、跨机器可复现。
5. `font-picker.tsx` 调用点（masks-tab、参数面板 font 参数）全部迁移到 FontPanel，`fontFamily` 数据格式无破坏。
6. `make service-test` 全绿（含新增 `fonts_server_test.go`）；`make editor-e2e` 全绿（含新增 `tests/e2e/fonts/*`）；`RECUT_FONTS_FULLSTACK=1` 全链路套件在 `make dev` 环境下通过。
