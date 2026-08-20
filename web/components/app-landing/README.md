# app-landing/

> L2 | 父级: /web/components/README.md

成员清单

landing-primitives.tsx: 不含业务语义的步骤标签与指标原子。
audio-studio-landing.tsx: 基于 ASR 转写、SRT/ASS、声音角色与本地配音的声音工作流 Landing。
cover-studio-landing.tsx: 基于渠道尺寸、参考图、参考封面与系列画板的封面工作流 Landing。
depth-anything-landing.tsx: 基于 Small/Base/Large、图片/视频推理、伪彩/灰度与保存入库的深度工作流 Landing。
remotion-studio-landing.tsx: 基于 Brief、模板、workspace composition、Vite 预览与本地 MP4 渲染的代码视频 Landing。
vox-broll-landing.tsx: 基于立项、资料研究、创作方案、脚本/场景、B-roll 与确定性交付的 AI 短片 Landing。
index.ts: 唯一静态 appId → 独立 Landing 组件注册表，只负责分发。

设计边界

每个 App 的主体组件独立维护，禁止回退到“共享主题 + 文案分支”的伪差异化；修改真实 App 功能时，先复核对应 App 的 README、manifest、UI 与 operation 契约，再同步本目录。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
