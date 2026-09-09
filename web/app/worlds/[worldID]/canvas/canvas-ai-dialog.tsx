/*
 * [INPUT]: 依赖 react、canvas-store（aiDialogOpen/entityTypes/createEntity）、recut-worlds-client
 * [OUTPUT]: 对外提供 AiEntityDialog（T13/B.16）：多行描述 → POST /v1/worlds/{id}/ai/suggest-entities →
 * 候选列表（可勾选/可改标题）→ [放置 N 个设定] = 逐个 createEntity 草稿卡（网格排布）。
 * 契约先行：后端 v1 未接 LLM 通道时返回 501/AI_NOT_CONFIGURED，本对话框如实提示
 * [POS]: worlds/[worldID]/canvas 的 AI 创建入口（唯一 AI 入口，D10；候选必须用户勾选才落盘）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { createRecutWorldsClient } from "@/lib/recut-worlds-client";
import { useWorldCanvasStore } from "./canvas-store";

type Candidate = { kind: string; title: string; summary?: string; content?: Record<string, unknown> };

export function AiEntityDialog() {
  const open = useWorldCanvasStore((state) => state.aiDialogOpen);
  if (!open) return null;
  return <AiDialogBody />;
}

function AiDialogBody() {
  const setAiDialogOpen = useWorldCanvasStore((state) => state.setAiDialogOpen);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [titles, setTitles] = useState<Record<number, string>>({});

  const generate = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const store = useWorldCanvasStore.getState();
      const body = await createRecutWorldsClient(store.apiBase).requestAI(`/v1/worlds/${encodeURIComponent(store.worldId)}/ai/suggest-entities`, {
        text: text.trim(),
        limit: 6,
      });
      const list = (body.candidates ?? []) as Candidate[];
      setCandidates(list);
      setChecked(new Set(list.map((_, index) => index)));
      setTitles(Object.fromEntries(list.map((item, index) => [index, item.title])));
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code === "AI_NOT_CONFIGURED" ? "AI 生成通道尚未接入，请稍后再试。" : cause instanceof Error ? cause.message : "生成失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const place = async () => {
    const list = (candidates ?? []).filter((_, index) => checked.has(index));
    if (!list.length) return;
    setBusy(true);
    try {
      // 网格排布落点（视口中心起，2 列）
      const store = useWorldCanvasStore.getState();
      for (let index = 0; index < list.length; index += 1) {
        const item = list[index];
        await store.createEntity(item.kind, {
          title: titles[index] || item.title,
          pos: { x: 200 + (index % 2) * 300, y: 120 + Math.floor(index / 2) * 220 },
        });
        // 候选简介/字段预填：创建后写 summary 与 schema 内字段
        const created = useWorldCanvasStore.getState().entities.find((entity) => entity.title === (titles[index] || item.title));
        if (created && (item.summary || item.content)) {
          await store.saveEntityField(created, { summary: item.summary ?? created.summary, contentPatch: item.content ?? {} });
        }
      }
      useWorldCanvasStore.getState().toast(`已放置 ${list.length} 个草稿设定`, "success");
      setAiDialogOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "放置失败");
      setBusy(false);
    }
  };

  const toggle = (index: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <div aria-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={() => setAiDialogOpen(false)} role="dialog">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-md border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <Sparkles className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">用描述添加设定</h3>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
          <textarea
            className="min-h-20 w-full resize-y rounded-md border bg-background p-2 text-xs leading-5 outline-none focus:border-primary"
            onChange={(event) => setText(event.target.value)}
            placeholder="描述你想添加的人物 / 地点 / 物件…（如：一个 30 岁的电台主播，声音低沉，随身带着一台旧磁带机）"
            value={text}
          />
          <button className="mt-2 w-full rounded-md bg-primary py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50" disabled={!text.trim() || busy} onClick={() => void generate()} type="button">
            {busy ? "生成中…" : "生成候选"}
          </button>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          {candidates && (
            <div className="mt-3 space-y-2">
              <p className="text-[10px] text-muted-foreground">候选（勾选后放置为草稿设定）</p>
              {candidates.map((item, index) => (
                <div className="flex items-start gap-2 rounded-md border p-2" key={index}>
                  <input checked={checked.has(index)} onChange={() => toggle(index)} type="checkbox" />
                  <div className="min-w-0 flex-1">
                    <input
                      className="w-full rounded border bg-background px-1.5 py-0.5 text-xs outline-none focus:border-primary"
                      onChange={(event) => setTitles((prev) => ({ ...prev, [index]: event.target.value }))}
                      value={titles[index] ?? item.title}
                    />
                    {item.summary && <p className="mt-1 text-[10px] text-muted-foreground">{item.summary}</p>}
                    <p className="mt-0.5 text-[9px] text-muted-foreground/70">{item.kind}</p>
                  </div>
                </div>
              ))}
              {!candidates.length && <p className="text-xs text-muted-foreground">没有生成候选</p>}
            </div>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t p-3">
          <button className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => setAiDialogOpen(false)} type="button">
            关闭
          </button>
          <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50" disabled={!candidates?.length || !checked.size || busy} onClick={() => void place()} type="button">
            放置 {checked.size || ""} 个设定
          </button>
        </footer>
      </div>
    </div>
  );
}
