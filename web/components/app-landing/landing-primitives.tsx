/*
 * [INPUT]: 依赖 React 节点；被各 App Landing 模块消费
 * [OUTPUT]: 对外提供 LandingStep 与 LandingMetric 两个无业务视觉原子
 * [POS]: app-landing 的共享微型原语；不决定任何 App 的信息架构
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export function LandingStep({ step, label }: { step: string; label: string }) { return <div className="flex items-center justify-between font-mono text-[9px] font-semibold tracking-[.16em] text-primary"><span>{step}</span><span>{label}</span></div>; }
export function LandingMetric({ title, value }: { title: string; value: string }) { return <div className="rounded-xl border border-white/10 bg-card p-4"><p className="font-mono text-[9px] text-white/35">{title}</p><p className="mt-3 text-xs font-medium text-white/70">{value}</p></div>; }
