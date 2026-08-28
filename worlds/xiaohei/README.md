# 小黑怪诞正文配图（pgc.xiaohei）

平台内置 World 源格式目录。内容 vendored 自
[helloianneo/ian-xiaohei-illustrations](https://github.com/helloianneo/ian-xiaohei-illustrations)
（MIT License，sourceRevision `cbf5ee2`，见随附 `LICENSE`），按
[PGC Platform Worlds RFC](../../rfc/2026-08-28-pgc-platform-worlds.md)
一次性适配为 World 目录形态：

| 源 | 目标 |
| --- | --- |
| `SKILL.md`（核心定位 + 工作流 + 输出口径） | `world.md`（宿主无关化：图片生成 → 宿主工具/`recut.image.generate`，保存交付 → 素材库入库；新增「资源口径」章节） |
| `references/prompt-template.md` | 折叠进 `world.md`「生图提示词模板」 |
| `references/qa-checklist.md` | 折叠进 `world.md`「生成后检查」 |
| `references/composition-patterns.md` | 折叠进 `world.md`「结构类型与隐喻方法」 |
| `references/xiaohei-ip.md` | 实体 `character/xiaohei`（typed 字段 + `body` = 该文件） |
| `references/style-dna.md` | 实体 `style/style-dna`（typed 字段 + `body`）+ `rule-*` 规则实体 |
| `assets/examples/*.png`（14 张） | `examples/` → 证据（collection=风格示例，发布期镜像 CDN） |

`examples/` 中的 14 张示例图只存在于官方仓库与 CDN：manifest 仅携带 URL 清单，
daemon 同步不下载图片；图片在 UI 或 Agent 需要时经 CDN 按需加载，且仅作低频
视觉校准，不进入默认生成路径。
