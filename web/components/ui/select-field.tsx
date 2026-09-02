/*
 * [INPUT]: 依赖 Radix Popover、Button 风格与 lucide 图标
 * [OUTPUT]: 对外提供键盘可达的 CustomSelect；替代原生 select，统一显示已选项与选项列表
 * [POS]: web/components/ui 的表单选择原子；World 页面及未来原生表单只能经此组件选择固定枚举
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export type SelectOption = { label: string; value: string; description?: string };

export function CustomSelect({ id, label, onChange, options, value }: { id: string; label?: string; onChange: (value: string) => void; options: SelectOption[]; value: string }) {
  const selected = options.find((option) => option.value === value);
  const labelID = `${id}-label`;
  return <div className="text-xs font-medium">{label ? <span id={labelID}>{label}</span> : null}<Popover><PopoverTrigger aria-labelledby={label ? labelID : undefined} asChild><button aria-label={label ? undefined : label} className="mt-1 flex min-h-9 w-full items-center justify-between gap-2 rounded-sm border bg-background px-2 py-1.5 text-left text-xs font-normal hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" id={id} type="button"><span className="min-w-0"><span className="block truncate font-medium">{selected?.label ?? "请选择"}</span>{selected?.description ? <span className="mt-0.5 block truncate text-[10px] font-normal text-muted-foreground">{selected.description}</span> : null}</span><ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /></button></PopoverTrigger><PopoverContent align="start" className="z-[110] max-h-64 min-w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1"><div role="listbox">{options.map((option) => <button aria-selected={option.value === value} className={`flex w-full items-center justify-between gap-3 rounded-xs px-2.5 py-2 text-left text-xs hover:bg-muted ${option.value === value ? "bg-accent" : ""}`} key={option.value} onClick={() => onChange(option.value)} role="option" type="button"><span className="min-w-0"><span className="block truncate">{option.label}</span>{option.description ? <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{option.description}</span> : null}</span>{option.value === value && <Check className="size-3.5 shrink-0 text-primary" />}</button>)}</div></PopoverContent></Popover></div>;
}
