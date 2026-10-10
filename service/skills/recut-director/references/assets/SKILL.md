---
name: assets
appId: recut.platform
description: 决定「生成要用的参考锚点怎么备齐」——角色卡/场景图/道具图/色卡/声线；排产与生成的前置，缺一不提交。
---

# Recut 参考资产开发技能（references/assets）

本技能只回答一个决策问题：**生成要用的参考锚点怎么备齐？** 它是 `references/plan`（排产）与 `references/generation-prompt`（写提示词）的**前置**：没有锚点就排产 = 纯文本直出，主角色会漂、场景/风格会串。

## 为什么必须做

真实制作的实测规律：**先把锚点备齐，再生成**。反过来（边生成边找参考）是 AI 短片一致性崩掉最常见的原因。这与全局铁律一致：画面出现主角色就必须带 `role="character"` 参考图；角色说话就必须带 `role="voice"` 声线参考。

## 要备哪些锚点

| 锚点 | 产物 | 生成 role | 写回字段（locked media） | 何时必须有 |
|---|---|---|---|---|
| **角色卡** | 该角色的多视图/表情/服装（图） | `character` | `character_reference` | 画面出现该角色的任何镜头 |
| **场景卡** | 场景的建立镜/多机位/氛围（图） | `environment` | `location_reference` | 该场戏的所有镜头 |
| **道具卡** | 关键道具的多角度/细节（图） | `prop` | `prop_reference` | 反复出现或承担关键动作的道具所在镜头 |
| **色卡** | 整段色调/材质参考（图） | `color-card` | 按需 media 属性 | 需要锁色调时 |
| **风格锚点** | 世界视觉语言（图） | `style-ref` | 世界风格 / 按需 media 属性 | 有风格实体/示例图时按需 |
| **声线参考** | 角色的参考音（音） | `voice` | `voice_reference`（角色） | 该角色有台词/旁白时 |

> **分镜表不是生成锚点**（2026-10-04）：storyboard 只作排产/人工预览，不提交给视频模型。生成依赖 = 资产（角色/场景/道具/声线）+ `script`（脚本里该视频段的拍摄设计）。

## 从哪来（优先级）

1. **世界已有** → 直接引用（`recut.worlds.entities.get` 的实体 media 字段：核心锚点取 `character_reference` / `location_reference` / `prop_reference`，声线取 `voice_reference`）。**先读，别再造一份。**
2. **世界没有** → 生成候选交用户挑选 → 采纳后写回实体的**语义卡字段**（`recut.worlds.entity` op=`update` + `attrPatch`，key 用 `character_reference` / `location_reference` / `prop_reference`；或画布落"节点 + 属性边"，label 与字段一致）。**不要写进普通的装饰 attr**——那只是可删可改名的动态属性，不声明 role。
3. **用户给了素材** → 登记入库（`recut.media.import`）→ 挂到对应实体的语义卡字段。

## 纪律

- **一物一锚点，不堆料**：只为"本片真的会出现的角色/场景/道具"备锚点；不给"可能有用"的参考。
- **锚点要有身份**：写回**实体**的语义卡字段（角色挂 `character_reference`、场景挂 `location_reference`、道具挂 `prop_reference`），不是散在画布上的游离图、也不是装饰用的普通 attr——这样它的 role 才由字段直接声明（`character_reference`→`character`、`location_reference`→`environment`、`prop_reference`→`prop`），不再靠 label 推断。
- **采纳才写下**：候选图先给用户挑，采纳后再写回；不把"生成的候选"当既定锚点。
- **锚点变了要重跑下游**：换角色卡/风格 → 用到它的镜头失效重跑（见 `references/qc`）。

## 使用时机

`references/plan` 的前置（排产前发现缺锚点）、或用户说"给这个角色做套设定图/让场景一致"时加载。
