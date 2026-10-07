/*
 * [INPUT]: 依赖 react、lucide-react、ui/dropdown-menu、ui/popover、media-types（ModelParameter）
 * [OUTPUT]: 对外提供 CompactParameters：把生成参数渲染成底栏里的一排紧凑 chip——
 *   枚举 = 下拉菜单（当前值 + 选中勾选）、布尔 = 开关 chip、数值/文本 = 小气泡输入（失焦/回车提交、夹到 min/max）。
 *   不渲染「生成参数」标题与整行表单，保持核心输入框整洁（对齐素材库 composer 的底栏规范）
 * [POS]: web/components 的紧凑生成参数控件；供 World 画布节点生成输入框使用（可下沉给提案编辑台/面板复用）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Check, ChevronDown, Crop, Dices, FileImage, Footprints, Gauge, Hash, ListFilter, PaintBucket, ShieldCheck, SlidersHorizontal, Sparkles, Timer, ToggleLeft, Images } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import type { ModelParameter } from "@/app/media/media-types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const CHIP = "inline-flex h-7 max-w-[200px] items-center gap-1 rounded-md border bg-background px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

// 参数名 → 图标：chip 用图标替代长属性名（label 只留 tooltip），一眼可辨又不占宽。
function iconFor(parameter: ModelParameter): ComponentType<{ className?: string }> {
  const key = `${parameter.name} ${parameter.label ?? ""}`.toLowerCase();
  if (/size|resolution|aspect|ratio|width|height|dimension|尺寸|分辨率|画幅|比例/.test(key)) return Crop;
  if (/duration|length|time|seconds|时长|秒/.test(key)) return Timer;
  if (/quality|画质|质量/.test(key)) return Sparkles;
  if (/seed|随机/.test(key)) return Dices;
  if (/step|步/.test(key)) return Footprints;
  if (/format|格式/.test(key)) return FileImage;
  if (/background|背景/.test(key)) return PaintBucket;
  if (/moderation|审核|安全/.test(key)) return ShieldCheck;
  if (/fps|framerate|帧率/.test(key)) return Gauge;
  if (/count|number|images|张|数量/.test(key)) return Images;
  if (parameter.enum?.length) return ListFilter;
  if (parameter.type === "boolean") return ToggleLeft;
  if (parameter.type === "integer" || parameter.type === "number") return Hash;
  return SlidersHorizontal;
}

export function CompactParameters({ parameters, values, onChange }: { parameters: ModelParameter[]; values: Record<string, unknown>; onChange: (name: string, value: unknown) => void }) {
  if (!parameters.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {parameters.map((parameter) => (
        <ParamChip key={parameter.name} onChange={(value) => onChange(parameter.name, value)} parameter={parameter} value={values[parameter.name]} />
      ))}
    </div>
  );
}

function ParamChip({ parameter, value, onChange }: { parameter: ModelParameter; value: unknown; onChange: (value: unknown) => void }) {
  const label = parameter.label || parameter.name.replace(/_/g, " ");
  const current = value ?? parameter.default;
  const Icon = iconFor(parameter);

  if (parameter.enum?.length) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={CHIP} title={parameter.description || label} type="button">
            <Icon className="size-3 shrink-0 opacity-70" />
            <span className="truncate">{current === undefined || current === null || current === "" ? label : String(current)}</span>
            <ChevronDown className="size-3 shrink-0 opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-44 overflow-y-auto">
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          {parameter.enum.map((option) => (
            <DropdownMenuItem className="justify-between" key={option} onSelect={() => onChange(option)}>
              <span className="truncate">{option}</span>
              {String(current ?? "") === option && <Check className="size-3.5 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (parameter.type === "boolean") {
    const on = Boolean(current);
    return (
      <button
        className={`${CHIP} ${on ? "border-primary/40 bg-primary/10 text-primary" : ""}`}
        onClick={() => onChange(!on)}
        title={parameter.description || label}
        type="button"
      >
        <Icon className="size-3 shrink-0 opacity-70" />
        <span className="truncate">{label}</span>
      </button>
    );
  }

  return <NumberChip Icon={Icon} current={current} label={label} onChange={onChange} parameter={parameter} />;
}

function NumberChip({ parameter, current, label, Icon, onChange }: { parameter: ModelParameter; current: unknown; label: string; Icon: ComponentType<{ className?: string }>; onChange: (value: unknown) => void }) {
  const numeric = parameter.type === "integer" || parameter.type === "number";
  const currentText = current === undefined || current === null ? "" : String(current);
  // 数值/文本走本地草稿、失焦或回车才提交：逐键写回会在输入中间态（空串、越界半截数字）触发服务端校验回弹。
  const [draft, setDraft] = useState(currentText);
  const editingRef = useRef(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!editingRef.current) setDraft(currentText);
  }, [currentText]);

  const commit = () => {
    if (!numeric) {
      if (draft !== currentText) onChange(draft);
      return;
    }
    const parsed = Number(draft);
    if (draft.trim() === "" || Number.isNaN(parsed)) {
      setDraft(currentText);
      return;
    }
    let next = parameter.type === "integer" ? Math.round(parsed) : parsed;
    if (parameter.minimum !== undefined) next = Math.max(parameter.minimum, next);
    if (parameter.maximum !== undefined) next = Math.min(parameter.maximum, next);
    setDraft(String(next));
    if (next !== current) onChange(next);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button className={CHIP} title={parameter.description || label} type="button">
          <Icon className="size-3 shrink-0 opacity-70" />
          <span className="truncate">{currentText || label}</span>
          <ChevronDown className="size-3 shrink-0 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-2">
        <p className="mb-1 text-[10px] text-muted-foreground">{label}</p>
        <input
          autoFocus
          className="h-8 w-full rounded-sm border bg-background px-2 text-xs outline-none focus:border-primary"
          max={parameter.maximum}
          min={parameter.minimum}
          onBlur={() => {
            editingRef.current = false;
            commit();
          }}
          onChange={(event) => {
            editingRef.current = true;
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
              setOpen(false);
            }
          }}
          step={parameter.type === "integer" ? 1 : "any"}
          type={numeric ? "number" : "text"}
          value={draft}
        />
        {parameter.description && <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">{parameter.description}</p>}
      </PopoverContent>
    </Popover>
  );
}
