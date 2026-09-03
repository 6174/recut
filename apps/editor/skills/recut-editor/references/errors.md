# 错误处理 runbook（recut.editor）

> 按类别给恢复路径。以工具返回的错误/当前 schema 为准，不记忆旧载荷盲重试。

## 一、版本冲突（conflict / opsSince）

- 收到 `{ conflict: true, currentVersion, opsSince }`：`timeline.read` 或 `project.get` 重读，按 `opsSince` 理解他人变更后**重放自己的 op**，不整份覆盖。
- 每次写前记录上次 `version`，作为下一次 `baseVersion`。

## 二、锁定 / 过期 id

- `aiLock` 会话内 UI 写被拒是预期：等 `project.unlock` 或超时后再试。
- `locked-track` / stale id 失败：刷新受影响的时间线范围，只拿当前 id 重试；不换 payload 盲试。
- 一切 trackId/elementId/componentId 来自读取工具返回值，不臆造。

## 三、素材未登记（asset-exists）

- `insert` 用未登记 `mediaId`/`sourceUrl` 会被 `timeline.validate` 拦截：先 `recut.media.list_assets` 拿真实 assetId，再 `timeline.assets` 覆盖式登记，再重试 insert。
- 组件未 verify：先用 `recut.job.status/wait` 观察 `component.create` job；构建/验证失败时用 `recut.job.logs` 诊断并重试。素材库可见后封面可选。绝不把未 verified 条目插入时间线。

## 四、validate violations

- 只改被拒的字段/事务形状，保留无关项目状态。
- 常见：`track-type`（元素与轨道类型不匹配）、`overlap`（同轨重叠——判断顺序还是层叠，顺序收拢 / 层叠上高层轨）、`out-of-range`（trim 越 sourceDuration）。

## 五、script 文稿面

- `no-speech-track` / `no-transcript-source`：目标元素没绑转写 → 先 `script.attach { assetId }`（audio-studio 转写产物），或 `subtitle.import` 建立转录来源。
- `address not found in project`：项目在 `script.read` 后已被改动（或 address 来自旧 baseline）→ 重新 `script.read` 拿新地址再编辑。
- `transcript-src` violation：`timeline.validate` 报元素 transcript 无来源（既无 assetId 也无 segments 快照）→ 重 `script.attach`。
- `script.apply` 传 `content` 或先 `script.read` 落盘 `scripts/timeline.md`；两者都空会报错。
- 删词/压停顿后元素变多：正常，不是问题。
- 停顿规则只压段间源停顿；句内停顿压不动属预期（需词级时间，v1 不做）。

## 六、生成失败

- 保原 provider/内容策略错误，不花额度重复同样参数裸重试。
- 同文字 prompt 失败两次：换 reference 锚点或改编辑路径，不第三次裸重试。
- 生成前告知用户即将生成的数量与内容。

## 六·五、job 观察与传输健壮性（recut.job.*）

- `recut.job.wait` 单次最多阻塞 **15s**（Streamable HTTP 兼容），超时返回当前状态，**不算完成**；必须继续轮询。
- 若 `recut.job.wait` 报 `MCP error …: EOF` 或传输异常：**不要在同一 jobId 上无限连发 wait**（连发长阻塞等效长轮询，会被断开）。立即降级为 `recut.job.status` 短轮询（间隔 2–4s），或复用事件订阅。
- 一次只维护**一个活跃观察**：提交下一段生成前，上一段必须已到终态。多段生成按完成顺序驱动，不并行长 wait。
- 长任务（如 audio-studio 合成 + ASR 回读可达几十秒）用短轮询逐步推进，把 running 当「进行中」，只有 completed/failed 才定案。

## 七、导出失败

- `timeline.validate` 必须零违反才导出；失败先修 violations。
- 排队/运行中的导出**不 claim 交付**；等 `recut.job.wait` 到 completed，拿真实产物 assetId 再交付。
- `editor-not-open`：编辑器 iframe 心跳不新鲜（&lt;30s）。请用户打开剪辑器项目视图后再 `preview.*` / `export.start`；不要改成 headless 重试。
- `headless-unavailable`：无头预览/导出尚未实现。把产物称为待视觉验收的时间线草稿；不要声称已交付，也不要循环改 `mode`。

## 八、视觉验证失败

- `preview.frame` / `preview.batch` / `preview.contact-sheet` 失败/超时：先确认 doc 合法（validate）与 iframe 在线，再重试；`editor-not-open` / `headless-unavailable` 走上一节，不要用"编一段假时间线"绕过。
- 结构/视觉类结果没看到像素前**不报成功**；无法验证时明确报告阻塞点，请用户在编辑器确认。
