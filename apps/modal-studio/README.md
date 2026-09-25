# Modal 云函数 · Modal Functions

**把开源 GPU 项目托管到 modal.com，用云端 GPU 生成图片与视频**

Recut 的 Modal 云函数 App — 本机只做薄客户端，配置一个 modal token，即可部署镜像、准备权重并调用云端函数。

## 这是什么

Modal 云函数是一个 Recut **标准 App**（`standalone` 类型）：把「云端运行环境」与「预设包」解耦——一个 App 托管多个 **modalapp（预设包）**，每个 modalapp 自包含（`modalapps/<id>/`：`manifest.json` 表单/权重/GPU 档位 + `modal_app.py` 云端 Modal App + `bootstrap.py` 权重准备）。

- **无需本机显卡**：GPU 计算全在 [modal.com](https://modal.com)，用你自己的 Modal 账号（每月含免费额度）。
- **切换单位是预设包**：每个预设包可含多个函数（如文生图/图生图、文生视频）；**加能力 = 加目录 + 重跑注册表生成**，核心代码一行不用改。
- **部署与权重分离（但一次完成）**：`modal.deploy` 构建并缓存云端 Image（+ 部署函数），成功后**自动接着** `modal.install` 把权重写进 Modal Volume；只补权重可单独 `modal.install`。权重源默认 **Hugging Face**。
- **像调用本机函数一样调用云端**：本机用 Modal SDK 的 `Function.from_name(...).with_options(gpu=...).remote()` 直接调用，**无需任何 HTTP endpoint**。
- **结果先私有**：生成产物留在 App 私有区，确认后 `modal.save` 进入素材库。

## 交互

```text
┌───────────────────────────────┬──────────────────────────────────────┐
│ Left                          │ Right                                │
│ [功能] [记录]                  │ 统一生产预览 + 进度/日志              │
│  · 功能：顶部切换预设包/函数，  │  · 生成：图片/视频/音频预览 + 参数    │
│    每个函数有自己的表单，       │    + 保存入库                        │
│    可选 GPU 档位               │  · 部署/下载：实时日志 + 就绪度        │
│  · 记录：部署/下载/运行统一列表 │  · 顶部：Modal 账号连接状态           │
└───────────────────────────────┴──────────────────────────────────────┘
```

## 快速开始

1. 安装并启动 Recut（见主仓库 [README](../../README.md#安装-recut)）。
2. 用 `make app-link APP=apps/modal-studio` 链接到本机 App 目录（或经 `recut.apps.install` 安装）。
3. 首次进入：按提示**配置 Modal token**（modal.com → Settings → API Tokens），验证连接后进入工作台。
4. 选预设包 → 「部署环境」→「下载权重」→ 填表单 → 「运行」→ 结果「保存入库」。

## 能力

| 能力 | 操作 |
| --- | --- |
| 连通性 / 预设包目录 | `modal.status` · `modal.catalog` |
| token / 设置 / Secret | `modal.profiles.add/list/remove` · `modal.settings.set` · `modal.secret.set` |
| 预设包管理 | `modal.modalapp.list` · `modal.modalapp.get` · `modal.modalapp.path` · `modal.modalapp.save` · `modal.modalapp.scaffold` · `modal.modalapp.remove` |
| 本机环境 | `modal.prepare` |
| 部署 / 权重 / 停止 | `modal.deploy` · `modal.install` · `modal.teardown` |
| 运行 / 历史 / 入库 | `modal.generate` · `modal.generations` · `modal.generation.complete` · `modal.save` |
| 任务中心 | `modal.tasks.list` · `modal.task.get` · `modal.task.logs` · `modal.task.cancel` · `modal.cancel` |

> **v1 不接平台**：不写 `contributes.media`、不占默认生图/生视频路由；能力只经本 App 的 api/mcp operation 暴露。平台 hook 机制就绪后再评估接入。

## 预设包：内置 + 用户

预设包有两类来源，共用同一契约（`manifest.json` + `modal_app.py` + `bootstrap.py`）：

- **内置（origin=builtin）**：随 App 包发布，在 `apps/modal-studio/modalapps/<id>/`，**只读**；`python/publish_registry.py` 生成 `python/registry.json`。
- **用户（origin=user）**：运行时创建，落在 **appstate** 目录 `<dataRoot>/appstate/recut.modal-studio/files/modalapps/<id>/`，**可写**，App 运行期动态发现并合并进目录。

用户预设包的管理：

```text
modal.modalapp.path                       # 拿到内置/用户根目录的绝对路径（供原生工具编辑）
modal.modalapp.scaffold { id, name }      # 生成可端到端跑通的最小骨架（占位图、无需权重）
modal.modalapp.save { id, manifest, modalAppPy, bootstrapPy }   # 写入/更新
modal.modalapp.list / modal.modalapp.get  # 查看（含 origin 与绝对路径）
modal.modalapp.remove { id }              # 删除用户预设包（内置不可删）
```

用户 id 不可与内置撞名；改完需重新 `modal.deploy`（改 `bootstrap.py` 需重新 `modal.install`）。

**代码变更检测**：`modal.deploy` 成功后会记录预设包目录的 sha256 到 appstate `modal/deploy-state.json`；`modal.status` / `modal.catalog` 现场重算目录 hash，不一致即返回 `stale: true`（至少调用一次 deploy 后才会进入可信状态）。因此 App 升级或用户编辑 `modal_app.py` 后，界面会提示「需重新部署」，并常驻「重新部署」手动入口（deploy 自带 bootstrap，权重会一并刷新）。权重不做 hash 跟踪：`bootstrap.py` 自身跳过已下载文件，deploy 后的权重准备可安全重跑。

## 内置预设包

| 预设包 | 能力 | 函数 | 模型 | GPU |
| --- | --- | --- | --- | --- |
| `minimax-h3` | video.generate | 文生视频 / 首尾帧生视频（带原生音频） | `MiniMaxAI/MiniMax-H3`（FL2VA，约 134GB，HF gated） | H200×4 / H100×4 / B200×4 / B200×8 |
| `sd-turbo` | image.generate | 文生图 / 图生图 | `stabilityai/sd-turbo`（约 3GB） | T4 / A10G |

> `minimax-h3` 用 SGLang 多卡服务：容器内按探测到的 GPU 选择官方已验证 recipe；需先 `modal.secret.set { name: "recut-hf-token", values: { HF_TOKEN } }` 并在 Hugging Face 申请 `MiniMaxAI/MiniMax-H3` 访问授权。详见 `modalapps/minimax-h3/README.md`。

## 扩展一个新预设包

**方式一（推荐，内置开发）**：在 `modalapps/` 下新增一个目录，然后重跑 `python3 python/publish_registry.py`。

```text
modalapps/my-app/
├── manifest.json   # app meta + engine(image/gpuTiers/volumes/secrets) + weights + functions(formSchema/output)
├── modal_app.py    # 云端 Modal App：Image + Volume + @app.function(...)
└── bootstrap.py    # modal run 入口：把权重下载进 Volume
```

**方式二（用户运行时创建）**：用 `modal.modalapp.scaffold` 起骨架，或 `modal.modalapp.save` 写入，落到 appstate，无需重跑生成器。

## 面向开发者

```sh
make app-link APP=apps/modal-studio            # 开发期软链接
cd apps/modal-studio/ui && npm install && npm run build   # 构建 ui/dist
python3 apps/modal-studio/python/publish_registry.py      # 重新生成注册表
```

- UI 源码在 `ui/src`（React + TypeScript + Vite），运行时消费构建产物 `ui/dist/index.html`；`node_modules` 不入库。
- 本机主 venv 在 `~/.recut/python/envs/recut.modal-studio/`（轻量：`modal` 客户端）；**重依赖在云端 Image 里**，不落到本机。
- token profile 存 `~/.recut` 下 App 私有 files 区的 `modal/profiles.json`，只在 `modal_runner.py` 子进程内使用，绝不写入日志。
- 注册表由 `python/publish_registry.py` 从 `modalapps/*/manifest.json` 生成（`python/registry.json`），人工不再手改。

[返回主 README](../../README.md)
