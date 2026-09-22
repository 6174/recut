# 工具用法与失败诊断

权威：`rfc/2026-09-19-asset-model-simplification.md`。Asset 只有 `kind`/`status`/`content`/`attributes`；没有 `metadata.reference`。

## 0. 就绪与引入

| 能力 | op | 说明 |
|---|---|---|
| 引入素材 | `recut.media.import({ path\|url\|link })` | 一个入口：本地文件 / 直链媒体 / 网页链接；返回稳定 assetId |
| 读理解 | `recut.media.asset.get` / `asset.update` | content/attributes 读写 |
| 环境就绪 | `recut.media.understand.status` / `understand.prepare` | 缺依赖按指引准备，绝不自行安装 |

## 1. 读取工具速查

| 工具 | 输入 | 输出 |
|---|---|---|
| `probe` | `{ assetId }` | `{ durationSec, width, height, fps, hasAudio }` |
| `frames` | `{ assetId, atSec?[], intervalSec?, startSec?, endSec?, maxFrames? }` | `{ frames: [{ atSec, assetId }] }` |
| `contactSheet` | `{ assetId, startSec, endSec, intervalSec, columns?, cellPx?, transcriptAssetId? }` | `{ sheetAssetId, cells: [{ atSec, label }] }`（只落合成图一张；单帧用 `frames`） |
| `boundaries` | `{ assetId, threshold?, minGapSec? }` | `{ boundaries: [{ atSec, kind, score? }] }` |
| `clip` | `{ assetId, startSec, endSec }` | `{ clipAssetId }` |
| `words` | `{ assetId \| transcriptAssetId, language? }` | `{ transcriptAssetId, wordLevel: true }`（可选，默认关） |
| `measure` | `{ text, language?, pace? }` | `{ estimatedDurationSec }` |

读取产物是 **workspace 级普通素材**（`origin=understand`）；要把某帧/接触表留在理解里，就在 `content` 里 `<media assetid="…">` 引用它。**不要把参考或读取产物挂进项目**（不传 `projectId`）；只有要上时间线的素材才用 `recut.editor.asset.add` 进项目素材库。

## 2. 用法要点

- `contactSheet` 带时间码；给 `transcriptAssetId` 叠词（CJK 缺字退化时间码）。
- `boundaries` 尽力而为，快摇/强运动/叠化可能误检，只作参考。
- `words` 默认不开，只在卡拉OK/词级绑定/单词删除时用。

## 3. 引入路径（一个入口）

- 本地文件：`recut.media.import({ path })`（会话工作区/目标项目内，≤2GB）；**不要传 `projectId`**。
- 直链媒体：`recut.media.import({ url })`（image/video/audio，≤25MB，按哈希去重）；**不要传 `projectId`**。
- 网页/文章链接：`recut.media.import({ link, sourceKind, name?, content?, imageData?, … })`（无字节，落 `kind=document`）。
- 平台页（YouTube/抖音…）平台不下载：宿主用 `yt-dlp` 下到工作区后，仍必须 `recut.media.import({ path })` 入库；**只落工作区文件不算完成**。
- 标为参考：`recut.media.asset.update({ assetId, attrPatch: [{ key:"role", value:"reference" }, { key:"url", value: sourceUrl }] })`。

### 3.1 yt-dlp + 浏览器 cookie（宿主自理）

1. 规范 URL（只认视频详情页；分享短链原样，搜索/弹层页按平台重写）。
2. 先探测再下载：`yt-dlp --cookies-from-browser "chrome" --skip-download --print "%(title)s|%(duration)s|%(id)s" "<url>"`。
3. 下载：`yt-dlp --cookies-from-browser "chrome" -f "bv*+ba/b" --merge-output-format mp4 --no-playlist -o "<workdir>/%(id)s.%(ext)s" "<url>"`。
4. 需要登录/风控时，引导用户在本机 Chrome 登录后重试；不要索要账号密码；cookie 不落仓库。
5. 下载产物 → `recut.media.import({ path })` 入库。

## 4. 失败诊断

| 现象 | 原因 | 处理 |
|---|---|---|
| 模型不支持读图 | 当前模型无视觉能力 | **立即终止**，提示用户「理解与克隆视频需要能读图的模型，请先切换到有视觉能力的模型」；不要用转写/切点替代读图 |
| 缺 ffmpeg/ffprobe/PySceneDetect | 平台 venv 未准备 | `understand.status` → `understand.prepare` → `recut.job.wait`；不要自行安装 |
| `assetId` 不可读 | 非本地素材/已删除 | `asset.get` 确认；补引入 |
| 素材无本地文件 | 只有链接 / 未完成 | 只有 `completed` 且带本地文件的素材可读；`document` 无字节是正常的 |
| 无音轨却要转写 | 源文件无音轨 | 报告并改纯画面路径 |
| 区间越界/0 帧 | 参数超出 `probe` 时长 | 先 `probe` 再取区间 |
| 平台页报 cookie | 未带登录 cookie | 加 `--cookies-from-browser "chrome"` |
| 平台页 `Unsupported URL` | 传了搜索/发现页 | 重写为详情页 |

## 5. 输出纪律

- 一律返回/保存为**稳定 `assetId`**；不把内存图像或 base64 当最终证据。
- 理解只写素材的 `content`/`attributes`；不写 `metadata.reference`，不做 evidence 记账。
- 不确定的事实标「未知」，不要用形容词补空白。
