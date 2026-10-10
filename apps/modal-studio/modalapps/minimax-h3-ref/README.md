# MiniMax-H3 参考生视频·人脸保持档（minimax-h3-ref）

[MiniMax-H3](https://github.com/MiniMax-AI/MiniMax-H3) 的 **Ref2VA（参考生视频）专用档**：把「参考锚定 + 少步加速 + 人脸修复」三层收敛进一个预设包，专治**远景/中景小脸崩溃**这一主场景。

与 `minimax-h3`（多卡）、`minimax-h3-one`（单卡 base）、`minimax-h3-turbo`（单卡极速）**并列**。区别是：

- **只做 ref2video**：只加载 Ref2VA 分区 + 复用 Turbo 离线合并出的 `ref2va-transformer`（lightx2v ref2v 8 步），不加载 FL2VA 分区；
- **权重与合并产物全部复用已有卷**（本包**不下载** H3 权重）；
- **默认精确注意力**（`fa`；SM12.x 自动回退精确 `torch_sdpa`）——人脸/微细节优先，而不是近似加速优先；
- 增加**人脸保持层**：参考组增强（L1）+ 生成后的人脸修复（L4）。

## 为什么要单独做一档（根因）

H3 的「远处脸崩」是**头部在画面里占比过小**的属性，**不是输出分辨率**的属性——社区实测 720p 以上、把步数加到 24 依旧会崩（见 `rfc/2026-10-10-minimax-h3-acceleration-and-face-preservation.md` §1.1）。所以策略是「**先锚定身份 → 再谈分辨率 → 最后才修脸**」，而不是靠调提示词：

| 级别 | 本包做法 |
|---|---|
| **L1 身份锚定**（最大杠杆） | `referenceSheet: auto` —— 从参考图里裁出人脸放大、拼成一张「角色参考组」追加为最后一张参考图（**不影响你原有的 `<Picture 1..N>` 编号**） |
| **L2 分辨率** | 本档不含（两阶段潜空间放大需要 ComfyUI/LightX2V 这类能控制潜空间/去噪的运行时，见 RFC 的 Tier B/C） |
| **L3/L4 修脸** | `faceRefine` —— 生成后逐帧检测 → 跟踪 → 裁剪 → 专用人脸修复（CodeFormer/GFPGAN ONNX）→ 羽化缝合；**源脸 <40px 自动切远景档**（画布 512 / 外扩 3.5 / 强度下调） |

**只动画面，不动声音**：修复后把 H3 的原生立体声**原样 copy** 回封装（不重编码音频）。

## 两个函数

| 函数 | 说明 |
|---|---|
| `reference-to-video` | 主链：参考组增强 → Ref2VA（8 步）→ 人脸修复（可关）→ 交付；**保留原始 mp4**（`runs/<id>.raw.mp4`），可只重跑修复 |
| `face-refine` | 对**已有视频**做同一套人脸修复（视频→视频，跑在便宜的小卡上、不加载 DiT）；「修复失败/效果不满意」时的**廉价恢复路径**，不必重新生成 |

## 配方与档位

```text
sglang serve --model-path /models/MiniMax-H3 --model-variant ref2va \
  --component-weights-paths.transformer /merged/ref2va-transformer   # ← 复用 turbo 的离线合并产物
  --num-gpus 1 --performance-mode speed --enable-torch-compile false \
  --attention-backend fa                                              # ← 人脸优先：精确
  [显存 <130GB 时] --quantization fp8 --layerwise-offload-components text_encoder
```

| 档位 | 显存 | 说明 |
|---|---|---|
| **RTX PRO 6000（默认）** | 96GB | fp8 DiT 驻留 + 文本编码器流式；GPU 快照 |
| H200 | 141GB | bf16 全驻留（给人脸阶段留头寸） |
| B200 | 183GB | 原生 mxfp8/NVFP4 |

`face-refine` 函数固定跑小卡（`L4`）。

## 三个前置卷（复用 + 新增）

| 卷 | 挂载 | 内容 | 来源 |
|---|---|---|---|
| `recut-minimax-h3-models` | `/models` | MiniMax-H3 权重（本包只读 Ref2VA 分区） | **复用**（由 minimax-h3 / -turbo 下好） |
| `recut-minimax-h3-turbo-merged` | `/merged` | `ref2va-transformer`（lightx2v ref2v 8 步离线合并） | **复用**（由 minimax-h3-turbo 的 `bootstrap_merge` 产出） |
| `recut-minimax-h3-ref-face` | `/face` | 人脸检测（YuNet）+ 修复（CodeFormer ONNX）小模型 | **新增**（几百 MB，`bootstrap_facemodels` 下载） |
| `recut-minimax-h3-ref-out` | `/out` | 产物中转（含保留的原始 mp4） | 新增 |

> **前置**：本包复用共享权重与合并产物，**请先对 `minimax-h3-turbo` 执行一次 `modal.install`**（它会下 Ref2VA 权重并离线合并 lightx2v ref2v LoRA）。缺任一前置时，`bootstrap_weights` 会给出可执行的修复指引（而不是晦涩的 SGLang traceback）。

## 表单参数

`reference-to-video` 在通用参考参数（prompt / 参考图·视频·音频 / 画幅 / 分辨率 / 时长 / 步数 / seed）之外，多出：

| 参数 | 默认 | 说明 |
|---|---|---|
| `referenceSheet` | `auto` | 参考组增强（L1）。关闭即完全不干预参考输入 |
| `faceRefine` | `auto` | `auto`/`off`/`codeformer`/`gfpgan` |
| `faceFidelity` | `0.6` | 修复保真度：越大越清晰、越小越像原脸（仅 codeformer） |
| `faceCropFactor` | `2.5` | 裁剪外扩倍数（远景建议 3.5） |
| `faceCanvasSize` | `768` | 修复画布（远景小脸自动降到 512） |
| `facePersonFallback` | `false` | 远景丢帧兜底（用人体框顶部反推头部；中景/夜景开了会拉偏） |
| `keepRaw` | `true` | 保留原始 mp4，便于只重跑修复 |

**参数与 `face-refine` 函数保持一致**（同名同义）。Agent/平台路由调用只需传 `prompt` + 参考素材，其余走 App 内「AI 默认参数」。

## 产物 meta

```jsonc
"referenceSheet": { "applied": true, "picture": 4, "bytes": 123456 },
"faceRefine": { "requested": "auto", "applied": true, "model": "codeformer", "faces": 3, "minFacePx": 52,
                "profile": "longshot", "fidelity": 0.45, "cropFactor": 3.5, "canvas": 512 },
"rawKey": "runs/<id>.raw.mp4", "attentionBackend": "fa", "generateSeconds": 124.9
```

**失败不连坐**：人脸阶段任何失败都只写 `faceRefine.applied=false + reason` 与日志，生成结果照常交付，任务终态仍为成功。

## 验证与实测

**本地（零 GPU / 零模型，可重复）**：

```sh
cd apps/modal-studio/modalapps/minimax-h3-ref
python3 face_refine.py --selftest        # 几何/跟踪/档位/参考组/降级 9 项
python3 mock_sglang.py --selftest        # H3 契约与异步视频协议
# 端到端（起 mock 服务 + 走 runner 的完整产物链路）：
python3 ../../python/modal_runner.py invoke --mock --dir . --function reference-to-video \
  --output /tmp/ref --params <params.json> --refs <refs.json> --mock-url http://127.0.0.1:30110
```

**云端（需 Modal 账号 + GPU）**：

```sh
python3 apps/modal-studio/python/modal_runner.py deploy --dir apps/modal-studio/modalapps/minimax-h3-ref
# 或 App UI 切换预设包后「部署环境」（deploy 收尾会自动 install）
modal run apps/modal-studio/modalapps/minimax-h3-ref/bench.py --runs 1 --duration 5
```

> **尚未真机验证 / 默认未生效的部分**（诚实标注）：
> ① **修复模型地址默认是空的**——`modal_app.FACE_RESTORE_URLS` 默认 `""`（不臆造 URL），需用环境变量 `RECUT_H3_CODEFORMER_URL` / `RECUT_H3_GFPGAN_URL` 指向一个**已验证 I/O** 的 ONNX 导出（检测模型 YuNet 有默认地址）。**未配置前，`faceRefine` 会优雅降级为「不修复」（`meta.faceRefine.applied=false`），生成照常交付。**
> ② 人脸 ONNX 的 **I/O 约定**（`load_restorer` 假定 NCHW float32 [0,1] + 可选 `w` 保真度）需按实际导出核对；
> ③ 修复阶段的**真实耗时/显存**（预期与 8 步生成的 ~125s 同量级，需 `bench` 实测）；
> ④ 参考组增强对画质的**实际增益**（需同 prompt/seed 的 A/B）。
> ③④ 在首次真机 deploy 时补齐，数字回填 README 与 RFC。
>
> **注意力后端**：本包默认精确 `fa`（人脸优先），由 `modal_app.ATTENTION_BACKEND` 控制（环境变量 `RECUT_H3_REF_ATTENTION` 可覆盖）。它是**部署期**的 server-wide 选择（改后需重新 deploy），目前**不是**表单/UI 可配项（把它提为预设包声明 + UI 开关见 RFC §D10，属 M2）。

## 已知边界

- **本包只做参考生视频**：`minReferences: 1`。平台按 `modal-cloud/minimax-h3-ref` 路由时若**不带参考素材**，同包内没有可回退的纯文生函数 → 会给出明确的「需要参考素材」错误（纯文生请用 `minimax-h3-turbo`）。
- **修脸不能修身份漂移**：修复只能把「已有的脸」画清楚，不能补回已在帧间丢失的身份——身份要靠 L1 参考锚定。
- **放大/修复不能修**：错误运动、时域闪烁、畸变文字、物理错误、错误构图。结构错请**先重新生成**。
- **两阶段潜空间放大不在本包**：需要能控制潜空间/去噪强度的运行时（ComfyUI / LightX2V），见 RFC 的 Tier B/C。
- 权重受 **MiniMax-H3 Community License** 约束（非 OSI）；修复模型（CodeFormer / YuNet）各自的许可证也需单独核查。
