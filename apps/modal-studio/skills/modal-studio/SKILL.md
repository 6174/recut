# Modal 云函数（Modal Functions）Skill

Modal 云函数是 Recut 的**云端 GPU 自托管 App**：把开源 GPU 项目托管到 [modal.com](https://modal.com)，用用户自己的 Modal 账号（含每月免费额度）跑图片/视频生成，无需本机显卡，也不依赖任何平台代持的云服务。

## 何时使用

- 用户**本机没有 GPU**，但想跑开源图片/视频模型（内置：SD-Turbo 文生图/图生图、MiniMax-H3 文生视频（带原生音频）/首尾帧生视频）。
- 需要查看有哪些预设包/函数、是否已部署、权重是否就绪，或需要部署、下载权重、调用云端函数。
- **用户/Agent 想新建一个自己的 modalapp**（见「创建一个新 modalapp」）。

## 核心概念

- **modalapp（预设包）**：自包含目录（`manifest.json` + `modal_app.py` + `bootstrap.py`）。切换单位是预设包，不是模型。
- **两种来源**：
  - **内置（origin=builtin）**：随 App 包发布，在 `apps/modal-studio/modalapps/<id>/`，**只读**，来自 `python/registry.json`（由 `python/publish_registry.py` 生成）。
  - **用户（origin=user）**：用户在运行时创建，落在 **appstate** 目录 `<dataRoot>/appstate/recut.modal-studio/files/modalapps/<id>/`，**可写**，运行期动态发现。
- **Image（云端环境）**：`modal.deploy` 构建并缓存的 Modal Image；**Volume（云端权重）**由 `modal.install` 的 bootstrap 写入。
- **Function（函数）**：一个预设包可含多个函数（如文生图/图生图），每个函数一张表单；经 `Function.from_name(...).with_options(gpu=...).remote()` 调用——**无需 HTTP endpoint**。
- **本机薄客户端**：本机只做编排、上传参考、接收产物；真实计算与权重都在 modal.com。

## 操作顺序（务必按此收敛）

1. `modal.status` / `modal.catalog` / `modal.modalapp.list` 看预设包/函数、部署与 Volume 就绪度、连通性、来源与路径。
2. 首次使用：右上角「Modal 账号」面板设置 Modal token（profiles）与 HF token / 其他 Secret（`modal.profiles.add` / `modal.secret.set`，可用 `modal.secrets.list` 看哪些已声明/已设置）；`modal.prepare` 准备本机 venv。
3. `modal.deploy { modalapp }` **部署与权重合并**：先 `modal deploy` 构建 Image，成功后自动接着跑 bootstrap 下载权重（幂等/断点续传）；只补权重用 `modal.install { modalapp, source:"huggingface" }`（按预设包串行）。来源默认 Hugging Face。
4. `modal.generate { modalapp, function, params, referenceAssetIds?, gpuTier?, confirmCost: true }` 调用云端函数（单槽 FIFO）；占槽时返回 `taskId`（`job=null`）→ 用 `modal.tasks.list` / `recut.job.wait` 观察。
5. `modal.generation.complete { id }` 读取产物；`modal.save { id, kind }` 入库（不自动入库）。

## 创建一个新 modalapp（用户预设包）

> 用户预设包写在 **appstate** 里，App 重启/升级不丢；内置包不可改。用 `modal.modalapp.path` 拿到绝对路径后，可用**原生文件工具**直接编辑，或用 `modal.modalapp.save` 写入。

### 1) 拿路径 / 起骨架

- `modal.modalapp.path` → `{ userRoot, userModalappsRoot, builtinRoot }`（绝对路径）。用户包放在 `<userModalappsRoot>/<id>/`。
- `modal.modalapp.scaffold { id, name?, capability? }` → 生成一个**可端到端跑通**的最小骨架（返回一张 1x1 占位图，无需权重），作为起点。已存在时需 `overwrite:true`。
- 或直接 `modal.modalapp.save { id, manifest, modalAppPy, bootstrapPy }` 写入三个文件。

### 2) 三件套契约

```text
<userModalappsRoot>/<id>/
├── manifest.json   # id / name / capability / engine / weights / functions[]
├── modal_app.py    # 云端 Modal App：Image + Volume + @app.function(...)
└── bootstrap.py    # modal run 入口：把权重下载进 Volume（无权重可空实现）
```

**manifest.json 要点**（与内置完全同构）：

- `id`：`[a-z0-9][a-z0-9._-]*`，且**不可与内置 id 撞名**。
- `engine.appName`：云端 Modal App 名（如 `recut-my-app`），与 `modal_app.py` 里 `modal.App(...)` 一致。
- `engine.gpuTiers`：`{ default, options:[{id,gpu,label}] }`；`gpu` 直接传给 `with_options(gpu=...)`。
- `engine.volumes`：`[{name, mount, label}]`；第一个 volume 是权重卷，bootstrap 需在其根部写 `.recut-download-complete`。
- `engine.secrets`：可选，如 `recut-hf-token`（用 `modal.secret.set` 写入用户账号）。
- `weights`：`{ repoHuggingFace, repoModelScope, revision, sizeGb, files[] }`（供参考与文档；实际下载在 `bootstrap.py`）。
- `functions[]`：每项 `{ id, name, entrypoint, output:{kind,mimeType,ext}, formSchema[], defaultParams }`。
  - `entrypoint` 必须等于 `modal_app.py` 里的函数名；参数名与 `formSchema[].key` 一致。
  - `formSchema` 类型：`textarea|text|number|select|boolean|media`；`media` 字段经 `referenceAssetIds` 传入，函数收到 `refs=[{name,mimeType,data:bytes}]`。
  - `output.kind` ∈ `image|video|audio`，决定取回方式与预览。

### 3) 云端函数输出契约（`modal_app.py`）

- **小产物**：返回 `{ "kind":"bytes", "data": <bytes>, "mimeType": "...", "meta": {width,height,seed,...} }`。
- **大产物**：写入声明过的 `/out` 卷并返回 `{ "kind":"file", "volume":"<name>", "key":"runs/x.mp4", "mimeType":"video/mp4", "meta": {...} }`。
- `meta` 会被 runner 合并进 `<output>.meta.json`（宽高/时长/seed）。
- 错误：抛异常即失败；runner 落结构化错误。

### 4) 验证与运行（与内置同一套 op）

```text
modal.modalapp.save / scaffold        # 写入
modal.modalapp.get { id }             # 回读归一 manifest + 文件清单 + 路径
modal.catalog / modal.modalapp.list   # 应出现 origin=user 的新预设包
modal.deploy { modalapp: id }         # 构建镜像并部署函数
modal.install { modalapp: id, source }# 跑 bootstrap.py 把权重写进 Volume（无权重可跳过）
modal.generate { modalapp: id, function, params, confirmCost:true }
modal.save { id, kind }               # 入库
modal.modalapp.remove { id }          # 删除用户预设包（内置不可删）
```

> 改完 `manifest.json`/`modal_app.py` 后需重新 `modal.deploy` 才生效；改 `bootstrap.py` 后重新 `modal.install`。
>
> **代码变更检测**：`modal.deploy` 成功后把预设包目录 hash 记进 appstate；之后 `modal.status` / `modal.catalog` 的 `stale: true` 表示目录已变、需重新部署。界面常驻一个「重新部署」入口（deploy 自带 bootstrap，权重一并刷新），用户可手动更新。**但 `modal.generate` 不会自动重部署**，Agent 应在代码变更后（`stale` 为真时）主动补一次 `modal.deploy`。权重不做 hash 跟踪，`bootstrap.py` 自身跳过已下载文件。

## 成本纪律（重要）

- Modal 有免费额度但超了要花钱。**`modal.generate` 必须显式传 `confirmCost: true`**（默认开启成本确认门；`modal.settings.set { requireCostConfirm: false }` 可关闭）。
- 调用前用 `modal.catalog` 确认 `gpuTiers`；GPU 档位越高越贵。

## 平台集成（v1 有意边界）

- **v1 不接平台**：不写 `contributes.media`、不注册媒体 provider、不占默认生图/生视频路由。能力只经本 App 的 operation 暴露：UI 走 api、Agent 走 mcp、其他 App 走 `capability: true` 能力桥。
- 因此 `recut.media.list_capability_models` / 默认路由**不会**出现本 App；需显式调用 `modal.*`。

## 安全

- token 只存本机 App 私有状态（appstate `modal/profiles.json`，尽力 0600），只在 `modal_runner.py` 子进程内使用，绝不写入日志或素材元数据。
- 云端函数会执行 modalapp 代码（`modal deploy` 会构建并运行）；**只创建/使用可信的 modalapp**。

## 纪律

- 不要绕过 `modal.deploy` / `modal.install` 直接调用；未就绪时会排队或明确报错。
- 产物先私有，只有 `modal.save` 后才进入素材库。
- 失败要可操作：Modal 不可达/未部署/未装权重/超时各有明确错误与 hint。
