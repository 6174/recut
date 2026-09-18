# timeline.command op 目录与编排模式

> `timeline.command` 是唯一写入口：`{ op: { type, payload, baseVersion? } }`。每个 op 落统一日志（可 `history.undo`）、version +1，返回 `{ version, seq, result }`。时间字段一律秒。

## op 目录

### 元素
| type | payload | 说明 |
|---|---|---|
| `insert` | `{ sceneId?, trackId?\|trackType?, element: { type, name?, mediaId?/componentId?/definitionId?/effectType?/sourceType?/sourceUrl?, content?, params?, startSec, durationSec, trimStartSec?, trimEndSec?, hidden?, subtitle?, subtitleSource?, subtitleCueIndex? }, index? }` | 放元素；`trackType` 缺省按元素类型推导；返回 `result.element = { trackId, elementId }`。视频/图片放主轨，文字放 text 轨，音频放 audio 轨，组件放 graphic 轨。text 带 `subtitle:true` = 字幕 cue，落在字幕轨自动继承共享样式 |
| `delete` | `{ refs: [{ trackId, elementId }] }` | 批量删除 |
| `param` | `{ ref, params: { key: value }, atSec?, fields? }` | 设参数；`atSec` 语义见 keyframes.md（D1）。**字幕 cue 的 param 修改会广播到全轨**（`content` 除外） |
| `trim` | `{ ref, startSec?, durationSec?, trimStartSec?, trimEndSec?, ripple? }` | 裁剪/位移；`ripple:true` 平移后续同轨元素 |
| `split` | `{ ref, atSec, retainSide: "both"\|"left"\|"right" }` | 在 `atSec` 切分；返回左右 refs |
| `keyframe-upsert` | `{ ref, path, atSec, value, segmentToNext? }` | 在 `atSec` 落/更新关键帧 |
| `keyframe-remove` | `{ ref, path, atSec? }` | 删指定时刻或整条路径的关键帧 |

### 字幕
| type | payload | 说明 |
|---|---|---|
| `caption-style` | `{ trackId, style: { params } }` | 设置字幕轨全轨共享样式（fontSize/color/background.*/textAlign/letterSpacing/lineHeight/opacity/blendMode 等）；同步到全轨字幕 cue。批量导入用 `subtitle.import`（独立 MCP op，见 `captions.md`） |
| `subtitle-import` | `{ cues: [{ text, startSec, durationSec }], style?, trackId?, startSec?, source? }` | 批量铺设字幕 cue；优先使用 `subtitle.import` 传入 SRT/ASS 文本 |

### speech-track（文稿剪辑）
| type | payload | 说明 |
|---|---|---|
| `transcript-attach` | `{ ref, assetId, source?, language? }` | 给 video/audio 元素绑定转写素材（MCP 用 `script.attach`）；可 undo |
| `transcript-fix` | `{ ref, segmentIndex, text }` | 只改转录文本（ASR 错词/说话人），不改音频（MCP 用 `script.fix-transcript`）；可 undo |

> `script.read` / `script.apply` / `script.clean` / `script.find` 提供文字稿读取、编辑与回写能力：read 输出可编辑文本，apply 将修改同步到时间线，clean 处理 filler/停顿，find 用于检索。`timeline.validate` 仍需确认 transcript 来源有效。

### 轨道
| type | payload | 说明 |
|---|---|---|
| `track-add` | `{ type: "video"\|"text"\|"audio"\|"graphic"\|"effect", name?, index? }` |
| `track-remove` | `{ trackId }`（非空轨拒绝） |
| `track-mute` | `{ trackId, muted? }`（缺省切换） |
| `track-visible` | `{ trackId, hidden? }`（缺省切换） |
| `track-role` | `{ trackId, role: "anchor"\|"follower"\|"none", duckDepthDb? }` | 音频轨自动混音角色（MCP 用 `track.role`）；驱动 auto-duck，包络见 `music-beat-sync.md` |

### 场景 / 书签
| type | payload |
|---|---|
| `scene-create` | `{ name?, isMain? }` |
| `scene-rename` | `{ sceneId, name }` |
| `scene-delete` | `{ sceneId }`（主场景禁止） |
| `bookmark-add` | `{ sceneId?, timeSec, note? }` |
| `bookmark-remove` | `{ sceneId?, timeSec }` |

### 项目
| type | payload |
|---|---|
| `settings` | `{ fps?, canvasSize?, background? }`（等价 `project.updateSettings`） |

## 编排模式

### 粗剪（铺稿 → 精修）
```text
film.package.import → 时间线草稿        # AI 短片交接包（可选起点）
timeline.read → 现状                    # 轨道 + clips
project.lock → owner/token               # 多步会话
  element.insert { video → main 轨 }    # 素材落主轨
  element.trim { 裁剪，ripple }         # 去头去尾
  element.split { atSec }               # 打点切分，删多余段
  element.insert { text → 标题 }        # 字幕/标题
  element.insert { audio → 配音 }       # 旁白/音乐
  keyframe-upsert { opacity / transform }  # 入场退场动画
project.unlock { owner, token }
timeline.validate                       # 零违反
preview.frame(t)                        # 视觉验收
export.start({ mode: "ui" })             # 出片（编辑器前端需在线）
```

### 变速 / 音频
- 变速：先 `element.trim` 保持 duration 语义；如需 retime 语义（rate 0.01–5x），通过 `element.get` 读取当前 `retime` 后用 `param.fields.retime` 设置（v1 目录以 trim/split 为主，retime 字段可经 `param` 的 `fields` 直接写）。

### 冲突处理
- 收到 `{ conflict, currentVersion, opsSince }`：`timeline.read`（或 `project.get`）重读，按 `opsSince` 理解他人变更后重放自己的 op。
- 每次命令前记录上次 `version`，作为下一次 `baseVersion`。

## 注意事项

- 一次 `timeline.command` 只放一个 op；批量操作用多次调用（每步可 undo）。
- `insert` 的元素 id 由后台确定性生成（`el-ai<seq>-<n>`）；redo 复用存储的 id，幂等。
- 所有时间字段用秒；`durationSec` 至少 0.001。
