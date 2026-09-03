# hooks/

> L2 | 父级: apps/editor/README.md

成员清单
use-committed-ref.ts: 将最新 React 值在 layout commit 后写入稳定 ref，供事件回调读取。
use-container-size.ts: 用 ResizeObserver 返回指定容器的实时宽高。
use-focus-lock.ts: 用受控样式层锁定画布交互并提供安全退出。
use-fullscreen.ts: 预览容器的 Fullscreen API 适配器；拒绝的浏览器策略不向界面抛出异常。
use-infinite-scroll.ts: 返回滚动容器 ref 与接近底部时的加载更多回调。
use-mobile.ts: 基于 768px 媒体查询公开稳定的移动端布尔值。
use-raf-loop.ts: 管理 requestAnimationFrame 生命周期并传递相邻帧间隔。
use-resize-observer.ts: 订阅元素尺寸变化并向调用方转交原生 entry。
use-shift-key.ts: 追踪 Shift 按键与窗口失焦状态，公开可变 ref。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
