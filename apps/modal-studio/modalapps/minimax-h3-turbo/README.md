# MiniMax-H3 极速版（Turbo 离线合并 + GPU 快照）

[MiniMax-H3](https://github.com/MiniMax-AI/MiniMax-H3) 的全模态音视频生成（文本/关键帧/多模态参考 → 带原生立体声的视频，4–15 秒、768p、24 FPS）。本预设包是**时延优先的极速分支**，与多卡 `minimax-h3`、单卡 `minimax-h3-one` **并列、三选一**，复用同一份权重卷。

同样提供三个函数：`H3Turbo`（`--model-variant fl2va`）服务**文生视频（t2va）/ 首尾帧生视频（fl2va）**，叠加 larryvrh Turbo 少步 LoRA；`H3TurboRef`（`--model-variant ref2va`）服务**参考生视频（ref2va，图像/视频/音频）**，叠加 **Ref2VA 专用的 lightx2v turbo 8 步 LoRA**。两份 LoRA 各自离线合并进**各自分区**的 transformer，互不通用。

> ⚠️ **三个函数都走少步**：文生视频 / 首尾帧 = larryvrh turbo（请求 **9** 步）；参考生视频 = lightx2v ref2v turbo（请求 **9** 步 = 8 NFE）。两者是不同的 LoRA、不同的 base 分区，**不能互换**。

### Ref2VA 的加速路径

- **lightx2v `minimax_h3_ref2v_turbo_8step_v1.0_768p_bf16.safetensors`（本包采用）**：纯 PEFT LoRA（无 PDD 头 bank），但它是 **diffusers 命名**且 q/k/v 分开 —— 合并时必须做映射改写（`transformer_blocks.*`→`blocks.*`、`token_refiner.refiner_blocks.*`→`token_refiner.blocks.*`、`attn.to_out.0`→`attn.out_proj`、`ff.net.0.proj`→`mlp.fc1`、`ff.net.2`→`mlp.fc2`）并把 q/k/v **按 head 交织融合**进 native 的 `attn.qkv_proj`；缩放 `scale = alpha/rank = 8/128 = 0.0625`（**不是** 1.0）。本包直接复用 SGLang 自带的映射/交织实现（`build_minimax_h3_pdd_weights._target_of` / `_interleave_qkv`），且命中数与预期不符时**直接报错**，而不是静默产出坏权重。
- **备选：`alibaba-pai` PDD Acc-8Step（未采用）**：Ref2VA 也有对应 PDD 加速（`MiniMax-H3-Ref2VA-Acc-8Step`），但它多带 **32 个输出头 bank**，普通 LoRA loader 会丢掉这部分（=丢掉核心加速），必须走 SGLang 的 `build_minimax_h3_pdd_weights` → `fuse_minimax_h3_pdd_heads` → `SGLANG_DIFFUSION_MINIMAX_H3_PDD_HEADS` 管线（请求步数被 schedule 强校验为 9）。本包先选改动面更小、与 FL2VA 同构的 lightx2v 路线。

它把「少步蒸馏 + 合成量化驻留 + 快注意力 + GPU 快照 + 形状预热」叠在一起，且**少步 LoRA 是在 bootstrap 里离线合并进权重的**（不是运行期 LoRA）。

## 状态与实测（2026-09-29，真机 RTX PRO 6000 + `lmsysorg/sglang:dev`）

**✅ Turbo 离线合并路径已实现并真机跑通。**

| 环节 | 实测 |
|---|---|
| 复用共享权重卷 | `bootstrap_weights` 见到标记短路，**14s 完成、零下载** |
| 下载 LoRA | 780MB → `/adapters` |
| **离线合并** | 读 13 个分片、合并 **259 个张量**、写 `/merged/transformer`（≈62GB），**~11 分钟纯 CPU，不占 GPU** |
| 生成（合并版 + fp8 + 9 网格点=8 次去噪） | 1344×768 / 4s：**66.1s**，峰值显存 **46.4 GiB** |

> 对比：base 50 步在同类单卡上约 **8 分钟/5s 片** —— Turbo 约 5–6× 时延收益。

**为什么必须离线合并（而不是运行期 LoRA）**：当前 sglang build 上，H3 挂任意 LoRA 都会在 warmup 阶段崩：
```text
AttributeError: 'RowParallelLinearWithLoRA' object has no attribute 'quant_method'
  minimax_h3.py → _accepts_mxfp8_input  （MLP forward 无条件读 self.fc2.quant_method）
Server warmup failed; aborting startup
```
sglang 会把 GPU 上**所有线性层**换成 `*WithLoRA` 包裹层（`Converted 266 layers to LoRA layers`），包裹层缺该属性。**与是否量化无关**（在线 fp8 与不量化都复现）。离线合并后没有包裹层 → 探针正常，**因此还能继续用 `--quantization fp8`**（这正是 96GB 便宜卡能跑 Turbo 的关键）。

**代价（作者明示的取舍）**：LoRA 仓库 README 指出「合并进 bf16 会把较小的 delta 舍入掉 → 运行期 LoRA 最锐，合并版 *a bit softer*，量化基座更明显」。本包因上游 bug 只能走合并版；等上游修复后切回运行期 LoRA 可拿回最锐结果。

**其他实测约束**：
- **SM12.x（RTX PRO 6000）无 `fa`**：`fa` 会回退 `torch_sdpa`（仍精确）。故默认 `ATTENTION_BACKEND="auto"`：SM90/SM100/SM120 → `subblock_sparse_attn`（近似，但比 `torch_sdpa` 快），其余（含 B300/SM103，不在其支持列表）→ `fa`。

### 参考生视频（ref2va）真机验证（2026-09-30，H200 单卡 · bf16 全驻留）

| 项 | 结果 |
|---|---|
| 启动 | `--model-variant ref2va` + `subblock_sparse_attn` 正常起服务 |
| 形状预热（本包新增） | 合成占位参考图发起一次真 ref2va 4s/9 步请求，**58.2s**，峰值 ≈120 GiB |
| 合并前基线（base 50 步 / 5s / 1344×768） | denoise **49 步 @ ~6.6s/it（≈5.4min）**，产物 h264+aac、5.175s |
| 首次调用 wall-clock（base 路径） | ≈18min（含单次建快照 + 权重加载 + 预热；之后从快照秒级恢复） |
| **8 步合并路径（lightx2v，本包现用）** | RTX PRO 6000 / fp8：5s / 1344×768 / **8 次去噪 = 124.9s/片**（含解码，峰值 48.8 GiB）。相对 base 50 步（≈8–12min）**约 4–6×**；首次调用 wall-clock ≈16min（一次性建快照） |

> **Ref2VA 权重是硬前置**：共享卷若只下过 FL2VA，会缺 `Ref2VA/{tokenizer,video_vae,transformer}`，SGLang 启动即失败（`ValueError: Model directory .../Ref2VA is missing required component directories`）。先 `modal.install` 让 `bootstrap_weights` 补下 Ref2VA（写 v2 标记）。`_ensure_server` 现已对该情况**提前报可执行错误**，不再抛出晦涩的 sglang traceback。
> **前置产物缺失不该变成 crash-loop**：`/merged/ref2va-transformer`、`/merged/transformer`（以及 Ref2VA 权重分区）都是**确定性**前置。若只把它们直接抛在 `@modal.enter(snap=True)` 里，Modal 会把异常当作容器启动失败并**反复重建容器**（`Function ... is crash-looping: containers are repeatedly failing to start.`），每个新容器都重新尝试建 GPU 快照——空烧 GPU，而错误只留在容器日志里。因此本包：`_assert_ready()` 在**方法体**（`generate_video`）先断言（错误归属这一次调用，直接返回本机）；`start()` 捕获 `PrereqError` 后放行（容器正常起来）；类设 `retries=0`。App 侧另有预检（`engine.artifacts` / `engine.requires`）：产物缺失时界面显示未就绪、提交被拦、**不创建云端容器**。

## 与另外两个预设包的关系

| 预设包 | 拓扑 | 快照 | 定位 |
|---|---|---|---|
| `minimax-h3` | H200×4 / H100×4 / B200×4 / B200×8 | ❌（多卡不支持） | 多卡，例行质量优先（50 步） |
| `minimax-h3-one` | 单卡（RTX PRO 6000 等） | ✅ | 单卡，base 50 步 |
| **`minimax-h3-turbo`（本包）** | 单卡（快照档） | ✅ | **Turbo 少步（离线合并）+ 形状预热，时延优先**：文/首尾帧 9 步，参考 8 步 |

三者共用同一套 `h3_contract`，调用方式完全一致。

## 可选 GPU 档位（单卡，越高越快越贵）

| 档位 | 显存 | Modal $/h（仅 GPU） | 配方 |
|---|---|---|---|
| **RTX PRO 6000（默认，最省）** | 96GB | 3.03 | fp8 DiT 宿留 + 文本编码器流式 + `auto`→`subblock_sparse_attn`（SM12.x 无 `fa`） |
| H200 | 141GB | 4.54 | bf16 全驻留（≈118 GiB 放得下） |
| B200 | 183GB | 6.25 | bf16 全驻留，原生 mxfp8/NVFP4 可用 |
| B300 | 288GB | 7.10 | 单卡上限（`auto` 在该档回落精确 `fa`） |

> 单卡才能用 GPU memory snapshot（Modal 不支持多卡快照），故本包**只提供单卡档**。要更多并行度用 `minimax-h3`。
> 价格仅为 GPU，另有 host RAM（本包默认 256GiB ≈ $2.05/h）与卷存储。每种 GPU 型号各自建一份快照：切到新档后首次调用会重建快照（慢一次），之后各自秒级恢复。

## 配方（容器内按显存自动选择）

```text
sglang serve --model-path /models/MiniMax-H3 --model-variant fl2va \
  --component-weights-paths.transformer /merged/transformer   # ← 仅 Turbo/fl2va：离线合并权重（无运行期 LoRA）
  --num-gpus 1 --performance-mode speed --enable-torch-compile false \
  [显存 <130GB 时] --quantization fp8 --layerwise-offload-components text_encoder \
  --warmup-resolutions 1344x768 \                             # ← 仅 Turbo/fl2va（serve 侧）
  --attention-backend <auto | fa | sage_attn | sol_attn | subblock_sparse_attn>
```

- **≥130GB**（H200/B200/B300）：BF16/FP32 全驻留放得下，不量化最快；
- **<130GB**（RTX PRO 6000 96GB / SM120）：在线 fp8 只量化 DiT 让其常驻，文本编码器流式 offload；
- **ref2va**（`H3TurboRef`）：`--model-variant ref2va`，加 `--component-weights-paths.transformer /merged/ref2va-transformer`（lightx2v 合并权重）；不加 `--warmup-resolutions`（用请求级预热），仍享 fp8 驻留 + 快照。
- 请求步数两边默认都是 **9**（＝8 次去噪）：FL2VA 由作者建议的 4–8 次去噪推得，Ref2VA 由 lightx2v 8 步 LoRA 决定。
- **分辨率**（表单「最长边」，短边按画幅换算、≤768p，只下调不超分）会换掉请求形状：快照只预热了 `1344x768` 那一种，换到更小的画幅时该容器内首个请求要多付一次分配器增长成本（结果不变，之后同形状恢复常态），故默认档 1536（16:9 下即原生 768p）。

## 三个卷（bootstrap 三步）

| 卷 | 挂载 | 内容 | 步骤 |
|---|---|---|---|
| `recut-minimax-h3-models` | `/models` | FL2VA + Ref2VA 原始权重（**与 minimax-h3/-one 共用，只读**） | `bootstrap_weights`（见标记即短路） |
| `recut-minimax-h3-turbo-adapters` | `/adapters` | 两份少步 LoRA（FL2VA larryvrh + Ref2VA lightx2v，各 ~1GB） | `bootstrap_adapters` |
| `recut-minimax-h3-turbo-merged` | `/merged` | **两份离线合并后的 transformer**（`transformer/`＝FL2VA，`ref2va-transformer/`＝Ref2VA，各 ≈62GB） | `bootstrap_merge` |
| `recut-minimax-h3-turbo-out` | `/out` | 产物中转 | — |

`modal.install` 会依次跑这三步（幂等）。也就是说：**权重只下一次；每个用户各自在自己的账号里合并一次（CPU，不花 GPU 钱），产物留在自己的卷里。**

## GPU 快照

`H3Turbo` 与 `H3TurboRef` 都开启 `enable_memory_snapshot=True` + `experimental_options={"enable_gpu_snapshot": True}`，`@modal.enter(snap=True)` 内 `_ensure_server()` + 形状预热。首次运行会创建快照（较慢，一次性），之后冷启动从快照秒级恢复。改了代码 / 镜像 / serve flags 会自动重建快照。两个类都设 `retries=0`：容器/调用失败只报一次，不因确定性错误反复重建（见上方「前置产物缺失不该变成 crash-loop」）。

> Modal 限制：GPU memory snapshot **不支持多 GPU Function**，所以本包只做单卡；多卡走 `minimax-h3`。

## 注意力后端与实测（M1）

注意力后端是 **server-wide** 的部署期选择（非请求参数）：改 `modal_app.py` 顶部的 `ATTENTION_BACKEND` 一行后重新部署，镜像会按 profile 的 pip 补装内核、快照随之重建。

默认 `ATTENTION_BACKEND="auto"`：按容器实际 GPU 架构解析——SM90/SM100/SM120 → `subblock_sparse_attn`，其余 → `fa`。

| profile | 说明 | 额外依赖 |
|---|---|---|
| `auto`（默认） | 按 GPU 架构挑：SM90/100/120 → `subblock_sparse_attn`，否则 `fa` | 无 |
| `fa` | 精确 FlashAttention（一致性基准） | 无（但 **SM12.x 不支持，自动回退 `torch_sdpa`**） |
| `sage_attn` | 量化注意力（近似） | 固定 commit 的 [SageAttention](https://github.com/thu-ml/SageAttention) |
| `sol_attn` | Sage→Sol 混合（前 10 步精确、其后近似） | 同上 |
| `subblock_sparse_attn` | 无训练块稀疏（内建，SM90/SM100/**SM120**；`auto` 在这些架构上选它） | 无 |

> 除 `fa` 外均为**近似**，输出**非**一致性基准，启用后须在目标负载上同时抽检视频**与音频**。

**形状对齐预热**：`WARMUP=True` 时，`@modal.enter(snap=True)` 会在建快照前按目标形状预热一次（4s 请求），把分配器/算子/首帧成本一并冻进快照：
- `H3Turbo`（fl2va）：serve 侧 `--warmup-resolutions 1344x768` + 一次 t2va 请求；
- `H3TurboRef`（ref2va）：serve 侧无 `--warmup-resolutions`，改用一张**合成占位参考图**发起一次真正的 ref2va 预热请求（否则会被分区拒绝、白预热）。该步为 best-effort：失败只记日志，不影响服务。

**实测一条命令**（先部署本包并 install，再跑 bench）：

```sh
python3 apps/modal-studio/python/modal_runner.py deploy --dir apps/modal-studio/modalapps/minimax-h3-turbo
# 或 App UI「部署环境」（deploy 收尾会自动 install）
modal run apps/modal-studio/modalapps/minimax-h3-turbo/bench.py --runs 1 --duration 4
modal run apps/modal-studio/modalapps/minimax-h3-turbo/bench.py --gpu H200 --runs 1
```

输出 JSON：`{ attentionBackend, gpu, resolution, steps, seconds[], medianSec, peakVramGb }`（`peakVramGb` 为尽力采样的近似峰值）。
对比流程＝**改 `ATTENTION_BACKEND` → 重新部署（重建快照）→ 跑 bench**，逐后端记录 `medianSec` 并给出画质抽检结论。

## 前置条件

- **HF 访问授权**：`MiniMaxAI/MiniMax-H3` 是 gated 仓库，需在 Hugging Face 申请。
- **HF token**：`modal.secret.set { name: "recut-hf-token", values: { HF_TOKEN: "hf_..." } }`（若权重已由 `minimax-h3` 下好，权重部分会短路，但 secret 仍需存在以便部署）。
- **host RAM**：单卡流式/驻留需较大 host RAM（本包默认请求 256 GiB）。
- **额外卷空间**：合并产物**约 124GB/账号**（FL2VA + Ref2VA 两份 transformer，各 ≈62GB，一次性）；另需 Ref2VA 权重分区（约 134GB，`modal.install` 随 `bootstrap_weights` 一并补下）。
- **许可**：受 MiniMax-H3 Community License 约束；LoRA 适配器（apache-2.0）另有其自身条款。

## 已知边界

- **合并版比运行期 LoRA 略软**（作者取舍，见上）；等上游修好 `*WithLoRA` × `quant_method` 兼容后可切回运行期 LoRA。
- **步数**：两边都请求 **9**（＝8 次去噪）。FL2VA 依作者「4–8 次去噪」建议；Ref2VA 由 lightx2v 8 步 LoRA 决定。超过 8 次去噪收益消失甚至过锐。
- Cache-DiT（`quality:"high"`）官方 fail-closed 到 4×H200 特定 workload，本包单卡档**不可用**。
- **画质抽检待补**：本轮只验证了「能否跑通 + 时延/显存」，合并版相对运行期 LoRA 的画质差异尚未逐帧比对。
- **参考生视频（ref2va）走 lightx2v 8 步**：本包把 `lightx2v/Minimax-h3-Turbo` 的 `ref2v_turbo_8step` 离线合并进 Ref2VA transformer（需 diffusers→native 映射 + q/k/v 交织，见「Ref2VA 的加速路径」），请求 9 步。它**不是** FL2VA 那份 `larryvrh` LoRA —— 两者 base 分区与覆盖面都不同。要求至少 1 个参考素材，上限图 ≤9、视频 ≤3、音频 ≤3。
- **注意力后端**：`auto` 在 SM90/100/120 上会选近似块稀疏（`subblock_sparse_attn`），输出**非**一致性基准，需在目标负载上抽检视频**与音频**；要严格一致请把 `ATTENTION_BACKEND` 固定为 `fa`。
