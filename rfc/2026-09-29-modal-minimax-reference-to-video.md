# MiniMax-H3 参考生视频（Ref2VA）在三个 modalapp 的落地 + 按参数设计的表单 + 可配置的部署忽略名单

> 状态：已实施（App 层 + `service/` 少量契约字段）｜范围：`apps/modal-studio/`、`service/catalog.go`、`service/app_media_bridge.go`

## 0. 背景与问题

Modal 预设包里的 MiniMax-H3 只暴露了 **文生视频（t2va）** 与 **首尾帧生视频（fl2va）**，README 明写「仅 FL2VA 检查点：暂不支持 Ref2VA」。

但上游 MiniMax-H3 把能力**拆到两个检查点分区**（`sglang` cookbook §2、`MiniMaxAI/MiniMax-H3` model card）：

| task | 语义 | 条件 role | 分区 |
|---|---|---|---|
| `t2va` | 文生视频+音频 | 无 | FL2VA |
| `fl2va` | 首/尾帧 → 视频+音频 | `keyframe` + `frame_index` 0/-1 | FL2VA |
| `ref2va` | 多模态参考（图像/视频/音频，可混首尾帧）→ 视频+音频 | `reference`（+ 可选 keyframe） | **Ref2VA** |

结论：**首尾帧 ≠ 参考生视频**，是不同 task + 不同 checkpoint 分区，不是命名差异。而「参考生视频」是当下最常用的能力（对齐云端 Atlas 的「多参考视频」档位），必须支持。

同时暴露两个 App 层体验问题：

1. **表单是通用的**：`first-last-frame` 用一个 `references`（image, multiple）字段，让用户「按顺序」传首/尾帧，没有把「首帧」「尾帧」「其他参考」表达成模型真实支持的参数。
2. **manifest 一改就误报待部署**：`modal_runner.py` 的 `folder_hash()` 把整个预设包目录（含只被本机 runner 读取的 `manifest.json`、文档、mock/bench）都算进变更 hash，改文档也会把预设包标成 `stale`。

## 1. 决策

- **参考生视频（ref2va）每个 minimax 预设包都要有**（多卡 `minimax-h3` / 单卡 `minimax-h3-one` / 极速 `minimax-h3-turbo`），且**权重共享**——沿用既有 `recut-minimax-h3-models` 卷，只增量补下 `Ref2VA/**`。
- 一个 SGLang 进程只加载一个分区，所以**每包用两个并列 Modal 类**分别托管 FL2VA 与 Ref2VA（`H3`/`H3Ref`、`H3One`/`H3OneRef`、`H3Turbo`/`H3TurboRef`），不新增预设包目录。
- **表单按模型真实参数设计**，而不是通用 `references`：
  - `first-last-frame` → `firstFrame`（image, single, optional）+ `lastFrame`（image, single, optional），至少 1 张（`minReferences: 1`）；
  - `reference-to-video` → `referenceImages`（image, multiple）+ `referenceVideos`（video, multiple）+ `referenceAudios`（audio, multiple），至少 1 个（`minReferences: 1`）。
- **默认模型选「可锚定参考」的**：每个 preset 的 `expose.function` 指向参考型函数（MiniMax → `reference-to-video`；Qwen-Image → `image-edit`），而非通用 `text-to-*`；并补齐平台能力标注（`inputModes` 汇总 image/video/audio + `referenceFields` + `referenceBudgets`）。
- **部署忽略名单通用化**：默认忽略不参与部署的文件，预设包可在 manifest 里用 `deployIgnore: [<glob>...]` 追加。

## 2. 契约改动

### 2.1 参考素材的角色化（`h3_contract.py`，三包同源）

- `write_reference_conditions(refs, ref_dir)` 按每个 ref 的 `field` 决定 role：
  - `firstFrame`/`lastFrame` → `{type:image, role:keyframe, frame_index:0|-1}`；
  - 其余（`referenceImages`/`Videos`/`Audios`，或按 `mimeType` 推断）→ `{type:image|video|video_audio|audio, role:reference}`，视频可带 `start_time_seconds`。
- `build_video_body(..., task=None)` 缺省按条件角色推断 task：含 `reference` → `ref2va`；含 `keyframe` → `fl2va`；否则 `t2va`。
- `refs` 条目新增可选 `field`/`startTimeSeconds`/`withAudio`；`modal_runner.load_references` 透传这些键。
- `mock_sglang.py` 校验同步支持 ref2va（≥1 个 `role=reference`、类型白名单、URI 可读、`start_time_seconds≥0`），并加入自检用例（t2va/fl2va/ref2va + 角色映射 + 拒绝无参考）。

### 2.2 云端执行体（`modal_app.py`）

- `_server_flags(variant)` / `_ensure_server(variant)`：服务按分区启动；分区不一致时**不复用**（一个 SGLang 进程只加载一个分区）。
- 新增 `H3Ref/H3OneRef/H3TurboRef` 类，`--model-variant ref2va`；`generate_video` 要求至少 1 个参考素材。
- **Turbo 例外**：`larryvrh/MiniMax-H3-Turbo-Lora` 只训练于 FL2VA 分区，故 `H3TurboRef` **不套用 Turbo LoRA / 合并 transformer**，走官方 Ref2VA 权重与 base 步数（默认 50），并跳过仅对 fl2va 的 `--warmup-resolutions` 与请求级形状预热。
- `bootstrap_weights` 的默认抓取集合改为 `model_index.json + FL2VA/* + Ref2VA/*`；完成标记升到 `.recut-download-complete-v2`，让**旧卷自动补下 Ref2VA**（`volume_ready` 按子串 `".recut-download-complete"` 匹配，仍兼容）。

### 2.3 平台能力标注（`publish_registry.py` + Go 契约）

- `inputModes`：由「只认 image」改为**按 media 字段 kind 汇总**（text + image/video/audio）。
- 新增 `referenceFields`（field/role/multiple）与 `referenceBudgets`（复用平台既有 `ReferenceBudget` 语法，如 `images+videos+audios>=1`、`maxImages:9`）。
- `service/catalog.go` 的 `ContributedMediaModel` 增 `referenceFields` 与 `referenceBudgets`；`service/app_media_bridge.go` 把 `referenceBudgets` 映射进 `media.MediaModel.ReferenceBudgets`——于是平台**在提交前就按声明的上限校验本地参考型模型**（与云端 provider 同一套校验，无需 per-App 代码）。

### 2.4 部署忽略名单（`modal_runner.py`）

- `folder_hash(source, ignore)`：新增 glob 忽略；默认忽略 `manifest.json`、`*.md`、`mock.py`、`mock_sglang.py`、`bench.py`（都不参与 `modal deploy`）。
- 预设包可在 manifest 声明 `deployIgnore: ["<glob>", ...]`，`deploy_ignore(manifest)` 追加合并。
- `deploy`/`status` 都按同一忽略名单算 hash，改文档/manifest 不再误报 `stale`；`manifest.json` 里改 `appName` 这类会被 `deployed` 状态兜住（新 app 名不在 `modal app list` 里即为未部署）。

### 2.5 App 与 UI

- `background.js`：`collectReferences(fn, input)` 支持**按字段分组**的 `references: {field:[assetId]}`（App UI 走这条），平台桥的扁平 `referenceAssetIds` 作为回退（单字段函数直接落位，多字段由契约层按 mimeType 推断）；required 改为**按字段**校验，新增 `minReferences` 校验。
- UI：`RunTab` 从「一个 media 字段」改为**逐 media 字段渲染**（首帧/尾帧/参考图/参考视频/参考音频各自独立，按 `kind` 过滤素材、`multiple` 决定单选或多选）；`useRunStore.references` 改为 `Record<field, MediaAsset[]>`；提交按字段分组。

## 3. 验收

- `python mock_sglang.py --selftest` 三包全绿（含 ref2va 端到端、角色映射、拒绝无参考）。
- `modal_runner invoke --mock` 走 `first-last-frame`（2 张 keyframe）与 `reference-to-video`（1 张 reference）均产出 mp4。
- `folder_hash` 忽略名单单测：改 `README.md`/`manifest.json`/`mock.py` 不变 hash；改 `h3_contract.py` 变 hash。
- `go build ./...` 与 `go test ./...` 通过；UI `tsc --noEmit` 零错、`vite build` 通过。

## 4. 已知边界与风险

- **Ref2VA 需要额外约 134GB 权重**（两分区共约 270GB）；旧卷靠 marker v2 自动补下，续传幂等。
- **Turbo 的 ref2va 没有少步加速**（LoRA 不适用于 Ref2VA 分区）。
- **平台路由**：`expose.function` 指向参考型函数后，`modal-cloud/<model>` 的平台默认路由即为参考型；纯文生视频/文生图仍可在 App 内按函数选择使用，但不再是该模型的平台默认函数。
- `referenceFields`（列表形态）目前仅随 manifest 声明，平台实际消费的是 `inputModes` + `referenceBudgets`。
