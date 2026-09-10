/*
 * [INPUT]: 依赖 react、canvas-store（apiBase）、shared world-entity/field-row
 * [OUTPUT]: 画布面板的编辑原语 shim：FieldRow/AssetFieldRow/parseAssetValue/typeLabelOf 统一提升至
 * web/components/world-entity/field-row.tsx（RFC 统一 Entity 模型 P1 共享编辑器，设定视图同源复用）；
 * FieldRow 直接透传，AssetFieldRow 注入画布 apiBase
 * [POS]: worlds/[worldID]/canvas/panel 的编辑原语兼容出口；编辑 UI 真相在共享模块
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useWorldCanvasStore } from "../canvas-store";
import { AssetFieldRow as SharedAssetFieldRow, FieldRow as SharedFieldRow } from "@/components/world-entity/field-row";

// 画布面板注入 apiBase 的薄封装（AssetFieldRow 本体不依赖 store）
export function FieldRow(props: React.ComponentProps<typeof SharedFieldRow>) {
  return <SharedFieldRow {...props} />;
}

export function AssetFieldRow({ value, label, kinds, readOnly, onSave }: { value: unknown; label: string; kinds?: ("image" | "video" | "audio")[]; readOnly?: boolean; onSave: (value: unknown) => Promise<void> | void }) {
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  return <SharedAssetFieldRow apiBase={apiBase} kinds={kinds} label={label} onSave={onSave} readOnly={readOnly} value={value} />;
}

export { parseAssetValue, typeLabelOf } from "@/components/world-entity/field-row";
