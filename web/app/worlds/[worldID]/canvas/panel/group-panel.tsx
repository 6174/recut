/*
 * [INPUT]: 依赖 canvas-store（elements/selection/setGroupProps/arrangeGroup/ungroup/deleteGroup/selectMany/
 *          canvasDisplayNameOf）、world-canvas/group（group-metrics 色板与文案、group-model 成员派生）、
 *          panel/field-row（FieldRow 共用编辑原语）
 * [OUTPUT]: 对外提供 GroupPanel（选中分组容器时的属性面板）：名称 / 背景色 / 内边距 / 自适应 fit /
 *           组内一键布局（grid / tree-down / tree-right，默认按名称排序）/ 成员列表（点击定位）/
 *           解散分组与删除分组（危险区）。
 * [POS]: worlds/[worldID]/canvas 的分组容器属性面板（detail-panel 在 selection.element.kind==="group" 时路由到此）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { LayoutGrid, Network, Trash2, Ungroup } from "lucide-react";
import { GROUP_BACKGROUND_SWATCHES, GROUP_LAYOUT_LABELS, GROUP_PADDING, type GroupLayoutMode } from "@/lib/pomelo/world-canvas/group/group-metrics";
import { groupBackgroundOf, groupMembersOf } from "@/lib/pomelo/world-canvas/group/group-model";
import { blockIdOfCanvasId } from "../canvas-group";
import { canvasDisplayNameOf, useWorldCanvasStore } from "../canvas-store";
import { FieldRow } from "./field-row";
import { PanelSection } from "@/components/panel-section";

const LAYOUT_BUTTONS: Array<{ mode: GroupLayoutMode; label: string; icon: typeof LayoutGrid }> = [
  { mode: "grid", label: "网格", icon: LayoutGrid },
  { mode: "tree-down", label: "树形 Down", icon: Network },
  { mode: "tree-right", label: "树形 Right", icon: Network },
];

export function GroupPanel({ groupId }: { groupId: string }) {
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const elements = useWorldCanvasStore((state) => state.elements);
  const setGroupProps = useWorldCanvasStore((state) => state.setGroupProps);
  const arrangeGroup = useWorldCanvasStore((state) => state.arrangeGroup);
  const ungroup = useWorldCanvasStore((state) => state.ungroup);
  const deleteGroup = useWorldCanvasStore((state) => state.deleteGroup);
  const selectMany = useWorldCanvasStore((state) => state.selectMany);
  const group = elements.find((item) => item.id === groupId && item.kind === "group");
  if (!group) return null;
  const members = groupMembersOf(elements, groupId);
  const background = groupBackgroundOf(group);
  const name = group.name ?? "";
  const layout = String(group.props?.layout ?? "free") as GroupLayoutMode;
  return (
    <div className="text-sm">
      <PanelSection first title="分组">
        <FieldRow hideLabel label="名称" value={name} placeholder="分组名称…" readOnly={readOnly} onSave={(value) => void setGroupProps(groupId, { name: String(value) })} />
        <p className="mt-1 text-[10px] text-muted-foreground">{members.length} 个元素</p>
      </PanelSection>

      <PanelSection title="外观">
        <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">背景色</p>
        <div className="flex flex-wrap gap-1.5">
          {GROUP_BACKGROUND_SWATCHES.map((swatch) => (
            <button
              aria-label={swatch.label}
              className={`size-6 rounded-md border ${background === swatch.value ? "ring-2 ring-primary" : ""}`}
              disabled={readOnly}
              key={swatch.label}
              onClick={() => void setGroupProps(groupId, { background: swatch.value })}
              style={swatch.value ? { backgroundColor: swatch.value } : { backgroundImage: "linear-gradient(45deg,#888 25%,transparent 25%,transparent 75%,#888 75%),linear-gradient(45deg,#888 25%,transparent 25%,transparent 75%,#888 75%)", backgroundSize: "8px 8px", backgroundPosition: "0 0,4px 4px" }}
              title={swatch.label}
              type="button"
            />
          ))}
        </div>
      </PanelSection>

      <PanelSection title="布局（默认按名称排序）">
        <div className="flex flex-wrap gap-1.5">
          {LAYOUT_BUTTONS.map(({ mode, label, icon: Icon }) => (
            <button
              className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted ${layout === mode ? "border-primary text-primary" : ""}`}
              disabled={readOnly}
              key={mode}
              onClick={() => arrangeGroup(groupId, mode)}
              type="button"
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
        <button
          className="mt-2 flex h-7 w-full items-center justify-center rounded-md border text-xs hover:bg-muted disabled:opacity-40"
          disabled={readOnly}
          onClick={() => void setGroupProps(groupId, { fit: "fit" })}
          title="把容器精确贴合到成员包围盒 + 内边距（可增可减）"
          type="button"
        >
          适应内容
        </button>
        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">默认只在内容装不下时自动扩大，不会自动缩小。</p>
        <label className="mt-2 block text-xs">
          <span className="text-muted-foreground">内边距</span>
          <input
            className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
            defaultValue={Number(group.props?.padding ?? GROUP_PADDING)}
            disabled={readOnly}
            key={`padding-${groupId}`}
            min={0}
            onBlur={(event) => void setGroupProps(groupId, { padding: Math.max(0, Number(event.target.value) || GROUP_PADDING) })}
            type="number"
          />
        </label>
      </PanelSection>

      <PanelSection title={`成员 · ${members.length}`}>
        {members.length === 0 ? (
          <p className="text-xs text-muted-foreground">拖元素进组框即可加入。</p>
        ) : (
          <ul className="space-y-1">
            {members.map((member) => (
              <li key={member.id}>
                <button
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-muted"
                  onClick={() => selectMany([blockIdOfCanvasId(elements, member.id)])}
                  type="button"
                >
                  <span className="min-w-0 truncate">{canvasDisplayNameOf(useWorldCanvasStore.getState(), member.id) || member.kind}</span>
                  <span className="shrink-0 text-muted-foreground">{member.kind}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>

      {!readOnly && (
        <PanelSection title="危险区">
          <div className="space-y-2">
            <button
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border text-xs hover:bg-muted"
              onClick={() => void ungroup(groupId)}
              type="button"
            >
              <Ungroup className="size-3.5" /> 解散分组（保留内容）
            </button>
            <button
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-destructive/40 text-xs text-destructive hover:bg-destructive/10"
              onClick={() => void deleteGroup(groupId)}
              type="button"
            >
              <Trash2 className="size-3.5" /> 删除分组（含内容）
            </button>
          </div>
        </PanelSection>
      )}
    </div>
  );
}
