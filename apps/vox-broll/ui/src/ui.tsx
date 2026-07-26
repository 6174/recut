/**
 * [INPUT]: 依赖 React、Radix Dialog / Dropdown Menu、Tailwind CSS 与 lucide 图标
 * [OUTPUT]: 对外提供 Button、Dialog、Dropdown Menu、Badge、Textarea 等 shadcn 风格原子
 * [POS]: vox-broll 的本地 UI 原子层；供资源卡片、弹窗和根视图复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { FolderPlus, X } from "lucide-react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

const join = (...values: Array<string | undefined | false>) => values.filter(Boolean).join(" ");

export function Button({ children, className, variant = "default", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "outline" }) {
  const variants = variant === "outline" ? "border bg-background hover:bg-muted" : "bg-primary text-primary-foreground hover:bg-primary/90";
  return <button className={join("inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", variants, className)} {...props}>{children}</button>;
}

export function Badge({ children }: { children: ReactNode }) { return <span className="inline-flex h-5 items-center rounded-sm border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">{children}</span>; }
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={join("overflow-hidden rounded-lg border bg-card text-card-foreground", className)} {...props} />; }
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={join("px-4 pt-4", className)} {...props} />; }
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={join("px-4 py-4", className)} {...props} />; }
export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={join("flex items-center border-t px-4 py-3", className)} {...props} />; }
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className="min-h-28 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" {...props} />; }

export function Tabs({ children }: { children: ReactNode }) { return <div>{children}</div>; }
export function TabsList({ children }: { children: ReactNode }) { return <div className="flex gap-1 overflow-x-auto border-b pb-px" role="tablist">{children}</div>; }
export function TabsTrigger({ active, children, count, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean; count: number }) { return <button aria-selected={active} className={join("flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition", active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")} role="tab" {...props}>{children}<span className={join("rounded-full px-1.5 py-0.5 font-mono text-[10px]", active ? "bg-primary/15 text-foreground" : "bg-muted")}>{count}</span></button>; }

export const Dialog = DialogPrimitive.Root;
export const DialogHeader = ({ children }: { children: ReactNode }) => <div className="grid gap-2">{children}</div>;
export const DialogTitle = (props: DialogPrimitive.DialogTitleProps) => <DialogPrimitive.Title className="text-lg font-semibold tracking-tight" {...props} />;
export const DialogDescription = (props: DialogPrimitive.DialogDescriptionProps) => <DialogPrimitive.Description className="text-sm leading-6 text-muted-foreground" {...props} />;
export const DialogFooter = ({ children }: { children: ReactNode }) => <div className="flex justify-end gap-2 pt-1">{children}</div>;
export function DialogContent({ children, className, ...props }: DialogPrimitive.DialogContentProps) { return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-black/30 backdrop-blur-[1px]" /><DialogPrimitive.Content className={join("fixed left-1/2 top-1/2 z-[100] grid max-h-[88vh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 gap-5 overflow-y-auto rounded-xl border bg-card p-5 shadow-2xl outline-none", className)} {...props}><DialogPrimitive.Close aria-label="关闭" className="absolute right-4 top-4 rounded-sm text-muted-foreground hover:text-foreground"><X className="size-4" /></DialogPrimitive.Close>{children}</DialogPrimitive.Content></DialogPrimitive.Portal>; }

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export function DropdownMenuContent({ children, className, ...props }: DropdownMenuPrimitive.DropdownMenuContentProps) { return <DropdownMenuPrimitive.Portal><DropdownMenuPrimitive.Content className={join("z-[150] grid min-w-32 rounded-md border bg-card p-1 shadow-lg", className)} sideOffset={6} {...props}>{children}</DropdownMenuPrimitive.Content></DropdownMenuPrimitive.Portal>; }
export function DropdownMenuItem({ className, ...props }: DropdownMenuPrimitive.DropdownMenuItemProps) { return <DropdownMenuPrimitive.Item className={join("flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs outline-none transition hover:bg-muted focus:bg-muted", className)} {...props} />; }
export function EmptyState({ action, label }: { action: () => void; label: string }) { return <div className="grid min-h-64 place-items-center rounded-xl border border-dashed bg-card p-8 text-center"><div><div className="mx-auto grid size-10 place-items-center rounded-full bg-muted"><FolderPlus className="size-5 text-muted-foreground" /></div><h3 className="mt-4 text-sm font-semibold">此阶段还没有资源</h3><p className="mt-1 max-w-xs text-sm leading-6 text-muted-foreground">从一个明确的创作意图开始，完成后会自动出现在这里。</p><Button className="mt-4" onClick={action}><FolderPlus className="size-4" />{label}</Button></div></div>; }
