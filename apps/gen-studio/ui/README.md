# ui/

> L2 | 父级: ../README.md

生成工坊界面（React + TypeScript + Vite + Tailwind CSS v4）。

- `src/style.css`：Recut Design System 语义 token（深色画布、绿色主色、低圆角工具表面）。
- `src/ui.tsx`：共享视觉原子（Button / Card / Badge / Field / Input / Textarea / Progress / StatusDot）。
- `src/components/ui/select.tsx`：shadcn 风格 Select（Radix Select，替代原生 `<select>`）。
- `src/recut-sdk.ts`：宿主 MessageChannel 桥（`background.call` / `state.query`）与 `useRecutLocale`。
- `src/i18n.ts`：zh/en 字典 + `t` / `interpolate`。
- `src/App.tsx`：Left 两 Tab（生成 / 记录）+ Right 统一预览与进度日志的状态编排与轮询。
- `src/components/GenerateTab.tsx`：模型切换（shadcn Select）+ 未就绪时置于表单上方的核心依赖块（准备环境 / 下载模型 / 来源）+ 表单。
- `src/components/RecordsTab.tsx`：环境/下载/生成统一任务列表（只读历史）。
- `src/components/PreviewPane.tsx`：Right 的结果预览与实时日志。

```sh
npm install
npm run build   # 产出 ui/dist（运行时代码，随内置归档分发）
```

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
