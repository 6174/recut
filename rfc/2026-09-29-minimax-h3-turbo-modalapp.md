<!--
 * [INPUT]: 既有 modal-studio 预设包范式（apps/modal-studio/README.md；modalapps/minimax-h3 多卡 SGLang、
 *          modalapps/minimax-h3-one 单卡 + GPU memory snapshot；modal_app.py / bootstrap.py / h3_contract.py /
 *          manifest.json）、rfc/2026-09-24-modal-functions.md（App 层契约与 modalapp 三件套）、
 *          SGLang Diffusion「MiniMax-H3」cookbook（recipe / checkpoint-adapter 格式表 / LoRA 配方 / 注意力后端 /
 *          Cache-DiT / AdaLN 缓存 / 基准）与「Quantization」页（quant_family 兼容表）、
 *          Modal Memory Snapshots（enable_memory_snapshot + experimental_options["enable_gpu_snapshot"]）。
 * [OUTPUT]: 设计一个新预设包 modalapps/minimax-h3-turbo（「MiniMax-H3 极速版」）：复用现有 recut-minimax-h3-models
 *          共享权重卷（零重复下载 134GB），在单卡 RTX PRO 6000 96GB（SM120）上以 Turbo 少步 LoRA（默认 9 步 / 8 NFE）
 *          + 合成式 fp8（SM100+/SM120 映射 mxfp8）DiT + 快注意力/跳步后端（sage_attn / subblock_sparse_attn / spectrum，
 *          按实测取舍）+ 组件驻留，并开启 GPU memory snapshot（把已合并 LoRA 的 sglang 常驻服务冻进快照，冷启动秒级）；
 *          只做单卡档（快照与多卡互斥，多卡冷启动过慢故不复刻）。表单在 h3_contract 上仅新增 steps/profile 默认值。
 *          全部改动落在 apps/modal-studio/，零 service 改动。
 * [POS]: rfc 的「Modal 云函数」系列第二篇——把一个社区「本地低显存跑 33B 视频模型」的异构优化策略，
 *        按「哪些杠杆在 Modal 上真的成立」重新收敛为「少步 + 快注意力 + 合成量化 + GPU 快照」的极速预设包设计稿。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC：MiniMax-H3 极速版（Turbo modalapp）——少步 LoRA + 快注意力 + GPU 快照

- 状态：Proposal
- 作者：Recut
- 日期：2026-09-29
- 决策范围：`apps/modal-studio/modalapps/minimax-h3-turbo/`（新预设包，纯 App 层）；复用既有 `recut-minimax-h3-models` 权重卷；新增 `recut-minimax-h3-turbo-adapters` / `recut-minimax-h3-turbo-out` 卷；不新增 manifest 契约字段、不改 `h3_contract` 的请求形状（只加默认值）
- 关联：[Modal 云函数（modal-studio）](./2026-09-24-modal-functions.md)、[本地模型本地生成（gen-studio）](./2026-09-23-local-generation-studio.md)、comfyui-studio 的 comfyuiapps 姊妹结构（[工作流应用 RFC](./2026-09-24-comfyui-studio-workflow-apps.md)）

## 0. 白话总结（先看这个）

**这件事是：** 社区里已经有人把 MiniMax-H3（33B 全模态音视频模型）跑在 16GB 消费级显卡上，靠的不是把模型「塞进 16GB」，而是拆成几层——**主模型量化（INT8/NVFP4）、CPU/RAM 承载容量、少步蒸馏 LoRA、低精度注意力、条件缓存、运行时 kernel**。这个策略里真正**与硬件无关、能迁移到 Modal** 的只有三件事：

1. **少步 LoRA**（把 50 步采样压到 8–9 步）；
2. **快注意力 / 跳步 kernel**（注意力换成近似后端、跳过部分去噪步）；
3. **GPU memory snapshot**（把「加载 134GB 权重 + 拉起常驻服务 + 预热」从每次冷启动里彻底剔除，冷启动从 ~2.5 分钟降到秒级）。

而「16GB 显存 / 32–64GB 内存 / CPU offload / 逐层流式」那一整套容量故事，在 Modal 的 96–183GB 数据中心卡上**基本不成立**（显存不再是瓶颈）。Modal 的瓶颈是**单次时延**与**冷启动成本**，所以极速版的目标从「能不能跑」变成「多快、多便宜」。

**它长什么样：** 就是 `minimax-h3` / `minimax-h3-one` 的第三个并列预设包（三选一切换），复用同一份权重卷：

```text
                    recut-minimax-h3-models  (共享权重卷，已由 minimax-h3 下好 134GB)
                              │  mount /models  (只读使用)
        ┌─────────────────────┴─────────────────────┐
        │      modalapps/minimax-h3-turbo           │
        │  ┌─────────────────────────────────────┐  │
        │  │ RTX PRO 6000 96GB (SM120) · 单卡     │  │  ← GPU memory snapshot（默认档）
        │  │ sglang serve --model-variant fl2va   │  │
        │  │   --component-weights-paths.          │  │  ← 离线合并的 Turbo 权重（无运行期 LoRA）
        │  │     transformer /merged/transformer    │  │
        │  │   --quantization fp8   (→ mxfp8)     │  │  ← DiT 合成式低精度，驻留
        │  │   --attention-backend <fast>         │  │  ← sage_attn / subblock_sparse_attn（可选）
        │  │   --performance-mode speed           │  │
        │  └─────────────────────────────────────┘  │  @modal.enter(snap=True) 冻结整棵进程树
        └────────────────────┬─────────────────────┘
                             ▼
                      视频 + 原生立体声
```

**几个关键决定：**

1. **复用权重卷，不重复下载**：`minimax-h3` 已经把 FL2VA 权重下进 `recut-minimax-h3-models`；极速版只挂这个卷，`bootstrap_weights` 见到完成标记直接短路；只需另下**几百 MB 的 LoRA 适配器**到自己的小卷。
2. **只做单卡 + 快照**：GPU memory snapshot 只支持**单卡**（Modal 限制，`minimax-h3-one` 已踩过）；多卡档拿不到快照、每次冷启动要 ~2 分钟，对本 App「时延优先」的定位不划算，因此**不做多卡**（需要多卡并行用既有 `minimax-h3`）。
3. **少步 LoRA 是最大杠杆，但必须先固定步数**：蒸馏 LoRA 与 sigma 步网格强绑定（9 步 = 8 次 NFE；lightx2v 的 4 步要 `--lora-alpha 8`；PDD 8 步会**拒绝**其它步数）。因此极速版按**一份配方 = 一个部署**来做，表单只暴露默认步数（并标注不可乱改）。
4. **合成式量化在单卡上主要买「驻留」，不买「更快」**：fp8/mxfp8 让 33GB 的 DiT 常驻显存，从而**免去逐层流式**；这在 96GB 卡上是实打实的时延收益。
5. **LoRA 离线合并 + GPU 快照**：LoRA 在 bootstrap 里合进 transformer（`W' = W + B@A`，`bootstrap_merge`），serve 直接加载合并权重；快照捕获「已合并、已预热」的状态，一次建快照、之后每次都秒级起。
6. **不碰平台**：仍是一个标准 App 的预设包，v1 不写 `contributes.media`、不占默认路由；能力经本 App 的 `modal.generate` 暴露（承 [modal-functions RFC](./2026-09-24-modal-functions.md) §5）。

**一句话：** 极速版 = 已有 H3 权重卷 + Turbo 9 步 LoRA + 合成式 fp8 驻留 + 快注意力 + **GPU 快照**；把「本地省显存」的故事，翻译成 Modal 上的「少算步、算得快、起得快」。

---

## 0.1 技术摘要

新增预设包 `modalapps/minimax-h3-turbo/`（三件套 `manifest.json` + `modal_app.py` + `bootstrap.py` + 复用 `h3_contract.py` 副本），与 `minimax-h3`（多卡）、`minimax-h3-one`（单卡 + 快照）**并列、三选一**。

- **权重复用（零重复下载）**：挂载既有 `recut-minimax-h3-models`（`/models`，FL2VA，约 134GB）与自有 `recut-minimax-h3-turbo-adapters`（`/adapters`，LoRA 适配器，几百 MB）+ `recut-minimax-h3-turbo-out`（`/out`，产物）。
- **单卡快照档（默认）**：`@app.cls(gpu="RTX-PRO-6000", enable_memory_snapshot=True, experimental_options={"enable_gpu_snapshot": True})`，`@modal.enter(snap=True)` 内 `sglang serve` + 预热，整棵进程树（含 sglang 子进程 CUDA 状态）冻进快照。
- **配方（serve flags，单卡 96GB / SM120）**：
  ```text
  sglang serve \
    --model-path /models/MiniMax-H3 --model-variant fl2va \
    --component-weights-paths.transformer /merged/transformer   # Turbo 离线合并权重（无运行期 LoRA）
    --quantization fp8                 # SM100+/SM120 → online mxfp8；DiT 常驻
    --attention-backend <fa|sage_attn|subblock_sparse_attn>   # 见 §3.3，默认保守
    --performance-mode speed           # 组件尽量常驻（容量够）
    --layerwise-offload-components text_encoder    # 官方 bf16 编码器 46GB 单卡放不下，仍需流式
    --enable-torch-compile false \
    --host 127.0.0.1 --port 30010
  ```
  请求侧 `num_inference_steps: 9`（8 次 NFE），其余契约（`task` / `target` / `flow_shift 12` / `audio_flow_shift 3`）不变。
- **只做单卡档（有意）**：GPU 快照与多卡互斥，多卡档冷启动（无快照）约 2 分钟，对时延优先定位不划算；多卡并行请用既有 `minimax-h3`。
- **契约**：复用 `h3_contract.build_video_body`，仅把 `steps` 默认值从 50 调成 9（`num_inference_steps`），其余字段与 `minimax-h3` 完全同构，保证三个预设包可互换。
- **改动面**：仅 `apps/modal-studio/modalapps/minimax-h3-turbo/**`（新增）+ `python/registry.json`、`modalapps/index.json`（重跑 `publish_registry.py` 生成）。**零 `service/` 改动。**

---

## 0.2 实测发现（2026-09-29，真机 RTX PRO 6000 + `lmsysorg/sglang:dev`）

真机 `modal deploy` + `modal run bench.py` 跑通了「部署 → 复用权重卷 → 建快照 → 生成」，并暴露两个硬事实，已据此把默认配置改为**可用状态**：

1. **❌ H3 + 任意 LoRA 在当前 build 上启动即崩（上游阻断）。**
   ```text
   AttributeError: 'RowParallelLinearWithLoRA' object has no attribute 'quant_method'
     minimax_h3.py line 376, in _accepts_mxfp8_input  → MLP forward 无条件读 self.fc2.quant_method
   Server warmup failed; aborting startup
   ```
   sglang 把 GPU 上**所有线性层**换成 `*WithLoRA` 包裹层（`Converted 266 layers to LoRA layers`），包裹层缺 `quant_method`。**在线 fp8 与不量化两种配方均复现**，与显存无关（换 H200 也不会好）。
   → 结论：**在线量化 + LoRA、以及裸 LoRA，在本 build 都不可用**；SGLang 只背书「离线合并的 Turbo checkpoint」（把 LoRA 融进权重后用 `--component-weights-paths.transformer` 提供）——这正是本包采用的方案（见第 4 条）。
2. **⚠️ SM12.x（RTX PRO 6000）无 `fa`**：日志 `FlashAttention is not supported on SM12.x in this build; falling back to Torch SDPA`。该档 `fa` 实际回退 `torch_sdpa`（仍精确）。SM120 的加速注意力应改用 `subblock_sparse_attn`。
3. **✅ 复用/快照/预热按设计工作**：`bootstrap_weights` 见到共享卷标记短路（实测 14s，零权重下载，仅下 LoRA）；`@modal.enter(snap=True)` 内文本编码器流式 offload 正常。关掉 LoRA、恢复 fp8 后烟测通过：**RTX PRO 6000 / 1344×768 / 4s / 10 步 = 72.1s（denoise 8 迭代 ≈50s + decode ≈6.3s），峰值显存 46.4 GiB**，`bench` 返回 JSON 正常。

4. **✅ 修复落地：LoRA 在 bootstrap 里离线合并，并真机验证通过。**
   `bootstrap_merge`（**CPU 流式**：按 base 的 13 个分片逐张量算 `W' = W + B@A`，LoRA 仓库 README 明示 alpha == rank → 无额外缩放）把 Turbo LoRA 合进 `/merged/transformer`（**259 个张量、≈62GB、~11min、不占 GPU**）；serve 改用 `--component-weights-paths.transformer /merged/transformer` —— **没有 LoRA 包裹层 → `quant_method` 探针正常 → 可继续 `--quantization fp8`**（这才是 96GB 便宜卡能跑 Turbo 的关键）。真机结果：**RTX PRO 6000 / 1344×768 / 4s / 9 网格点（8 次去噪）= 66.1s，峰值 46.4 GiB**（对比 base 50 步 ≈8min/5s，约 5–6×）。
   代价（作者取舍）：合并进 bf16 会舍入掉较小的 delta → 合并版比运行期 LoRA *a bit softer*；等上游修好 `*WithLoRA × quant_method` 兼容后可切回运行期 LoRA 拿回最锐结果。每个用户在自己的账号里合并一次（CPU、幂等、留自己的卷）。

---

## 1. 目标与非目标

### 1.1 目标

1. 在既有 H3 预设包之外，提供**一个时延优先的极速预设包**，与 `minimax-h3` / `minimax-h3-one` 三选一。
2. **复用** `recut-minimax-h3-models` 权重卷，**不重复下载 134GB**；只增量下载几百 MB 适配器。
3. 用 **GPU memory snapshot** 把冷启动从「加载 ~134GB + 预热 ~30s」降到秒级（单卡档）。
4. 用 **少步 LoRA** 把 50 步压到 8–9 步（合成式 fp8 让 DiT 常驻，避免逐层流式）。
5. 用**可选快注意力 / 跳步后端**继续压单步成本，但**默认保守**（精确 `fa`），近似项显式开启并标注质量代价。
6. 与既有契约**同构**：同一套 `h3_contract`、同一个 `modal.generate` 表单形状，切换预设包不改调用方式。
7. 全部改动落在 App 层，**不改 `service/`**。

### 1.2 非目标

- **不做**本地/消费级显卡的显存 offload 故事（那是 `sglang` 的 `--layerwise-offload-*` 领域，且 Modal 上显存不是瓶颈）。
- **不做**模型训练 / LoRA 训练；只消费社区已发布的适配器。
- **不引入**新的 manifest 契约字段（`engine.profiles` 等）；配方固化在 `modal_app.py` 里，靠「新预设包 = 新配方」表达差异。
- **不保证** Turbo 9 步的画质与 base 50 步一致（少步蒸馏是**近似**，见 §4）。
- **不接平台路由**（承 modal-functions RFC §5：v1 不写 `contributes.media`、不占默认路由）。
- **不覆盖** FastH3 / VDN-H3 等**换架构**的蒸馏（它们改的是注意力/权重结构，不是 LoRA 叠加，属后续独立预设包候选）。

---

## 2. 从「16GB 本地跑 H3」到「Modal 极速版」：哪些杠杆真的可迁移

社区策略的「五层优化」经对照 SGLang Diffusion 的 H3 cookbook 后，映射与可迁移性如下：

| 社区层 | 具体手段 | SGLang H3 对应开关 | 在 Modal 上成立吗 | 本 RFC 取用 |
|---|---|---|---|---|
| L1 模型压缩 | INT8 / NVFP4 / W4A8 权重 | `--quantization fp8`（SM100+→mxfp8）／`kitchen_int8`（在线）／`--component-weights-paths.*`（int8-convrot / nvfp4 / gguf） | ✅ 但**买的是驻留而非速度**（96GB 卡上免逐层流式） | ✅ `--quantization fp8` |
| L1 容量承载 | CPU/RAM offload、逐层流式 | `--layerwise-offload-components`、`--dit-layerwise-resident-layers` | ❌ 显存不缺，offload 只增时延 | 仅对 bf16 文本编码器保留 |
| L2 计算精度 | SageAttention | `--attention-backend sage_attn` / `sol_attn`(`dense_backend=sage_attn`) / `subblock_sparse_attn` / `cube_sparse_attn` | ✅ 单步成本↓ | ✅ 可选（默认 `fa`） |
| L3 少步采样 | 8 步加速 LoRA（PDD）/ Turbo LoRA | **离线合并**进权重（`bootstrap_merge`）+ `--component-weights-paths.transformer` + 请求 `num_inference_steps`（运行期 `--lora-path` 在当前 build 上会崩，见 §0.2） | ✅ **最大杠杆** | ✅ 默认 Turbo 9 步（合并版） |
| L3 跳步 | Spectrum（跳过部分去噪步） | `--enable-spectrum` | ✅（与 `fa`/`sage→sol` 组合可用；不能与 `quality=high` 或 SP>1 同用） | ✅ 可选 |
| L4 条件缓存 | 文本/图像编码复用 | 请求内同 prompt fan-out 复用条件；**跨请求缓存无官方开关** | ⚠️ 部分（见 §8） | ❌ 记为开放问题 |
| L4 特征缓存 | Cache-DiT（跳过 DiT block） | `quality:"high"` / `SGLANG_CACHE_DIT_*` | ❌ 官方 `quality:"high"` **fail-closed 到 4×H200 特定 workload**，其它硬件/形状会被拒 | ❌ 记边界 |
| L5 运行时 | kernel / CUDA / 预热 | `--performance-mode speed`、`--warmup-resolutions`、`--use-fsdp-inference` | ✅ | ✅ |
| L5 冷启动 | —（本地无此概念） | Modal **GPU memory snapshot** | ✅ 单卡可用，多卡不支持 | ✅ 默认档核心 |

**结论**：社区策略里对 Modal 真正有效的是 **L3（少步）+ L2（快注意力）+ L5（快照 + 驻留 + 预热）**；L1 在 Modal 上只作为「让 DiT 常驻」的手段；L4 的 Cache-DiT 因官方 fail-closed 基本用不上（除非恰好复刻 4×H200 / 1344×768 / 124-frame / 50-step 的审计 workload）。

**另一处需要纠正的前提**：社区叙述里的「16GB / 32–64GB RAM / 显存峰值 14.6GB」等，是**单卡低显存**语境；Modal 的档位（RTX PRO 6000 96GB / H200 141GB / B200 183GB）下，**显存与主存都不是瓶颈**，因此本 RFC 的优化目标是**时延与冷启动**，而非「能不能装下」。

---

## 3. 设计：`minimax-h3-turbo` 预设包

### 3.1 目录、卷与复用

```text
apps/modal-studio/modalapps/minimax-h3-turbo/
├── manifest.json      # id/capability/engine(image/gpuTiers/volumes/secrets)/weights/functions(formSchema)
├── modal_app.py       # 云端 Modal App：Image + 两个 Volume + @app.cls(H3Turbo, 快照) + bootstrap
├── bootstrap.py       # 权重/适配器准备入口（模态 run）
├── h3_contract.py     # 与 minimax-h3 / minimax-h3-one 共享契约层（同一份副本）
└── README.md
```

| 卷 | 挂载 | 用途 | 复用关系 |
|---|---|---|---|
| `recut-minimax-h3-models` | `/models` | FL2VA 权重（约 134GB，只读使用） | **与 `minimax-h3` / `minimax-h3-one` 共用**，不重复下载 |
| `recut-minimax-h3-turbo-adapters` | `/adapters` | Turbo LoRA（780MB） | **新增**，`bootstrap_adapters` 写入 |
| `recut-minimax-h3-turbo-merged` | `/merged` | **离线合并后的 transformer（≈62GB）** | **新增**，`bootstrap_merge`（CPU 流式）写入 |
| `recut-minimax-h3-turbo-out` | `/out` | 产物中转（mp4） | **新增**（各预设包独立 out 卷，避免互相覆盖） |

- **镜像**：沿用 `lmsysorg/sglang:dev` + `pip install -e "/sgl-workspace/sglang/python[diffusion]"`（与 `minimax-h3` 同一镜像策略，保证 SGLang 版本一致）；如需**近似注意力内核**，在同一 `run_commands` 里按需补装（见 §3.3）。
- **共享契约**：把 `h3_contract.py` 再复制一份（与 `minimax-h3-one` 现状一致——两份已有副本保持字面一致），保证三个预设包请求同构；`modal_app.py` 与本地 `mock.py` 共用它。
- **`bootstrap_weights` 幂等短路**：挂 `/models` 后，若卷根 `.recut-download-complete` 存在则跳过（复用 `minimax-h3` 已下好的权重）；**只有需要 LoRA 时**才连网。适配器写 `/adapters` 并落自己的完成标记。

> **不重复下载的硬约束**：极速版**只读**共享权重卷，绝不写 `/models`（避免与 `minimax-h3` / `minimax-h3-one` 的写者竞争）；一切增量（LoRA）落 `/adapters`。

### 3.2 GPU 档位：只做「单卡 + 快照」档

| 档位 id | GPU | 快照 | 定位 |
|---|---|---|---|
| `rtxpro6000x1`（默认） | `RTX-PRO-6000`（96GB / SM120） | ✅ | 最省 + 冷启动秒级；单次时延中等 |
| `h200x1` | `H200`（141GB） | ✅ | 单卡最快（带宽高），仍享快照 |
| `b200x1` | `B200`（183GB / SM100） | ✅ | 单卡原生 mxfp8/NVFP4，容量最宽 |
| `b300x1` | `B300` | ✅ | 单卡上限 |

- **每种 GPU 型号各自建一份快照**（Modal 行为，`minimax-h3-one` 已验证）：切到新档首次调用重建快照（慢一次），之后各自秒级恢复。
- **不做多卡档（有意边界）**：Modal 的 GPU memory snapshot 不支持多卡 Function，多卡档拿不到快照、每次冷启动仍要走一次 ~2 分钟的加载 + 预热——对「时延优先」的极速版定位而言冷启动代价过大。需要多卡并行时用既有的 `minimax-h3`，本包不复刻多卡 recipe。
- 内存（host RAM）：沿用 `minimax-h3-one` 的 `memory=262144`（256GiB）。

### 3.3 配方：三档「速度/质量」与注意力后端

**步数（`num_inference_steps`）与 LoRA 强绑定**——H3 的请求字段控制 sigma 网格点数（含终点 0），故「8 步适配器」写作 `9`、「4 步适配器」写作 `5`。可选的社区配方：

| 配方 | 适配器 | 请求 steps | NFE | 备注 |
|---|---|---|---|---|
| **`turbo9`（默认，推荐）** | `larryvrh/MiniMax-H3-Turbo-Lora` · `minimax_h3_turbo_v4_step600_ema.safetensors` | 9 | 8 | 速度/质量平衡最佳 |
| `turbo4`（最激进） | `lightx2v/Minimax-h3-Turbo` · `minimax_h3_fl2v_turbo_4step_v0.1.safetensors` | 5 | 4 | **必须** `--lora-alpha 8`（仓里缺 alpha） |
| `pdd8`（PDD 加速） | `alibaba-pai/MiniMax-H3-Acc-LoRAs` · `MiniMax-H3-FL2VA-Acc-8Step.safetensors` | 9 | 8 | 需**离线合并 backbone + 融合 output heads**（`build_minimax_h3_pdd_weights` / `fuse_minimax_h3_pdd_heads`），并设 `SGLANG_DIFFUSION_MINIMAX_H3_PDD_HEADS`；服务器会**拒绝**非 9 步 |

**注意力后端**（server-wide，按档位固定，非请求参数）：

| 后端 | 取得方式 | 说明 | 默认？ |
|---|---|---|---|
| `fa` | 平台默认 | 精确 FlashAttention，一致性基准 | ✅ **默认（保守）** |
| `sage_attn` | `pip install --force-reinstall git+https://github.com/thu-ml/SageAttention.git@<pin> --no-build-isolation` | 量化注意力，**非常量级一致性**；Hopper 需装上游 SM90 修复而非 PyPI 2.2.0 | 可选 |
| `sol_attn` | 同上 + `--attention-backend-config dense_backend=sage_attn,dense_steps=10` | Sage→Sol 混合；4090 上 `fa+Spectrum 285.3s → sage→sol+Spectrum 219.0s` | 可选 |
| `subblock_sparse_attn` | 内建 | 无训练块稀疏；**支持 SM90/SM100/SM120**（B300/SM103 除外） | 可选（SM120 友好） |
| `cube_sparse_attn` | 内建（纯 PyTorch + FlexAttention） | 3D 视觉流 TopK 稀疏；文本/音频/参考图保持 dense | 可选 |

> **SM120（RTX PRO 6000）注意**：`subblock_sparse_attn` 官方列明支持 SM90/SM100/SM120；SageAttention 的 SM120 支持需在 M0 实测确认，若不支持则单卡默认回退 `subblock_sparse_attn` 或 `fa`。

**跳步**：`--enable-spectrum`（跳过部分去噪步）可与 `fa` / `sage→sol` 组合；**不能**与 `quality:"high"` 或 SP>1 同用。作为可选实验档记录，不进默认配方。

**DiT 驻留与量化**：
- 单卡 96GB：`--quantization fp8`（SM100+/SM120 → online mxfp8，DiT ≈33GB 常驻），文本编码器（bf16 ≈46GB）**单卡放不下**，仍需 `--layerwise-offload-components text_encoder`（与 `minimax-h3-one` 现状一致）。
- 可选「编码器量化」实验档：把 text encoder 换成 `Qwen3-VL-32B-Instruct-FP8` / `comfy-nvfp4` / W4A8-convrot（需 `comfy-kitchen`、SM100+），把 46GB 压到 ~15GB 级，使**编码器也常驻**、免跨请求流式；代价是条件近似（改变 conditioning），列为**可选档 + 抽检**。

**预热**：`@modal.enter(snap=True)` 内做一次**与目标形状一致**的预热（`--warmup-resolutions 1344x768` 语义 + 一次真实请求），把分配器/算子/首帧成本一起冻进快照。

### 3.4 GPU memory snapshot 设计（默认档核心）

```python
@app.cls(image=image, gpu="RTX-PRO-6000",
         volumes={MODELS_DIR: models, ADAPTER_DIR: adapters, OUT_DIR: outputs},
         timeout=3600, max_containers=1, memory=262144,
         enable_memory_snapshot=True, experimental_options={"enable_gpu_snapshot": True})
class H3Turbo:
    @modal.enter(snap=True)
    def start(self):
        # 拉起 sglang 常驻服务（已合并 Turbo LoRA）并等 /health；
        # 快照创建时执行一次，此后冷启动直接从快照恢复（含 sglang 子进程 CUDA 状态）。
        _ensure_server()

    @modal.method()
    def generate_video(self, prompt, aspectRatio="auto", durationSec=5, steps=9, seed=-1, refs=None):
        ...
```

要点与约束：
- **只支持单卡**（Modal 限制；多卡档不启用快照）。
- **快照随代码 / 镜像 / 权重变化而失效**：改了 `modal_app.py`、LoRA 文件、serve flags 或镜像 → 下次调用自动重建（慢一次）。
- **离线合并与快照契合**：LoRA 已由 `bootstrap_merge` 合进 `/merged` 权重，快照捕获「已合并、已预热」的状态，冷启动秒级，运行期不再加载适配器。
- **预热形状要对齐实际请求**（含分辨率/时长/步数），否则首次真实请求仍付分配器增长成本。
- 参考 `minimax-h3-one`（单卡 H3 + 快照）与 `sd-turbo` / `qwen-image-2.1` 已落地的 `@modal.enter(snap=True)` 写法，保持一致。

### 3.5 表单与契约（`h3_contract` 复用）

- **复用** `build_video_body` / `write_reference_conditions` / `submit_video`，请求形状与 `minimax-h3` 完全一致，仅把默认 `steps` 从 50 改为 9。
- `manifest.functions` 与 `minimax-h3` 同形（`text-to-video` t2va / `first-last-frame` fl2va），差别只在 `defaultParams.steps = 9`，并在 `steps` 字段描述里标注「Turbo 配方绑定 8–9 步，改动会偏离蒸馏调度」。
- `invoke.mode` 保持 `sdk`（`Function.from_name(...).with_options(gpu=...).remote(...)`），对 `modal_runner.py` 零改动。
- 若后续要暴露「配方选择」，**不新增请求字段**，而是把不同配方拆成不同预设包（`minimax-h3-turbo` / 未来的 `minimax-h3-fast4`），维持「一配方一部署」以规避步数/alpha 误配。

### 3.6 注册与生成

- 新增目录后重跑 `python3 apps/modal-studio/python/publish_registry.py` → 更新 `python/registry.json` 与 `modalapps/index.json`。
- **零核心改动**：`background.js`、`modal_runner.py`、UI 表单渲染都对 `registry.json` 驱动，新预设包自动出现在预设切换器里。

---

## 4. 关键权衡

| 维度 | 取舍 |
|---|---|
| **质** | Turbo 9 步 / 4 步是**近似**（蒸馏调度），硬动作/细节相对 base 50 步有损失；近似注意力（sage / sparse）与 `--quantization fp8` 进一步累积偏差。默认 `fa` + 明确标注「极速档非一致性基准」。 |
| **速** | 少步（≈5× 步数削减）+ fast attention + 合成 fp8 驻留（免逐层流式）+ 形状预热，是时延的主要来源。 |
| **冷启动** | 单卡快照把「加载 134GB + 预热」从每次计费里剔除；这是本包不做多卡档的根本原因（多卡无快照）。 |
| **本** | GPU 单价低（RTX PRO 6000 ≈ $3.03/h）+ 快照省冷启动额度；多卡并行交给既有 `minimax-h3`。 |
| **稳** | 用 `lmsysorg/sglang:dev` 固定策略与 `minimax-h3` 一致；近似后端默认关闭，避免「悄悄换算法」。 |
| **不复用** | Cache-DiT 的 `quality:"high"` 与本 App 的档位/形状不匹配（官方 fail-closed），**不纳入**。 |

---

## 5. 改动清单（全部在 App 层）

| 位置 | 改动 | 类型 |
|---|---|---|
| `apps/modal-studio/modalapps/minimax-h3-turbo/{manifest.json,modal_app.py,bootstrap.py,bench.py,h3_contract.py,mock.py,mock_sglang.py,README.md}` | 新预设包（复用权重卷 + LoRA 卷 + **merged 卷** + out 卷；单卡 + GPU 快照；Turbo 9 步配方；**`bootstrap_merge` 离线合并**；注意力后端 profile + 形状预热 + bench 实测入口） | 新增 |
| `apps/modal-studio/python/registry.json`、`modalapps/index.json` | 重跑 `publish_registry.py` 生成 | 生成物 |
| `apps/modal-studio/README.md` / `README.en.md` | 内置预设包表新增一行（能力/函数/模型/GPU） | 文档 |
| `service/**` | **无任何改动** | — |

---

## 6. 里程碑

- **M0（骨架 + 复用 vol 烟测）— 已实施（代码侧）**：三件套 + `h3_contract`/mock 副本；`bootstrap_weights` 见到共享卷标记短路；`bootstrap_adapters` 下 Turbo LoRA；`fa` + Turbo 9 步配方就绪。本地已跑通契约自检（`mock_sglang.py --selftest` 6/6）与 mock 入口（默认 9 步返回 mp4）。
- **M1（快注意力 + 形状预热 + LoRA 离线合并）— 已实施并真机验证**：① 注意力 profile 表 + 形状对齐预热 + `bench` 入口；② `bootstrap_merge` 把 Turbo LoRA 离线合并进 transformer（259 张量 / 62GB / ~11min CPU），serve 改 `--component-weights-paths.transformer` 并用 `USE_TURBO` 开关。**真机结果**：LoRA 运行期不可用（上游 `quant_method`），离线合并后 RTX PRO 6000 / 1344×768 / 4s / 9 网格点 = **66.1s、峰值 46.4 GiB**；SM12.x 无 `fa` → `torch_sdpa`。**剩余**：合并版 vs 运行期 LoRA 的**画质逐帧比对**，以及 `subblock_sparse_attn` 等后端的 bench 对比。
- **M2（多卡极速档）— 不做**：快照与多卡互斥，多卡冷启动约 2 分钟，对时延优先定位不划算；多卡并行保留给既有 `minimax-h3`。
- **M3（打磨）**：编码器量化实验档（NVFP4/W4A8）、`turbo4`/`pdd8` 备选配方的实测对比、UI/README/多语言、`modal.catalog` 就绪度（无需平台改动）。

---

## 7. 验收

1. **三选一可用**：`modal.catalog` 出现 `minimax-h3-turbo`，与 `minimax-h3` / `minimax-h3-one` 并列；切换后表单同形。
2. **零重复下载**：在已下好 `minimax-h3` 权重的账号里，`modal.install {modalapp:"minimax-h3-turbo"}` 只下 LoRA（几百 MB），`/models` 卷内容不变。
3. **快照生效**：单卡档首次调用建快照（慢一次），其后冷启动秒级恢复；改代码/镜像/LoRA 会自动重建。
4. **少步生效**：日志/请求显示 `num_inference_steps: 9`；与 base 50 步相比同 prompt/seed 的端到端时延显著下降。
5. **契约同构**：产物（mp4，视频 + 立体声）、`meta`（durationSec/fps/seed/steps/audio）与 `minimax-h3` 一致；`modal.save` 入库正常。
6. **单卡档逐档可用**：RTX PRO 6000 / H200 / B200 / B300 单卡各能跑通并建立快照；`bench.py` 给出各档 `medianSec` 与近似峰值显存。
7. **零 service 改动**：`git diff service/` 为空。

---

## 8. 风险与开放问题

- **Turbo 画质**：少步蒸馏是近似，社区公开质量差异不能直接外推；需在本 App 目标负载（分辨率/时长/任务）上抽检视频**与音频**（H3 是联合音视频去噪）。
- **LoRA 上游阻断（已实测，已用离线合并绕过）**：当前 `lmsysorg/sglang:dev` build 上 H3 + 任意运行期 LoRA 会在 warmup 阶段 `AttributeError: 'RowParallelLinearWithLoRA' object has no attribute 'quant_method'` 直接启动失败（与量化/显存无关）。**本包据此改为 `bootstrap_merge` 离线合并**（`W'=W+B@A` → `--component-weights-paths.transformer`），已真机验证可跑通且能叠 fp8。**残余风险**：合并到 bf16 会损失一点精度（作者称 *a bit softer*）；上游修复后可切回运行期 LoRA 拿回最锐结果。
- **SM12.x 无 FA（已实测）**：RTX PRO 6000 上 `fa` 回退 `torch_sdpa`；加速注意力应选 `subblock_sparse_attn`（SM120 官方支持），`sage_attn` 的 SM120 支持仍未证实。
- **Cache-DiT 不可用（有意边界）**：官方 `quality:"high"` fail-closed 到 4×H200 / 1344×768 / 124-frame / 50-step 的审计 workload；不在本 App 采纳，作为边界记录。
- **跨请求条件缓存（TE 复用）**：SGLang 仅保证**请求内**同 prompt fan-out 复用条件；**跨请求**文本/图像编码缓存无官方开关。若要做，只能在本 App 层按 `(prompt, conditions, bucket)` 做应用级缓存（需先探测请求内是否已有复用、命中率是否值得），列为开放问题。
- **快照实验性**：GPU memory snapshot 是 Modal 的实验特性；多卡不支持、随改动重建、可能对某些子进程 CUDA 状态不友好（`minimax-h3-one` 已验证 sglang 子进程可快照，但需持续回归）。
- **适配器来源与许可**：LoRA 仓（larryvrh / lightx2v / alibaba-pai）为社区产物，需固定文件名与 revision；许可与 H3 Community License 的兼容性需使用者确认。
- **步数/alpha 误配**：PDD 8 步会**拒绝**非 9 步请求；lightx2v 缺 alpha 必须补 `--lora-alpha 8`。采用「一配方一部署」避免运行期误配。
- **镜像漂移**：`lmsysorg/sglang:dev` 是滚动 tag，SGLang 版本漂移会影响 recipe 可用性；建议与 `minimax-h3` 同步固定策略（承 [modal-functions RFC](./2026-09-24-modal-functions.md) 的镜像约束）。

---

## 参考（外部事实来源）

- SGLang Diffusion — MiniMax-H3 cookbook：recipe、checkpoint/adapter 格式表、LoRA 配方（Turbo / PDD）、注意力后端（`sage_attn` / `sol_attn` / `subblock_sparse_attn` / `cube_sparse_attn`）、AdaLN 缓存、Cache-DiT、消费级与数据中心基准 — https://docs.sglang.io/cookbook/diffusion/MiniMax/MiniMax-H3
- SGLang Diffusion — Quantization（`quant_family` 兼容表：`kitchen_int8` / `comfy-int8-convrot` / `comfy-nvfp4` / `mxfp8` / `gguf` / `quanto-int8` 等） — https://docs.sglang.io/docs/sglang-diffusion/quantization
- Modal — Memory Snapshots（`enable_memory_snapshot` + `experimental_options={"enable_gpu_snapshot": True}`） — https://modal.com/docs/guide/memory-snapshots
- 仓库内先例：`apps/modal-studio/modalapps/minimax-h3`（多卡）、`apps/modal-studio/modalapps/minimax-h3-one`（单卡 + GPU 快照）、`rfc/2026-09-24-modal-functions.md`
