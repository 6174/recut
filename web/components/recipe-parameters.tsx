/*
 * [INPUT]: 依赖 media-types 的 ModelParameter。
 * [OUTPUT]: 对外提供 RecipeParameters：按 catalog model.parameters 渲染生成参数控件（枚举/布尔/数值/文本）。
 * [POS]: web/components 的生成参数渲染原子；素材详情弹框、World 画布媒体编辑器、提案编辑台共用同一套控件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import type { ModelParameter } from "@/app/media/media-types";

export function RecipeParameters({ parameters, values, onChange }: { parameters: ModelParameter[]; values: Record<string, unknown>; onChange: (name: string, value: unknown) => void }) {
  if (!parameters.length) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground">生成参数</p>
      {parameters.map((parameter) => (
        <ParameterRow key={parameter.name} parameter={parameter} value={values[parameter.name]} onChange={(value) => onChange(parameter.name, value)} />
      ))}
    </div>
  );
}

function ParameterRow({ parameter, value, onChange }: { parameter: ModelParameter; value: unknown; onChange: (value: unknown) => void }) {
  const label = parameter.label || parameter.name.replace(/_/g, " ");
  const current = value ?? parameter.default;
  if (parameter.type === "boolean") {
    return (
      <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground" title={parameter.description}>
        <span className="truncate">{label}</span>
        <input checked={Boolean(current)} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      </label>
    );
  }
  if (parameter.enum?.length) {
    return (
      <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground" title={parameter.description}>
        <span className="shrink-0 truncate">{label}</span>
        <select
          className="min-w-0 flex-1 rounded-md border bg-background p-1 text-[11px] outline-none focus:border-primary"
          onChange={(event) => onChange(event.target.value)}
          value={String(current ?? "")}
        >
          {parameter.enum.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    );
  }
  const numeric = parameter.type === "integer" || parameter.type === "number";
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground" title={parameter.description}>
      <span className="shrink-0 truncate">{label}</span>
      <input
        className="min-w-0 flex-1 rounded-md border bg-background p-1 text-[11px] outline-none focus:border-primary"
        max={parameter.maximum}
        min={parameter.minimum}
        onChange={(event) => onChange(numeric ? Number(event.target.value) : event.target.value)}
        step={parameter.type === "integer" ? 1 : "any"}
        type={numeric ? "number" : "text"}
        value={current === undefined || current === null ? "" : String(current)}
      />
    </label>
  );
}
