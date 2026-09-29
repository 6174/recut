# ui/

> L2 | 父级: ../README.md

ComfyUI 工作台界面（React + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui）。

- `components.json`：shadcn/ui 配置（radix-mira 风格、Tailwind v4、`@/` 别名）；`vite.config.ts` / `tsconfig.json` 同步 `@ -> src` 别名。
- `src/style.css`：Recut Design System 语义 token（深色画布、绿色主色、低圆角工具表面）；页面直接消费 `--background` / `--card` 等平台 token，不引入装饰性渐变或光晕。
- `src/components/ui/`：shadcn/ui 原件（`button` / `badge` / `card` / `input` / `textarea` / `label` / `separator` / `tabs` / `select` / `progress` / `dialog`）；业务组件统一从这里取 UI 原子，不再自造视觉件。
- `src/recut-sdk.ts`：宿主 MessageChannel 桥（`background.call` / `state.query` / `media.pick` / `media.preview`）与 `useRecutLocale`。
- `src/lib/utils.ts`：`cn`（clsx + tailwind-merge），供 shadcn 原件合并类名。
- `src/lib/media.ts`：媒体地址边界（素材内容路径 / 绝对地址），供缩略图与全屏预览共用。
- `src/i18n.ts`：zh/en 字典 + `t` / `interpolate`。
- `src/App.tsx`：紧凑头部 + shadcn `Tabs`（生成 / 记录）与 `Card` 面板框架的状态编排与轮询。
- `src/state/generate.ts`：生成表单的 zustand store（appId / 字段值 / 参考图 / 下载源），persist 到 localStorage，刷新与切 Tab 后恢复。
- `src/components/WorkflowTab.tsx`：工作流切换（shadcn Select）+ 未就绪时置于表单上方的核心依赖块（准备环境 / 下载模型 / 来源）+ 按 `formSchema` 渲染的通用表单（shadcn Label/Input/Textarea/Select，含 `media` 参考图，订阅 `useGenerateStore`）。
- `src/components/RecordsTab.tsx`：环境/下载/生成统一任务列表（只读历史）。
- `src/components/EngineControl.tsx`：顶栏引擎状态入口（点击打开引擎面板）。
- `src/components/EngineDialog.tsx`：引擎管理模态框（shadcn Dialog；实时状态与端口/PID、启动/关闭的进行中与失败反馈、`server.log` 实时日志；打开期间每 2s 轮询 `comfy.engine.logs`）。
- `src/components/PreviewPane.tsx`：Right 的结果预览与实时日志。

```sh
npm install
npm run build   # 产出 ui/dist（运行时代码，随内置归档分发）
```

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
