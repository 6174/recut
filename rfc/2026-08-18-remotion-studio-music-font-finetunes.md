<!--
 * [INPUT]: 依赖 remotion-studio 现状（ui/fine-tunes 六个动作 + studio.tsx FINE_TUNES 导航、background.js 的 catalog.list / composition.assets / preview.props / render.export、remotion-skeleton 的 player.tsx 无声预览与 render.js 素材物化、@recut/remotion-kit/src/captions 硬编码 Google Fonts 家族名）、
 *          编辑器参考（apps/editor/ui/src/audio-library 的 CDN 优先/本地回退 catalog 加载器与 AudioLibraryItem、Apps/editor/ui/src/fonts 与 rfc/2026-08-16-editor-font-system.md 的双 Tab 面板与自托管字体）、
 *          以及平台已就绪的资源（cdn/buckets/audio/catalog.json 72 支音乐 + 48 支音效、cdn/buckets/fonts/google 34 个家族含 CJK 与 catalog.json 与 {id}.css、https://cdn.recut.video 为该资源最上层）
 * [OUTPUT]: 定义 remotion-studio 音乐与字体微调的整体方案：两类资源全部复用 Recut 自有 CDN 与编辑器同构的 catalog-first 架构，不做代码复用；
 *          音乐「选择即导入」为媒体资产（composition.assets + media 物化管道，预览用 service 内容 URL、渲染用本地物化路径，离线可用且确定性）、
 *          字体直接经 CDN 自托管 {id}.css 注入 @font-face（unicode-range 按需下载，caption 主题经 palette.font 覆盖）、
 *          预览静音门控（有音乐资产才解锁音量，无音乐保持无声不回归）、
 *          MusicFineTune / FontFineTune 两个新 fine-tune 模块与 Prompt 契约、选择持久化（app_meta）与 workflow.context 对 Agent 的资源可见性，以及分阶段实施与分层验证
 * [POS]: rfc 的 remotion-studio 资源微调实施蓝图；获批后落到 background.js 新操作、remotion-skeleton 字体加载器与 player 门控、ui/fine-tunes 两个模块与 i18n，并反向更新 README、manifest 与 rfc/README.md
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: Remotion Studio 音乐与字体微调——复用 Recut CDN 与编辑器的 catalog-first 架构

- 状态：实施中（Phase 0-2 已落地：music/fonts 两个 fine-tune 模块与 i18n、ui/public 本地回退 catalog、background music.import/selected 与 fonts.select/selected、preview.props 与 render.export 携带 music、workflow.context.resources、skeleton player 声音门控与 ProjectVideo bgm 渲染、kit fonts 加载器与 13 套 caption 主题 fontFamily 覆盖；CDN 字体集合已补录 caption 主题缺失家族（Outfit/Rajdhani/Dancing Script，fetch-fonts 编制 + make upload-fonts 上传，catalog v2、37 家族），builtin remotion-studio 归档已重新打包）
- 架构修订（评审反馈）：音乐 **catalog-first** 不再后台回源拉 CDN 目录，曲目的 url 与元数据由 UI（已用 loadResourceCatalogs 持有同一份目录）传入 `music.import`；目录条目的下载地址经 UI 解析为绝对 CDN URL；MP3 二进制用**单次** shell job 直接写文件（不走 stdout/base64，规避大文件超 shell 日志 1MB 扫描行上限），再 `ctx.media.importFile`，避免 `ctx.shell.run(node -e)` 三连与 base64-over-stdout 的脆断。字体预览镜像 apps/editor 的 loadFullFont（注入 CDN css + document.fonts.load），每个卡片真加载，Card 含中文样例与来源 URL 提示。音乐面板移除「导入/移除」机制行，用户只选曲与试听。
- 架构修订（Remotion 场景）：**字体与媒体同走「物化到本地 + 代码引用」**——不再让 composition 运行时 `fetch(CDN woff2)`。`props.fonts[familyId].css` 预览态给 CDN 绝对 URL（浏览器可联网）、渲染态由 `render.js` 把选中家族的 CDN css + woff2 下载到渲染 public 目录并**重写 url() 为本地 /fonts/{id}/{file}**（`/fonts/{id}.css`），`FontProvider` 据此注入并阻塞到 `document.fonts` 就绪。这样预览与导出共用同一 props 驱动代码路径、预览==导出、**渲染期零运行时网络**（离线可渲染），与媒体 `resolveMediaUrl` 的模式一致。`FontProvider` 改为纯副作用（注入 link、渲染 null），不包裹内容，避免多家族重复挂载同一内容树。
- 架构修订（系统字体）：字体选择**区分 CDN 来源（google）与本机系统字体（system）**。UI 用 `catalog.ts` 的 `SYSTEM_FONTS` 合并出统一可选列表，带「在线 / 本机」来源筛选与徽标；`fonts.select` 持久化 `source`，`fonts.selected`/`workflow.context` 返回 source；`projectFonts` 对 system 家族只给 `{ system: true }`（本机直接 fontFamily 使用，无 css），render.js 与 ProjectVideo 对 system 条目不做 css 物化/注入。**大预览区只在选中时更新**（hover 仅高亮卡片、不切换，避免字体切换引起布局跳动），预览区固定最小高度。
- 作者：Recut
- 日期：2026-08-18
- 决策范围：数据源与 CDN 复用边界、音乐资产物化管道、预览声音门控、字体加载方式、音乐/字体 fine-tune 面板与 Prompt 契约、选择持久化与 Agent 可见性、分阶段实施与验证、不采纳边界
- 关联：`apps/remotion-studio/background.js`、`apps/remotion-studio/manifest.json`、`apps/remotion-studio/ui/src/studio.tsx`、`apps/remotion-studio/ui/src/app.tsx`、`apps/remotion-studio/ui/src/fine-tunes/*`、`apps/remotion-studio/ui/src/i18n.ts`、`apps/remotion-studio/remotion-skeleton/src/player.tsx`、`apps/remotion-studio/remotion-skeleton/src/types.ts`、`apps/remotion-studio/remotion-skeleton/render.js`、`apps/remotion-studio/packages/remotion-kit/src/captions/`、`apps/editor/ui/src/audio-library/*`、`apps/editor/ui/src/fonts/*`、`rfc/2026-08-16-editor-font-system.md`、`rfc/2026-08-16-canonical-assets-opfs-cache.md`、`cdn/buckets/audio/catalog.json`、`cdn/buckets/fonts/google/*`、`cdn/scripts/fetch-fonts.mjs`、`ARCHITECTURE.md`

## 1. 背景与病灶

remotion-studio（`apps/remotion-studio`）是**完全 code-based** 的视频产品：每个项目拥有自己的 Remotion 工程（`workspace/`），AI 直接用原生文件工具改写 composition 代码，Vite dev server 热更新预览，本地 `render.js` 渲染导出。创作台右侧的 fine-tune 面板目前有六个动作：`template` / `captions` / `canvas` / `component` / `materials` / `effects`——每个模块只维护用户选择并把选择转译为可审阅的编辑 Prompt，交由 Agent 改写代码。

对应的，`apps/editor` 是 **timeline-based** 编辑器，已完成两套可直接借鉴的资源能力：

1. **音乐/音效库**：`apps/editor/ui/src/audio-library/` 以「CDN 优先、本地打包回退」的方式加载 `https://cdn.recut.video/audio/catalog.json`（72 支音乐 + 48 支音效，条目带 moods/styles/license/source/attribution），用户搜索、筛选、试听、下载到 OPFS 缓存后再插入时间线。
2. **字体系统**：`rfc/2026-08-16-editor-font-system.md` 已批准并实施 Phase 0-3——字体目录与 woff2 全部自托管到 `https://cdn.recut.video/fonts/google/`（34 个家族，含 Noto Sans/Serif SC/TC、思源、ZCOOL、霞鹜等 CJK 家族），带 `{id}.css`（@font-face + unicode-range）与 `catalog.json`，运行期零 Google 依赖。

而 remotion-studio 目前有四类病灶：

1. **成片没有音乐入口**。fine-tune 面板无音乐选择；成片默认无 BGM。用户想要配乐只能把 MP3 当素材上传，或让 AI 凭经验写一个不存在的配乐。
2. **成片没有字体入口，且字幕主题的字体其实从未被加载**。`@recut/remotion-kit/src/captions/vendor/themes/*` 硬编码了 `'Poppins'`、`'Montserrat'`、`'Outfit'`、`'Rajdhani'`、`'Dancing Script'` 等 Google 家族名，但整个运行链路从不在项目里注入这些 @font-face——预览和导出全部静默回退到 `sans-serif`。内容文字同理由 AI 就地写 `system-ui`，无法统一。
3. **预览固定静音**。`remotion-skeleton/src/player.tsx` 对每个 `<Player>` 设 `initialVolume={0}` + `initiallyMuted`，避免宿主无音频设备时创建 WebAudio。一旦引入音乐，需要一个「只有项目真的有音频内容时才解锁音量」的门控，不能简单全局开声。
4. **无资源目录与合规元数据**。音乐/字体若各自引用第三方或让 AI 手拼，目录、版本、许可证与署名（CC0 音乐需要在导出描述/结尾交代归属）都会丢失，也无法跟随平台 CDN 整体升级。

**目标**：在 remotion-studio 增加「音乐选择」与「字体选择」两个 fine-tune 动作，与现有六个动作同构；音乐与字体的目录和二进制全部复用 Recut 自有 CDN（与编辑器同一份数据、同一份文件），架构上对齐编辑器的 **catalog-first**（目录是单一真相源、版本化、UI/Agent/渲染同一数据）、**契约驱动**（operation 定义 I/O）与 **预览==导出** 原则。

**边界（本阶段不做）**：不做代码级复用（不把编辑器组件搬进 remotion-studio，也不反过来）；不做字体/音乐的云端上传与跨设备同步（用户上传素材不在本期）；不改 remotion-studio 的「选择→Prompt→Agent 改代码」产品范式为时间线式操作。

## 2. 关键不变量

1. **数据源单一**：音乐与字体的目录、元数据、二进制全部来自 Recut 自有 CDN（`cdn/buckets/audio` 与 `cdn/buckets/fonts/google`），与编辑器**同一份 catalog、同一份文件**。remotion-studio 不维护第二套资源目录，不引用 Google 域名。
2. **预览 == 导出**：composition 的一切由 props 与代码派生，无 `Math.random`/`Date.now`。音乐与字体在预览（Vite 页面）与渲染（headless Chrome）中必须走同一解析路径，产物逐帧一致。
3. **默认静音不回归**：项目没有音乐资产时，Player 保持现在的无声行为（host 无音频设备时可安全创建）；只有项目真的登记了音乐资产才解锁音量。
4. **音乐走既有媒体管道**：选中的音乐导入为**媒体资产**，与现有 `composition.assets` 登记 + `render.export` 物化管道一致——预览用 service 内容 URL（`mediaContentURL`），渲染用物化后的本地路径，离线可用、确定性、导出不会空音轨。
5. **字体与渲染同源**：`@font-face` 来自 Recut CDN 自托管 `{id}.css`/woff2（与编辑器同一二进制），`fontFamily` 是可序列化字面值写入 composition 代码与 props。

## 3. 决策记录

| # | 决策 |
|---|---|
| D1 | **资源数据源 = Recut CDN catalog，复用不复刻**。音乐目录为 `https://cdn.recut.video/audio/catalog.json`；字体目录为 `https://cdn.recut.video/fonts/google/catalog.json`。UI 用与编辑器相同的「CDN 优先、本地打包回退」加载器；二进制不复制一份进 remotion-studio。 |
| D2 | **音乐「选择即导入」为媒体资产**。新增后台操作 `music.import`：从 CDN catalog 定位 track → 下载 MP3 → `ctx.media.importFile` 导入为 audio Asset → 返回 `assetId`。后续 composition、预览、渲染全部以 `assetId` 引用（`resolveMediaUrl(assetId)` + `composition.assets` 登记），复用现有素材物化与导出路径。再次选择同一首复用已导入资产；取消选择则解除登记。 |
| D3 | **字体直接经 CDN 自托管 CSS 加载，不做服务端缓存**。skeleton/kit 提供 `@recut/remotion-kit/fonts` 加载器，注入 `https://cdn.recut.video/fonts/google/{id}.css`（@font-face + unicode-range，woff2 按需下载），并用 `delayRender` 等待 `document.fonts` 就绪再出帧。字体目录不适合走「下载为资产」——woff2 按字形子集按需拉取且体量可控，浏览器与 headless Chrome 共享同一 CDN 与长缓存；离线渲染降级见 §6.4/§10。 |
| D4 | **预览静音门控**：`preview.props` 新增可选 `music: { assetId }`；`player.tsx` 仅有 `music` 时 `initialVolume=1` / `initiallyMuted=false` / 显示音量控件，否则保持无声。由既有的 `syncPreviewPlayer` 把新 player 同步进每个项目 workspace。 |
| D5 | **新增两个 fine-tune 模块，纳入现有导航与契约**：`MusicFineTune` 与 `FontFineTune` 加入 `studio.tsx` 的 `FINE_TUNES` 网格与 `FINE_TUNE_MODULES`；`FineTuneProps` 追加可选 `resources` 字段（CDN catalog 由 Studio 拉取一次注入），既有六个模块不受影响。 |
| D6 | **选择持久化到 `app_meta`**：`music_scope_key` 存 `music.import` 选中的 `assetId`，`font_scope_key` 存 `fonts.select` 选中的 family id。`App` 刷新时读取并传给 `PlayerPanel`（`preview.props` 携带 `music`）、以 `selection` 形式放进 `workflow.context` 供 Agent 核对。既存优先以 Prompt 为准，持久化用于预览门控与跨会话稳定。 |
| D7 | **合规信息进入 Prompt**：音乐必须携带 `license`/`source`/`attribution` 到 Prompt，Agent 在成片结尾或导出描述注明归属（CC0 音乐也保留署名习惯）；字体 catalog 无许可证风险（服务端一份 OFL/自托管授权），只要求加载家族/字重与 family 名一致。 |
| D8 | **Agent 可见性**：`workflow.context` 的返回新增 `resources.music`（已选 assetId+track 元数据）与 `resources.fonts`(已选 family+CDN css URL)；`readCatalog` 不动，CDN catalog 不并入 `remotion-kit/catalog.json`（CDN 版本独立演进，`kitVersion` 只管组件目录）。 |
| D9 | **caption 主题字体 override**：`CaptionTheme` 消费 `palette.font`（可选 `{ family, url }`）；未设置时沿用主题自带的家族名（并继续加载该家族，见 §6.5），设置时用所选家族替换所有文案层字号以外的 fontFamily。自定义的内容文字由 Agent 在 Prompt 约束下统一写 `FONT_FAMILY` 常量。 |

## 4. 架构总览

```text
┌──────────────────────── remotion-studio UI (ui/) ────────────────────────┐
│   Studio 右侧 fine-tune 网格（新增两张卡）                                  │
│   ├─ MusicFineTune：CDN audio catalog → 试听/筛选 → 选中 → music.import       │
│   │      → assetId → 组装 Prompt（track 元数据 + license/attribution）        │
│   └─ FontFineTune：CDN fonts catalog → 搜索/脚本筛选 → 选中 → fonts.select     │
│          → family → 组装 Prompt（family + css URL + 应用范围）                │
│   └─ onPrompt → 可审阅 Prompt → Agent 改写 workspace 代码                     │
│   └─ music.selected / fonts.selected → preview.props.music → 声音门控        │
└──────────────┬──────────────────────────────────────▲──────────────────────┘
               │ recut.background (api surface)        │ preview/dev-server（Vite）
┌──────────────┴──────────── background.js (Goja) ─────┴─────────────────────┐
│  music.import：CDN catalog → 下载 mp3 → ctx.media.importFile → assetId       │
│  fonts.select：校验 family∈CDN catalog → 写 app_meta                         │
│  music.selected：读 app_meta → { assetId }                                  │
│  workflow.context：+ resources.{music,fonts}（Agent 只读，Prompt 为权威）     │
│  composition.assets / preview.props / render.export：原样复用（音乐作为资产）  │
└──────────────┬─────────────────────────────────────────────────────────────┘
               │ ctx.media.importFile / materialize    预览：mediaContentURL(assetId)
┌──────────────┴──────────── 平台 Media Platform ───────────────────────────┐
│  music Asset（audio）→ 预览 props：service 内容 URL                          │
│                        → 渲染 props：物化本地路径（render.js 拷入 public/）   │
└───────────────────────────────────────────────────────────────────────────┘
┌──────────────────────── remotion composition (workspace/remotion-kit) ────┐
│  <Audio src={resolveMediaUrl(assetId)} volume={duck(progress)}> 确定性音量    │
│  @recut/remotion-kit/fonts：loadFontFamily(id) → <link cdn css> → fonts ready│
│  palette.font 覆盖 caption 主题 / 正文 fontFamily                              │
└───────────────────────▲───────────────────────────────────────────────────┘
                        │ 同一份 CDN（音乐 mp3 首次 import 拉取；字体 css/woff2 按需）
┌───────────────────────┴──────────────── Recut CDN (Cloudflare R2) ────────┐
│  https://cdn.recut.video/audio/catalog.json + music/*.mp3 + sfx/*          │
│  https://cdn.recut.video/fonts/google/catalog.json + {id}.css + {id}/*.woff2│
└────────────────────────────────────────────────────────────────────────────┘
```

数据流：**CDN catalog（单一真相源，与编辑器共用）→ UI 选择 → 落资产/落选择 → Prompt → Agent 以真实引用写进代码 → 预览与渲染走同一解析路径**。音乐允许「下载一次、之后离线」，字体走「CDN 按需 + 长缓存」，两者共享事件栈并都满足确定性。

## 5. 音乐微调（MusicFineTune）

### 5.1 catalog 复用

- 目录：`https://cdn.recut.video/audio/catalog.json`（复用编辑器条目字段：`id/name/moods/styles/duration/filesize/license/source/attribution/url`，另有 `sfx` 数组；本期只消费 `music`）。
- 回退：`ui/public/audio/catalog.json` 打包副本（离线/开发用，与编辑器同约定）。
- UI 侧加载器仿编辑器 `audio-library/catalog.ts`：模块内 `inFlight` 去重 + 内存缓存；`ui/src/fine-tunes/catalog.ts` 提供 `loadResourceCatalogs()` 并返回 `{ music, fonts }`。

### 5.2 UI

`MusicFineTune`（复用 `FineTuneProps`）：

- 布局：上方单曲试听卡（选中曲目名 + moods/styles 标签 + license/attribution 徽标 + 播放/暂停，加载真实 MP3 ≤30s 预览）；下方可滚动音乐网格，每项含 ID、名字、时长、moods/styles、license 徽标；选中项高亮并出现「已选择」。
- 交互：选中即展示元数据并进入「准备中…」状态——`music.import` 下载并导入资产；完成后 `onReady(true)` 并把 Prompt 写入 `onPrompt`。下载失败时 `onStatus` 报错、`onReady(false)`。
- 支持取消：再次打开面板选择同一曲目直接命中已导入资产（`music.import` 幂等）；提供「移除配乐」选项（`music.import({ trackId: "" })` 解除登记）。

### 5.3 资产物化管道

`music.import` 契约（新 op，`surfaces: ["api"]`）：

```text
POST music.import { trackId?: string }
  trackId 非空：CDN catalog 定位 → fetch MP3 bytes → 写临时文件 → ctx.media.importFile
               → app_meta 写 music_asset → 返回 { assetId, track: {...} }
  trackId 空：  清除 app_meta music_asset → 返回 { assetId: null }
```

- 幂等：`app_meta` 已有同曲 assetId 时直接返回，不重复下载。
- 导入后该 audio 资产出现在 `loadAssets()` 返回里，`buildMediaMap` 自动把它映射进 `preview.props` 的 `media`（service 内容 URL）；`render.export` 收集 `registeredAssets ∪ brief.materialAssetIds` 时，只要 Agent 用 `composition.assets` 登记了该 assetId 就会物化为本地路径。**音乐因此天然获得与图片/视频素材一致的预览/渲染一致性，且渲染离线可用（依赖在导入时已落盘），不新增渲染期网络依赖。**
- composition 用法（Prompt 约束）：`<Audio src={resolveMediaUrl(assetId)} />` 配 `volume` 自动化（与 SRT 旁白 duck，无旁白时固定中低音量）、片头入场/片尾收束 fade、按 `durationInFrames` 精确裁剪或无缝 loop——全部由 `useCurrentFrame` 派生，确定性。`renderMedia` 会把 `<Audio>` 轨道并入 MP4。

### 5.4 预览声音门控

- `PlayerPanel` 的 `writeProps` 附带 `music: { assetId }`（来源：App 刷新时 `music.selected` 查询，传入 PlayerPanel props）。
- `player.tsx` 读取 `props.music?.assetId`：

```tsx
const hasMusic = Boolean(props?.music?.assetId);
<Player initialVolume={hasMusic ? 1 : 0}
        initiallyMuted={!hasMusic}
        showVolumeControls={hasMusic} ... />
```

- 无音乐项目行为完全不变（默认静音，不创建 WebAudio）；有音乐才解锁。播放器宿主更新继续走既有 `syncPreviewPlayer` 同步到每个 workspace。

### 5.5 Prompt 契约

`MusicFineTune` 组装（`i18n` zh/en 双语言，模板占位符示例）：

```
为这支视频加入我选中的配乐。
曲目：{name}（{duration}s）
风格：{styles}，情绪：{moods}
资源：assetId={assetId}，用 resolveMediaUrl(assetId) 引用，并用 composition.assets 登记。
许可与署名：{license}（来源 {source}，音源 {attribution}）——在成片结尾或导出描述交待归属。
实现要求：
1. 整片铺满：audio 从第一帧到最后一帧，起始 ≤1s 淡入、结束前 ≤2s 淡出。
2. 若成片有旁白/字幕语言，音量按旁白自动 duck（讲话区间 -14dB 左右、间隙回满），实现必须确定性。
3. 无旁白段落保持中低音量（约 -8dB），不得盖住画面主体。
4. 时长严格等于 composition durationInFrames；文件短则无缝循环（Silent 间隙裁剪），不超出成片。
5. 只允许一条音乐轨；若已存在音乐轨，先移除再添加。
```

### 5.6 后台与 manifest 变更

- `manifest.json`：新增 `operations`: `music.import`、`music.selected`、`fonts.select`（均 `api` surface，附 `inputSchema`）；`permissions` 已含 `media.read/write` 与 `files`，无需新增权限。
- `background.js`：新增以上 handler；`workflowContext()` 增加 `resources` 字段；复用 `registeredAssets`/`previewProps`/`renderExport` 不改造（音乐走资产即通用）。

## 6. 字体微调（FontFineTune）

### 6.1 catalog 复用

- 目录：`https://cdn.recut.video/fonts/google/catalog.json`（`{ version, generatedAt, google: [{ id, family, category, scripts, weights, faces }] }`，与编辑器同一份）。
- 每家族 CSS：`https://cdn.recut.video/fonts/google/{id}.css`（@font-face 的 `src` 已写绝对 CDN 地址 + unicode-range 分片，直接 `<link>` 注入即可，无需重写）。
- 34 个家族已覆盖：Inter/Roboto/Open Sans/Montserrat/Lato/Poppins/Oswald/Space Grotesk/Playfair Display/Bebas Neue…与 CJK（Noto Sans/Serif SC/TC/JP/HK、ZCOOL×4、马善政、龙藏、刘建毛草、霞鹜（yuji）/芷明芒星、紫彰、ま + Rounded…）。
- **缺口**：caption 主题还引用了未入册的家族（`Outfit`、`Rajdhani`、`Dancing Script` 等）。Phase 1 用 `cdn/scripts/fetch-fonts.mjs` 把它们并入 curated 集合（与编辑器同源扩展，两 App 共享既有的字体能力升级）。

### 6.2 UI

`FontFineTune`（复用 `FineTuneProps`）：

- 顶部：搜索框 + 脚本筛选（`latin` / `zh` / All）。
- 网格：字体卡（用家族名以**真实字体**即时渲染卡片标题样式预览，选中/悬停高亮），条目显示 `family`、`category`、`scripts`、`weights` 角标；CJK 家族在名称后带「中」徽标。
- 底部：当前选中 family + 字重（默认 400/700 双字重，勾选可放开）+「移除字体覆盖」选项。
- 选中 → `fonts.select({ familyId })` 持久化 → 组装 Prompt → `onReady(true)`。

（本地系统字体枚举、用户上传字体不在本期——那是编辑器 `Local Fonts` 的能力，code-based 场景字体由代码统一加载 CDN 家族即可，见 §12。）

### 6.3 skeleton 字体加载器

在 `@recut/remotion-kit` 新增 `src/fonts/index.ts`（随 kit 冻结进 workspace）：

```ts
// loadFontFamily(id, { weights }) -> 注入 <link> + delayRender 等待 document.fonts
import { delayRender, continueRender } from "remotion";
const FONT_BASE = "https://cdn.recut.video/fonts/google";
export const loadFontFamily = (id: string, opts?: { weightParam?: string }) => {
  // 幂等：同一 id 只注入一次；<link rel="stylesheet" href={`${FONT_BASE}/${id}.css`}>
  // 监听 load/error；有 font 就绪需求时包 delayRender/continueRender
};
```

- 预览与渲染（headless Chrome）都走 `<link>` + woff2 拉取，与编辑器浏览器行为一致；unicode-range 只管实际用到的字形子集。
- 提供辅助常量与组件：`FontProvider({ id, children })` 顶层挂载（推荐 Agent 在 `Root.tsx`/`ProjectVideo` 根上挂一次），`FONT_FAMILY(id)` 返回字面家族名。
- 渲染一致性：`render.js` 同浏览器渲染，注入机制天然对齐，`FontProvider` 用 `delayRender` 等字体就绪再出帧，避免首帧回退。

### 6.4 caption 主题与内容字体 override

- `@recut/remotion-kit/src/captions/vendor/themes/*` 保留各自默认家族名（不回退），但增加主题引擎一层 override：`CaptionTheme` 读取 `palette.font`（`{ family }`），命中时把所有文案层的 `fontFamily` 替换为所选家族（字号/字重/布局不变）。
- 自定义内容文字：Prompt 要求 Agent 从 `palette.font` 读取所选 family 写进标题/正文常量（`FONT_FAMILY = palette.font?.family ?? "…"`），不再手写 `system-ui`。
- 模板 `primitives.tsx`/`template/ProjectVideo.tsx` 的 palette 若无 `font` 字段则系统字体兜底，不破坏旧项目。

### 6.5 Prompt 契约

`FontFineTune` 组装（zh/en 双语言）：

```
将这支视频的字体统一为我选择的 {label}（{family}；选中字重 {weights}）。
加载方式：项目根挂 @recut/remotion-kit/fonts 的 FontProvider，
  loadFontFamily("{id}")（https://cdn.recut.video/fonts/google/{id}.css，unicode-range 按需）。
统一范围：
1. 标题/正文文字 fontFamily 全部改为 {family}，且从 palette.font 读取，不再手写 system-ui。
2. 字幕主题经 palette.font 覆盖为 {family}（保持现有字号、字重、行数与安全边距）。
3. 不改变层级与排版布局，只允许替换字体。
4. 仅在字形缺失无法覆盖的字符（如音标/特殊符号）保留回退栈；中文内容优先选中 scripts 含 zh 的家族。
```

### 6.6 后台与 manifest 变更

- `fonts.select({ familyId })`：校验 familyId 存在于 CDN fonts catalog（目录随 UI fetch 的结果传回），写 `app_meta`（`font_family`），返回 `{ familyId, family, cssUrl }`。
- `fonts.selected()`：读回选择（App 刷新与 workflow.context 用）。
- `workflowContext()` 返回 `resources: { music: {...} | null, fonts: {...} | null }`，Prompt 仍是「选择正在生效」的权威快照，`resources` 仅作 Agent 上下文核对。

## 7. 数据与接口契约汇总

| 契约 | 位置 | 语义 |
|---|---|---|
| CDN 音频目录 | `https://cdn.recut.video/audio/catalog.json` | 音乐/音效条目（id/name/moods/styles/duration/license/source/attribution/url），与编辑器共用 |
| CDN 字体目录 | `https://cdn.recut.video/fonts/google/catalog.json` | 34 家族 + faces/weights/scripts，与编辑器共用 |
| CDN 字体 CSS/woff2 | `https://cdn.recut.video/fonts/google/{id}.css` + `{id}/*.woff2` | 自托管 @font-face（绝对 CDN 地址 + unicode-range） |
| `music.import` op | `background.js` + `manifest.json` | 下载 CDN 音乐 → 导入媒体资产 → 写 app_meta → 返回 assetId（幂等；空 trackId 清除） |
| `music.selected` / `fonts.select` / `fonts.selected` op | 同上 | 读/写 app_meta 的音乐与字体选择 |
| `preview.props.music` | `background.js` `previewProps` | 可选 `{ assetId }`；播放器据此解锁音量 |
| `workflow.context.resources` | `workflowContext()` | 已选音乐 assetId+track、字体 familyId+cssUrl（Agent 只读参考） |
| `@recut/remotion-kit/fonts` | `packages/remotion-kit/src/fonts/` | `loadFontFamily` / `FontProvider` / `FONT_FAMILY`，delayRender 就绪 |
| `palette.font` | caption 主题与模板 palette | 可选 `{ family }`；CaptionTheme 与正文据此 override |
| `composition.assets` / `render.export` | 既有（不改契约） | 音乐 assetId 一并登记并物化 |

## 8. 分阶段实施

**Phase 0 —— 资源接入与两模块骨架**
1. `ui/src/fine-tunes/catalog.ts`：`loadResourceCatalogs()`（CDN 优先、本地回退，缓存去重）。
2. `FineTuneProps` 追加可选 `resources`；`Studio` 拉取一次并注入。
3. `studio.tsx`：`FINE_TUNES` 新增 `music`/`fonts` 两张卡 + `FINE_TUNE_MODULES` 注册；`i18n.ts` 新增全部 zh/en 文案。
4. `MusicFineTune`/`FontFineTune` 先以目录只读展示（不落资产）验收 UI，`onReady` 恒 true + 最小 Prompt。

**Phase 1 —— 音乐落资产**
5. `background.js` 实现 `music.import`/`music.selected`；`manifest.json` 注册。
6. `MusicFineTune` 接通 import（幂等、取消、失败处理）；Prompt 完成 §5.5。
7. `player.tsx` 声音门控 + `PlayerPanel` 传 `music`；`syncPreviewPlayer` 同步。
8. `workflowContext()` 增加 `resources.music`。
9. **CJK/字幕字体入册**：`cdn/scripts/fetch-fonts.mjs` 并入 caption 主题引用但缺失的家族（Outfit/Rajdhani/Dancing Script…），两 App 共享升级。

**Phase 2 —— 字体落地**
10. `@recut/remotion-kit/src/fonts/` 实现 `loadFontFamily`/`FontProvider`/`FONT_FAMILY`。
11. caption 主题 `palette.font` override 接入 `CaptionTheme`。
12. `background.js` 实现 `fonts.select`/`fonts.selected`；`FontFineTune` 接通；Prompt 完成 §6.5。
13. `workflowContext()` 增加 `resources.fonts`。

**Phase 3 —— 一致化与回归**
14. 新老项目兼容性回归（旧 workspace 无 palette.font、无 music 选择 → 行为不变）。
15. `remotion-skeleton/README.md`、`ui/src/fine-tunes/README.md`、`README.md`、`manifest.json` 反向更新；`rfc/README.md` 同步。
16. 端到端验证（§9）。

## 9. 测试与验证

沿用 remotion-studio 与编辑器既有的分层设施，不引入新框架：

- **L1 后台 op（`background.js` 自测/轻量 harness）**：`music.import` 幂等（同 trackId 二次调用命中缓存）、下载失败结构化报错、空 trackId 清除；`fonts.select` 非法 familyId 拒绝、合法回写；`workflow.context.resources` 与 app_meta 一致。
- **L2 UI（Playwright，随 `make` 既有 UI E2E 或手动验收）**：`music`/`fonts` 卡出现在 fine-tune 网格；`loadResourceCatalogs` 在 CDN 不可达时回退本地副本；MusicFineTune 试听/选中/import 状态流转；FontFineTune 搜索、`zh`/`latin` 筛选、卡片选择。
- **L3 组合成片（Playwright + 项目 workspace fixture）**：用固定 fixture 项目（含 SRT brief）驱动「选音乐 + 选字体 → Prompt → 改写 → preview.props 写入 → 预览取帧」：
  - 音乐：props 含 `music`，播放器 `initialVolume>0`；`composition.assets` 含音乐 assetId；`render.export` 出片可 `ffprobe` 到音频轨（≥1 条 audio stream）且时长==成片。
  - 字体：`FontProvider` 挂载后 `document.fonts.check('400 16px "<family>"')` 为 true；预览与渲染首帧像素与 fallback 字体不同（复用编辑器 font RFC §11 的像素直方图断言思路）。
  - 回归：无音乐项目预览仍静音、无 palette.font 项目排版不变。

**命令**：L3 需 `make dev`（真实 service + web + app 链路）；L1/L2 可 hermetic 跑。font fixture 直接复用 `editor-font-system` 的测试字体 fixture 目录（同一仓库共享，不重复造）。

## 10. 风险与取舍 / 开放问题

- **开放问题 1（音乐导入存储）**：`ctx.media.importFile` 产物是平台级媒体资产，会出现在素材库与其他 App 里（好处是统一、可复用；代价是素材库多出「音乐」条目，用户可能困惑）。备选：写入项目私有 `files/` 走 `ctx.files` + 归入 project 私有区。倾向平台资产（与编辑器音乐库一致、composition.assets 管道完全复用）；若评审反对再切私有路径（music.import 内部实现可整体替换，契约不变）。
- **开放问题 2（渲染字体离线性）**：字体走 CDN `<link>`，预览在线即正常；渲染同样在线取 woff2（长缓存）。离线机器渲染会回退字体。可在 Phase 3 增加「字体物化」：`fonts.materialize` 把所选 family 的 css+woff2 下载到 workspace `static/`，`FontProvider` 优先本地 `staticFile`——本项目暂缓，作为已知取舍。
- **开放问题 3（curated 字体集合边界）**：caption 主题所需家族入册是「两 App 共享的 CDN 升级」，需要一次 `fetch-fonts` + CDN 上传；在 Phase 1 作为一个明确交付项，避免新字体能力被主题引用拦路。
- **风险**：音乐试听走 CDN 直连音频，宿主可能有音频设备缺失（编辑器已证明可行，预览 play 是显式交互创建 WebAudio，符合纪律）；`music.import` 增加一次网络下载（单首 ~1-2MB），属一次性成本。
- **取舍**：音乐比「Prompt 直接写 CDN URL」多一小段后台下载代码，换来渲染离线、确定性、与素材管道统一；字体比「用 @remotion/google-fonts」多一个自托管加载器，换来零 Google 依赖、与编辑器同二进制同目录。

## 11. 验证验收清单（采纳后）

1. fine-tune 网格出现「音乐」「字体」两张卡，两模块在 CDN 不可达时仍能以本地副本展示目录。
2. 选一首音乐 → `app_meta` 出现 assetId，素材库出现该 audio 资产；同曲再选不重复下载；取消后资产与登记解除；`preview.props` 带 `music`，Player 解锁音量且可静音。
3. 提交音乐 Prompt 后：Agent 代码 `resolveMediaUrl(assetId)` 引用并 `composition.assets` 登记；导出 MP4 `ffprobe` 有音频轨、时长一致、旁白处音量被 duck。
4. 选一个 CJK 字体 → 标题/正文/字幕全部该家族；`document.fonts` 注册、中文无 tofu；导出首帧与预览像素一致且与回退不同。
5. 无音乐/无字体覆盖的既有项目：播放器仍无声、排版不变（回归通过）。
6. `make service-test`/既有 UI 检查全绿；L3 组合成片用例通过。

## 12. 不采纳边界（明确不做）

- 不做**代码复用**：不把编辑器 `audio-library/*`、`fonts/*` 组件搬进 remotion-studio，也不反过来；只共享 CDN 数据、文件与 catalog-first 架构范式（D1/D3）。
- 不做 **Local Fonts（本机字体枚举）+ 上传字体 + Favorites**：code-based 场景字体由代码统一加载 CDN 家族即可，local/upload/Favorites 是编辑器（timeline 逐元素改字体）的产品能力，留待后续独立 RFC 评审 remotion-studio 是否引入。
- 不做**音效（sfx）微调**：本期只做音乐 BGM 全片铺底；音效按需进入 ShotGraph 是另一套节奏工程量，作为后续候选（目录已在 CDN 中就绪，成本低）。
- 不做**云端/跨设备资源上传同步**；音乐导入的是 CDN 既有音源，用户自有音频仍走原「素材上传→brief/ материалы」路径。