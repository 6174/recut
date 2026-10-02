# docs/analyze-libtv/

> L3 | 父级: /docs

分析 **liblib.tv（LibTV）真实 AI 影视作品的「制作过程」画布**，反推它的制作流程与数据结构，用来指导我们的 World Canvas 迭代（见 [`rfc/2026-10-02-world-canvas-production-layer.md`](../../rfc/2026-10-02-world-canvas-production-layer.md)）。

这里把一次性的人工分析沉淀成**可复现的工具**：下次拿到任何一个 LibTV 作品，三条命令就能得到同样的结论。

---

## 为什么这么做（判断逻辑）

LibTV 的「查看制作过程」是一张无限大的节点图，看起来像复杂流程图。但**第一眼看不懂它到底是不是流程图**——所以不能靠肉眼猜，要把它背后的数据拿下来验证。

关键发现的一句话：

> 节点只有 `image / video / audio / text / group` 五种，**没有任何"开始/判断/分支"节点**；连线里 `图→视频` 占最多。
> 所以它 **不是流程图，是"生成依赖图"**：**节点 = 一次生成（带料 + 活 + 配方），连线 = "这个活用了那份料"**。

这条判断是怎么被证明的，见 [`findings.md`](./findings.md) 与脚本产出的 `report.md`。

---

## 三步工作流

```bash
# ① 取图：从接口把整张制作图拉下来（不需要浏览器）
node docs/analyze-libtv/scripts/fetch-project.mjs <detailUrl 或 uuid>
#   → output/analyze-libtv/<uuid>/  { template.json, snapshot.json, meta.json }

# ② 分析：把图翻译成结论（人在环，不需要浏览器）
node docs/analyze-libtv/scripts/analyze-snapshot.mjs --in output/analyze-libtv/<uuid>
#   → 同目录 { report.md, report.json }

# ③ 看画面：需要截图 / 接口清单 / 画布 DOM 时（需要 playwright）
node docs/analyze-libtv/scripts/browser-probe.mjs <detailUrl> --select
#   → output/analyze-libtv/<uuid>/  { detail.png, canvas.png, canvas-selected.png, api.json, canvas-dom.json, canvas-text.txt }
```

**绝大多数结论只用 ① + ②**（无头、无需浏览器）；③ 只在要看卡片长什么样、要抓接口时用。

### 换个作品

把上面命令里的 URL 换成任意作品详情页地址即可，输出目录按 uuid 自动分。例：

```bash
node docs/analyze-libtv/scripts/fetch-project.mjs https://www.liblib.tv/detail/<uuid>
```

---

## 脚本清单

| 脚本 | 作用 | 需要浏览器 | 主要产物 |
| --- | --- | --- | --- |
| `scripts/lib/env.mjs` | 公共工具：路径常量、CLI 解析、uuid 提取、playwright 定位、计数 | 否 | — |
| `scripts/fetch-project.mjs` | 调 `api.liblib.tv` 的 `template/detail` 接口，取 `snapshotData` 并解析 | 否 | `template.json` / `snapshot.json` / `meta.json` |
| `scripts/analyze-snapshot.mjs` | 分析节点/边构成、模型与模式、参数、分组、用料绑定、失效标记、命名、提示词、空间布局 | 否 | `report.md` / `report.json` |
| `scripts/browser-probe.mjs` | 打开详情页 → 点「查看制作过程」→ 截图 + 抓 XHR + 盘点画布 DOM | 是 | 多张 png + `api.json` + `canvas-dom.json` |

### fetch-project.mjs 参数

| 参数 | 说明 |
| --- | --- |
| `<detailUrl\|uuid>` | 位置参数：作品详情页 URL 或 32 位 uuid |
| `--out <dir>` | 自定义输出目录（默认 `output/analyze-libtv/<uuid>`） |

### analyze-snapshot.mjs 参数

| 参数 | 说明 |
| --- | --- |
| `--in <dir>` | 含 `snapshot.json` 的目录（`fetch-project` 的产物） |
| `--snapshot <file>` | 直接指定 snapshot.json |
| `--out <dir>` | 报告输出目录（默认与输入同目录） |

### browser-probe.mjs 参数

| 参数 | 说明 |
| --- | --- |
| `<detailUrl>` | 作品详情页 URL |
| `--out <dir>` | 输出目录 |
| `--headed` | 显示浏览器窗口（默认无头） |
| `--full` | 整页截图（默认视口内截图） |
| `--click "查看制作过程"` | 进入制作画布的按钮文案（默认「查看制作过程」） |
| `--viewport 1600x1000` | 视口尺寸 |
| `--focus "x,y,scale"` | 把画布视口定位到某坐标/缩放（看某个节点长什么样） |
| `--select` | 点选一个屏上节点，截图并 dump 文本 |
| `--wait 6000` | 打开详情页后的等待毫秒 |

---

## 产物说明（`output/analyze-libtv/<uuid>/`）

> `output/` 已在 `.gitignore`，产物不会进 git。

| 文件 | 内容 |
| --- | --- |
| `meta.json` | 作品元信息：名称、作者、标签、成品视频 URL、节点/边数、播放与查看制作次数 |
| `template.json` | 接口 `data.detail` 原始返回（含 `snapshotData` 字符串） |
| `snapshot.json` | 解析后的节点图（React Flow 格式） |
| `report.md` / `report.json` | `analyze-snapshot` 的结构化结论 |
| `detail.png` / `canvas.png` / `canvas-selected.png` | 详情页 / 制作画布 / 选中节点的截图 |
| `api.json` | 进入画布后的 XHR/fetch 清单（用来发现数据来源接口） |
| `canvas-dom.json` | 画布 DOM 盘点：react-flow 类名统计、节点列表、屏上节点、视口 transform |
| `canvas-text.txt` / `console.log` | 画布可见文本 / 浏览器控制台日志 |

---

## 依赖与前置

- **① ②**：只需 Node ≥ 18（用全局 `fetch`）。无需任何依赖。
- **③**：需要 playwright。脚本会自动去 `web/node_modules/playwright` 找；找不到时：
  ```bash
  cd web && pnpm i          # 安装（含 playwright）
  # 或指定：export RECUT_PLAYWRIGHT=/path/to/web/node_modules/playwright/index.js
  ```
  若浏览器二进制缺失：`cd web && npx playwright install chromium`。

---

## 数据来源（它是怎么被取到的）

- 详情页：`https://www.liblib.tv/detail/<uuid>`
- 数据接口：`GET https://api.liblib.tv/api/community/project/template/detail?projectTemplateUuid=<uuid>&withRecommendList=true`
  - 真正有用的是 `data.detail.snapshotData` —— 一个 JSON 字符串，解析后即 `{ nodes, edges, savedAt }`。
  - 画布本身是 **React Flow**（DOM 上可见 `.react-flow__viewport` / `.react-flow__node-<type>`）。

---

## 如何扩展（下次继续分析）

- **想加一条统计**：改 `scripts/analyze-snapshot.mjs` 的 `report` 对象 + `L.push(...)` 段落即可，`report.json` 会同步产出结构化数据。
- **想分析别的站点**：复制本目录为 `docs/analyze-<site>/`，替换 `apiUrl()`（`lib/env.mjs`）与 `browser-probe.mjs` 的进入按钮文案。
- **想横向对比多个作品**：对每个 uuid 跑 ① + ②，然后读各 `report.json` 聚合（节点数、模型分布、提示词长度、副本比例）。

---

## 已知注意点

- `snapshotData` 可能很大（本例约 1MB），接口返回体也大；脚本对 body 截断到 300KB 保存（分析用的是 `snapshot.json`，未截断）。
- 画布视口是 React Flow 内部状态，脚本 `--focus` 是直接改 `.react-flow__viewport` 的 transform（够用于截图，不代表应用真实状态）。
- LibTV 可能有反爬 / 登录态变化；接口是公开只读的，但若失败先重跑或换 `--headed` 观察。
