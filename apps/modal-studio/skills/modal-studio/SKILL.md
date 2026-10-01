# Modal 云函数（Modal Functions）Skill

Modal 云函数是 Recut 的**云端 GPU 自托管 App**：把开源 GPU 项目托管到 [modal.com](https://modal.com)，用用户自己的 Modal 账号（含每月免费额度）跑图片/视频生成，无需本机显卡，也不依赖任何平台代持的云服务。

## 何时使用

- 用户**本机没有 GPU**，但想跑开源图片/视频模型（内置：SD-Turbo 文生图/图生图、Qwen-Image-2.1 图像编辑/文生图（原生 2K，默认档 A100-80GB）、MiniMax-H3 文生视频（带原生音频）/首尾帧生视频/**参考生视频（图像/视频/音频多模态参考）**）。
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
4. `modal.generate { modalapp, function, params, referenceAssetIds?, gpuTier?, confirmCost: true }` 调用云端函数（**按预设包单槽、跨预设包并行**，上限可经该包 `engine.concurrency` 调大）。**params 只需传 `prompt`（与参考素材）**：其余字段会走用户在 App 内配置的「AI 默认参数」、再回落到函数默认，无需自己填。占槽时返回 `taskId`（`job=null`）→ 用 `modal.tasks.list` / `recut.job.wait` 观察。
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
- `expose`（可选）：`{ model, function }` 把该预设包注册为一个平台模型 `modal-cloud/<model>`；`model` 只能含 `a-z0-9-_`（不能含 `.`），`function` 缺省取 `functions[0]`。不加则不上平台。
- 参考图：平台在 `ctx.media.materialize` 时**统一**把图片等比缩到单边上限 1024、去 alpha 压成 JPEG——全局口径，预设包无需声明；确实要原图的渲染类消费方传 `{ raw: true }`。
- `engine.appName`：云端 Modal App 名（如 `recut-my-app`），与 `modal_app.py` 里 `modal.App(...)` 一致。
- `engine.gpuTiers`：`{ default, options:[{id,gpu,label}] }`；`gpu` 直接传给 `with_options(gpu=...)`。
- `engine.volumes`：`[{name, mount, label}]`；第一个 volume 是权重卷，bootstrap 需在其根部写 `.recut-download-complete`。
- `engine.secrets`：可选，如 `recut-hf-token`（用 `modal.secret.set` 写入用户账号）。
- `weights`：`{ repoHuggingFace, repoModelScope, revision, sizeGb, files[] }`（供参考与文档；实际下载在 `bootstrap.py`）。
- `functions[]`：每项 `{ id, name, entrypoint, output:{kind,mimeType,ext}, formSchema[], defaultParams }`。
  - `entrypoint` 必须等于 `modal_app.py` 里的函数名；参数名与 `formSchema[].key` 一致。
  - `formSchema` 类型：`textarea|text|number|select|boolean|media`（`label`/`placeholder`/`hint` 均为双语对象，用于把字段语义写在字段旁）；`media` 字段经 `referenceAssetIds` 传入，函数收到 `refs=[{name,mimeType,data:bytes}]`；`number` 字段可加 `randomizable: true`，App 表单会为它渲染一个「随机」按钮（点击在 `min`–`max` 区间内填入一个整数，缺省 0..2³¹-1）。
  - **`aspectRatio` / `resolution`**：`aspectRatio` 是输出画幅，`resolution` 是**输出最长边（最大边）像素**（短边按画幅推导，**只下调不超分**，不小于该画幅原生最长边时保持原生尺寸：H3 原生 768p，16:9 即 1366×768、表单默认 1536；Qwen-Image-2.1 原生 2K（原生长边 2048–2752，表单默认 2752＝原生）；SD-Turbo 原生 512）。以最长边为准而不是短边，宽画幅（如 21:9）不会把另一边撑大到爆显存。文生图、文生视频，以及**视频的首尾帧生视频 / 参考生视频**都有这两个字段——首尾帧生视频的 `aspectRatio` 留空＝跟随首/尾帧（`auto`），参考生视频默认 16:9（参考素材只作语义参考、不继承其尺寸）。**图像编辑 / 图生图默认跟随参考图尺寸**——`aspectRatio` 留空即跟随，显式给定后按「画幅 + 分辨率」出图（Qwen-Image-2.1 的 `edit_image` 已支持）。Agent 调 `recut.video.generate` 时把 `aspectRatio` / `durationSec` 传在**顶层字段**即可：平台按模型声明把它们折进 `output` 下发到 App（未声明的模型不接收）。合法取值从 `modal.catalog` 的 `formSchema[].options` 取。
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

> 改完 `modal_app.py`（或它部署进容器的模块，如 `h3_contract.py`）后需重新 `modal.deploy` 才生效；改 `bootstrap.py` 后重新 `modal.install`。
>
> **代码变更检测（两层忽略名单）**：`modal.deploy` 成功后把预设包目录 hash 记进 appstate；之后 `modal.status` / `modal.catalog` 的 `stale: true` 表示目录已变、需重新部署。目录 hash **排除**不进部署的文件，名单分两层：① **通用名单** `modalapps/deploy-ignore.json`（随 App 发布，内置/用户预设包共享，覆盖文档与生成物 `manifest.json`/`*.md`/`index.json`、本地 `mock*.py`/`bench*.py`、运行产物 `*.log`/`output/`/`samples/`、开发测试目录 `test*/`/`*.ipynb`/`.venv/`/`node_modules/` 等，`xxx/` 形式按目录名匹配）；② **预设包自带**：在 manifest 里用 `deployIgnore: ["<glob>", ...]` 追加自己的规则，叠加在通用名单之上。因此改 manifest/文档/mock 不会误报「待部署」，个别预设包的噪声文件也不用改通用名单。界面常驻一个「重新部署」入口（deploy 自带 bootstrap，权重一并刷新），用户可手动更新。**但 `modal.generate` 不会自动重部署**，Agent 应在参与部署的代码变更后（`stale` 为真时）主动补一次 `modal.deploy`。权重不做 hash 跟踪，`bootstrap.py` 自身跳过已下载文件。

## 成本纪律（重要）

- Modal 有免费额度但超了要花钱。**`modal.generate` 必须显式传 `confirmCost: true`**（默认开启成本确认门；`modal.settings.set { requireCostConfirm: false }` 可关闭）。
- 调用前用 `modal.catalog` 确认 `gpuTiers`；GPU 档位越高越贵。`gpuTier` 不传时按「该函数 AI 默认 GPU > 全局默认 > 预设包默认」取，且候选必须落在该预设包的 `options` 内（否则回落到首个选项），所以不需要自己兜底。

## 平台集成（已接入）

- 本 App 在 manifest `contributes.media` 声明 provider `modal-cloud`（`protocol:"local"`）；**每个声明 `expose: { model, function }` 的 modalapp 注册为一个平台模型 `modal-cloud/<model>`**（图片与视频都注册）。内置的 MiniMax-H3 与 Qwen-Image 都把 **`expose.function` 指向「可锚定参考」的函数**（参考生视频 / 图像编辑），并在函数上声明 `referenceFields`/`referenceBudgets`——平台据此把模型识别为参考型并校验参考数量上限；`inputModes` 由 media 字段类型汇总（image/video/audio）。函数的 `formSchema` 非 media 字段同时进入平台模型 `parameters`（`prompt` 除外——它是平台一等输入），平台据此折叠一等字段（把顶层 `aspectRatio` 折进 `output`）并渲染参数控件，但**输出参数仍由 App 校验**（平台标记 `PassthroughParams`，不复核、不注入默认）。参考图由平台统一归一：`ctx.media.materialize(id)` 默认把图片等比缩到单边上限 1024、去 alpha 压成 JPEG（全局口径，无需声明；确实要原图传 `{ raw: true }`）——参考图只做参考，不喂原图。
- 平台「生图/生视频默认路由」可指向 `modal-cloud/<model>`；生成经通用执行桥组装 `{ model, prompt, params, referenceAssetIds }` 调 `modal.generate`（`resolveTarget` 按 `expose.model` 解析 modalapp + `expose.function`），终态经 `modal.task.get` 观察，产物 `modal.save` 入库。
- **参考可选，无参考自动回退文生**：平台路由不带 `referenceAssetIds` 时，`resolveTarget` 会把 `expose.function`（参考型）自动换成同输出类型的纯文生函数（`text-to-*`）；带参考才走参考函数。回退的**触发条件是参考函数声明了 `minReferences >= 1`**（与 MiniMax 的 `reference-to-video`/`first-last-frame`、Qwen-Image-2.1 的 `image-edit` 一致，缺省 0 则永不回退）。注意区分两层「下限」：函数级 `minReferences: 1` 是**参考函数的正常声明**（回退依据）；而平台模型的 `referenceBudgets` 只声明**上限**，不能声明 `images>=1` 这类下限（否则平台在提交前就拒绝纯文本请求，回退走不到）。
- **就绪是动态的**：`modal.catalog.models[]` 上报 `ready`，**只有 `deployed && volumeReady` 才为真**；未就绪时平台路由提交给出引导错误（先部署/下权重）。
- 因此 `recut.media.list_capability_models` 会列出本 App 与其模型就绪度；平台路由与显式 `modal.*` 调用两条路径都可用。
- **成本门**：经平台路由（`model` 入参）跳过 App 的 `confirmCost` 门（视频由平台 proposal 门兜底）；直接 `modal.generate` 仍须 `confirmCost: true`。

## 安全

- token 只存本机 App 私有状态（appstate `modal/profiles.json`，尽力 0600），只在 `modal_runner.py` 子进程内使用，绝不写入日志或素材元数据。
- 云端函数会执行 modalapp 代码（`modal deploy` 会构建并运行）；**只创建/使用可信的 modalapp**。

## 纪律

- 不要绕过 `modal.deploy` / `modal.install` 直接调用；未就绪时会排队或明确报错。
- 产物先私有，只有 `modal.save` 后才进入素材库。
- 失败要可操作：Modal 不可达/未部署/未装权重/超时各有明确错误与 hint。
