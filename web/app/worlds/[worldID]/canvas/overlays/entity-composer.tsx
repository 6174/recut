/*
 * [INPUT]: 依赖 react/createPortal、lucide-react、components/rich-composer（富文本 @ 引用）、
 *   components/agent-panel-types（creationEntityContextPayload）、context-catalog/registry、
 *   lib/rich-composer/value（normalizeValue）、canvas-store（saveEntityField/worldId/readOnly/entities）
 * [OUTPUT]: 对外提供 entityBodyComposerPlugin（内置输入框插件）与 EntityBodyComposer：实体节点下方的正文输入框——
 *   直接把 entity.detail（正文）作为富文本展示/编辑，底部保存按钮，右上角放大全屏编辑（⌘↵ 保存 / Esc 关闭）
 * [POS]: worlds/[worldID]/canvas/overlays 的实体正文输入框插件（RFC 2026-10-07 §3.3）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Loader2, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { creationEntityContextPayload } from "@/components/agent-panel-types";
import { RichComposer } from "@/components/rich-composer/rich-composer";
import { contextProtocolRegistry } from "@/lib/context-catalog/registry";
import type { ContextOption } from "@/lib/context-catalog/types";
import { normalizeValue, type RichComposerValue } from "@/lib/rich-composer/value";
import { useWorldCanvasStore } from "../canvas-store";
import type { EntityOverlaySubject, NodeOverlayContext, NodeOverlayPlugin } from "./types";

export const entityBodyComposerPlugin: NodeOverlayPlugin = {
  id: "entity-body-composer",
  kind: "composer",
  priority: 0,
  match: (ctx) => ctx.subject.kind === "entity",
  render: (ctx) => <EntityBodyComposer ctx={ctx} />,
};

export function EntityBodyComposer({ ctx }: { ctx: NodeOverlayContext }) {
  const subject = ctx.subject as EntityOverlaySubject;
  const entityId = subject.entityId;
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  const worldId = useWorldCanvasStore((state) => state.worldId);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const saveEntityField = useWorldCanvasStore((state) => state.saveEntityField);
  // 渲染期用最新实体快照（subject.entity 可能是旧快照），保存后 detail 立即反映
  const entity = useWorldCanvasStore((state) => state.entities.find((item) => item.id === entityId) ?? subject.entity);

  const registry = useMemo(() => contextProtocolRegistry(), []);
  const [value, setValue] = useState<RichComposerValue>(() => normalizeValue(entity.detail ?? "", registry));
  const [fullscreen, setFullscreen] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const initialRef = useRef(entity.detail ?? "");

  // 外部（面板/其它入口）改动正文时回填；用户已编辑则不覆盖
  useEffect(() => {
    if (dirtyRef.current) return;
    setValue(normalizeValue(entity.detail ?? "", registry));
    initialRef.current = entity.detail ?? "";
  }, [entity.detail, registry]);

  const pinnedOptions = useMemo<ContextOption[]>(
    () => [
      {
        key: `creation_entity:${worldId}:${entity.id}`,
        sourceType: "creation_entity",
        group: "current",
        subKind: entity.typeId,
        title: entity.name,
        subtitle: "当前实体 · 可下钻属性",
        badges: [{ key: "self", label: "当前", tone: "primary" }],
        data: { worldId, entityId: entity.id, entity },
        context: creationEntityContextPayload(worldId, entity.id),
        score: 0,
        pinned: true,
      },
    ],
    [worldId, entity],
  );

  const handleChange = (next: RichComposerValue) => {
    setValue(next);
    setDirty(next.text !== initialRef.current);
    if (state !== "idle") setState("idle");
  };

  const save = async () => {
    if (readOnly || !dirtyRef.current) return;
    setState("saving");
    try {
      await saveEntityField(entity, { detail: value.text });
      initialRef.current = value.text;
      setDirty(false);
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
    }
  };

  const renderPrompt = (expanded: boolean) => (
    <div className={`relative z-0 rounded-lg p-1.5 ${expanded ? "flex min-h-0 flex-1 flex-col" : "min-h-[76px]"}`}>
      <RichComposer
        apiBase={apiBase}
        className={expanded ? "h-full" : undefined}
        maxRows={expanded ? 40 : 6}
        minRows={expanded ? 10 : 2}
        mode="referencing"
        onChange={handleChange}
        pinnedOptions={pinnedOptions}
        placeholder="填写正文内容，@ 可引用实体…"
        value={value}
        variant="field"
      />
    </div>
  );

  const renderBar = () => (
    <div className="mt-2 flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground">
        {state === "saving" ? "保存中…" : state === "error" ? "保存失败，请重试" : state === "saved" ? "已保存" : dirty ? "未保存修改" : ""}
      </span>
      <span className="flex-1" />
      <button
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        disabled={readOnly || !dirty || state === "saving"}
        onClick={() => void save()}
        type="button"
      >
        {state === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : null}
        保存
      </button>
    </div>
  );

  if (fullscreen) {
    return createPortal(
      <div className="fixed inset-0 z-[85] grid place-items-center bg-foreground/40 p-6 backdrop-blur-[1px]" data-composer-fullscreen onMouseDown={() => setFullscreen(false)}>
        <section className="flex h-[min(780px,calc(100vh-3rem))] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
          <header className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
            <p className="text-xs font-medium text-muted-foreground">{entity.name} · 正文</p>
            <button aria-label="退出全屏" className="grid size-7 place-items-center rounded hover:bg-muted" onClick={() => setFullscreen(false)} type="button">
              <Minimize2 className="size-3.5" />
            </button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col p-4">
            {renderPrompt(true)}
            {renderBar()}
          </div>
        </section>
      </div>,
      document.body,
    );
  }

  return (
    <div className="pointer-events-auto relative w-[min(520px,calc(100vw-2rem))] rounded-xl border bg-card p-2.5 shadow-2xl">
      <button
        aria-label="全屏编辑"
        className="absolute right-1.5 top-1.5 z-10 grid size-6 place-items-center rounded-md bg-muted/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={() => setFullscreen(true)}
        title="全屏编辑（更大的输入区）"
        type="button"
      >
        <Maximize2 className="size-3.5" />
      </button>
      {renderPrompt(false)}
      {renderBar()}
    </div>
  );
}
