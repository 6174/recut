/*
 * [INPUT]: 依赖 Radix Popover、Button 风格与 lucide 图标
 * [OUTPUT]: 对外提供键盘可达的 CustomSelect；替代原生 select，统一显示已选项与选项列表；
 *          可选 searchable 搜索框与 group 分组头，供模型/世界等长列表选择复用
 * [POS]: web/components/ui 的表单选择原子；World 页面及未来原生表单只能经此组件选择固定枚举
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export type SelectOption = { label: string; value: string; description?: string; group?: string };

// SelectMenu lives inside PopoverContent so the search query resets whenever
// the popover closes (Radix unmounts content by default).
function SelectMenu({ options, searchable, searchPlaceholder, value, onChange }: { options: SelectOption[]; searchable: boolean; searchPlaceholder?: string; value: string; onChange: (value: string) => void }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const visible = normalized ? options.filter((option) => `${option.group ?? ""} ${option.label} ${option.description ?? ""}`.toLowerCase().includes(normalized)) : options;
  let lastGroup: string | undefined;
  return <>{searchable && <div className="relative p-1 pb-0"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input aria-label={searchPlaceholder} className="h-7 w-full rounded-xs border bg-background pl-7 pr-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} type="search" value={query} /></div>}{visible.length ? <div role="listbox">{visible.map((option) => { const header = option.group != null && option.group !== lastGroup ? option.group : null; lastGroup = option.group; return <span key={option.value}>{header != null && <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{header}</div>}<button aria-selected={option.value === value} className={`flex w-full items-center justify-between gap-3 rounded-xs px-2.5 py-2 text-left text-xs hover:bg-muted ${option.value === value ? "bg-accent" : ""}`} onClick={() => onChange(option.value)} role="option" type="button"><span className="min-w-0"><span className="block truncate">{option.label}</span>{option.description ? <span className="mt-0.5 block truncate text-[10px] font-normal text-muted-foreground">{option.description}</span> : null}</span>{option.value === value && <Check className="size-3.5 shrink-0 text-primary" />}</button></span>; })}</div> : <p className="px-3 py-6 text-center text-xs text-muted-foreground">{searchPlaceholder ? "无匹配结果" : "暂无选项"}</p>}</>;
}

export function CustomSelect({ id, label, onChange, options, value, searchable, searchPlaceholder }: { id: string; label?: string; onChange: (value: string) => void; options: SelectOption[]; value: string; searchable?: boolean; searchPlaceholder?: string }) {
  const selected = options.find((option) => option.value === value);
  const labelID = `${id}-label`;
  return <div className="text-xs font-medium">{label ? <span id={labelID}>{label}</span> : null}<Popover><PopoverTrigger aria-labelledby={label ? labelID : undefined} asChild><button aria-label={label ? undefined : label} className="mt-1 flex min-h-9 w-full items-center justify-between gap-2 rounded-sm border bg-background px-2 py-1.5 text-left text-xs font-normal hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" id={id} type="button"><span className="min-w-0"><span className="block truncate font-medium">{selected?.label ?? "请选择"}</span>{selected?.description ? <span className="mt-0.5 block truncate text-[10px] font-normal text-muted-foreground">{selected.description}</span> : null}</span><ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /></button></PopoverTrigger><PopoverContent align="start" className="z-[110] max-h-64 min-w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1"><SelectMenu onChange={onChange} options={options} searchPlaceholder={searchPlaceholder} searchable={searchable ?? false} value={value} /></PopoverContent></Popover></div>;
}
