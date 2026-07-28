# web/app/

> L2 | 父级: /web/README.md

成员清单
layout.tsx: 工作台 HTML 外壳与全局元数据。
page.tsx: 固定桌面双栏本地工作台；Project/Apps 是首页核心 tab，前者创建/继续项目，后者校验安装 GitHub App、显示 Git 工作树/更新状态并执行安全升级；本地 service 缺失时显示 curl 安装入口，版本过低时可调用本机 daemon 的自更新 API，并为失败提供 Codex/Claude Code 诊断引导。
media/: 平台级素材库系统应用；左侧按类型管理跨项目媒体资产，可主动批量上传图片、视频或音频，提交创建后由单条 Recut Asset SSE 原位呈现，活跃 Asset 显示实时用时、终态显示持久化耗时；以紧凑下拉框选择已连接 Provider 模型、在独立缩略图选择弹框中按需添加参考图，并引导添加缺失 Provider；右侧复用标准 Agent 会话，Provider 和用途模型仍在全局设置中管理。
projects/[id]/page.tsx: 项目详情的服务端路由壳；只导出静态站需要的占位参数并挂载客户端容器，不能使用浏览器 API，避免客户端组件导出 `generateStaticParams`。
projects/[id]/project-detail-client.tsx: 固定桌面项目详情客户端容器；从真实路径（兼容旧查询串）读取项目 ID，Header 展示当前加载的 App 版本与项目身份，左侧全高 iframe 承载 App UI，右侧为独立滚动且可拖拽调宽、持久化宽度的 Agent 对话栏，并转发项目事件与 iframe 请求；App API 的结构化失败原因必须透传到 iframe。
globals.css: 工作台的全局设计 token：白色画布、黑色内容、明亮品牌绿操作，以及状态色、圆角、阴影与基础排版。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
