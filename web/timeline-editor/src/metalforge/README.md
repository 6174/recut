# MetalForge 效果库（apps/editor/ui 内置组件）

复刻 [metalforge.xyz](https://metalforge.xyz/editor) 付费效果库的本地版本：首页分组浏览 + 详情页调参，预览直接使用效果自带的 WebGPU WGSL，参数面板按每个效果的真实 schema 渲染。

## 运行

```bash
cd apps/editor/ui
npx vite --port 5193
open http://localhost:5193/metalforge.html
```

要求浏览器支持 WebGPU（Chrome/Edge 113+、Safari 18+）。

## 结构

```
metalforge.html                 独立入口（vite 多页面之一）
src/metalforge/
  catalog.ts                    目录索引：schema + imports 索引 + 分组
  catalog/schema.json           64 个效果的完整参数 schema（types/options/presets/groups）
  catalog/wgsl/<id>.wgsl        每个效果的 WebGPU 预览着色器（来自官方 bundle）
  imports/                      付费导出的源码（ios/rn/web 三平台, 266 个文件）
  imports/index.json            每个效果导出文件清单
  generated/ProgressBar.tsx     官方 web 导出组件（自包含 React + WebGPU，双击可用）
  engine/layout.ts              uniform 布局与编码（size@0, time@8, params 按 WGSL 对齐）
  engine/preview.ts             WebGPU 预览引擎（按 kind 分发：fullscreen/mesh/particle）
  engine/mesh.ts                MeshSim CPU 网格解析 + 双 pass 渲染（mesh + post filter）
  engine/particle.ts            particle-field 实例化 quad 管线
  engine/thumbnails.ts          离屏单帧渲染 → PNG dataURL 缩略图（含 filter chips swatches）
  engine/wgsl-wrap.ts           WGSL wrapper（fullscreen / particle 两种包装）
  components/GalleryPage.tsx    首页：gradient/atmosphere/space/solid/motion/orbs 分组卡片
  components/DetailPage.tsx     详情：左预览（或代码）右参数
  components/ParamPanel.tsx     参数面板（按 effect.groups 分组）
  components/ParamControl.tsx   float 滑杆 / select 分段 / toggle / color / colors / float2
  components/ProgressComponentPreview.tsx  progress → 官方组件 props 桥接
```

## 数据来源

`/api/export`（付费账号）：`{ effectId, values, want: "bundle", platform, scope }` 返回
SwiftUI/MSL/RN/Web 源码。批量导出脚本在临时工作区 `batch_export.py`（cookie 已过期即需重新提供）。

WGSL 预览着色器与参数 schema 提取自官方前端 bundle（`catalog/wgsl/`、`catalog/schema.json`），
uniform 打包逻辑与官方 runner 一致（`mslArgOrder` 顺序、WGSL 隐式对齐）。

## 当前覆盖

- ✅ `metal` 52 个：详情页实时预览 + 首页静态缩略图（离屏单帧渲染）
- ✅ `progress`：双模式预览 —— 「着色器」（WGSL + pill 容器裁剪）与「组件」
  （官方导出 `generated/ProgressBar.tsx` 实时挂载，面板颜色/style/progress 即 props）
- ✅ `meshgradient` 2 个（abyss/mesh）：完整双 pass 管线（MeshSim 网格 + 15 种 post filter），
  Filter 选择器带每个滤镜的真实渲染缩略图（点击 chips 即时切换）
- ✅ `particle` 1 个（particle-field）：实例化 quad + additive blend，四 style 可切换
- ✅ 首页卡片：54+ 个效果的真实 WGSL 单帧渲染缩略图（WebGPU 离屏 → PNG dataURL，带缓存）
- ⏳ `cloth`/`sim`/`dust`/`discs`/`graph`/`fluid`/`mesh3d` 等 9 个：参数面板与代码导出可用，
  交互预览需 CPU 侧模拟器（verlet 布料、流体求解等），显示 swatch 占位
- ✅ 代码 tab：展示已导入的 ios/rn/web 源码，一键复制

## 验证

```bash
npx vite --port 5193 &
node scripts/mf-smoke.mjs   # 首页分组/卡片数、详情渲染、调参、代码加载、导航
node scripts/mf-smoke2.mjs  # 缩略图渲染数、abyss filter chips、blocks 切换、particle/cloth
```
