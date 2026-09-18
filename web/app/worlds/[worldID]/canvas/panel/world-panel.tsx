/*
 * [INPUT]: 依赖 react、canvas-store（World 态数据与 updateWorldMeta/locate 动作）、panel/field-row、
 * recut-worlds-client（永久删除世界）与 worlds-store（删除后失效缓存）
 * [OUTPUT]: 对外提供 WorldPanel：空选/选中 World 节点时的详情面板（B.8 World 态）——
 * 名称与简介就地编辑、世界快照（类型计数）、待关注列表（无简介/无素材/待确认草稿，[定位]）、
 * [导出为 zip]（复用 exportWorld，只读世界同样可导出）、[＋ 添加设定…] 打开创建菜单，
 * 以及 local 世界的永久删除（名称二次确认，素材库不受影响）
 * [POS]: worlds/[worldID]/canvas/panel 的 World 态面板（不暴露 revision/canonical/hash，B.2）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Plus, Crosshair, Download, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createRecutWorldsClient, type WorldDetail, type WorldEntity } from "@/lib/recut-worlds-client";
import { useWorldsStore } from "@/lib/worlds-store";
import { useWorldCanvasStore } from "../canvas-store";
import { entityMediaAttrs } from "../entity-attrs";
import { FieldRow, typeLabelOf } from "./field-row";
import { PanelSection } from "@/components/panel-section";
import { RichFieldRow } from "@/components/world-entity/rich-field-row";

export function WorldPanel({ worldDetail }: { worldDetail: WorldDetail | undefined }) {
  const store = useWorldCanvasStore();
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  const worldId = useWorldCanvasStore((state) => state.worldId);
  const loadDetail = useWorldsStore((state) => state.loadDetail);
  const invalidate = useWorldsStore((state) => state.invalidate);
  const entities = useWorldCanvasStore((state) => state.entities);
  const relations = useWorldCanvasStore((state) => state.relations);
  const setCreating = useWorldCanvasStore((state) => state.setCreating);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteName, setDeleteName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [exporting, setExporting] = useState(false);
  // 保存后强制刷新 detail（updateWorldMeta 不回写 worlds-store 缓存，面板值需立即落位）
  const saveMeta = async (patch: { name?: string; description?: string; skillMd?: string }) => {
    await store.updateWorldMeta(patch);
    void loadDetail(apiBase, worldId, true);
  };

  const confirmName = store.worldName.trim();
  const deleteArmed = deleteName.trim() !== "" && deleteName.trim() === confirmName;

  async function deleteWorldForever() {
    if (deleting || !deleteArmed) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await createRecutWorldsClient(apiBase).deleteWorld({ worldId, name: deleteName.trim() });
      invalidate(worldId);
      window.location.assign("/worlds");
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "删除失败");
      setDeleting(false);
    }
  }

  async function exportWorldBundle() {
    if (exporting) return;
    setExporting(true);
    try {
      const { blob, filename } = await createRecutWorldsClient(apiBase).exportWorld({ worldId });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      store.toast("已导出为 zip", "success");
    } catch (cause) {
      store.toast(cause instanceof Error ? cause.message : "导出失败", "error");
    } finally {
      setExporting(false);
    }
  }

  // 待关注（至多 5 条）：当前上下文内 缺简介 / 缺素材 / 待确认草稿（B.8；快照为全世界计数）
  const attention: Array<{ key: string; text: string; entity?: WorldEntity }> = [];
  for (const entity of entities) {
    if (!entity.intro.trim()) attention.push({ key: `${entity.id}-summary`, text: `${entity.name} 还没有简介`, entity });
    if (!entityMediaAttrs(entity).length) attention.push({ key: `${entity.id}-media`, text: `${entity.name} 还没有参考素材`, entity });
    if (entity.isProvisional) attention.push({ key: `${entity.id}-draft`, text: `${entity.name} 待确认设定`, entity });
  }
  const counts = worldDetail?.entityCounts;
  const snapshot = counts
    ? Object.entries(counts)
        .filter(([, count]) => (count ?? 0) > 0)
        .map(([kind, count]) => `${count} 个${typeLabelOf({ typeId: kind }, store.entityTypes)}`)
        .join(" · ")
    : "";
  const summary = [snapshot, `${relations.length} 条关系`].filter(Boolean).join(" · ");

  return (
    <div className="text-sm">
      <PanelSection first title="身份">
        <FieldRow label="名称" value={store.worldName} onSave={(value) => void saveMeta({ name: String(value) })} />
        <RichFieldRow
          apiBase={apiBase}
          label="简介"
          minRows={3}
          value={worldDetail?.description ?? ""}
          placeholder="一句话描述这个世界…"
          onSave={(value) => void saveMeta({ description: value })}
        />
        <RichFieldRow
          apiBase={apiBase}
          label="Skill"
          minRows={6}
          value={worldDetail?.skillMd ?? ""}
          placeholder="这个世界的创作技能说明（Agent 会读取）…"
          onSave={(value) => void saveMeta({ skillMd: value })}
        />
      </PanelSection>
      <PanelSection title="世界快照">
        <p className="text-sm leading-6">{summary || "（空世界）"}</p>
      </PanelSection>
      {attention.length > 0 && (
        <PanelSection title="待关注">
          <ul className="space-y-1">
            {attention.slice(0, 5).map((item) => (
              <li className="flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1.5 text-xs" key={item.key}>
                <span className="truncate">{item.text}</span>
                {item.entity && (
                  <button
                    aria-label="定位"
                    className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => useWorldCanvasStore.getState().select({ type: "entity", entity: item.entity! })}
                    type="button"
                  >
                    <Crosshair className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </PanelSection>
      )}
      <div className="space-y-2 pt-3">
        {!store.readOnly && (
          <button
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90"
            onClick={() => setCreating(true)}
            type="button"
          >
            <Plus className="size-3.5" /> 添加设定…
          </button>
        )}
        <button
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border text-xs font-medium hover:bg-muted disabled:opacity-50"
          disabled={exporting}
          onClick={() => void exportWorldBundle()}
          type="button"
        >
          <Download className="size-3.5" /> {exporting ? "导出中…" : "导出为 zip"}
        </button>
        {!store.readOnly && (
          <button
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-destructive/40 text-xs text-destructive hover:bg-destructive/10"
            onClick={() => { setDeleteName(""); setDeleteError(""); setDeleteOpen(true); }}
            type="button"
          >
            <Trash2 className="size-3.5" /> 永久删除这个世界
          </button>
        )}
      </div>
      {deleteOpen && (
        <div aria-modal="true" className="fixed inset-0 z-[60] grid place-items-center bg-foreground/30 p-6" role="dialog">
          <div className="w-full max-w-md rounded-md border bg-card p-5 text-left shadow-2xl">
            <h3 className="text-base font-semibold">永久删除「{store.worldName}」？</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              此操作不可撤销：世界内的实体、关系、类型目录、画布与全部版本记录都会被永久删除，且无法恢复。素材库中的图片、视频与音频不会被删除，但会失去与这个世界的关联；已绑定它的项目会变为未绑定。
            </p>
            <label className="mt-3 block text-xs font-medium text-muted-foreground" htmlFor="canvas-world-delete-confirm">
              请输入世界名称「{store.worldName}」以确认删除
            </label>
            <Input
              autoFocus
              className="mt-1.5 h-9 bg-background"
              id="canvas-world-delete-confirm"
              onChange={(event) => setDeleteName(event.target.value)}
              placeholder={store.worldName}
              value={deleteName}
            />
            {deleteError && <p className="mt-2 text-xs text-destructive">{deleteError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button disabled={deleting} onClick={() => setDeleteOpen(false)} type="button" variant="outline">取消</Button>
              <Button
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleting || !deleteArmed}
                onClick={() => void deleteWorldForever()}
                type="button"
              >
                <Trash2 className="size-3.5" />
                {deleting ? "删除中…" : "永久删除"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
