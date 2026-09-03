# recut/

> L2 | 父级: /apps/editor/README.md

成员清单
sdk.ts: 编辑器 iframe 与 Recut Host 的 API、事件、导航和 `focus.report` 桥；时间线完整选区只能补充 Host 签发的项目 Work Surface。
use-project-sync.ts: 订阅项目、组件与 AI 锁事件，优先以带文档的增量事件或 `timeline.delta` 应用变更，只有无法增量同步时才重载；rAF 合并事件、reload 期间保留最新事件，成功快照一次确认并避免回显事件造成刷新风暴，失败不自旋等待下一次外部事件。带 `library.tab=components` 的新组件发布事件聚焦组件库，其余变更不抢占用户标签。
use-cover-sync.ts: 同步项目封面相关的 Host 事件与编辑器状态；尊重用户手动封面（cover.get mode != auto 时停止自动首帧）。
components.ts: 只按 asset.list 的 active component 引用或已有时间线 componentId 同步 runtime 定义；组件 Tab 不参与 AI 组件加载；无宿主测试 seam（aiComponents）时以注入数据服务列表与 bundle 解析。
component-cover.ts: 仅在组件素材库实际挂载时，以完整 viewport 的隐藏 component-harness 验证版本并将 HTML-in-Canvas PNG 封面回传；后台不生成缩略图；无宿主测试 seam 时跳过。
ai-components.ts: 组件 asset 引用与 AI 组件元数据的前端契约；通过 asset.list 发现素材、component.source 读取源码、asset.archive 隐藏引用；对外暴露 getTestSeam 供同步/封面链感知无宿主测试注入。

组件的创建统一走一次异步 `component.create job -> 唯一 component.commit -> 轻量 verified -> 自动建立 type=component 引用 -> 返回 assetIds/components[].assetId -> 素材库（media）可见时可选 HTML-in-Canvas 封面`；已有组件调整或 Bug 修复统一是 `component.revise job -> 新 head -> 更新同一 asset 的 refVersionId`。组件源码、bundle、版本只有 components.js 一份；asset.archive 只隐藏引用，已有时间线仍可解析。AI 要放置组件时只把返回的 `assetId` 传给 `timeline.placeComponents`，后台再解析到 componentId。组件 Tab 只展示内置组件，项目组件必须经 active asset 引用进入素材库。Author job 用 `recut.job.status/wait/cancel/logs` 观察与控制，失败重试；`component.define` 只保留给受管提交入口。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
