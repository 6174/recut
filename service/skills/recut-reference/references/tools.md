# 工具用法与失败诊断（recut.media.*）

权威定义：`rfc/2026-09-17-reference-understanding.md` §2。本页是操作速查与排错。

## 0. 就绪检查

调用前确认 op 在平台工具列表内；缺失即如实报告其里程碑（RFC §8），不要冒充结果。

| 工具 | 里程碑 | 说明 |
|---|---|---|
| `asset.get` / `asset.update` | 已实施 | 属性/正文读写 |
| `import_media` | 已实施 | 本地视频/音频/图片文件入库（流式，≤2GB） |
| `probe` / `frames` / `contactSheet` | 已实施 | 探测、抽帧、接触表 |
| `boundaries` / `clip` | 已实施 | 切点、源片段 |
| `words` / `measure` | 已实施 | 词级（可选）、估时 |
| `reference.create` / `reference.attach` | 已实施 | 标记参考、写观察 |
| `understand.status` / `understand.prepare` | 已实施 | 环境就绪检查与异步准备 |

底层依赖：平台全局 Python venv（`<dataDir>/python/platform/<ver>`）提供 ffmpeg/ffprobe/PySceneDetect/opencv/Pillow。**平台启动只前置 PATH、不安装**；缺环境时工具返回「需要准备」错误 —— 先 `recut.media.understand.status` 看缺什么，再 `recut.media.understand.prepare` 异步准备，**不要自行 pip/uv 安装**。

## 1. 工具速查

| 工具 | 输入 | 输出 |
|---|---|---|
| `probe` | `{ assetId }` | `{ durationSec, width, height, fps, hasAudio }` |
| `frames` | `{ assetId, atSec?[], intervalSec?, startSec?, endSec?, maxFrames? }` | `{ frames: [{ atSec, assetId }] }` |
| `contactSheet` | `{ assetId, startSec, endSec, intervalSec, columns?, cellPx?, transcriptAssetId? }` | `{ sheetAssetId, cells: [{ atSec, assetId }] }` |
| `boundaries` | `{ assetId, threshold?, minGapSec? }` | `{ boundaries: [{ atSec, kind, score? }] }` |
| `clip` | `{ assetId, startSec, endSec }` | `{ clipAssetId }` |
| `words` | `{ assetId \| transcriptAssetId, language? }` | `{ transcriptAssetId, wordLevel: true }` |
| `measure` | `{ text, language?, pace? }` | `{ estimatedDurationSec }` |

## 2. 用法要点

- **`contactSheet`**：带时间码；给 `transcriptAssetId` 时叠词标签（CJK 依赖平台字体服务，缺字退化为时间码）。用 `columns`/`cellPx` 调密度：全局小、细节大。
- **`frames`**：按「跳转 + 短解码」精确 seek；帧数上限默认随总时长推导（每 5s 一帧，下限 24、上限 120），可用 `maxFrames` 收紧或显式指定。
- **`boundaries`**：PySceneDetect；结果带置信度，**快摇/强运动/叠化仍可能误检**，只作参考不当作精确镜头切分。
- **`measure`**：纯本地估时，用于生成前判断时长，不调模型。
- **`words`**：默认不开；只在必须把图形/音效对到具体词时开。

## 3. ingest 路径

- **本地文件**：`recut.media.import_media`（会话工作区/目标项目内，流式，≤2GB，返回真实 assetId）。
- **直链媒体**：`recut.files.fetch`（本地路径、公网、≤100MB）或 `recut.media.import_url`（入库、≤25MB）。
- **平台页（YouTube/TikTok/B站…）**：平台无下载能力；默认由宿主 Agent 自理（自行用 yt-dlp 下到工作区），**这不是平台保证**。下载完成后用 `recut.media.import_media` 入库，才进入理解链路。
- **标记为参考**：`recut.media.reference.create({ assetId, sourceUrl? })`（真实内容）；无内容可下载的链接才用 `recut.media.create_reference`。

### 3.1 平台页下载：yt-dlp + 浏览器 cookie（宿主 Agent 自理）

平台页（YouTube / B站 / 抖音 / TikTok / 小红书 / 快手…）平台无下载能力，由有 shell 的宿主 Agent 用 `yt-dlp` 下到工作区（**平台不保证**）。统一套路：

1. **规范 URL**：yt-dlp 只认「视频详情页」URL。分享短链一般可原样传入（自动跟随重定向）；搜索/发现/弹层类 URL 多不认，需按各平台规则重写（见下表）。
2. **先探测，再下载**：多数平台需登录态 cookie，否则报风控/登录错误。先只验证元信息：

   ```bash
   yt-dlp --cookies-from-browser "chrome" --skip-download \
     --print "%(title)s|%(duration)s|%(id)s" "<url>"
   ```

   验证通过后再正式下载：

   ```bash
   yt-dlp --cookies-from-browser "chrome" \
     -f "bv*+ba/b" --merge-output-format mp4 --no-playlist \
     -o "<workdir>/%(id)s.%(ext)s" "<url>"
   ```

   要音轨/字幕时再补 `-x --audio-format mp3` / `--write-subs --convert-subs srt`。
3. **cookie 取值**：优先 `--cookies-from-browser`（直接读本机已登录浏览器，无需导出）。
   - profile 语法 `<browser>[:<profile>]`：macOS 默认可写 `chrome`；多 profile 用 `chrome:Default` / `chrome:Profile 2`。也支持 `edge` / `firefox` / `chromium` 等。
   - 读不到时（浏览器未登录、Windows 的 `Could not copy Chrome cookie database` 或 `Failed to decrypt with DPAPI`）改用登录态导出的 Netscape `cookies.txt`：`--cookies "<path>"`。
   - **需要登录 / 反复风控时，主动引导用户**：先让用户在本机 Chrome 里打开该平台并登录（打开一次目标视频确认能正常播放），再重试上面的命令；不要替用户登录、不要索要账号密码或 cookie 文本。
   - 用户若改为在浏览器里手动下载（导出文件），也必须把该文件用 `recut.media.import_media` 入库，不能只留在下载目录。
   - cookie / 浏览器 profile 是私密数据：**绝不**提交仓库、写进技能或长期留存。
4. **必须入库，不能白下载**：任何下载产物（yt-dlp 产物或用户手动下载的文件）都要 → `recut.media.import_media` 入库 → `recut.media.reference.create({ assetId, sourceUrl })` 把原始 URL 记为溯源。只落一个工作区文件不算完成。

**各平台要点**（yt-dlp 通用行为；症状以实际输出为准）：

| 平台 | URL 处理 | 额外参数 | 典型报错 → 处理 |
|---|---|---|---|
| YouTube / `youtu.be` | 原样 | 新版需 JS 运行时：`--js-runtimes node:<path>`（或 deno） | `Sign in to confirm you're not a bot` → 加 cookie |
| Bilibili / `b23.tv` | 原样 | 需 cookie 避免 412 | `HTTP 412` → `--cookies-from-browser` |
| 抖音 / `v.douyin.com` | 只认 `/video/<id>`；分享短链原样；搜索/发现页 `modal_id` URL 需取 `modal_id` 重写 | 必须带 cookie | `Fresh cookies ... needed` → 加 cookie；`Unsupported URL` → 重写 URL |
| TikTok | 原样 | 部分内容需 cookie | 登录 / 风控 → 加 cookie |
| 小红书 | 原样 | 通常需 cookie | 登录 / 风控 → 加 cookie |
| 快手 / `v.kuaishou.com` | 原样 | 需 cookie；反爬强时可回退登录态浏览器会话抓取 | 风控 → 用浏览器会话 |

- 抖音重写示例：`.../search/...?modal_id=7684542936582851892&type=general` → `https://www.douyin.com/video/7684542936582851892`。
- 若 `yt-dlp` 该站提取器整体失效（确认已登录仍反复 `Fresh cookies` 等），如实报告「此链接当前无法下载」，不要用截屏/占位素材冒充真实内容。

## 4. 失败诊断

| 现象 | 原因 | 处理 |
|---|---|---|
| 缺 ffmpeg/ffprobe/PySceneDetect | 平台 venv 未准备 | `understand.status` 确认 → `understand.prepare` → `recut.job.wait`；不要自行安装 |
| `assetId` 不可读 | 非本地素材或已删除 | 用 `asset.get` 确认状态；补入库 |
| 素材无本地文件 | proposed/计划素材或纯链接 | 只有 `completed` 且带本地文件的素材可理解 |
| 无音轨却要转写 | 源文件无音轨 | 报告并改用纯画面理解路径 |
| 区间越界 / 帧数为 0 | 参数超出 `probe` 时长 | 先 `probe` 再取区间 |
| 帧数超限 | 显式 `maxFrames` 太小或超过硬上限 120 | 放宽 `maxFrames`、缩小 `intervalSec` 覆盖或分段 |
| 接触表 CJK 缺字 | 字体未命中 | 退化为时间码；或换支持字体 |
| 平台页报 `Fresh cookies ... needed` / `Sign in to confirm ...` | 未带登录 cookie | 加 `--cookies-from-browser "chrome"`（见 §3.1）；仍失败则引导用户先在本机 Chrome 登录该平台再重试 |
| 平台页 `Unsupported URL` | 传了搜索/发现/弹层 URL | 按平台取视频 id 重写为详情页（抖音取 `modal_id`/`/video/(\d+)`） |
| `Could not copy Chrome cookie database` | Chrome 占用（Windows 常见） | 关闭 Chrome 重试；或导出 `cookies.txt` 用 `--cookies` |
| `Failed to decrypt with DPAPI` | 浏览器 cookie 加密不兼容 | 登录态导出 Netscape `cookies.txt`，改 `--cookies "<path>"` |

## 5. 输出纪律

- 一律返回/保存为**稳定 `assetId`**；不把内存图像或 base64 当作最终证据。
- 证据是普通 `image`/`video` 素材，不改素材生命周期。
- 不确定的事实标注为「未知」，不要用形容词补空白。
