---
name: recut-design-system
appId: recut.platform
description: Recut 全局设计系统参考库：业务无关的抽象视觉风格定义，直接复用 Open Design（nexu-io/open-design）的包格式与内容。供任何视频创作 App（remotion-studio 等）的 Agent 按风格 ID 读取 DESIGN.md / tokens.css 作为视觉参考。先调用 recut.skills.reference 读取 design-systems/catalog.json 枚举，再按风格 id 读取单套包文件。
---

# Recut 全局设计系统（recut-design-system）

本 Skill 是 Recut 平台的**全局视觉参考**：一套业务无关的抽象设计风格定义，供任意视频 App 的 Agent 在写 composition 前选择风格并读取其视觉契约。**它不绑定 remotion，也不依赖任何具体 App，更不做视频适配——它就是设计风格本身。**

## 来源与包结构

本目录 `design-systems/<id>/` 直接复用 Open Design（nexu-io/open-design）的 153 套设计系统包，并裁剪为最小契约集（38M → 3.6M）：

```text
design-systems/<id>/
├── DESIGN.md        # 给 Agent 的设计散文（视觉主题、颜色角色、字体、间距、组件、动效）
├── tokens.css       # 语义 token 样式表（--bg / --fg / --accent / --font-* / --radius-* / --elev-*）
└── tailwind-v4.css  # 派生的 Tailwind v4 映射（tokens 的工具类视图）
```

Agent 以**风格 ID** 定位：用 `recut.skills.reference`（`appId: recut.platform`、`skillId: recut-design-system`）按相对路径读取包文件，如 `design-systems/<id>/DESIGN.md`、`design-systems/<id>/tokens.css`、`design-systems/<id>/tailwind-v4.css`。

## 使用方式

1. **枚举**：先 `recut.skills.reference` 读取 `design-systems/catalog.json`，看全部可用风格（id / name / origin）。
2. **选定**：按用户偏好与内容调性选一个风格 ID（如 `neobrutalism`、`glassmorphism`、`clean-editorial`）。
3. **读取**：`recut.skills.reference` 依次读取该风格 ID 的 DESIGN.md、tokens.css 与 tailwind-v4.css，拼出完整视觉契约。
4. **实施**：把 DESIGN.md 的颜色/字体/表面语言、tokens.css 的语义值**落进你正在创作的作品**（写进该 App 的 palette 内联样式或工具类），不手写无关的十六进制色值。

## 设计系统的边界

- 设计系统是**抽象的风格定义**：颜色、字体、间距、形状、表面语言、动效语气。它不规定任何视频镜头、时长或叙事——那些是场景（scenario）层的职责。
- 每个 App 的 `workflow.context.catalogs.designSystems` 只列出风格元数据；**完整视觉契约以本 Skill 为准**。
- 不要在套件里放任何 App 业务逻辑；渲染时的具体映射由各 App 自己决定。
