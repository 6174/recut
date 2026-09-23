/**
 * [INPUT]: 依赖 React 属性类型与 lucide-react 图标
 * [OUTPUT]: 对外提供 Gen Studio 共享视觉原子（Button / Card / Badge / Field / Input / Textarea / Select / Progress / StatusDot）
 * [POS]: ui/src 的无业务视觉原子；不读取 App 状态或调用宿主
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

type Variant = "primary" | "outline" | "ghost" | "destructive";

const BUTTON: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/85",
  outline: "border bg-card hover:bg-muted",
  ghost: "hover:bg-muted",
  destructive: "border border-destructive/40 text-destructive hover:bg-destructive/10",
};

export function Button({ className = "", variant = "primary", size = "md", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  const sizing = size === "sm" ? "h-7 px-2 text-[11px]" : "h-9 px-3 text-xs";
  return <button className={`inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${sizing} ${BUTTON[variant]} ${className}`} {...props} />;
}

export function Card({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`rounded-xl border bg-card shadow-[0_1px_2px_oklch(0.19_0.008_150/0.04)] ${className}`} {...props} />;
}

export function Badge({ tone = "muted", className = "", children }: { tone?: "muted" | "primary" | "success" | "warning" | "destructive"; className?: string; children: ReactNode }) {
  const tones: Record<string, string> = {
    muted: "border-border text-muted-foreground",
    primary: "border-primary/40 text-primary",
    success: "border-success/40 text-success",
    warning: "border-warning/40 text-warning",
    destructive: "border-destructive/40 text-destructive",
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${tones[tone]} ${className}`}>{children}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-foreground/85">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

const CONTROL = "w-full rounded-md border border-input bg-secondary/60 px-2.5 py-2 text-xs text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:bg-secondary";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${CONTROL} h-9 ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${CONTROL} min-h-[72px] resize-y leading-5 ${className}`} {...props} />;
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function StatusDot({ tone }: { tone: "idle" | "active" | "success" | "error" }) {
  const tones: Record<string, string> = {
    idle: "bg-muted-foreground",
    active: "bg-primary animate-pulse",
    success: "bg-success",
    error: "bg-destructive",
  };
  return <span className={`inline-block size-2 shrink-0 rounded-full ${tones[tone]}`} />;
}
