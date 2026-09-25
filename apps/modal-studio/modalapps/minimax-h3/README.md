# MiniMax-H3（视频 + 音频生成）

[MiniMax-H3](https://github.com/MiniMax-AI/MiniMax-H3) 是 MiniMax 的**全模态（omni-modal）音视频生成系统**：从文本、关键帧或参考素材生成带原生立体声的视频，支持 4–15 秒、768p（短边 768）、24 FPS、32 kHz 立体声。

本预设包把 **H3-Base（FL2VA 检查点）** 用 [SGLang](https://docs.sglang.io/cookbook/diffusion/MiniMax/MiniMax-H3) 托管到 modal.com 的多卡 GPU 上，并暴露为两个函数：

- **文生视频（t2va）**：纯文本提示词 → 视频 + 音频。
- **首/尾帧生视频（fl2va）**：1–2 张关键帧（首帧/尾帧）→ 视频 + 音频。

## 如何在 Modal 上运行

H3-Base 是一个 **33B 的 omni transformer**（DiT 约 61.7GB）+ Qwen3-VL-32B 文本编码器，单卡放不下，官方用 **SGLang 多卡并行** 服务。做法：

1. **镜像**：`lmsysorg/sglang:dev`（含 H3 diffusion 支持）+ `pip install -e /sgl-workspace/sglang/python[diffusion]`。
2. **多卡**：Modal 单节点最多 8 卡（`gpu="H200:4"` 等）。容器内启动 `sglang serve` 常驻服务，按**探测到的 GPU 型号/数量**自动选择官方已验证 recipe：
   | GPU | 并行 | 说明 |
   |---|---|---|
   | `H200:4` | `--num-gpus 4 --ulysses-degree 4` | 官方 h200-resident-4（默认） |
   | `H100:4` | `--num-gpus 4 --tp-size 2 --ulysses-degree 2` | 官方 h100-resident-4 |
   | `B200:4` | `--num-gpus 4 --ulysses-degree 4 --use-fsdp-inference true` | 官方 b200-fsdp-4 |
   | `B200:8` | `--num-gpus 8 --ulysses-degree 8` | 官方 b200-resident-8 |
3. **调用**：容器内的 `generate_video` 把表单参数组装成 SGLang `POST /v1/videos` 请求（`task=t2va|fl2va`、`target.short_edge=768`、`quality=lossless`、`num_inference_steps`、`flow_shift=12.0`、`audio_flow_shift=3.0`），取回 mp4 写入 `/out` 卷并返回 `{kind:"file"}`。对本机 runner 仍是 `Function.from_name(...).with_options(gpu=...).remote(...)`——**无需 HTTP endpoint**。
4. **权重（只在 bootstrap 下进 Volume）**：FL2VA 检查点（`model_index.json` + `FL2VA/**`，约 134GB）**只由 `bootstrap.py` 下载进 `/models` 卷**；`modal.deploy` 只构建镜像、`generate` 只读卷，都不联网拉权重。因为太大，下载用**逐文件 HTTP Range 断点续传**（`.part` 留在卷里），并**每 10 分钟 `volume.commit()`**，容器超时/中断后重跑 `modal.install` 即从断点继续；全部文件校验通过才写完成标记。**标记存在时 `bootstrap_weights` 直接短路返回（不联网、不需要 token）**——已下载过就不会重复准备。

## 前置条件（重要）

- **HF 访问授权**：`MiniMaxAI/MiniMax-H3` 是 **gated 仓库**，需在 Hugging Face 页面申请并获批。
- **HF token**：先写入 Modal Secret：
  ```text
  modal.secret.set { name: "recut-hf-token", values: { HF_TOKEN: "hf_..." } }
  ```
  该 secret 在部署时被引用，缺失会导致 `modal.deploy` 失败。
- **成本**：H200×4 ≈ $18/小时、B200×8 ≈ $50/小时（Modal 计价）。一次 5s / 50 步生成通常数分钟；`modal.generate` 默认要求 `confirmCost: true`。
- **许可**：模型受 MiniMax-H3 Community License 约束，商用/再分发前请阅读许可与可接受使用政策。

## 本地 mock（零成本调试）

H200×4 冷启动约 3 分钟且按小时计费，改一次请求字段就上云代价太高。为此把请求契约抽到 **`h3_contract.py`**，
云端 `modal_app.py` 与本地 `mock.py` 共用同一套「POST→轮询→下载 content」逻辑；本地 mock 服务复刻 SGLang 的
`/v1/videos`（含合法校验与真实格式的 400 detail），可在秒级把整条链路跑通。

```bash
# 1) 契约自检（起临时服务，验证 t2va/fl2va 与各类 400）
python modalapps/minimax-h3/mock_sglang.py --selftest

# 2) 启动本地 SGLang 替身（默认 http://127.0.0.1:30010）
python modalapps/minimax-h3/mock_sglang.py --port 30010

# 3) 用同一 runner 走 mock（不部署、不访问 Modal/GPU）
python python/modal_runner.py invoke \
  --dir "$PWD/modalapps/minimax-h3" --modalapp minimax-h3 \
  --function text-to-video --output /tmp/out \
  --params /tmp/params.json --mock --mock-url http://127.0.0.1:30010
#   fl2va 追加 --refs /tmp/refs.json（[{path,name,mimeType}]，首/尾帧按顺序）
```

- `mock_sglang.py`：`/health`、`/v1/models`、`POST /v1/videos`（校验 `seed≥0`、`seconds` 整数、
  `duration_seconds` 4–15、`task` 与 `conditions` 规则）、`GET /v1/videos[/{id}]`、`GET /v1/videos/{id}/content`
  （回一个内嵌的极小合法 mp4）。`--delay` 控制「生成」耗时，便于验证轮询。
- 校验通过后产物与 `.meta.json` 由 runner 正常落盘，`gpuTier` 标为 `mock`。

## 已知边界

- **不含 H3-Context-IR / H3-Regenerate-2K**：官方未开源这两个模块（提示词增强与 2K 重生成）。本预设包输出 768p；提示词建议直接给出结构化的 `integrated_multimodal_description / overall_soundscape / non_diegetic_music`（见上游 Prompting Guidance），否则质量会低于官方 API。
- **仅 FL2VA 检查点**：暂不支持 Ref2VA（多模态参考）。
- **冷启动较慢**：每次冷启动需从卷加载约 134GB 权重；`max_containers=1` 避免重复加载。
