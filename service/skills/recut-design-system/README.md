# recut-design-system/

> L2 | 父级: /service/README.md

Recut 平台的**全局设计系统参考库**：业务无关的抽象视觉风格定义，直接复用 Open Design（nexu-io/open-design）的 `design-systems/` 153 套包（manifest.json + DESIGN.md + tokens.css + 富包文件）。供任意视频创作 App 的 Agent 按风格 ID 读取视觉契约，**不做视频适配，也不绑定任何 App**。

成员清单
SKILL.md: 全局设计系统 Skill 正文；告诉 Agent 如何枚举、读取并实施一套设计系统。
design-systems/: Open Design 克隆的设计系统包（生成器在 recut 仓库 `scripts/design-systems/`）。

依赖边界
- App（如 remotion-studio）的 catalog 只消费本目录的 manifest 元数据（`gen-catalog.mjs`）；完整契约以本 skill 为准。
- 不在本 skill 放任何 App 业务逻辑或视频渲染适配。
- 更新：`scripts/design-systems/gen-design-systems.mjs` 从 spec 重新生成；或从 Open Design 上游重新克隆 `design-systems/`。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
