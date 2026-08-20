/*
 * [INPUT]: 依赖 AppDemoLayout 类型；纯展示，不连接 service、不读取用户项目，也不存在任何加载态
 * [OUTPUT]: 对外提供 AppDemoSchematic——集合场景（App Store / 应用市场列表）下替代纯文字的「App 快速示意」：按 layout 画出一个静态但可辨认的精简界面（侧栏 + 预览 + 时间线，或主画布 + 控制面板），用静止的界面块表达 App 长什么样，而非占位/加载骨架
 * [POS]: web/components/app-demo 的通用兜底演示；未注册专属演示的 App 一律走它，未来每个 App 只需新增自己的 module 即可获得 richer 展示
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { AppDemoLayout } from "./types";

export function AppDemoSchematic({ layout, className = "" }: { layout: AppDemoLayout; className?: string }) {
  return (
    <div className={`app-demo app-demo-schematic ${className}`}>
      <div className="flex h-9 items-center justify-between border-b border-white/10 px-3">
        <div className="flex items-center gap-2">
          <span className="size-5 rounded-md bg-primary/25" />
          <span className="h-2.5 w-20 rounded bg-white/15" />
        </div>
        <span className="size-5 rounded bg-white/10" />
      </div>
      {layout === "timeline" ? (
        <div className="grid flex-1 grid-cols-[5.5rem_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)]">
          <div className="space-y-2 border-r border-white/10 p-2.5">
            <span className="block h-2 w-10 rounded bg-white/20" />
            <span className="block aspect-video rounded-sm bg-[linear-gradient(140deg,#d35d42,#1d342f_64%)]" />
            <span className="block aspect-video rounded-sm bg-[linear-gradient(135deg,#224a64,#b5d4cf)]" />
            <span className="block aspect-video rounded-sm bg-[linear-gradient(135deg,#242126,#766747)]" />
          </div>
          <div className="flex flex-col gap-2 p-2.5">
            <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded border border-black/30 bg-[oklch(0.1_0.012_150)]">
              <div className="h-2/3 w-3/4 rounded bg-[linear-gradient(130deg,#17312d,#b96d40)]" />
              <span className="absolute inset-x-4 bottom-3 h-1.5 rounded bg-white/40" />
            </div>
            <div className="space-y-1.5">
              <span className="flex h-3.5 items-center gap-1 rounded bg-white/10 px-1 text-[7px] text-white/45"><span className="size-1.5 rounded-full bg-primary" />V1</span>
              <span className="flex h-3.5 items-center gap-1 rounded bg-white/10 px-1 text-[7px] text-white/45"><span className="size-1.5 rounded-full bg-primary" />T1</span>
              <span className="flex h-3.5 items-center gap-1 rounded bg-white/10 px-1 text-[7px] text-white/45"><span className="size-1.5 rounded-full bg-primary" />A1</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_5.5rem] sm:grid-cols-[minmax(0,1fr)_7rem]">
          <div className="relative flex items-center justify-center overflow-hidden p-2.5">
            <div className="aspect-square w-2/3 rounded-xl border border-white/10 bg-[linear-gradient(135deg,#162d3b,#366c76)] shadow-inner" />
          </div>
          <div className="space-y-2 border-l border-white/10 p-2.5">
            <span className="block h-2 w-10 rounded bg-white/20" />
            <span className="block h-6 rounded bg-white/10" />
            <span className="block h-6 rounded bg-white/10" />
            <span className="block h-6 rounded bg-primary/25" />
          </div>
        </div>
      )}
    </div>
  );
}
