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
- **`frames`**：按「跳转 + 短解码」精确 seek；用 `maxFrames` 防爆量。
- **`boundaries`**：PySceneDetect；结果带置信度，**快摇/强运动/叠化仍可能误检**，只作参考不当作精确镜头切分。
- **`measure`**：纯本地估时，用于生成前判断时长，不调模型。
- **`words`**：默认不开；只在必须把图形/音效对到具体词时开。

## 3. ingest 路径

- **本地文件**：`recut.media.import_media`（会话工作区/目标项目内，流式，≤2GB，返回真实 assetId）。
- **直链媒体**：`recut.files.fetch`（本地路径、公网、≤100MB）或 `recut.media.import_url`（入库、≤25MB）。
- **平台页（YouTube/TikTok/B站…）**：平台无下载能力；默认由宿主 Agent 自理（自行用 yt-dlp 下到工作区），**这不是平台保证**。下载完成后用 `recut.media.import_media` 入库，才进入理解链路。
- **标记为参考**：`recut.media.reference.create({ assetId, sourceUrl? })`（真实内容）；无内容可下载的链接才用 `recut.media.create_reference`。

## 4. 失败诊断

| 现象 | 原因 | 处理 |
|---|---|---|
| 缺 ffmpeg/ffprobe/PySceneDetect | 平台 venv 未准备 | `understand.status` 确认 → `understand.prepare` → `recut.job.wait`；不要自行安装 |
| `assetId` 不可读 | 非本地素材或已删除 | 用 `asset.get` 确认状态；补入库 |
| 素材无本地文件 | proposed/计划素材或纯链接 | 只有 `completed` 且带本地文件的素材可理解 |
| 无音轨却要转写 | 源文件无音轨 | 报告并改用纯画面理解路径 |
| 区间越界 / 帧数为 0 | 参数超出 `probe` 时长 | 先 `probe` 再取区间 |
| 帧数超限 | `maxFrames` 太小或区间过大 | 缩小 `intervalSec` 覆盖或分段 |
| 接触表 CJK 缺字 | 字体未命中 | 退化为时间码；或换支持字体 |

## 5. 输出纪律

- 一律返回/保存为**稳定 `assetId`**；不把内存图像或 base64 当作最终证据。
- 证据是普通 `image`/`video` 素材，不改素材生命周期。
- 不确定的事实标注为「未知」，不要用形容词补空白。
