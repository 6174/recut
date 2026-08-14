# rfc/

> L2 | 父级: /README.md

成员清单
2026-08-12-creation-worlds.md: Creation Worlds 顶级工作台、创作上下文绑定、版本化 Canon、跨 App / MCP 契约与 Remotion MVP 的实施 RFC。
2026-08-12-creation-worlds-technical-design.md: Creation Worlds 的 workspace SQLite、Go service facade、SDK/MCP、权限、Web/Remotion 接入、迁移与测试的技术实施 RFC。
2026-08-13-visual-runtime-component-system.md: Recut Visual Runtime 与 Component System：世界（场景图）+ 时间线创作表面、R3F 全权渲染、组件即代码对象、材质混合与排序规则、Preview/Export 统一与分阶段实施路线。
2026-08-14-editor-data-model-selection.md: 编辑器数据模型（DocumentData + EditorState + Ephemeral Layer + NodeState）与选区/元素定位架构：单一解析入口、实时渲染几何 bbox、Model API（含关键帧提交策略）、渲染路径收缩与 Chromium 自测方案。
2026-08-14-realtime-channel-ws.md: 平台实时通道的单 WS 收敛：一条长连接 + channels 订阅 + 心跳保活 + REST 首屏取数 + 单后台账本转发，以及 iframe App 的宿主桥/直连 WS 双链路传输抽象。

此目录保存尚未实施或分阶段实施的平台设计决策。RFC 定义目标、边界、数据与接口契约；获批实现后，代码与运行时文档必须反向更新以保持一致。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
