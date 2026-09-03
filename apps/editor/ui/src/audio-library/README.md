# audio-library/

> L2 | 父级: apps/editor/README.md

成员清单
audio-library-store.ts: 音乐/音效分类、搜索词与下载状态的单一状态源，并归一化条目筛选标签。
cache.ts: OPFS 音频缓存的读写与 Object URL 创建。
catalog.ts: CDN 优先、本地回退的音频 catalog 加载器。
download.ts: 音频下载、缓存和插入时间线的业务流程。
restore.ts: 启动时恢复已缓存的音频下载记录。
types.ts: catalog 与音频条目的共享类型契约。
components/audio-library-view.tsx: 音频库面板；剪映风格卡片网格（封面主按钮下载/播放、两行标题、许可·时长单行、右下添加按钮），加载期用同网格骨架卡占位，网格滚动条独立槽位不贴卡片。

音效筛选使用与素材顶层导航相同的原则：单行显示可容纳的分类，双箭头菜单容纳其余分类；当前选中的隐藏分类优先留在主行，避免筛选状态失去上下文。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
