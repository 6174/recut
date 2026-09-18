# 预览与导出（recut.editor）

> `verification.md` 定义结构、视觉和交付三层证据；本文只定义 `preview.frame`、导出和封面的具体 Editor 契约。

## 视觉验证：preview.frame

- 读取 timeline 在 `t` 时刻的真实渲染画面，返回**统一异步 Handle**：`preview.frame({ timeSec })` → `{ jobId }`，
  用 `recut.job.wait(jobId)` / `recut.job.status` 观察终态，结果含 `imageUrl`（app 文件 CDN 地址，非 base64）
  与可选 `assetId`（`saveToLibrary:true` 时导入素材库）。AI 用平台读图能力自检构图/文字/蒙版/关键帧插值。
- **前置条件（presence 门）**：需编辑器 iframe 在线（心跳 <30s）。离线时返回业务错误 `editor-not-open`；
  无前端场景的 `headless` 模式待 P2 实现（返回 `headless-unavailable`）。
- 在 `timeline.validate` 零违反后、`export.start` 前，对关键时间点（开场、转场、结尾）各渲一帧验收。
- **验证纪律**：mutation 成功 ≠ 视觉证明。结构/视觉类结果必须**检像素**后再报成功；排队/运行中的导出不 claim 交付。
- **多帧对比**：用 `preview.batch({ times })` 一次拿多个 settled-time 的异步 frame job；用 `preview.contact-sheet({ times })` 合成一张 contact sheet。部分帧缺元素、截断、看似"破版"通常是动画中间态，不是真实缺陷——以 **settled（落定）帧**判定，与预览/导出同确定性。
- 确定性：同 doc + 同 t 两次渲染像素一致（Preview==Export）。
- `workflow.context.authoring.headlessPreview` 为 false；不要假设离线也能渲帧。

## 导出

当前只有 **UI 异步**路径。`export.start` 在 iframe 心跳新鲜时经 `callUI("export.encode")` 编码，`completeOp=export.finalize` 落盘入库，返回统一 `jobId`。Agent 用 `recut.job.wait` 观察终态。

| 模式 | 实际行为 |
|---|---|
| 缺省 / `mode:"auto"` / `mode:"ui"` | 编辑器 iframe 必须在线。用与预览同一帧循环编码 MP4。离线返回业务错误 `editor-not-open`。 |
| `mode:"headless"` | **未实现（P2）**。立即返回 `headless-unavailable`。禁止声称已无头导出。 |

- 完成时平台自动 `importFile` 为 video Asset；auto 封面模式下设为项目封面。
- `export.list` 读取历史导出（含产物 assetId 与设置）。
- `workflow.context.capabilities["export.start"]` 为 `ui-async`；`authoring.headlessExport` 为 false。
- 无 iframe 时只能把时间线称为待视觉验收的草稿，不能交付。

## 自动首帧封面（UI 驱动，非 media Asset）

- 编辑器时间线内容变化后，UI 在空闲约 1.5s 渲染首帧（t=0，与预览/导出同契约），
  经 `cover.update` 把 PNG 写入项目文件根 `covers/cover.png` 并登记为 file 封面。
- 封面不产生 media Asset（不污染素材库）；两次推送至少间隔 30s；帧未变（hash 相同）则跳过。
- 平台经 `GET /v1/projects/{id}/cover` 直接服务该文件，web 项目卡与详情页实时跟随首帧。
- 导出成片仍走 asset 封面（video Asset），与首帧 file 封面共存（以最后更新者为准）。

## 手动封面（用户选择，优先于自动首帧）

- 导出面板 Cover 区可 `seek` 预览任意帧，经 `cover.set-frame` 把该帧 PNG 落盘为 file 封面并切到
  `frame` 模式；也可从全局素材库选图片经 `cover.set-asset` 设 asset 封面并切到 `asset` 模式。
- 手动封面后自动首帧同步停止（`cover.update` 返回 `skipped`），`export.complete` 也不再覆盖封面，
  保证首页卡片不出现黑帧。`cover.set-auto` 恢复自动首帧。
- `cover.get` 返回当前模式（auto/frame/asset）、手动帧时间与平台封面，供 UI 渲染封面选择状态。

## 导出前 checklist

1. `timeline.validate` → `ok: true`（零 violations）
2. 所有 `mediaId`/`componentId` 已登记 / 已 verify（`timeline.assets` 覆盖式登记）
3. 关键帧/动画已预览确认
4. `project.lock` 已释放（如有）
5. `export.start({ width, height, fps })` → 拿到 `jobId` → `recut.job.wait` 到 completed → 产物 assetId 落库。不要传 `mode:"headless"`（会 `headless-unavailable`）。编辑器未打开时会 `editor-not-open`。
