/*
 * [INPUT]: 依赖内联的品牌 mark 几何（与 public/logo.svg 同源）与 globals.css 的 .brand-wordmark 字体栈，不加载任何位图
 * [OUTPUT]: 对外提供 RecutMark（纯图形，继承 currentColor）与 RecutLogo（mark + 字标组合），供官网与工作台复用
 * [POS]: web/components 的品牌视觉原子；官网 Header/Footer、工作台首页与项目详情头部共用同一份 mark
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
const MARK_SHELL =
  "M0 9.5A9.5 9.5 0 0 1 9.5 0L58 0A26 26 0 0 1 72.5 47.581L34.534 24.992A3 3 0 0 0 30 27.57L30 80.5A4.5 4.5 0 0 1 25.5 85L5 85A5 5 0 0 1 0 80Z";
const MARK_LEG = "M60.27 46.84A3 3 0 0 1 64.14 47.53L87.85 76.85A5 5 0 0 1 83.96 85L39 85A4 4 0 0 1 35 81L35 62Z";

export function RecutMark({ className = "h-6 w-auto", title }: { className?: string; title?: string }) {
  return (
    <svg aria-hidden={title ? undefined : true} aria-label={title} className={className} fill="currentColor" role={title ? "img" : undefined} viewBox="0 0 88 85" xmlns="http://www.w3.org/2000/svg">
      {title ? <title>{title}</title> : null}
      <path d={MARK_SHELL} />
      <path d={MARK_LEG} />
    </svg>
  );
}

export function RecutLogo({ className = "gap-2", markClassName = "h-7 w-auto", wordmark = "Recut", wordmarkClassName = "brand-wordmark text-base font-semibold" }: { className?: string; markClassName?: string; wordmark?: string; wordmarkClassName?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center ${className}`}>
      <RecutMark className={markClassName} />
      <span className={wordmarkClassName}>{wordmark}</span>
    </span>
  );
}
