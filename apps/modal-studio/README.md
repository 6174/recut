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
│ [功能] [记录]                  │ 统一生产预览 + 参数 + 日志            │
│  · 功能：顶部切换预设包/函数，  │  · 生成：图片/视频/音频预览 + 保存入库 │
│    每个函数有自己的表单，       │  · 参数：完整回显全部参数 + 参考素材   │
│    可选 GPU 档位               │    （图可全屏预览；视频/音频内联播放） │
│  · 记录：部署/下载/运行统一列表 │  · 日志：成功/失败都展示完整日志、   │
│    （终态任务可逐条删除）       │    生成中自动滚到最新（上滚时不打扰） │
│                               │  · 部署/下载：实时日志 + 就绪度        │
│                               │  · 顶部：Modal 账号连接状态           │
└───────────────────────────────┴──────────────────────────────────────┘
```

## 表单语义

- **按预设包 + 函数记忆**：每个函数的字段值与参考素材各自一份持久分片，GPU 档位按预设包记住。切函数、切预设包、切 Tab、刷新后再回来都是上次的样子；右侧预览聚焦的任务也会恢复（任务已失效则清空）。
- **画幅 / 分辨率**：「画幅」是输出比例，「分辨率」是**输出最长边（最大边）像素**，短边按画幅推导，越小越快、越省额度。各预设包的原生尺寸不同（MiniMax-H3 = 768p，16:9 即 1366×768、表单默认 1536；Qwen-Image-2.1 = 原生 2K；SD-Turbo = 512），且**只下调不超分**——取值不小于该画幅的原生最长边时保持原生尺寸。以**最长边**为准而不是短边：宽画幅（如 21:9）按短边放大会把另一边撑到远超目标，那正是爆显存的来源。**图像编辑 / 图生图默认跟随参考图尺寸**：Qwen-Image-2.1 的「画幅」留空即跟随参考图，显式选一个画幅后按「画幅 + 分辨率」出图。
- **GPU 档位**：用户选过就记住（按预设包分别记住），没选过才回落到预设包声明的默认档位。解析优先级为「本次请求 > 该函数 AI 默认 GPU（在「AI 调用默认参数」里设） > 全局默认 > 预设包默认」，且四个候选都必须落在该预设包的 `gpuTiers.options` 内，否则回落到首个选项——所以切预设包不会出现档位空白。
- **随机种子**：数字字段，`-1` 表示随机；字段带「随机」按钮，点一下在 0..2³¹−1 内取一个具体种子（便于复现某一次结果）。是否带该按钮由字段的 `randomizable` 声明决定。
- **AI 默认参数**：每个「预设包 + 函数」可在表单下方的「AI 默认参数」里配置 Agent/平台默认路由调用时的默认值。Agent 未显式传入的字段用它补全、Agent 传入的字段优先，配置后 Agent 基本只需传提示词。仅 AI/Agent 调用生效，App 内手动点「运行」不受影响。

## 快速开始

1. 安装并启动 Recut（见主仓库 [README](../../README.md#安装-recut)）。
2. 用 `make app-link APP=apps/modal-studio` 链接到本机 App 目录（或经 `recut.apps.install` 安装）。
3. 首次进入：按提示**配置 Modal token**（modal.com → Settings → API Tokens），验证连接后进入工作台。
4. 选预设包 → 「部署环境」→「下载权重」→ 填表单 → 「运行」→ 结果「保存入库」。

## 能力

| 能力 | 操作 |
| --- | --- |
| 首屏清单（本机读取，零等待） | `modal.overview` |
| 连通性 / 预设包目录 | `modal.status` · `modal.catalog` |
| token / 设置 / Secret | `modal.profiles.add/list/remove` · `modal.settings.set`（含每函数 AI 默认参数） · `modal.secret.set` |
| 预设包管理 | `modal.modalapp.list` · `modal.modalapp.get` · `modal.modalapp.path` · `modal.modalapp.save` · `modal.modalapp.scaffold` · `modal.modalapp.remove` |
| 本机环境 | `modal.prepare` |
| 部署 / 权重 / 停止 | `modal.deploy` · `modal.install` · `modal.teardown` |
| 运行 / 历史 / 入库 | `modal.generate` · `modal.generations` · `modal.generation.complete` · `modal.save` |
| 任务中心 | `modal.tasks.list` · `modal.task.get` · `modal.task.logs` · `modal.task.cancel` · `modal.task.remove` · `modal.cancel` |

> **已接入平台生图/生视频能力**：manifest `contributes.media` 声明 provider `modal-cloud`，每个声明 `expose` 的预设包注册为一个平台模型（`modal-cloud/<model>`，图片与视频都注册）。平台「生图/生视频默认路由」可指向它，生成经通用执行桥调用 `modal.generate`；**预设包未部署、或 `expose.function` 所需产物（基础权重 / LoRA / 离线合并）缺失时该模型 `ready=false`**（`modal.catalog.models[]` 动态上报，需 `deployed` 且所需产物齐备——离线合并产物缺失时基础权重卷仍是就绪的，只看 `volumeReady` 会把它误报为可用）。**纯文本请求（不带任何参考素材）会自动路由到该预设包的文生函数（`text-to-*`）；只有带参考时才走参考函数（参考生视频 / 图像编辑）**——参考是可选项（平台 budget 只设上限），因此「无参考走文生、有参考走参考」在平台默认路由下自动成立。其余能力仍经本 App 的 api/mcp operation 直接暴露。

> **任务并发（按预设包隔离）**：运行（`modal.generate`）与部署（`modal.deploy`）**按预设包独立排队**——A 预设包的任务不会等 B 预设包。同一预设包内默认**单槽 FIFO**（`deploy` 与 `generate` 互斥、`deploy` 优先），可在该包 manifest 的 `engine.concurrency` 里调大上限（如 `{ "generate": 2 }`，缺省 1）。准备（`modal.prepare`）全局单槽（所有预设包共用一个本机 venv）、权重（`modal.install`）按预设包串行、停止（`modal.teardown`）并行。**提交永不拒绝**：未拿到槽位的任务留在账本里（UI 显示「排队中」），就绪后由队列自动派发。

> **取消会传播到云端**：运行中任务的云端计算由 Modal `FunctionCall` 承载；本机 runner 在提交后把调用 ID 落在私有 `generations/<id>.call_id`（**只有成功取回结果后才撤掉**——取消/失败时保留，正是为了让 App 能按 ID 取消）。点「取消」时 App 会**先按该 ID 直接向 Modal 发起取消**，再终止本机 shell job——只杀本机进程是不够的（平台取消会把进程树 SIGKILL，runner 收不到 SIGTERM，取消也就传不到云端，云端 GPU 会继续烧）。排队中的任务直接落 cancelled。**拿不到调用 ID 时取消会返回一句告警**（提示云端容器可能仍在运行、可「停止环境」收敛），而不是静默放过——否则被取消的云端调用会继续跑，与下一次调用并存（同一 App 两个容器同时冷启动、互相拖慢）。

> **删除记录**：「记录」Tab 的**终态**任务可逐条删除（`modal.task.remove`）。删除会连同该任务的私有文件一起清理——日志、参数/参考快照；`generate` 任务还会删掉它的生成记录与私有产物（`generations/<recordId>.*`）。**已入库的素材不受影响**（`modal.save` 是把产物拷贝进素材库，与私有记录解耦）。运行中的任务不能直接删，须先「取消」。

## 进入工作台时的加载顺序

就绪度探测要拉 `modal` CLI（每个部署过的预设包一次 `modal volume ls`），是秒级操作，因此**不挡首屏**：

1. **首屏（`modal.overview`）**：只读本机——`python/registry.json`（预设包/函数/表单）、token profiles、设置，外加**上次探测的就绪度快照**。毫秒级返回，预设包与表单立即可用；就绪度按快照回放，没有快照时该预设包显示「状态待检查」（**未知不等于未部署**）。
2. **后台探测（`modal.status`）**：独立刷新，回填连通性、部署状态、volume 就绪度与 `stale`（代码变更待重新部署），并**把结果写成快照**供下次首屏直接回放。它只影响状态显示，不阻塞任何交互。
3. **点击「运行」时动态校验**：直接用新鲜快照；快照过期（>60s）或还没有时先重探一次。**只有已确定未就绪（未部署 / 权重缺失 / 离线合并产物缺失）才拦下**并提示「准备（部署 + 权重）」或「重新部署」；状态未知不拦。后台 `modal.generate` 在派发前还会对目标函数的所需产物做一次预检（`status --modalapp <id>`），缺产物直接拒绝、**不创建云端容器**——否则容器会在 `@modal.enter` 里反复起不来（Modal 判定 crash-looping 并不断重建，空烧 GPU，且错误只留在容器日志里）。

因此进入工作台不再需要等待探测；只有「第一次运行某个还没探测过的预设包」会多花一次探测的时间（约数秒）。

> **就绪度按「逐产物」判定**：预设包在 manifest 的 `engine.artifacts` 里声明自己的产物（基础权重 / LoRA / 离线合并…，各含卷名与完成标记），`engine.requires` 声明每个函数需要哪些产物；`modal.status` 逐个探测并在 `modalapps[id].assets` 上报（`volumeReady` 只代表基础权重）。缺离线合并产物（如 `minimax-h3-turbo` 的 `/merged/ref2va-transformer`）时基础权重卷照样「就绪」，正是它让「界面显示就绪 → 提交 → 云端 SGLang 起不来」的坑成立。未声明 `artifacts` 的预设包退回旧语义（只看第一个卷的下载标记）。

> **就绪度探测是「尽力而为」的**：权重是否就绪 = 卷根有没有完成标记（`.recut-download-complete`，部分预设包为 `-v2`，按前缀兼容）。单次 `modal volume ls` 失败（网络抖动、CLI 异常、卷正在被部署写入）**不会**被当成「权重没下载」——会先重试一次，两次都拿不到标记才判定未就绪；点「运行」时也会对「未就绪」结论复核一次，避免把一次抖动固化成假的告警。探测类短命令（`app list` / `volume ls`）静默执行，不往 stdout 灌无用噪声。同一轮探测里同一卷只探一次（`recut-minimax-h3-models` 被三个预设包共用）。

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

目录 hash 有两层**忽略名单**（不参与 `modal deploy` 的文件不计入变更检测）：
- **通用名单** `modalapps/deploy-ignore.json`（随 App 发布，内置与用户预设包共享）：文档与生成物（`manifest.json`、`*.md`、`index.json`）、本地 mock/压测（`mock*.py`、`bench*.py`）、运行产物（`*.log`、`*.tmp`、`output/`、`samples/`）、开发测试目录（`test/`、`tests/`、`test*.py`、`*.ipynb`、`.venv/`、`node_modules/`）；`xxx/` 形式按目录名匹配，其余为 glob（命中相对路径或文件名）。
- **预设包自带**：在该包 manifest 里用 `deployIgnore: ["<glob>", ...]` 追加自己的规则，叠加在通用名单之上。

因此改 manifest/文档/mock 不会误报「待部署」；个别预设包的噪声文件也无需改通用名单。

## 内置预设包

| 预设包 | 能力 | 函数 | 模型 | GPU |
| --- | --- | --- | --- | --- |
| `minimax-h3` | video.generate | 文生视频 / 首尾帧生视频（带原生音频） | `MiniMaxAI/MiniMax-H3`（FL2VA，约 134GB，HF gated） | H200×4 / H100×4 / B200×4 / B200×8 |
| `minimax-h3-one` | video.generate | 与上同（base 50 步） | 同上权重（共用 `recut-minimax-h3-models` 卷） | RTX PRO 6000 / H100 / H200 / B200 / B300（**单卡 + GPU 快照**） |
| `minimax-h3-turbo` | video.generate | 文生视频 / 首尾帧生视频（larryvrh **Turbo 9 步**）+ 参考生视频（lightx2v **Turbo 8 步**），带原生音频；两份 LoRA 均由 bootstrap 离线合并 | 同上权重（共用卷）+ 两份 Turbo LoRA | RTX PRO 6000 / H200 / B200 / B300（**单卡 + GPU 快照 + 形状预热**） |
| `minimax-h3-ref` | video.generate | **参考生视频·人脸保持档**（Ref2VA 8 步 + 参考组增强 L1 + 生成后人脸修复 L4；另有 `face-refine` 视频→视频修复函数） | 复用上面两份（权重卷 + turbo 的 `ref2va-transformer`，**不下载**）+ 人脸小模型（YuNet / CodeFormer ONNX） | RTX PRO 6000 / H200 / B200（单卡 + GPU 快照；**默认精确注意力**，人脸优先） |
| `qwen-image-2.1` | image.generate | 文生图 / 图像编辑（最多 10 张参考图） | `Qwen/Qwen-Image-2.1`（约 33GB，原生 2K） | A100 80GB（默认）/ H100 / H200 / L40S |
| `sd-turbo` | image.generate | 文生图 / 图生图 | `stabilityai/sd-turbo`（约 3GB） | T4 / A10G |

> `minimax-h3` 用 SGLang 多卡服务：容器内按探测到的 GPU 选择官方已验证 recipe；需先 `modal.secret.set { name: "recut-hf-token", values: { HF_TOKEN } }` 并在 Hugging Face 申请 `MiniMaxAI/MiniMax-H3` 访问授权。详见 `modalapps/minimax-h3/README.md`。
> `minimax-h3-one`（单卡 + GPU 快照，base 50 步）与 `minimax-h3-turbo`（单卡 + GPU 快照，Turbo 9 步：LoRA 在 bootstrap 里离线合并进权重）**共用同一 `recut-minimax-h3-models` 权重卷**，权重只下一次；两者都把 SGLang 常驻服务冻进 GPU memory snapshot，冷启动秒级。分别见各自 README。
> `minimax-h3-ref` 是**只做参考生视频的主场景「人脸保持档」**：复用 `recut-minimax-h3-models` 与 `recut-minimax-h3-turbo-merged`（**请先对 `minimax-h3-turbo` 跑一次 `modal.install`**，它下 Ref2VA 权重并离线合并 lightx2v ref2v LoRA），本包只新增人脸检测/修复小模型卷；注意力默认精确（`fa`）；生成后做参考组增强与人脸修复，并保留原始产物以便「只重跑修复」。见 `modalapps/minimax-h3-ref/README.md`。

## 扩展一个新预设包

**方式一（推荐，内置开发）**：在 `modalapps/` 下新增一个目录，然后重跑 `python3 python/publish_registry.py`。

```text
modalapps/my-app/
├── manifest.json   # app meta + engine(image/gpuTiers/volumes/secrets/concurrency/artifacts/requires) + weights + functions(formSchema/output)
├── modal_app.py    # 云端 Modal App：Image + Volume + @app.function(...)
└── bootstrap.py    # modal run 入口：把权重下载进 Volume
```

**方式二（用户运行时创建）**：用 `modal.modalapp.scaffold` 起骨架，或 `modal.modalapp.save` 写入，落到 appstate，无需重跑生成器。

**上平台（可选）**：在 `manifest.json` 加 `expose: { "model": "<平台模型简单名>", "function": "<函数 id>" }`，重跑生成器后即注册为平台模型
`modal-cloud/<model>`（`model` 只能含 `a-z0-9-_`，如 `qwen-image-2.1` 暴露为 `qwen-image`）。缺省 `function` 取 `functions[0]`，
capability 按该函数 `output.kind` 推导（image/video/audio）；未声明 `expose` 的预设包不上平台（用户 scaffold 默认不带）。

`expose` 也可以是数组：一个预设包可暴露**多个**平台模型（每个条目一个），各自命名并以各自函数判定输入能力与就绪度——例如
Qwen-Image-2.1 同时暴露 `qwen-image`（`text-to-image`，纯文本，进平台「图片生成」用途）与 `qwen-image-edit`
（`image-edit`，参考型，进「图片编辑」用途）。条目可带 `name`（双语展示名）覆盖预设包名，另有 `parameters`（额外平台参数属性名）。

**产物就绪（可选，推荐给「需要离线合并/额外适配器」的预设包）**：在 `engine.artifacts` 里声明产物
（`{ key, volume, marker }`，`marker` 是 bootstrap 写在卷根的完成标记），在 `engine.requires` 里按函数声明所需产物键。
声明后 `modal.status` 会逐项探测（`assets`）并在界面按所选函数判定就绪，`modal.generate` 也会在派发前预检；未声明则退回旧语义（只看第一个卷的下载标记）。

## 面向开发者

```sh
make app-link APP=apps/modal-studio            # 开发期软链接
cd apps/modal-studio/ui && npm install && npm run build   # 构建 ui/dist
python3 apps/modal-studio/python/publish_registry.py      # 重新生成注册表
node apps/modal-studio/test/catalog_smoke.mjs             # 首屏加载 + 逐产物就绪/预检冒烟（overview/status/快照/models）
node apps/modal-studio/test/queue_smoke.mjs               # 队列并发/取消冒烟
```

- 云端容器日志（含启动与崩溃栈）经后台 `modal app logs --follow` tee 进任务日志：`invoke` 与 `deploy`/`bootstrap` 都会跟随；跟随按启动时间**在本地过滤掉 App 历史日志**（`--follow` 不能与 `--since` 组合，否则每次新任务都会把上一次的崩溃栈整段回放进当前任务），并让子进程行缓冲，日志逐行到达。

- UI 源码在 `ui/src`（React + TypeScript + Vite），运行时消费构建产物 `ui/dist/index.html`；`node_modules` 不入库。
- 本机主 venv 在 `~/.recut/python/envs/recut.modal-studio/`（轻量：`modal` 客户端）；**重依赖在云端 Image 里**，不落到本机。
- token profile 存 `~/.recut` 下 App 私有 files 区的 `modal/profiles.json`，只在 `modal_runner.py` 子进程内使用，绝不写入日志。
- 注册表由 `python/publish_registry.py` 从 `modalapps/*/manifest.json` 生成（`python/registry.json`），人工不再手改。

[返回主 README](../../README.md)
