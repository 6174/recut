# 语义锚点（anchor）契约

配套技能 `recut-clone`。锚点回答：**这条素材跟着哪句话、什么时候出现；改稿后怎么重新对齐。**

## 1. 权威落点

- **权威 = 项目 `clone.md → Plan` 表的 `Anchor` 列**（唯一真相）。
- 不写进素材 attr，也不需要单独的计划素材；生成后把 `assetId`、落轨后把 `tlWindow` 回填同一行。
- 一行一个素材，`anchor` 必有。

## 2. token 语法

| token | 含义 | 何时用 |
|---|---|---|
| `speech@<transcriptAssetId>#<srcStart>-<srcEnd>` | 目标 A-roll 转写的**源时间**区间（秒，三位小数） | 有口播：跟着某句话 |
| `clock@<startSec>-<endSec>` | 设计时钟绝对秒 | 无口播 / 纯图形 / 音乐 |

规则：

- **绝不锚到 `elementId`**：`script.apply` 是删除+重插，元素 id 会变；源时间跨重排稳定。
- `transcriptAssetId` 必须是可读的真实转写素材（目标 A-roll 的 `script.attach` 产物）。
- S2 已定目标脚本，所以 S3 直接写 `speech@`，不再有「参考锚点 → 目标锚点」的升级往返。

## 3. 时间线映射（把锚点变成窗口）

目标口播元素的源时间 → 时间线时间是线性映射（与 `script.read` baseline 同源，`service/editor_script.go:339-347`）：

```text
给定 speech 元素 E（element.get 读 startSec/durationSec/trimStartSec/trimEndSec）
span = trimEndSec - trimStartSec
tl(t) = startSec + durationSec * (t - trimStartSec) / span     # t ∈ [trimStartSec, trimEndSec]
```

逐锚点落轨：

1. `element.get` 读该元素 `transcript.segments`（每段源 `start/end` + text）与 `startSec/durationSec/trimStartSec/trimEndSec`。
2. 取与 `#<srcStart>-<srcEnd>` 相交的段，交集 `[cs, ce]`（clamp 到 `[trimStartSec, trimEndSec]`）。
3. 窗口 = `[tl(cs), tl(ce)]`；素材放到 `tl(cs)`，时长 = `tl(ce)-tl(cs)`（必要时 trim）。
4. 多元素/多段延续：各段各自映射后取并集。

落轨后把实际窗口回填 `clone.md → Plan.tlWindow`（审计用）；权威仍是 anchor 列。

## 4. 改稿重排

用户改目标文稿（`script.read` → 编辑 → `script.apply`）后，时间线会整体位移、元素 id 会变：

1. 重新 `script.read`（新 baseline）+ `timeline.read`。
2. 对每条 `speech@` 按 §3 重算窗口。
3. `timeline.command { trim }`（或 delete+insert）把锚定元素移到新窗口。
4. `timeline.validate` + `preview.frame` 抽检受影响 scene。

因为锚点是**源时间**，改一句台词导致的时长变化会被自动吸收——这就是 clone「改一段自动重排」的最小实现（v1 由 AI 执行，无编译器）。

## 5. 检查清单

- [ ] Plan 每行都有 `anchor`（有口播 `speech@`，否则 `clock@`）
- [ ] 所有 `speech@` 的 `transcriptAssetId` 是可读的真实转写素材
- [ ] 无任何锚点指向 `elementId`
- [ ] 改稿后所有 `speech@` 已重算窗口并回填 `tlWindow`
