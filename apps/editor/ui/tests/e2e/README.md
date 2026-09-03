# e2e/

> L2 | 父级: [编辑器架构](../../../README.md)

Playwright Chromium 回归套件；所有浏览器由 `playwright.config.ts` 统一启用 CanvasDrawElement，验证预览与 HTML-in-Canvas 的真实像素结果。

成员清单

ai-component.spec.ts: AI 临时组件从构建、注册到 WebGL 像素的渲染链路；验证内置 HTML/React 组件可生成非透明 PNG 封面、内置 3D 组件实际出图，并覆盖生产 WorldScene 注入 Motion Program 后的 Three transform 时间求值与画面位移。
ai-component.spec.ts: 同时覆盖 React HTML-in-Canvas 文本的 grapheme segment MotionProgram 接入。
audio-library.spec.ts: 音频库目录、分类溢出菜单与音效下载插入时间线（依赖本机 Recut 服务，离线环境会超时）。
bounds-geometry.spec.ts: 元素边界与选择几何一致性。
click-select.spec.ts: 预览点击选择与命中行为。
drag-sync.spec.ts: 拖动后的时间线与预览同步。
effects-preview.spec.ts: 特效预览回归：对话框预览 27 个特效必须出图（底图案例 + 特效），时间线添加（案例内容铺满、移除 2s 源视频制造静态场景）后预览像素变化超过逐特效校准阈值。
fonts/font-panel.spec.ts: 字体系统：/v1/fonts 目录（含 CJK）、Google 字体经本服务 CSS 加载并注册、中文渲染非 tofu、本机系统字体枚举。全部走 installFontAPIMock 的本地 woff2 fixture（hermetic）。
frame-render.spec.ts: preview.frame 帧渲染链路。
helpers.ts: Chromium 启动、CanvasDrawElement 断言、测试桥接工具与字体 API mock / 字体注册断言。
motion-runtime-harness.spec.ts: 独立动画 runtime 夹具；同一 MotionRuntime seek 同时驱动 HTML-in-CANVAS DOM、Three Object3D 与 Shader uniform，并验证往返 seek 的状态/像素稳定性。
motion-presets-ui.spec.ts: 真实选择时间线元素后，从 Animation 面板应用/清除预设并断言项目绑定数据；同一 Loop Glitch Burst 覆盖 Glow Box 与 Canvas Text，逐帧读取元素材质 uniforms 和画布像素，确认不是全局 effect.glitch。
keyframe-drag.spec.ts: 关键帧与参数拖动的写入和求值。
real-project-card.spec.ts: 真实项目 HTML 组件在 iframe 内 seek 往返后的像素稳定性。
recut-sync.spec.ts: Recut 项目文档、AI 锁与新组件发布后的组件库聚焦同步。
text-background.spec.ts: 文字背景渲染，以及单项文本资源卡片不撑满面板的布局回归。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
