<!--
 * [INPUT]: 现有 `apps/modal-studio/modalapps/minimax-h3-turbo`（modal_app.py 的 `_run_video`/`H3Turbo`/`H3TurboRef`/bootstrap 三步、
 *          h3_contract.py 的 `/v1/videos` 契约、manifest.json 的 engine.artifacts/requires/gpuTiers/formSchema/expose）、
 *          modal-studio 既有机制（deploy-ignore、artifacts 逐产物就绪、contributes.media `expose` 数组、agentDefaults、
 *          runner 的 spawn/volume get/失败写任务日志）；姊妹 App `apps/comfyui-studio` 的「一个 workflow app = 一个自包含目录 +
 *          `workflow.py build(ctx)->dict` 构图」范式；既有 RFC 2026-09-29-minimax-h3-turbo-modalapp.md /
 *          2026-09-29-modal-minimax-reference-to-video.md / 2026-09-29-modal-studio-cloud-generation-provider.md /
 *          2026-09-24-comfyui-studio-workflow-apps.md；
 *          外部事实（社区共识与实测）：H3 远景小脸崩坏是「头部占比」性质而非分辨率性质（Comfy-Org 讨论 #30、
 *          Carasibana/ComfyUI-H3-FaceRefine、xm6018924/BSAI-ComfyUI-FaceRefine）；加速三层与「步数蒸馏只能选一个」及冲突矩阵
 *          （whichh3 加速横评、mushroom.cv 五条路径工程指南）；渐进分辨率采样 SPEED v2（StanLukuvka，免训练 1.3–2.4×，音频恒全分辨率）；
 *          两阶段潜空间放大（mcbibi / LBH-123-AI / xmarre Latent_Upscaler-Plus / rockerBOO，24 通道 H3 latent，音频跨采样器保留）；
 *          LightX2V 的 H3 推理与可控 denoise V2V；以低步数低 denoise V2V 修远景脸的实操；H3 原生 FaceRefine（低强度潜变量重绘）；
 *          Motion-Context 潜空间尾片续拍；SGLang 侧无损/近似加速实测（fused kernel / Cache-DiT / SubBlock / AdaLN cache /
 *          FP8 / Ulysses-Ring）与官方未开源项（H3-Context-IR / H3-Regenerate-2K）；非 H3 的整片超分与专用人脸修复
 *          （FlashVSR / VOSR 2.0 / SeedVR2；CodeFormer / GFPGAN；SVFR / DVFace）。
 * [OUTPUT]: H3 云端托管「加速 + 人脸保持」的**最优方案设计稿（v2）**：先给出加速三层（步数蒸馏只选一个 / 注意力可叠 / 缓存近似）
 *          + 正交的渐进分辨率 + 框架层选型（SGLang vs ComfyUI vs LightX2V）的完整账本，再给出人脸保持的四级阶梯
 *          （身份锚定 → 两阶段潜空间放大 → H3 原生小脸修复 → 像素域兜底），据此把 H3 分成三档：**Tier A（SGLang 极速档，现状保留）**
 *          / **Tier B（ComfyUI-in-Modal 质量档，新增 modalapp，跑社区完整图：turbo 8 步 + SPEED 渐进分辨率 + 两阶段潜空间放大 +
 *          可选 H3 原生 FaceRefine + 可选整片超分 + Motion-Context 长片续拍）** / **Tier C（LightX2V 中间档，可控 denoise V2V 修脸）**。
 *          含契约（表单/参数/资源/expose）、改动清单、M1–M4 与回滚、验收、边界（含「放大不能修什么」与框架取舍的诚实结论）、参考来源。
 *          全部改动落在 `apps/modal-studio/`（+ App 层文档），**零 `service/` 改动**。
 * [POS]: rfc 的「H3 云端加速与脸保持」总纲（v2 取代同日 v1 的「只在 SGLang 容器里加后处理」）；把社区已验证的完整配方
 *        收敛为 Modal 上的分层档位，而不是自己重造一个子集。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC：MiniMax-H3 云端托管——加速与「人脸崩溃」的最优方案（含运行时选型）

- 状态：Proposal（**v2**，取代同日 v1「只在 SGLang 容器里加一层后处理」的收敛方案）；**M1 已实施**——新增 Ref2VA 专用人脸保持档 `modalapps/minimax-h3-ref`（记 Tier A+，复用权重卷、只做 ref2video），详见 §12 实施记录
- 作者：Recut
- 日期：2026-10-10
- 决策范围：① H3 加速的**分层选型**（步数蒸馏 / 注意力 / 缓存 / 渐进分辨率）与**框架层选型**（SGLang vs ComfyUI vs LightX2V）；
  ② 人脸保持的**四级阶梯**（身份锚定 → 两阶段潜空间放大 → H3 原生小脸修复 → 像素域兜底）；
  ③ H3 的**三档运行时**（Tier A/B/C）与各档的契约、改动面、里程碑；
  ④ 明确**不采纳**哪些加速（对脸不利/冲突/需要专用管线而收益不抵复杂度）。
  不改 `service/`、不新增平台能力种类、不改 `async_ops`/Op 总线、不改平台提案门
- 关联：[MiniMax-H3 极速版（Turbo）](./2026-09-29-minimax-h3-turbo-modalapp.md)、
  [MiniMax-H3 参考生视频（Ref2VA）](./2026-09-29-modal-minimax-reference-to-video.md)、
  [Modal 云函数接入平台能力](./2026-09-29-modal-studio-cloud-generation-provider.md)、
  [ComfyUI 工作台（workflow app 范式）](./2026-09-24-comfyui-studio-workflow-apps.md)、
  [Modal 云函数](./2026-09-24-modal-functions.md)

---

## 0. 白话总结（先看这个）

**你的问题：** H3 Turbo 出的片子里，人物离镜头远一点脸就糊/五官错位/像换了个人（「人脸崩溃」）。

**v1 的判断（复盘）：** v1 说「这是头占比太小导致的，得修」，**这个判断是对的**；但 v1 给的**做法是错的**——它打算在我们现有的 SGLang 容器里，用另一个模型（CodeFormer）在**解码后的画面上**修脸。

**为什么错（v2 的核心结论）：**

1. **修脸的最高杠杆不在「修」，在「生成」和「分辨率」。** 脸崩的本质是那块区域**潜变量 token 太少**。社区现有两条真正有效的路——**参考图锚定身份**（生成时就锁住）和**两阶段潜空间放大**（给脸真实像素后再低噪声重采样）——**都在 H3 内部完成**，比在成品画面上贴一层 512px 的人脸 GAN 高一个维度。
2. **我们要做的东西，社区早就有成品了。** ComfyUI 生态里：小脸修复节点（FaceRefine）、潜空间放大节点（Latent Upscaler）、渐进分辨率采样（SPEED）、可控去噪的 V2V 修脸、长片续拍（Motion-Context）——**全是现成节点**。自己去写一套检测+跟踪+修复+缝合，正是「重造一个更差的子集」。
3. **真正的卡点是我们的运行时。** 我们跑的是 SGLang 的 `sglang serve`，它的 `/v1/videos` 只暴露「文生 / 首尾帧 / 参考」三种任务 + **固定采样调度**：**没有去噪强度、没有分步分辨率、没有潜空间放大、没有单流噪声掩码**。也就是说——**我们选的这个运行时，从根上就做不了上面那些好方案**，只能做「解码后再加工」这一种最弱的形式。

**所以 v2 的结论是一句话：先决定「用哪个运行时/图」，而不是「用哪个修脸模型」。**

**推荐做法（三档，按你要什么选）：**

| 档位 | 运行时 | 用来做什么 | 能得到什么 |
|---|---|---|---|
| **Tier A（现状保留）** | SGLang serve（现有 turbo 包） | 极速、短镜头、抽卡 | 8 步 + 精确注意力；只有**像素域后处理**兜底（整片超分 + 小脸修复），天花板最低 |
| **Tier B（推荐新增，质量档）** | **ComfyUI-in-Modal**（新 modalapp） | 人像、正片、要 1080p/2K、要长片 | **社区完整配方**：参考锚定 + turbo 8 步 + SPEED 渐进分辨率 + **两阶段潜空间放大** + H3 原生小脸修复 + 可选整片超分 + 长片潜空间续拍 |
| **Tier C（可选中间档）** | LightX2V | 只想用**可控去噪的 V2V** 把已有片子的远景脸修好 | 低步数、低 denoise 的 V2V 修脸（这正是「远景修脸」的社区做法） |

**一句话：** 想要最好的结果，就把 H3 从「只能出片的 SGLang 服务」换成「能跑社区完整工作流的图」（ComfyUI），SGLang 档保留做极速；脸的问题按「**先锚定身份 → 再两阶段放大 → 最后才修脸**」的顺序解，而不是一上来就修脸。

---

## 1. 问题与目标

### 1.1 「人脸崩溃」的根因（v1 结论保留）

两类不同的失败，**混在一起会修错方向**：

| 症状 | 本质 | 靠什么解 |
|---|---|---|
| 五官糊 / 扭曲 / 变形（「马赛克脸」「塑料脸」） | **细节不足**：脸占的像素与潜变量 token 太少 | 分辨率路径（两阶段放大）+ 小脸修复 |
| 身份漂移：像另一个人 / 前后不像同一人 | **身份约束不足** | **生成时锚定**（参考图 / 角色 LoRA）—— 修复救不了 |

**根因一句话：** 这是「头部在画面里占的比例」的属性，**不是输出分辨率**的属性——社区实测 720p 以上、步数加到 24 依旧会崩（Comfy-Org 讨论 #30；Carasibana/ComfyUI-H3-FaceRefine 明说「这是『头占比』的属性，不是分辨率，所以在 720p 及以上依旧存在」）。所以**改提示词或调大分辨率都救不回来**，必须从**分辨率路径 + 身份锚定**入手。

### 1.2 目标

1. **加速**：把 H3 的加速按「三层 + 正交项」分层收口，**只保留真正有效且对脸友好的组合**，并把不可叠加/冲突的规则写清楚（避免「叠加后没变快/质量崩了」）。
2. **人脸保持**：给出「**先锚定 → 再放大 → 最后修脸**」的四级阶梯，并把它落到可执行的档位上。
3. **运行时选型**：明确 SGLang / ComfyUI / LightX2V 各自能表达什么、代价是什么，据此把 H3 分成三档（Tier A/B/C），**用现成的社区工作流，而不是自己重造子集**。
4. **不加流程、可观察、可恢复**：对 Agent/用户而言调用形状尽量不变；产物可追溯；失败有恢复路径。
5. **技术账本**：把「不采纳什么、为什么」写清楚（对脸不利的近似、需专用管线的蒸馏、官方未开源项），避免后续重复调研或误用。

### 1.3 非目标

- **不做**模型训练/微调（本 RFC 只做推理期：运行时选型、工作流编排、参数收口；角色 LoRA 训练只作为**外部输入**被引用）。
- **不自己实现** ComfyUI 节点已有的能力（小脸修复 / 潜空间放大 / 渐进分辨率 / 长片续拍）——**复用社区节点**。
- **不做**官方未开源项（`H3-Context-IR`、`H3-Regenerate-2K`）。
- **不新增平台能力种类**、不改 `service/`；产物仍不自动入库。
- **不做**人脸「美化」（目标是保真、保身份，不是网红脸）。

---

## 2. 现状（代码事实）

**现有 turbo 包**（`apps/modal-studio/modalapps/minimax-h3-turbo/modal_app.py`）：

```text
generate_video(prompt, aspectRatio, durationSec, steps, seed, resolution, refs)
  → _run_video(variant, ...)                                  # :375
      → _ensure_server(variant)                               # 幂等拉起 `sglang serve`（GPU 快照冻结）
      → write_reference_conditions + build_video_body         # h3_contract.py:144 / :97
      → data = submit_video("http://127.0.0.1:PORT", body)     # :392  ← 拿到 mp4 bytes
      → path.write_bytes(data); outputs.commit()              # :396  ← 落 /out
      → {kind:"file", volume, key:"runs/<id>.mp4", meta}      # :399
  → runner.harvest_result()（`modal volume get` 拉回本机）
```

**关键事实：**

- **全流程没有任何后处理**（仓库内无 face/upscale/enhance 实现）；`submit_video` 返回的 mp4 原样落地交付。
- **单一咽喉**：`_run_video`（`:375-401`）是唯一产出点。
- **运行时是 `sglang serve`**：`--model-variant fl2va|ref2va`，`--quantization fp8`（96GB 卡）、`--layerwise-offload-components text_encoder`、`--warmup-resolutions 1344x768`、`--attention-backend auto|fa|sage_attn|sol_attn|subblock_sparse_attn`；请求走 `/v1/videos` 异步协议（`task` ∈ `t2va|fl2va|ref2va`），**固定调度**。
- **两个分区两个类**：`H3Turbo`（fl2va）、`H3TurboRef`（ref2va）；均 `retries=0` + `enable_memory_snapshot`。
- **指数**：`engine.artifacts`（逐产物就绪）+ `engine.requires`（每函数所需产物）；部署变更检测**排除** `manifest.json`/`*.md`/`mock*.py`/`bench*.py`（改表单即生效，改容器 `.py` 才需重新 deploy）。
- **实测基线**：RTX PRO 6000 / fp8 / 1344×768 / 4s / 8 次去噪 = **66.1s，峰值 46.4 GiB**；ref2va 8 次去噪 5s = **124.9s，峰值 48.8 GiB**。
- **加速现状是对的但不完整**：第一层（步数蒸馏）已用满（larry 8 步 / lightx2v 8 步）；**第二层（注意力）与正交的渐进分辨率、以及分辨率路径（两阶段放大）完全没用**。

> 姊妹范式可复用：`apps/comfyui-studio` 已确立「**一个 workflow app = 自包含目录 + `workflow.py 的 build(ctx) -> dict` 构图 + `manifest.json` 表单驱动**」，并在 Modal 场景里可直接照搬到 `modalapps/`。本 RFC 的 Tier B 就是这套。

---

## 3. 最新调研（一）：加速方案总览

H3 的加速分三层，**很多教程把三层混着讲**，导致「叠加后没变快 / 质量崩了」。先记住三个类别：**步数蒸馏**（减少步数）、**注意力后端**（加速每步）、**缓存/跳步**（跳过部分计算）；外加一个**正交项**：**渐进分辨率**（省的是每步的空间成本）。

### 3.1 第一层：步数蒸馏（**只能选一个！**）

它们都**改变了采样轨迹**，因此**互相叠加会破坏效果、还各自占显存**。另：PDD 会打乱 sigma 边界，**与缓存类也冲突**。

| 方案 | 步数 | 相对速度（官方 20 步 = 1.0×） | 特点与依赖 |
|---|---|---|---|
| 官方基线 | 20 | 1.0× | 质量最稳、最慢 |
| **LightX2V Turbo**（本包 ref2va 现用） | 8 / 4 | ~2.1× / ~3.4× | 官方内置 `turbo_mode`；4 步细节略降；**社区最常用**（下载量最高） |
| **larryvrh Turbo v4**（本包 fl2va 现用） | 8 | ~2.1× | 需**双时钟采样器**（音视频各自调度）；v4 微细节最好；>8 步过锐；4 步大运动拖影 |
| FastH3（FastVideo DMD2） | 4 | ~4× | DMD2 + VSA 稀疏蒸馏；**仅 T2VA**（fl2va/ref2va 被拒）；硬运动/细节有质量缺口 |
| TaoMate-H3 | 3 | 最快档 | 面向流式长视频，**质量代价较大** |
| 阿里 PAI PDD Acc | 8 / 4 | ~2× | **必须用专用节点 + 专用 sigmas，不能叠加任何其他蒸馏/缓存** |

> **本包现状正确**：fl2va 用 larry 8 步、ref2va 用 lightx2v 8 步（都是 8 次去噪，社区公认的**质量/速度甜点区**）。**这条不用改，且绝不能叠加第二份蒸馏。**

### 3.2 第二层：注意力后端（**可叠加**）

| 后端 | 提速 | 性质 | 注意 |
|---|---|---|---|
| **SageAttention** | 1.3–2× | 近无损 | **50 系 + 超长序列（≳16 万 token）有静默噪点风险** → 长片换稀疏/Kitchen |
| **comfy-kitchen 内置注意力** | 与 Sage 同级 | 近无损 | 零安装，不想装东西就选它 |
| SLA 稀疏注意力 | 长片显著（单步 44→25s @5090 768p/15s） | 近似 | **必须配 SLA 训练版 Turbo LoRA 成套使用** |
| VSA（FastVideo 稀疏，~90% 稀疏） | 高 | 近似 | 与 FastH3 同源；需 VSA 节点或新核心 Block Sparse 节点（comfy-kitchen ≥0.2.33） |

### 3.3 第三层：缓存 / 跳步（**近似，有质量代价**）

- **Spectrum / EasyCache**：再省 **15–40%**，属「跳过部分计算」，**需抽检画面**；Spectrum 用 Chebyshev 多项式 + 岭回归在线拟合相邻步的隐藏状态，20 步只真算 ~11 次前向（~45% 减少）；**与 PDD 冲突**。
- **条件缓存（CLIPCached）**：**无损** —— 同一提示词连续出多个种子时，从第二次起省掉整个文本编码阶段。**批量抽卡必用。**

### 3.4 正交项：渐进分辨率采样（SPEED，**免训练、可叠加**）

**把一次采样拆到不同分辨率上执行**：噪声最大的早期步在**便宜的低分辨率网格**上跑，随细节变得重要再逐步升回目标分辨率（内置阶梯 `2`：0.5→1.0；`3`：0.33→0.66→1.0；`4`：0.25→0.5→0.75→1.0）。

- **免训练**、与蒸馏/注意力**正交**（可叠加）。
- 实测（RTX 5080 / 960×544 / 24fps / 10.125s / Euler）：基线 571.49s → 3 阶段 delta 0.005 = 438.85s（**1.30×**）→ 4 阶段 delta 0.05 = **237.57s（2.41×）**。
- **H3 的音频流始终保持全分辨率**（只降视频的分辨率阶梯）。
- V2 取消了「仅 Euler」限制（支持 Heun / DPM2 / RES Multistep）、按采样器校准 Sigma、修了 I2V 每次换分辨率就变模糊的回归。
- **注意**：现有证据是 **Euler-only** 的参考数据，作者要求「用你自己的采样器/模型/scheduler 重跑 Harvest 校准」。

### 3.5 框架层：**这才是关键决策**（决定上面哪些能做）

| 能力 | **SGLang（现状）** | **ComfyUI + 社区节点** | **LightX2V** |
|---|---|---|---|
| 任务 | t2va / fl2va / ref2va（固定调度） | 全部（含 t2v/i2v/flf2v/r2v/**v2v**/rv2v） | t2v / flf2v / ref2v（+ **V2V**） |
| **去噪强度控制** | ❌ **无** | ✅（noise_mask / 低 denoise 二次采样） | ✅（V2V 低 denoise） |
| 分步分辨率（SPEED） | ❌ | ✅ 节点 | 视配置 |
| **潜空间放大**（两阶段） | ❌ | ✅（Latent Upscaler 节点） | 视配置 |
| 单流噪声掩码（保音频只重画视频） | ❌ | ✅（Stream Denoise） | ✅（音视频双调度） |
| 长片潜空间续拍 | ❌ | ✅（Motion-Context） | 部分 |
| 融合 kernel / fp8 / 多卡并行 / **GPU 快照** | ✅ 强项 | ❌（无快照，冷启动慢、镜像大、显存更重） | 中（量化支持好） |
| `ref2va` 局部重绘（保结构改局部） | ❌ 不支持 | ✅ | ✅ |

> **结论：我们的「修脸」之所以卡住，不是缺模型，是 SGLang 的 `/v1/videos` 只有三种固定 task——没有 denoise-strength、没有潜空间入口、没有 per-step 分辨率。** 官方文档也明确：`ref2va` **不暴露 denoising-strength 控制**（它会重排运动，不是像素对齐的编辑源）。所以「H3 原生低强度重绘」在 SGLang 档**根本做不到**，而在 ComfyUI/LightX2V 档是**一行参数**。

---

## 4. 最新调研（二）：人脸保持方案总览（四级阶梯）

**按杠杆从大到小排**——这是整份 RFC 最重要的一张表：

| 级别 | 做法 | 解决什么 | 在哪完成 | 我们的落点 |
|---|---|---|---|---|
| **L1 身份锚定**（最大杠杆） | **Subject Reference / 参考生视频**：用一组清晰参考图（正/¾/侧 + 服装）锚定身份；可选**角色 LoRA（rank 16，Ref2V 路径）**跨集复用 | **身份漂移**（修复救不了的那一半） | 生成时 | 已有 `reference-to-video`；把它做成**人像默认**，并教「角色参考组」 |
| **L2 分辨率路径** | **两阶段：低分辨率生成 → 潜空间放大（24 通道 H3 latent，时轴不变）→ 低噪声二次采样** | 脸**细节**（给脸真实潜变量 token） | 生成管线内 | **Tier B 的核心**（SGLang 做不到） |
| **L3 残余小脸修复** | **H3 原生低强度重绘**（FaceRefine 那条：逐帧跟踪 → 归一化裁剪 → 低 denoise 重绘 → 羽化缝回）；远景档 denoise 0.35–0.4 | 极端远景/小脸 | 生成管线内 | Tier B（ComfyUI/LightX2V）；Tier A 只能退化到 L4 |
| **L4 像素域兜底** | 解码后画面上的**整片超分**（FlashVSR / VOSR 2.0 / SeedVR2）+ **非 H3 人脸修复**（CodeFormer / GFPGAN） | 极小的残留 + 无 graph 控制权时的唯一选择 | 解码后 | Tier A（收益最低，但仍可用）；Tier C 的 V2V 也属这一层但更强 |

**社区已验证的可复用参数**（Tier B 的 L3 直接用）：

- 检测 `face_yolov8m.pt`；远景丢帧用 `person_yolov8m-seg.pt` 从人体框顶部反推头部（纯人脸检测在远景会频繁丢帧 → 跟踪框乱跳 → 放大后「脑补出错位五官」）。
- 强度：大脸 denoise **0.25–0.45**（默认 0.35）；**远景小脸降到 0.4**（作者实测 0.35–0.45 最自然），崩坏严重 0.5–0.55。
- 远景档：源脸高 **<40px** 自动切 **画布 512 + crop_factor 3.5**（把放大倍数从 ~9–13× 降到 ~5–7×）。
- `steps 8`、scheduler `beta`、sampler `euler`；多人各接一张身份参考图、**逐人跑一遍并链式缝合**。
- 缝合：羽化 + 颜色匹配（`colour_match`；贴图感就把 `blend` 降到 0.8–0.9）。

**两阶段放大的真实现状（Tier B 的 L2）：**

- H3 的 VAE latent 是 **24 通道、16× 空间 / 4× 时间压缩**；社区放大模型直接在**潜空间放大 H×W 并保持时间轴**，因此「低分辨率生成（token 少、快）→ 潜空间放大 → 低噪声精修」比直接高分辨率生成**又快又好**。
- 实现多样：**训练的 2× 空间放大**（`mcbibi`）、**分块 hires-fix**（`LBH-123-AI`：时间分段 + 空间分块，带**接缝去噪、两级颜色匹配、时间锚点**防接缝/拖影）、**学习式放大 + 内置低 sigma 精修**（`xmarre ...-Plus`）、社区参考实现 `rockerBOO/h3-latent-upscaler`（含 FL2VA 与 Ref2VA 示例图）。**部分实现在两次采样之间保留音轨**。
- 社区实测：**0.5MP → 1080p，< 5 分钟**（H3 自身 2K 直出很慢/易爆显存，所以「别直出高分辨率」是共识）。

**L4/Tier C 的可控去噪 V2V（修远景脸的社区做法）：**

- LightX2V 支持 H3 的四种基础任务（同一 base transformer 不重载），社区有**单采样器、低步数、低 denoise、把已有片段喂回去重跑**的「V2V 修远景脸」实操（`Minimax H3 - v2v Fixing Faces At Distance`）。
- ComfyUI 侧还有**单流噪声掩码**（`noise_mask`：0 = 保留该流、1 = 完全重生成）——可以**只重画视频、原样保留音频**，这是 SGLang 档完全没有的能力。

**长片连续性（Tier B 的可选 L5）：** Motion-Context 从**上一段的 latent 尾部切片**续拍（**不解码回像素再重编码**），从根上消除「拼接感/颜色漂移/边缘变软」；音频同样锚定上一段尾部。社区实测：RTX 5070 Ti 生成 4 分 34 秒多机位短剧约 2 小时。

**能力边界（必须如实写清，避免误导）：** 潜空间放大能改善**边缘/纹理/观感锐度**、给二次编辑留头寸；**不能可靠修复**已坏的运动、**已在帧间丢失的身份**、时域闪烁、已畸变的文字、物理错误、错误构图。**结构错就先重生成，再谈放大**。判定标准是「**脸更清楚、但身份没变**」，不是分辨率数字。

---

## 5. 决策记录

| # | 决策 | 理由 |
|---|---|---|
| **D0** | **运行时是首要决策，不是修脸模型**：SGLang 只能做「解码后加工」；要拿到「参考锚定 + 两阶段放大 + 原生小脸修复」，必须让 H3 跑在能表达这些的图上（ComfyUI / LightX2V） | §3.5：SGLang 的 `/v1/videos` 无 denoise-strength / 无潜空间入口 / 无 per-step 分辨率 |
| **D1** | 人脸崩溃判定为**结构性**（头占比小），非分辨率/提示词可救；必须从**分辨率路径 + 身份锚定**入手 | §1.1（v1 结论保留，证据不变） |
| **D2** | 人脸保持按「**L1 锚定 → L2 两阶段放大 → L3 原生小脸修复 → L4 像素域兜底**」四级阶梯，**顺序不可颠倒**；修复是最低优先级的手段 | §4：修复救不了身份；放大不能修结构 |
| **D3** | **不自己实现** ComfyUI 已有节点（FaceRefine / Latent Upscaler / SPEED / Stream Denoise / Motion-Context），**直接复用** | 现成、经过社区验证、避免边界 bug；本仓一贯偏好「复用现成的」 |
| **D4** | 新增 **Tier B：`minimax-h3-comfy` modalapp（ComfyUI-in-Modal）**，跑社区完整配方；工作流按 `comfyui-studio` 的「JSON 图模板 + `build(ctx)->dict`」范式参数化 | 只有这样才拿得到 L2/L3/L5；且复用本仓已有范式，不发明新东西 |
| **D5** | **Tier A（现有 SGLang turbo 包）保留**为极速/短镜头/抽卡档；只在其上加**可选的下限兜底**（整片 VSR + 像素域小脸修复，即 v1 的方案降级为 fallback） | 单卡 + GPU 快照 + fp8 的冷启动/吞吐优势不可替代；但不再声称它能修脸 |
| **D6** | **Tier C（LightX2V）**列为可选中间档：当只用「可控去噪 V2V 修已有片子的远景脸」时，它比 Tier B 轻、比 Tier A 强 | §4 的 v2v 修脸实操；无需 graph 编辑器 |
| **D7** | 加速按「**步数蒸馏只选一个**（8 步为甜点）+ 注意力可叠（Sage/Kitchen 近无损）+ 渐进分辨率（正交、免训练）用起来 + 缓存仅非人像用」收口；**人像工作禁用 Spectrum/EasyCache 类近似跳步** | §3.1–3.3；近似恰好毁微细节 |
| **D8** | **不采纳**：PDD（需专用管线+专用 sigmas，收益不抵复杂度）、TaoMate-H3（质量代价大）、FastH3（仅 T2VA，覆盖不到我们的 ref2va）、SLA/VSA（需配套专用 LoRA，属极限速度路线）、EasyCache/Spectrum 作默认（人像禁用） | 覆盖不到我们的任务或代价不划算 |
| **D9** | **第一层蒸馏保持现状**（larry 8 / lightx2v 8），**不叠加第二份蒸馏** | §3.1：叠加会互相破坏 |
| **D10** | 身份锚定做成**默认**：人像走参考型入口，并推广「**角色参考组**」（正/¾/侧+服装）与**可选角色 LoRA**（跨集复用） | L1 是唯一能解身份漂移的；且契合本仓「参考才是现在最常用的」 |
| **D11** | 参数与能力**外露且跨函数一致**（同名同义同默认）；运行时/档位/加速组合由用户在 App 内选择，而不是埋在代码常量里 | 质量/速度/成本是用户取舍 |
| **D12** | **失败可恢复、可观察**：任何增强阶段失败**不连坐生成**（原始产物保留），并给「只重跑增强」的入口；每阶段有日志与 `meta` 标记 | 恢复路径是硬要求；不得出现「背后发生我无法感知的事」 |
| **D13** | **零 `service/` 改动**；不新增平台能力种类（Tier B 的产物仍走 `video.generate` + 参考型；模式下复用 `expose` 数组） | 与既有 modal-studio 纪律一致 |
| **D14** | 结构错**先重生成**，不要靠放大/修复「救」；本 RFC 的增强只作用于「构图与表演已经过关、只有细节不足」的片子 | §4 的能力边界（放大 = 放大的错误） |

---

## 6. 方案：三档运行时

### 6.1 Tier A — SGLang 极速档（保留，加兜底）

- **不改生成路径**：8 步（larry / lightx2v）+ 精确注意力（人像）。
- **可选兜底**（v1 的方案降级到这里，作为 `postEnhance` 开关，默认关）：
  1. 解码后 **整片超分**（FlashVSR / VOSR 2.0 / SeedVR2，按实测选型）→ 提高整片锐度与脸的观感；
  2. **像素域小脸修复**（CodeFormer 默认 / GFPGAN 备选，ONNX GPU）+ 羽化缝合 + **原音轨 copy remux**。
- **定位**：短镜头、抽卡、预算优先。**明确不承诺**修复身份漂移与结构缺陷。

### 6.2 Tier B — ComfyUI-in-Modal 质量档（**推荐新增**）

新 modalapp `minimax-h3-comfy`：容器内跑 ComfyUI（沿用 `apps/comfyui-studio` 的 app 范式），H3 工作流以 **JSON 图模板 + `build(ctx)->dict`** 参数化。默认图（社区完整配方）：

```text
[身份锚定 L1]  subject refs (正/¾/侧+服装)  [+ 可选 Ref2V 角色 LoRA]
      │
[生成]  H3 FL2VA / Ref2VA  +  turbo 8 步 LoRA（双时钟采样器，保音频）
      │  ── 叠加 SPEED 渐进分辨率（stages=3~4，delta 0.01~0.05；音频恒全分辨率）
      ▼
[L2 两阶段放大]  H3 Latent Upscaler（24ch latent，2× 空间 / 时轴不变；分块 + 接缝去噪 + 颜色匹配 + 时间锚点）
      │
[L2 精修]  低 sigma 二次采样（低 denoise，只补细节，不重排结构）
      │
[L3 残余小脸]  （可选）H3 原生 FaceRefine：逐帧跟踪 → 归一化裁剪 → 低 denoise 重绘 → 羽化缝回
      │
[解码]  视频 + 音频（跨采样器保留）
      │
[可选 L4]  整片 VSR 到 1080p/2K（VOSR2 / FlashVSR / SeedVR2）
[可选 L5]  Motion-Context 潜空间尾片续拍（>15s 长片）
```

- **加速组合**：8 步蒸馏（一个）+ Sage/Kitchen 注意力 + **SPEED（正交）**；**人像不叠 Spectrum/EasyCache**。
- **体量/代价（诚实）**：ComfyUI 档**没有 SGLang 的 GPU 快照**，镜像更大、冷启动更慢、显存更重（需常驻 H3 + 放大模型）。因此它作**质量档**，而非极速档。
- **契约**：仍是一个标准 modalapp（`manifest.json` + `modal_app.py` + `bootstrap.py`），产物走 `video.generate`；`expose` 用数组暴露「生成」与「放大/修复」两个平台模型。

### 6.3 Tier C — LightX2V 中间档（可选）

新 modalapp（或 Tier B 的一个入口模式）：用 LightX2V 跑 H3，主打**可控 denoise 的 V2V**：

- 场景：**已有片子，只想把远景脸修好** → 低步数 + 低 denoise 的 V2V 重跑（保结构、保音频、只补脸）。
- 与 Tier B 的关系：Tier C 是「事后修」的强版；Tier B 是「生成时就做对」的版本。二者可并存，优先 Tier B。

### 6.4 推荐组合（给用户/Agent 的默认）

| 场景 | 走哪档 | 配方 |
|---|---|---|
| 远景/中景的人像正片、要 1080p+ | **Tier B** | 参考锚定 + 8 步 + SPEED + 两阶段放大 + 可选 FaceRefine |
| 快速抽卡 / 短镜头 | Tier A | 8 步 + Sage/Kitchen |
| 已有片子修远景脸 | Tier C（或 Tier B 的 V2V 模式） | 低 denoise V2V |
| 长片（>15s）连续叙事 | **Tier B** | + Motion-Context 潜空间续拍 |
| 同提示词批量出片 | 任一 | + CLIPCached 条件缓存（无损） |

---

## 7. 契约

### 7.1 Tier A（现有包）新增字段

三个生成函数增加同组字段（默认保守，全部可关）：

```jsonc
{ "key": "postEnhance", "type": "select", "options": ["off", "upscale", "face", "both"], "default": "off",
  "label": { "zh": "生成后增强（整片超分 / 小脸修复）", "en": "Post enhance (upscale / face)" },
  "hint": { "zh": "只作用于已解码画面：不能修复身份漂移或结构问题；远景小脸建议优先用质量档（ComfyUI）。",
            "en": "Decoded-frame only: cannot fix identity drift or structural errors; prefer the quality tier for distant faces." } }
{ "key": "faceRefine", "type": "select", "options": ["auto","off","codeformer","gfpgan"], "default": "off" }
{ "key": "faceFidelity", "type": "number", "default": 0.6, "min": 0.0, "max": 1.0 }
{ "key": "videoUpscale", "type": "select", "options": ["off","1.5x","2x"], "default": "off" }
{ "key": "keepRaw", "type": "boolean", "default": true, "label": { "zh": "保留原始产物（便于只重跑增强）", "en": "Keep the raw output" } }
```

### 7.2 Tier B（新包）表单（示意）

```jsonc
"engine": { "appName": "recut-minimax-h3-comfy", "image": { "base": "comfyui 系镜像", ... },
            "gpuTiers": { "default": "RTX-PRO-6000", "options": [...] },
            "volumes": [ { "name": "recut-minimax-h3-models", "mount": "/models" },      // 复用
                         { "name": "recut-minimax-h3-comfy-models", "mount": "/comfy-models" }, // 放大/修复/LoRA
                         { "name": "recut-minimax-h3-turbo-out", "mount": "/out" } ] },
"functions": [
  { "id": "text-to-video", "entrypoint": "generate", "output": { "kind": "video" }, "formSchema": [
      { "key": "prompt", "type": "textarea", "required": true },
      { "key": "referenceImages", "type": "media", "kind": "image", "multiple": true },   // L1 锚定
      { "key": "aspectRatio" }, { "key": "resolution", "options": ["2048","1536","1024","768"] },
      { "key": "durationSec" },
      { "key": "stages", "type": "select", "options": ["off","2","3","4"], "default": "3", "label": { "zh": "渐进分辨率（SPEED）" } },
      { "key": "latentUpscale", "type": "select", "options": ["off","1.5x","2x"], "default": "off" },  // L2
      { "key": "latentUpscaleRefine", "type": "number", "default": 0.35, "min": 0.0, "max": 0.6 },     // L2 二次采样强度
      { "key": "faceRefine", "type": "select", "options": ["auto","off"], "default": "auto" },         // L3
      { "key": "faceLongshot", "type": "boolean", "default": true },                                    // 远景档自动
      { "key": "videoUpscale", "type": "select", "options": ["off","2x"] , "default": "off" },          // L4
      { "key": "seed" } ],
    "defaultParams": { "resolution": "1024", "durationSec": 5, "stages": "3", "latentUpscale": "2x", "faceRefine": "auto" } } ],
"expose": [
  { "model": "minimax-h3-comfy", "function": "text-to-video" },
  { "model": "minimax-h3-upscale", "function": "upscale-video", "capability": "video.generate" } ]  // L2/L4 独立入口
```

> **加速组合的约束要写进字段 `hint`**：「步数蒸馏只选一个；渐进分辨率可叠加；人像不要叠加 Spectrum/EasyCache 类跳步；长片用稀疏/Kitchen 注意力（50 系长序列 Sage 有静默噪点风险）」。

### 7.3 产物 `meta`（两档统一）

```jsonc
"enhance": {
  "identityAnchor": { "refs": 3, "characterLora": "" },        // L1
  "stages": "3", "stepDistill": "lightx2v-8", "attention": "sage",
  "latentUpscale": { "scale": "2x", "refine": 0.35 },          // L2
  "faceRefine": { "applied": true, "faces": 3, "minFacePx": 52, "profile": "longshot" },  // L3
  "videoUpscale": "off",                                       // L4
  "rawKey": "runs/<id>.raw.mp4",                               // 原始产物永远保留
  "elapsedSec": { "generate": 66.1, "upscale": 41.0, "face": 18.4 }
}
```

---

## 8. 改动清单

| 位置 | 改动 | 档位 |
|---|---|---|
| `modalapps/minimax-h3-turbo/modal_app.py` | 新增可选 `postEnhance` 阶段（解码后整片超分 + 像素域小脸修复 + **音轨 copy remux**）+ 字段透传 + `keepRaw` 双写（`runs/<id>.mp4` / `.raw.mp4`） | A |
| `modalapps/minimax-h3-turbo/enhance.py`（新） | 兜底增强模块（VSR 适配 + 检测/跟踪/修复/缝合/remux）；ONNX GPU | A |
| `modalapps/minimax-h3-turbo/{manifest.json,bootstrap.py}` | 新字段、新卷（增强模型）、`artifacts.enhance`（**不进 `requires`**）、bootstrap 增一步 | A |
| `modalapps/minimax-h3-comfy/**`（新） | ComfyUI-in-Modal 新 modalapp：镜像（ComfyUI + 社区节点：Turbo LoRA / SPEED / Latent Upscaler / FaceRefine / Stream Denoise / Motion-Context）、`workflow.py`（`build(ctx)->dict` 的图模板）、`manifest.json`（表单 + `expose` 数组）、`bootstrap.py`（下 Comfy 权重）、README | B |
| `modalapps/minimax-h3-lightx2v/**`（新，可选） | LightX2V 版 H3（含可控 denoise V2V 修脸入口） | C |
| `apps/modal-studio/python/publish_registry.py` → `registry.json` | 重跑生成（新包/新参数/新 `expose` 条目进 `contributes.media.models`） | 全部 |
| `apps/modal-studio/skills/modal-studio/SKILL.md`、各 `modalapps/*/README.md`、`README(.en).md` | 三档说明、四级阶梯、加速三层与冲突规则、「能力边界」如实说明 | 全部 |
| `rfc/README.md` | 更新本 RFC 条目（v2） | 文档 |
| `service/**` | **无任何改动** | — |

---

## 9. 里程碑（含兼容与回滚）

- **M1（Tier A 兜底 + 收口）**：现有包加 `postEnhance`（默认 `off`）+ `keepRaw` 双写；注意力/Sage 可配；表单与文档收口；加速三层与冲突规则写进 skill。**兼容**：默认全关，老调用行为不变。**回滚**：默认改 `off` 即等于现状。
- **M2（Tier B 骨架）**：`minimax-h3-comfy` 跑通「参考锚定 + 8 步 + SPEED + 两阶段潜空间放大 + 低噪声精修」的最小图（先不做 FaceRefine / VSR / Motion-Context），给出与 Tier A 的**同 prompt 同 seed A/B**。
- **M3（Tier B 完整）**：接入 H3 原生 FaceRefine（含远景档）、可选整片 VSR（选型：VOSR2 / FlashVSR / SeedVR2）、可选 Motion-Context 长片续拍；把「只重跑增强」的入口做出来。
- **M4（Tier C 与选型报告）**：LightX2V V2V 修脸档（可选）；输出一份**加速 × 人脸 A/B 报告**（不同蒸馏/注意力/渐进分辨率组合下的时延与脸部观感），据此固化默认。
- **明确不做**：PDD / TaoMate / FastH3 / SLA-VSA 作默认（§D8）；EasyCache/Spectrum 用于人像（§D7）；官方未开源项。

---

## 10. 验收

1. **档位可选**：`modal.catalog` 能列出 Tier A（现状）与 Tier B（新）两个包及各自就绪度；App 能按档位切换。
2. **加速组合正确**：同一 prompt/seed 下，Tier B 的（8 步 + Sage + SPEED 3 阶段 + 2× 潜空间放大 + 低噪声精修）相对「Tier A 直接 768p 8 步」**总时延不劣于**（考虑到分辨率更高，允许放宽，但要给出实测数字），且**输出分辨率更高、脸部更清楚**。
3. **人脸改善可判定**：抽 3 条「远景小脸」样本，**正常速度播放**对比 `raw`/成品——五官可辨、**身份不变**（不是「修成另一个更清楚的人」）、无 mask 边缘脉动；给出并列文件。
4. **音频不变**：任何增强路径（V2V / FaceRefine / VSR / remux）后，音轨与原始**逐字节等价**；SPEED 只降视频阶梯、音频恒全分辨率。
5. **能力边界不误导**：UI/文档明确「结构错先重生成」；对身份漂移样本，Tier B 的 L1（参考锚定）相对无参考的改善要有对照。
6. **失败可恢复**：增强阶段失败 → 生成仍成功交付**原始**产物 + `meta.enhance` 标记 + 日志；「只重跑增强」不重新生成。
7. **调用形状**：Agent 仍只传 `prompt` + 参考素材；档位/参数走 `agentDefaults`；不传时的默认合理；「运行」不重置用户已填参数。
8. **契约与纪律**：`publish_registry.py` 后根 `manifest.json` 含新模型；`cd service && go test -run ModalStudio` 全绿（**零 service 改动**）。

---

## 11. 边界与未决

- **框架取舍是真实代价**：Tier B（ComfyUI）拿能力、丢 SGLang 的 **GPU 快照/融合 kernel/fp8 吞吐**——冷启动更慢、镜像更大、显存更重。**能否给 ComfyUI-in-Modal 也做快照/镜像瘦身**，需要在 M2 实测（未决）。
- **两阶段放大的显存与耗时未测**：24 通道 latent 放大 + 低噪声精修在 96GB 单卡上的真实峰值/时长**需实测**；社区数字（0.5MP→1080p <5min）来自消费卡，不能直接换算。
- **放大/修复都不能修的东西**（§4 边界）：身份漂移、错误运动、时域闪烁、畸变文字、物理错误——**只能重生成**。文档与 UI 必须如实说明。
- **`Sage` 的 50 系长序列静默噪点**：长片应换稀疏/Kitchen；本 RFC 把它写进 `hint`，但**具体阈值（≳16 万 token）需在目标负载上复核**。
- **Tier C 的必要性**：若 Tier B 已覆盖「V2V 修脸 + 生成时锚定」，Tier C（LightX2V）可能只是中间冗余——**保留为可选**，等 M2/M3 的 A/B 再决定是否保留。
- **`upscale-video` 的平台归属**：把放大暴露成平台模型仍走 `video.generate` 是权宜；是否该有独立能力名（`video.enhance`）**未决**（会碰 `service/`，本 RFC 不碰）。
- **角色 LoRA**：跨集复用的角色 LoRA 训练是**本 RFC 之外**的独立课题（数据、rank、验证），此处只把它当作 L1 的可选输入引用。
- **许可证**：H3 权重受 MiniMax H3 Community License 约束（非 OSI），EU/UK/韩/部分美国用途受限，商用前需核查——新增的放大/修复模型（VOSR/FlashVSR/SeedVR2/CodeFormer 等）**各自的许可证也要单独核查**。

---

## 12. 实施记录（M1：Ref2VA 专用人脸保持档 `minimax-h3-ref`）

**已实施（2026-10-10）**：按「**新预设包 + 复用模型卷 + 只做 ref2video**」的约束，先落最小的一档——记为 **Tier A+**（在 SGLang 栈内把 §4 的 L1 + L4 做到位；L2 两阶段潜空间放大仍需 Tier B/C 的运行时）。全部改动在 `apps/modal-studio/modalapps/minimax-h3-ref/`，**零 `service/` 改动**。

| 文件 | 作用 |
|---|---|
| `modal_app.py` | `H3Ref`（Ref2VA 专用：只加载参考分区 + **复用** `ref2va-transformer`；默认**精确注意力** `fa`；GPU 快照 + 形状预热）与 `H3FaceRefine`（小卡、不加载 DiT 的「只重跑修复」函数）；`bootstrap_weights`（**只校验**共享产物、不下载）与 `bootstrap_facemodels`（下载人脸小模型） |
| `face_refine.py` | 人脸保持层：参考组增强（L1）+ 检测/跟踪/裁剪/修复/羽化缝合/**原音轨 copy remux**（L4）；纯函数可单测；模型缺失时优雅降级（`applied=false` + reason，不连坐生成） |
| `manifest.json` | 卷声明（`recut-minimax-h3-models` / `recut-minimax-h3-turbo-merged` **复用**，`-ref-face` / `-ref-out` 新增）、`artifacts`（`weights`/`mergedRef2va`/**`facemodels` 不进 `requires`**）、两个函数与表单、`expose` 数组（`minimax-h3-ref` + `minimax-h3-face-refine`） |
| `bootstrap.py` / `mock.py` / `mock_sglang.py` / `bench.py` / `README.md` | 准备入口（校验复用 + 下载小模型）/ 本地 mock 链路 / 契约自检 / 时延实测入口 / 使用说明 |

**本地已验证（可重复）**：`face_refine.py --selftest` **9/9**；`mock_sglang.py --selftest` 契约全绿；`publish_registry.py` 生成注册表并同步 `contributes.media`（新增 2 个平台模型 `modal-cloud/minimax-h3-ref`、`modal-cloud/minimax-h3-face-refine`）；`modal_runner.py invoke --mock` 对 `reference-to-video` **与链式的** `face-refine` 端到端跑通（含「模型缺失优雅降级」路径）；`cd service && go test -run TestModalStudio` 通过。

**真机已验证（2026-10-10 · RTX PRO 6000 96GB · fp8 · 精确注意力）**：① Ref2VA 用**复用的** `ref2va-transformer`（8 步）在云端起服务并出片——5s / 1344×768 / 8 次去噪：denoise ≈118s、decode ≈7.4s、峰值 **≈49.8 GB**，生成本身 **≈148s**；② **参考组增强（L1）在真实人脸上生效**（YuNet 检出 → 512 裁剪拼成参考组 → 追加为 `<Picture 2>`）；③ **L4 人脸修复真正跑通**：CodeFormer ONNX（FaceFusion 导出，**按 commit pin**）加载，`load_restorer` **自适应识别真实 I/O**（`input` + `weight`(**float64**)，输出 `output/logits/features`），逐帧检测 → 跟踪 → 裁剪 → 修复 → 羽化缝合，**帧数保持 124→124**、**音轨原样保留**、**原始产物保留**；人脸阶段在 GPU 上 **11.6s**（157 裁剪；同负载 CPU 218s ≈19×）；④ 修复模型缺失时按设计优雅降级；⑤ `fa` 在 SM12.x 自动回退**精确** `torch_sdpa`。（注：当时的“视觉对比确认变清楚”结论**不可靠**——首轮把修复模型的值域喂错，见下第 ④ 个 bug；修正后同一内容 A/B 才干净。）

**这一轮实测暴露并修掉的四个真 bug**：① `bootstrap_image`（debian_slim）缺 numpy → bootstrap 一进容器就 `ModuleNotFoundError`；② `_decode` 用手动 `packet.decode()` **没有 flush 解码器为 B 帧缓冲的帧** → **丢 2 帧（124→122）**，改用容器管理的 `decode(video=0)`；③ 缝合掩膜覆盖**整个外扩裁剪框** → 把背景也交给模型重画（块状伪影/色偏），改为只覆盖人脸中心的椭圆；另按扫参结论补上 **colour match**（掩膜内统计对齐，否则边界色差明显）；④ **修复模型的值域喂错**：FaceFusion 系导出（CodeFormer/GFPGAN）的像素 I/O 是 **`[-1, 1]`**（官方 `(x/255-0.5)/0.5` 与 `(clip(x,-1,1)+1)/2`），早期按 **[0,1]** 喂入/裁出 → 模型被推出训练分布，输出灰糊/斑驳，缝回脸中心后整张脸像被“修坏”（**第二个真机验证里的“变清楚”结论即因此不可靠**）。已抽成纯函数 `to_model_input` / `from_model_output` 并用 `--selftest` 钉住值域契约。

**仍未做（已写进 pack README）**：① 参考组增强对画质的**实际增益**未做 A/B（只确认生效、未量化）；② 修复强度/羽化的默认值来自**单个样本**扫参，换内容可能仍需微调；③ 重编码 `crf 16` 使产物比原始大约 **4.6×**（0.77 → 3.51 MB / 5s；其中 **~2.9× 来自整帧重编码本身**——H3 原始只有 ~1.25 Mbps，一帧不改也会如此——其余来自修出来的细节）；已做成参数 `outputQuality`：`detail`(crf 16, 默认保脸细节) 4.6×／`balanced`(crf 20) 2.7×／`compact`(crf 23) 1.8×。这是像素域路线「必须整帧重编」的固有代价，latent 路线（Tier B/C）可规避；④ D10 的注意力后端 UI 化未落地。

**GPU 快照决策（实测后调整）**：首轮**首次调用 wall-clock 874.6s**，其中约 9 分钟用于建快照；**移除快照后重跑降到 326s（−63%）**，而生成本身不变（148.2s）。故**调试期关闭快照**（`enable_memory_snapshot` / `enable_gpu_snapshot` 均不启用、`@modal.enter()` 不带 `snap=True`、`WARMUP=False`）；将来需要时把这三处加回即可——预热本就是为把形状冻进快照而设，无快照时它只会让每次冷启动多付 ~90s）。

> 另：D10 的「把注意力后端提为预设包声明 + UI 可配」**尚未落地**——本包注意力是 `modal_app.ATTENTION_BACKEND` 常量（env `RECUT_H3_REF_ATTENTION` 可覆盖，部署期生效），manifest 里**没有**声明一个没人读的字段（避免误导性声明）。把它接成 UI 开关属 M2。

**与 v2 计划的关系**：本档 = §6 的 **Tier A** 在 ref2video 上的加强版（记 **A+**）：它把该栈能做的 L1/L4 做到位，但**不含 L2 两阶段潜空间放大与 L3 H3 原生低强度重绘**（那需要能控制潜空间/去噪强度的运行时）。**Tier B（ComfyUI-in-Modal）与 Tier C（LightX2V）仍按 §9 的 M2/M3 推进**；届时两阶段放大与原生重绘接入本档或另立新档。

---

## 13. 参考来源（外部事实与实测）

**加速（三层 + 正交 + 冲突）**
- [WhichH3 — H3 加速方案横评：LightX2V / larry / FastH3 / PDD 怎么选](https://whichh3.com/articles/acceleration)（三层分类、**步数蒸馏只选一个**、组合与冲突矩阵、Sage 长序列风险、CLIPCached 无损）
- [Mushroom Research — MiniMax H3 本地视频生成完整工程指南：五条加速路径](https://blog.mushroom.cv/blog/minimax-h3-video-generation-local-acceleration-engineering-guide/)（LightX2V / Larry Turbo / W4A4+VSA / Spectrum / Motion-Context；含实测数字）
- [ComfyUI Wiki — MiniMax H3 SPEED V2：多采样器支持与渐进分辨率加速](https://comfyui-wiki.com/zh/news/2026-09-20-h3-speed-sampler-v2)（免训练渐进分辨率；实测 1.30×–2.41×；音频恒全分辨率）
- [SGLang Cookbook — MiniMax-H3](https://docs.sglang.io/cookbook/diffusion/MiniMax/MiniMax-H3)（`/v1/videos` 契约、`ref2va` **不暴露 denoise-strength**、LoRA recipes、PDD、FastH3/VDN、AdaLN cache）
- [LMSYS — MiniMax-H3 on 8×H200: 1.95× Lossless, Up to 6.24×](https://www.lmsys.org/blog/2026-08-27-minimax-h3-h200)（fused kernel / Cache-DiT / SubBlock 的加速与 SSIM）
- [larryvrh/MiniMax-H3-Turbo-Lora](https://huggingface.co/larryvrh/MiniMax-H3-Turbo-Lora) / [lightx2v/Minimax-h3-Turbo](https://huggingface.co/lightx2v/Minimax-h3-Turbo) / [ModelTC/Minimax-H3-Turbo](https://github.com/ModelTC/Minimax-H3-Turbo)（步数与设置）

**人脸保持（四级阶梯）**
- [Comfy-Org/MiniMax-H3 讨论 #30「Why MiniMax H3 Ruins Faces on Wide Shots?」](https://huggingface.co/Comfy-Org/MiniMax-H3/discussions/30)（头占比性质；与分辨率无关）
- [Carasibana/ComfyUI-H3-FaceRefine](https://github.com/Carasibana/ComfyUI-H3-FaceRefine) / [xm6018924/BSAI-ComfyUI-FaceRefine](https://github.com/xm6018924/BSAI-ComfyUI-FaceRefine)（小脸修复链与参数：denoise 0.35 / 远景 0.4、<40px 切远景档、person 兜底、多人链式）
- [seedance — Fix Faces at a Distance: Detailer Workflow](https://www.seedance.tv/blog/minimax-h3-fix-faces-at-a-distance)（regenerate vs repair 的判据；正常速度验收）
- [Minimax H3 - v2v Fixing Faces At Distance](https://www.youtube.com/watch?v=d1h5-E7NpuY)（低步数、低 denoise 的 V2V 修脸） / [LightX2V examples/minimax_h3](https://github.com/ModelTC/LightX2V/tree/main/examples/minimax_h3)（H3 四任务 + 可控 denoise V2V）
- **两阶段潜空间放大**：[mcbibi/Minimax_h3_latent_Upscaler](https://huggingface.co/mcbibi/Minimax_h3_latent_Upscaler)、[LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler](https://github.com/LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler)、[xmarre/...-Upscaler-Plus](https://github.com/xmarre/Comfyui_Minimax_h3_latent_Upscaler-Plus)、[rockerBOO/h3-latent-upscaler](https://github.com/rockerBOO/h3-latent-upscaler)；[ComfyUI Wiki — H3 训练版 2× 潜空间放大](https://comfyui-wiki.com/en/news/2026-08-17-minimax-h3-trained-latent-upscaler)
- [MiniMax3 — H3 Latent Upscaler vs H3-Regenerate-2K](https://minimax3.org/minimax-h3-latent-upscaler)（潜空间放大与官方 2K 的区分；**放大不能修什么**的清单）；[seedance — Two-Stage Workflow](https://www.seedance.tv/blog/minimax-h3-two-stage-workflow)
- **身份一致性**：[PixMind — H3 角色一致性指南](https://www.pixmind.io/posts/minimax-h3-character-consistency)、[domoai — Character Consistency Guide](https://www.domoai.app/blog/minimax-h3-character-consistency-guide)、[RunComfy — H3 Ref2V LoRA 训练](https://www.runcomfy.com/zh-CN/trainer/ai-toolkit/minimax-h3-ref2v-lora-training)（角色 LoRA：rank 16、参考图当主体/风格而非第 0 帧）
- **长片连续性**：[NikoDemon80/ComfyUI-H3-Motion-Context](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context)（潜空间尾片续拍，避免像素往返）
- **非 H3 修复/超分（Tier A 兜底）**：[CodeFormer](https://github.com/sczhou/CodeFormer) / [GFPGAN](https://github.com/TencentARC/GFPGAN)；[FlashVSR（CVPR 2026）](https://github.com/OpenImagingLab/FlashVSR) / [VOSR 2.0](https://github.com/cswry/VOSR) / [SeedVR2](https://seedvr2.net/)；[SVFR（CVPR 2025）](https://en.papernotes.org/CVPR2025/image_generation/svfr_a_unified_framework_for_generalized_video_face_restoration/) / [DVFace](https://arxiv.org/abs/2604.14560)
- **一步生成前沿（背景）**：[One-step Generation in the Post Diffusion Era](https://junoh-kang.github.io/blog/2026/One-step-Generation-in-the-Post-Diffusion-Era/)、[Awesome Video DiT Distillation](https://github.com/veryverypro/awesome-video-distill)
