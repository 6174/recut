# MiniMax-H3 单卡（GPU 快照）

[MiniMax-H3](https://github.com/MiniMax-AI/MiniMax-H3) 的全模态音视频生成（文本/关键帧/多模态参考 → 带原生立体声的视频，4–15 秒、768p、24 FPS）。本预设包是 **多卡 `minimax-h3` 的单卡分支**，用 1 张 GPU 跑，换来两件事：

与 `minimax-h3` 一样提供三个函数，并各用一个 Modal 类托管对应检查点分区：**文生视频（t2va）/ 首尾帧生视频（fl2va）** 走 `--model-variant fl2va`（类 `H3One`），**参考生视频（ref2va，图像/视频/音频）** 走 `--model-variant ref2va`（类 `H3OneRef`）。两个分区权重都从同一个共享卷读取。

1. **单价大幅下降**：默认 RTX PRO 6000 ≈ $3.03/h vs H200×4 ≈ $18/h（Modal 计价）。
2. **GPU 冷启动缓存**：单卡才能用 Modal 的 GPU memory snapshot；把 sglang 子进程整棵进程树（含 CUDA 状态）冻进快照，冷启动从快照恢复、不再每次重读 134GB 权重。

代价是**生成明显更慢**（无多卡并行；5s/50 步实测约 8 分钟），适合对时延不敏感、在意额度的场景。

## 可选 GPU 档位（单卡，越高越快越贵）

| 档位 | 显存 | Modal $/h（仅 GPU） | 预估速度（5s/50步） |
|---|---|---|---|
| **RTX PRO 6000（默认，最省）** | 96GB | 3.03 | ≈8min（实测 464s） |
| H100 | 80GB | 3.95 | ≈4min |
| H200 | 141GB | 4.54 | ≈3min |
| B200 | 192GB | 6.25 | ≈2min |
| B300 | 288GB | 7.10 | ≈1.5min |

> 除 RTX PRO 6000 外均为**基于显存带宽的预估**，未逐档实测；首个跑到某档时会自动为该型号建快照。价格仅为 GPU，另有 host RAM（本包默认 256GiB ≈ $2.05/h）与音量存储。
>
> 同一套配方对所有档位生效（FP8 只量化 DiT）。**每种 GPU 型号各自建一份快照**：切到新档后首次调用会重建快照（慢一次），之后各自秒级恢复。只能选单卡档；多卡请用 `minimax-h3`。

## 配方（容器内自动选择）

单卡 BF16 全驻留放不下（DiT 62 + 文本编码器 63 + VAE 10 GiB ≈ 135 GiB > 96 GiB），因此：

```text
sglang serve --model-path /models/MiniMax-H3 --model-variant fl2va \
  --num-gpus 1 --performance-mode memory --quantization fp8 \
  --layerwise-offload-components text_encoder --enable-torch-compile false
```

- 在线 FP8 **只量化 DiT**（约 31 GiB），让它常驻显存；
- 文本编码器（Qwen3-VL-32B，BF16 约 63 GiB）按组件流式 offload；
- 关闭 torch.compile 省显存。

## 权重卷与 minimax-h3 共用

本包挂载 **同一个** `recut-minimax-h3-models` 卷，FL2VA + Ref2VA 权重只下载一次（`bootstrap_weights` 见到完成标记直接短路）。产物写到自己的 `recut-minimax-h3-one-out` 卷。

## GPU 快照

`H3One` 类开启 `enable_memory_snapshot=True` + `experimental_options={"enable_gpu_snapshot": True}`，`@modal.enter(snap=True)` 内启动 SGLang。首次部署后第一次运行会创建快照（较慢，一次性），之后冷启动从快照秒级恢复。改了代码/镜像会自动重建快照。

> Modal 限制：GPU memory snapshot **不支持多 GPU Function**，所以多卡走 `minimax-h3`、单卡走本包，二者并列、二选一。

## 前置条件

- **HF 访问授权**：`MiniMaxAI/MiniMax-H3` 是 gated 仓库，需在 Hugging Face 申请。
- **HF token**：`modal.secret.set { name: "recut-hf-token", values: { HF_TOKEN: "hf_..." } }`。
- **host RAM**：单卡流式/驻留需较大 host RAM（本包默认请求 256 GiB）。
- **许可**：受 MiniMax-H3 Community License 约束。

## 已知边界

- 单卡只能跑单节点单 GPU；输出 768p；不含官方未开源的 H3-Context-IR / H3-Regenerate-2K。
- **参考生视频（ref2va）走独立分区**：`H3OneRef` 用 `--model-variant ref2va` 单独服务（另一个快照档），要求至少 1 个参考素材；上限图 ≤9、视频 ≤3、音频 ≤3。
- 在线 FP8 是近似模式，画质/音频请在目标负载上抽检。
- 时延远高于多卡 `minimax-h3`。
