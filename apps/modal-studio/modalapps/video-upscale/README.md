# 视频高清化（video-upscale）

两个开源 SOTA 视频超分模型，**一个入口、两档**：质量档 [SeedVR2-7B](https://github.com/ByteDance-Seed/SeedVR)（ByteDance Seed，ICLR 2026，一步扩散，Apache-2.0）与快速档 [FlashVSR v1.1](https://github.com/OpenImagingLab/FlashVSR)（CVPR 2026，一步流式 4×，Apache-2.0）。

「一个入口」= 一个预设包，App 内切换函数即可；两档共用一次 `modal.deploy`，但各自独立的镜像、GPU 默认档与权重产物就绪标记。

## 两个函数

| 函数 | 模型 | 默认 GPU | 说明 |
|---|---|---|---|
| `upscale` | **SeedVR2-7B** | H200 | 质量优先：7B 一步扩散，官方 `inference_seedvr2_7b.py`，单卡 `sp_size=1` |
| `upscale-fast` | **FlashVSR v1.1** | A100-80GB | 速度优先：官方小条件解码器（`tiny`），流式 4×，官方验证的稀疏注意力卡是 A100 |

> **GPU 档位是包级的**（runner 用 `with_options(gpu=...)` 逐次覆盖类的默认档），所以手动切档位对**当前跑的那个函数**生效。两档的推荐档位都列在 `gpuTiers` 里：质量→H200/B200，快速→A100-80GB/L40S。并发上限提到 `generate: 2`，两档不会互相排队（同包内闸门见主 README）。

## 质量优先的关键取舍（部署期固定，非表单项）

- **用 7B 不用 3B**：质量档固定 `SeedVR2-7B`。
- **bf16 全驻留，不做 fp8/量化**：不拿画质换速度。
- **不放小 tile 硬拼**：SeedVR2 原生支持任意分辨率单步，尽量整帧/大时域窗口（接缝是画质杀手）。
- **音轨原样 copy**：`keepAudio` 默认开，用 ffmpeg `-c:a copy` 回封装，不重编码音频。
- **FlashVSR 必须是官方 LCSA 版**：快速档跑官方仓库（含 Locality-Constrained Sparse Attention）；社区部分实现退化成 dense attention 会明显掉画质。
- **seed 固定**：质量档暴露 `seed`，便于复现与 A/B。

## 权重与卷

| 卷 | 挂载 | 内容 | 完成标记 |
|---|---|---|---|
| `recut-video-upscale-models` | `/models` | `seedvr2-7b/`（HF `ByteDance-Seed/SeedVR2-7B`）；`flashvsr-v1.1/`（HF `JunhaoZhuang/FlashVSR-v1.1`） | `.recut-seedvr2-complete` / `.recut-flashvsr-complete`（外加基础 `.recut-download-complete`） |
| `recut-video-upscale-out` | `/out` | 产物中转 | — |

逐产物就绪：`upscale` 需要 `seedvr2`，`upscale-fast` 需要 `flashvsr`；缺哪个就只拦哪个函数（`modal.status` 的 `assets` / `modal.generate` 的提交前预检）。约 45GB。

## 运行时接线

两个上游工程都 clone 进各自镜像，权重走卷；运行时用符号链接把仓库「默认查找路径」接到卷上，**不改上游脚本的路径常量**：

- SeedVR2：`/opt/seedvr/ckpts` → `/models/seedvr2-7b`（官方文档约定权重放 `ckpts/`）。
- FlashVSR：`/opt/flashvsr/examples/WanVSR/FlashVSR-v1.1` → `/models/flashvsr-v1.1`（官方脚本约定此目录）。

SeedVR2 的 `torchrun ... --video_path <dir> --output_dir <dir> --res_h --res_w --sp_size 1` 与 FlashVSR 的 `python infer_flashvsr_v1.1_{tiny,full}.py` 都是**官方文档给出的入口**，本包只负责准备输入/输出与回封装音轨。

## 平台接入

本包声明两个 `expose` 条目，注册为平台模型（供平台默认路由与其他消费方调用）：

| 平台模型 | 函数 | 能力 | 参考上限 |
|---|---|---|---|
| `modal-cloud/video-upscale` | `upscale`（质量档） | `video.generate` | 视频 ×1 |
| `modal-cloud/video-upscale-fast` | `upscale-fast`（快速档） | `video.generate` | 视频 ×1 |

两个约束（有意保留，调用前须知）：

- **能力只能归到 `video.generate`**：平台只认 `image.generate` / `video.generate` / `speech.generate`，没有 `video.edit`/`upscale`，所以它会落在「视频生成」用途下、并可被选为视频默认路由。
- **平台层要求非空 `prompt`**：平台对所有生成都校验 prompt，而高清化没有提示词概念——经平台路由调用需给一个占位 prompt；直接用本 App 的 `modal.generate { modalapp: "video-upscale", function, referenceAssetIds, confirmCost: true }` 则不需要，也更贴合「视频→视频」语义。
- `weights.huggingFace` 是**预设包级**字段，两个平台模型都会标注 `ByteDance-Seed/SeedVR2-7B`（快速档实际是 FlashVSR v1.1）——仅展示用，不影响实际下载。

## 已知边界

- **只做超分/修复，不修内容**：错误运动、时域闪烁、畸变文字、物理错误、错误构图都修不了。
- **1× 输入**：`maxVideos: 1`。长视频按时域分块处理，跨块边界仍可能有时域不一致（尤其是大运动）。
- **FlashVSR 是 4× 设计**：官方明确「以 4× 为佳」，其它倍率稳定性未保证。
- **Block-Sparse-Attention**：编译目标架构写死为 `8.0;9.0`（A100/H200），换卡要改 `modal_app.FLASHVSR_CUDA_ARCH` 并重新 `modal.deploy`。
- 权重许可证：SeedVR2 / FlashVSR 均为 **Apache-2.0**，商用需各自保留声明。

## 验证

```sh
# 注册表（含本包）
python3 apps/modal-studio/python/publish_registry.py
node apps/modal-studio/test/catalog_smoke.mjs

# 云端（需 Modal 账号 + GPU）
python3 apps/modal-studio/python/modal_runner.py deploy --dir apps/modal-studio/modalapps/video-upscale
```

> **尚未真机验证 / 首次 deploy 需核对的部分**（诚实标注）：
> ① **FlashVSR 脚本 I/O 锚点**：官方脚本把输入/输出路径写成模块级常量且无 CLI 参数，`modal_app.FLASHVSR_IO_PATCHES` 按常见命名替换；若上游改版导致锚点失配，会**明确报错并指名文件与正则**（不会静默跑错）。首次 deploy 请按实际脚本核对一次。
> ② **FlashVSR 权重目录名**：脚本默认找 `FlashVSR-v1.1/`（v1.1 脚本）；若 v1.1 的 `tiny/full` 脚本实际指向 `FlashVSR/`，请相应调整符号链接名。
> ③ **SeedVR2 的 `--res_h/--res_w` 与 `ckpts` 形状**（配置目录名/权重子目录）需按 pinned revision 核对；`inference_seedvr2_7b.py` 的入参名以仓库为准。
> ④ **真实耗时/显存**（7B 到 1080p、FlashVSR 4× 到 1080p+）需实测回填；质量档预期单卡 H200 上 720p 级较从容，1080p+ 视长度可能需要 sp_size>1（本包固定单卡）。
> ⑤ **两档画质 A/B**（同源同 seed）需实测，以确认「质量档确实更好」这一默认假设。
