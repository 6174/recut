/*
 * [INPUT]: 依赖 react、canvas-store（updateRelation/swapRelationDirection/removeRelation/select/toast）、
 *          recut-worlds-client 类型、lucide-react
 * [OUTPUT]: 对外提供 RelationPanel（B.8 Relation 态，T5）：两端语义各自可编辑（可输入可选择的 combobox，
 *          默认「引用」），每行以「A → B 的关系」方向句标明这一侧语义指的是哪个方向，起点/终点不再歧义；
 *          终点留空=未标记（画布单箭头）；预设一键填两端；方向交换（次要，图标按钮，交换两端并同时对调 role）；
 *          范围（只读）、删除两步确认
 * [POS]: worlds/[worldID]/canvas/panel 的 Relation 态面板
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowLeftRight, ChevronDown, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { WorldEntityRelation, WorldRelationType } from "@/lib/recut-worlds-client";
import { PanelSection } from "@/components/panel-section";
import { useWorldCanvasStore } from "../canvas-store";

const RELATION_GROUP_LABELS: Record<string, string> = { people: "人际", world: "世界", story: "故事", video: "视频" };

// token → 展示标签（catalog 命中用中文名，自定义原样）
function roleLabel(relationTypes: WorldRelationType[], token: string): string {
  if (!token) return "";
  return relationTypes.find((item) => item.id === token)?.labelZh ?? token;
}

// 展示标签 → token（命中既有 catalog 的 labelZh 用其 id，否则原样作为自定义 token）
function roleToken(relationTypes: WorldRelationType[], label: string): string {
  const value = label.trim();
  if (!value) return "";
  return relationTypes.find((item) => item.labelZh === value)?.id ?? value;
}

export function RelationPanel({ relation }: { relation: WorldEntityRelation }) {
  const entities = useWorldCanvasStore((state) => state.entities);
  const relationTypes = useWorldCanvasStore((state) => state.relationTypes);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const updateRelation = useWorldCanvasStore((state) => state.updateRelation);
  const swapRelationDirection = useWorldCanvasStore((state) => state.swapRelationDirection);
  const removeRelation = useWorldCanvasStore((state) => state.removeRelation);
  const [armed, setArmed] = useState(false);
  const titleOf = (id: string) => entities.find((item) => item.id === id)?.name ?? "…";
  const toRole = relation.toRole ?? "";
  const presets = relationTypes.filter((item) => item.inverseLabelZh);

  return (
    <div className="text-sm">
      <PanelSection first title="语义">
        {readOnly ? (
          <div className="space-y-1 text-sm">
            <p>
              {titleOf(relation.fromEntityId)} → {titleOf(relation.toEntityId)} 的关系：
              {roleLabel(relationTypes, relation.fromRole) || "引用"}
            </p>
            {toRole && (
              <p>
                {titleOf(relation.toEntityId)} → {titleOf(relation.fromEntityId)} 的关系：
                {roleLabel(relationTypes, toRole)}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <RoleField
              clearable={false}
              sentence={`${titleOf(relation.fromEntityId)} → ${titleOf(relation.toEntityId)} 的关系`}
              onChange={(value) => void updateRelation(relation, { fromRole: value || "references" })}
              options={relationTypes}
              placeholder="引用"
              value={roleLabel(relationTypes, relation.fromRole)}
            />
            <RoleField
              clearable
              sentence={`${titleOf(relation.toEntityId)} → ${titleOf(relation.fromEntityId)} 的关系`}
              onChange={(value) => void updateRelation(relation, { toRole: value })}
              options={relationTypes}
              placeholder="未标记"
              value={roleLabel(relationTypes, toRole)}
            />
            {presets.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {presets.map((item) => (
                  <button
                    className="rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    key={item.id}
                    onClick={() => void updateRelation(relation, { fromRole: item.id, toRole: roleToken(relationTypes, item.inverseLabelZh ?? "") })}
                    type="button"
                  >
                    {item.labelZh}⇄{item.inverseLabelZh}
                  </button>
                ))}
              </div>
            )}
            <button
              className="flex items-center gap-1 pt-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => void swapRelationDirection(relation)}
              type="button"
            >
              <ArrowLeftRight className="size-3" /> 交换两端（含语义）
            </button>
          </div>
        )}
      </PanelSection>
      <PanelSection title="范围">
        <p className="text-sm">{relation.scopeEntityId ? `仅「${titleOf(relation.scopeEntityId)}」内部可见 · 局部` : "全局"}</p>
      </PanelSection>
      {!readOnly && (
        <div className="pt-3">
          {armed ? (
            <div className="flex gap-2">
              <button className="h-8 flex-1 rounded-md border text-xs hover:bg-muted" onClick={() => setArmed(false)} type="button">
                取消
              </button>
              <button
                className="h-8 flex-1 rounded-md bg-destructive text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  setArmed(false);
                  void removeRelation(relation.id);
                }}
                type="button"
              >
                确认删除
              </button>
            </div>
          ) : (
            <button
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-destructive/40 text-xs text-destructive hover:bg-destructive/10"
              onClick={() => setArmed(true)}
              type="button"
            >
              <Trash2 className="size-3.5" /> 删除此关系
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// 语义字段：方向句（「A → B 的关系」，可换行）单独一行，输入框单独一行（满宽）——
// 结构稳定，不随实体名长短跳变；输入可自由填写，也可从受控词表选择。
function RoleField({
  sentence,
  value,
  placeholder,
  options,
  onChange,
  clearable,
}: {
  sentence: string;
  value: string;
  placeholder: string;
  options: WorldRelationType[];
  onChange: (token: string) => void;
  clearable: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const shown = focused ? draft : value;
  const commit = () => {
    const next = roleToken(options, draft);
    if (next !== value) onChange(next);
  };
  const pick = (token: string) => {
    setDraft(roleLabel(options, token));
    setOpen(false);
    if (token !== value) onChange(token);
  };
  const groups = new Map<string, WorldRelationType[]>();
  for (const item of options) {
    const list = groups.get(item.group) ?? [];
    list.push(item);
    groups.set(item.group, list);
  }
  return (
    <div className="space-y-1">
      <p className="break-words text-[11px] leading-snug text-muted-foreground">{sentence}</p>
      <div className="relative">
        <input
          className="w-full rounded-md border bg-background px-1.5 py-1 pr-[3.25rem] text-xs outline-none focus:border-primary"
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => {
            setFocused(true);
            setDraft(value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
              (event.target as HTMLInputElement).blur();
            }
          }}
          placeholder={placeholder}
          value={shown}
        />
        {clearable && value && (
          <button
            aria-label="清除终点语义"
            className="absolute right-6 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted"
            onClick={() => onChange("")}
            onMouseDown={(event) => event.preventDefault()}
            type="button"
          >
            <X className="size-3" />
          </button>
        )}
        <button
          aria-label="选择语义"
          className="absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <ChevronDown className="size-3.5" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-20" onMouseDown={() => setOpen(false)} />
            <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border bg-card p-1 shadow-[var(--shadow-overlay)]">
              {[...groups.entries()].map(([group, items]) => (
                <div key={group}>
                  <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{RELATION_GROUP_LABELS[group] ?? group}</p>
                  {items.map((item) => (
                    <button
                      className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted ${item.id === value ? "bg-accent text-primary" : ""}`}
                      key={item.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => pick(item.id)}
                      type="button"
                    >
                      <span className="min-w-0 truncate">
                        {item.labelZh}
                        {item.inverseLabelZh ? <span className="text-muted-foreground"> ↔ {item.inverseLabelZh}</span> : null}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{item.id}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

