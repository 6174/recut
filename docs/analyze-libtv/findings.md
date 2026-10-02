# LibTV 制作画布反推：结构、流程与判断逻辑

> 分析对象：liblib.tv（LibTV）作品《阿猫阿雀》（`d6e06a451e9642efa7f92b2af7896f8f`，作者 大摸鱼家_Xr）。
> 复现方式见 [`README.md`](./README.md)：`fetch-project.mjs` + `analyze-snapshot.mjs`。
> 结论用于 [`rfc/2026-10-02-world-canvas-production-layer.md`](../../rfc/2026-10-02-world-canvas-production-layer.md)。

---

## 0. 一句话结论

> 那张看起来像复杂流程图的画布，**不是流程图，是「生成依赖图」**。
> **节点 = 一次生成任务**（带着"用的料 + 出的活 + 配方"）；**连线 = "这个活用了那份料"**。
> 一句话概括它的生产逻辑：**料 → 活 → 更好的料**。

---

## 1. 怎么判断的（方法论）

不能靠肉眼看图猜结构。做法是**把图背后的数据拿下来**验证：

1. 打开详情页 → 点「查看制作过程」→ 画布挂载（DOM 上出现 `.react-flow__viewport`，说明是 **React Flow**）。
2. 抓进入画布后的网络请求 → 发现数据来自
   `GET api.liblib.tv/api/community/project/template/detail?projectTemplateUuid=<uuid>`。
3. 其中 `data.detail.snapshotData` 是一个 JSON 字符串 → 解析后就是整张图 `{ nodes, edges, savedAt }`。
4. 对图做统计（`analyze-snapshot.mjs`），用数据回答"它是什么"。

**为什么这个方法可信**：我们看的不是"截图里的线"，而是**每条线的两端、每个节点的类型和参数**——这是作者真实操作留下的原始数据，不是视觉近似。

---

## 2. 图的规模与构成（实测）

| 维度 | 数值 |
| --- | --- |
| 节点 / 边 | **247 / 697** |
| 画布范围 | x 20–54192，y 66–52271（要缩到 10% 才看得全） |
| 节点类型 | image 124 · video 90 · audio 17 · text 2 · group 14 |
| 动作 | image_generate 100 · video_generate 90 · image_resource 23 · audio_generate 11 · audio_resource 6 · text_resource 2 · image_edit 1 |
| 分组框 | 14 个（"分组 N 个节点"） |
| 制作周期 | 单人，约 4 个月（2026-03 → 2026-08） |

### 2.1 为什么说它不是流程图

- 节点种类里**没有** start / end / condition / branch 之类；只有"出图/出视频/出音频/文本/分组"。
- 边的组合只有 5 种，全是"喂料"：

| 边 | 条数 | 含义 |
| --- | --- | --- |
| image → video | 428 | 图喂给视频（参考图/关键帧） |
| image → image | 201 | 图喂给图（参考图链） |
| audio → video | 55 | 音频喂给视频（声画同步） |
| video → image | 9 | 从视频回取帧 |
| audio → audio | 4 | 音频加工 |

**没有任何一条是"执行顺序"边。** 结论：连线表达的是**依赖/用料**，不是流程控制。

### 2.2 连线 = 用料（决定性证据）

每个节点的参数里存了一份"参考列表"（`imageListOrder` / `mixedListOrder` / `audioListOrder` …），存的是**上游节点 id 的数组**。把两者对一下：

- 参考列表里的引用共 **1193** 条，其中 **1171 条在图上都有对应连线**（吻合度 98%）。
- 有参考列表的节点 **192** 个，**平均 12.4 条参考**。

所以**画布上的连线就是这份"用料清单"的可视化**。这解释了为什么线那么多——做一段视频要参考一堆图。

### 2.3 提示词里的参考位

视频提示词里写着 `{{Mixed 1}}`、`{{Mixed 2}}` 这样的占位符，而节点同样存了 `mixedListOrder`。
**占位符 N 对应第 N 个参考**。全图 **94 个节点**使用了这种占位符。

> 这意味着：连线的本质是"prompt 里的那个参考位到了哪张图/哪条音频"。**线 = 参考槽的绑定**。

---

## 3. 每个节点的数据模型

一个节点（以视频为例）同时带着三样东西：

```jsonc
{
  "type": "video",
  "data": {
    "name": "视频节点 35 - 副本",
    // ① 出的活
    "url": ["https://.../xxx.mp4"],
    // ② 配方
    "action": "video_generate",
    "params": {
      "prompt": "在川渝老式居民小区夜晚...{{Mixed 1}}...",   // 最长 5014 字
      "model": "star-video2",
      "modeType": "mixed2video",                            // 图+音→视频
      "count": 1,
      "settings": { "ratio": "16:9", "resolution": "720p", "duration": 15, "enableSound": "on" },
      "cameraControl": { "camera": "panavision_dxl2", "lens": "cooke_sf_18x", "focal": "35mm", "aperture": "f/4" },
      // ③ 用的料（= 连线来源）
      "imageListOrder": ["i-hzgMPcFlb8", "i-OIYZFdr1eH", "..."],
      "mixedListOrder": ["i-...", "i-...", "a-...(音频)"]
    },
    // ④ 状态
    "isStale": false,
    "taskInfo": { "taskId": "...", "status": 2, "progressPercent": 100 }
  }
}
```

**关键理解**：配方的完整信息（提示词、模型、参数、参考）**都存在节点里**——所以任何一步都能"重跑"。

### 3.1 用到的模型 / 模式

| 环节 | 模型（次数） | 模式（次数） |
| --- | --- | --- |
| 出图 | doubao-seedream-5-0-pro (55)、nebula-ultra (42)、lib-image-2 (3)、nebula-2-flash (3)、mj-v8.1 (1) | image2image (75)、text2image (29) |
| 出视频 | star-video2 (84)、kling-v3-omni (6) | mixed2video (89)、frames2video (1) |
| 出音频 | seed-audio-1.0 (11) | text2audio (7)、audio2audio (4) |

**视频参数**：720p；时长 15s（74 个）为主，5–12s 少量；`enableSound` 开；**90 个视频里 64 个把音频一起喂进去**（声画同步）。

**提示词长度**：视频平均 **1861** 字（27–5014），图片平均 559 字，音频平均 841 字。
→ **每个视频节点的 prompt 其实是一份写好的分镜**（含时间码、镜头、走位、对白）。

---

## 4. 反推的生产流程

```text
① 写剧本 + 配音稿      （2 个 text 节点：逐句写声线/语速/情绪/时间码）
        │
        ▼
② 做角色设定集         （上传 + 文生图：每个角色的多视图"转面图"）
        │
        ▼
③ 生成关键帧           （图生图，带参考图链；平均 prompt 559 字）
        │
        ▼
④ 做配音 / 音效        （语音模型，text2audio / audio2audio）
        │
        ▼
⑤ 生成镜头（核心）     （图+音 → 视频 mixed2video；平均 prompt 1861 字；64/90 带音频）
        │
        ▼
⑥ 拆首尾帧             （从镜头截首帧/尾帧 → 再做下一镜衔接；节点名"首帧/尾帧/截图/裁剪"）
        │
        ▼
⑦ 剪成片               （最终成片 finalOutput 是一个 mp4，不在图里 —— 图外剪的）
```

**判断依据**：第 ⑥ 步的节点命名（`首帧` 1、`尾帧` 3、`截图` 6、`裁剪` 1）与 `frames2video` 模式；第 ⑦ 步来自 `meta.json` 的 `finalOutput`（一个 m4v），且全图**没有任何节点引用它**。

---

## 5. 它为什么成立（4 个值得学的机制）

| 机制 | 大白话 | 数据佐证 |
| --- | --- | --- |
| **产物即配方** | 每个节点都能"重跑"，做法全存着 | 每节点带 `prompt/model/settings/参考` |
| **连线表达"用料角色"** | 一根线不只"连上了"，而是"这张图在这当角色/场景/声线参考" | prompt 的 `{{Mixed N}}` + `mixedListOrder` |
| **改上游自动标脏下游** | 换了角色设定，用到它的镜头自动"过期" | 每节点有 `isStale` |
| **分组让图可读** | 90 个镜头按"场"打包成框 | 14 个 `分组 N 个节点` |

---

## 6. 它的代价（= 我们的机会）

| 代价 | 数据佐证 |
| --- | --- |
| **全靠人手工画** | 单人 4 个月摆出 247 节点 / 697 线 |
| **命名靠人** | 名前缀全是「图片节点 / 视频节点 / 音频节点」；**175 个节点带"副本"**（复制改名当版本管理） |
| **一致性靠肉眼** | 图里没有"这是主角色参考"的结构化声明，全靠人记得传哪张图 |
| **成片要另外剪** | `finalOutput` 不在图里 |
| **可读性差** | 要缩到 10% 才看全；还有 25 个离群节点 |

---

## 7. 对我们的启示（指向 RFC）

1. **建"生产层"**：在世界层（料）之上加"场 → 镜头 → 产物"的依赖图，连线 = 用料角色。
2. **不新建图库**：节点 ≈ 我们的"生成任务 + 媒体资产（配方在 `metadata.proposal`）"，连线 ≈ 我们的 `references[{id,kind,role}]`，分组 ≈ 场（scene）。**数据其实都已经有了，缺的是视图 + 规划 + 分组 + 失效传播。**
3. **由 Agent 派生，不让人手画**：他们的 697 条线是手工接线；我们让 Agent 从「世界 + 剧本」一次生成整张图（`plan` 零花费 → 人确认 → `apply` 提交），用 role 硬规则保证不漏主角色参考图。
4. **重跑 > 复制改名**：用 take/revision 取代"副本"，上游换料自动标脏、一键重跑。
5. **闭合成片**：就绪镜头直接接 remotion-studio 时间线，比他们多走"生产 → 成片"这一步。

详见 [`rfc/2026-10-02-world-canvas-production-layer.md`](../../rfc/2026-10-02-world-canvas-production-layer.md)。
