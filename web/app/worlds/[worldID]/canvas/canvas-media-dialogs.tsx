/*
 * [INPUT]: 依赖 react、canvas-store（mediaSource/mediaPreview 状态与媒体动作/attachEvidenceRun）、
 * canvas-media 辅助、recut-worlds-client 类型
 * [OUTPUT]: 对外提供 MediaSourceDialog（T8/B.12 素材来源浮层：上传文件 / 素材库 / URL 三源）与
 * MediaPreviewDialog（图片 lightbox / video / audio 播放）；挂接目标 = 入口给定的实体，无实体 = 独立元素
 * [POS]: worlds/[worldID]/canvas 的媒体对话框层（上传走 /v1/media/assets multipart，素材库走列表接口）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PixiRendererAdapter } from "@/lib/pomelo/pomelo-core/pomelo-pixi/pomelo-pixi-adapter";
import type { PomeloEditor } from "@/lib/pomelo/pomelo-core/pomelo-editor";
import type { WorldEntity } from "@/lib/recut-worlds-client";
import { assetModality, mediaSource, modalityOfKind } from "./canvas-media";
import { useWorldCanvasStore } from "./canvas-store";

type LibraryAsset = { id: string; name: string; kind: string; mimeType: string; status: string };

export function MediaSourceDialog() {
  const mediaSource = useWorldCanvasStore((state) => state.mediaSource);
  const setMediaSource = useWorldCanvasStore((state) => state.setMediaSource);
  if (!mediaSource) return null;
  return <SourceDialogBody target={mediaSource.entity} onClose={() => setMediaSource(null)} />;
}

function SourceDialogBody({ target, onClose }: { target: WorldEntity | null; onClose: () => void }) {
  const [tab, setTab] = useState<"upload" | "library" | "url">("upload");
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (tab !== "library" || assets.length) return;
    void fetch(`${apiBase}/v1/media/assets`, { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as LibraryAsset[]) : []))
      .then((items) => setAssets(items.filter((item) => item.status === "completed")))
      .catch(() => setAssets([]));
  }, [apiBase, assets.length, tab]);

  // 统一出口：有目标实体 = 直接挂接为证据（不建画布元素）；否则 = 独立媒体元素落视口中心
  const deliver = async (modality: string, assetId: string | undefined, urlValue: string | undefined, name?: string) => {
    const store = useWorldCanvasStore.getState();
    setBusy(true);
    setError("");
    try {
      if (target) {
        const purpose = (await import("./canvas-media")).defaultEvidencePurpose(modality, true);
        await store.attachEvidenceRun(target.id, modality, assetId ?? "", urlValue ?? "", purpose);
        store.toast(`已将${name || "素材"}挂为「${target.title}」的参考素材`, "success");
        onClose();
      } else {
        const center = store.editor
          ? viewportCenterWorld(store.editor)
          : { x: 300, y: 240 };
        await store.addMediaElement({ modality, assetId, url: urlValue, name }, center);
        onClose();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
      setBusy(false);
    }
  };

  const uploadFiles = async (files: File[]) => {
    for (const file of files) {
      const modality = modalityOfKind(file.type);
      if (!modality) {
        setError("仅支持图片 / 视频 / 音频文件");
        continue;
      }
      setBusy(true);
      try {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(`${useWorldCanvasStore.getState().apiBase}/v1/media/assets`, { method: "POST", body: form });
        if (!response.ok) throw new Error("素材导入失败，请重试");
        const asset = (await response.json()) as { id: string; name?: string };
        await deliver(modality, asset.id, undefined, file.name);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "素材导入失败");
        setBusy(false);
        return;
      }
    }
    setBusy(false);
  };

  const filtered = assets.filter(
    (item) => assetModality(item.kind) && (!query.trim() || item.name?.toLowerCase().includes(query.trim().toLowerCase())),
  );

  return (
    <div aria-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-md border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">添加素材{target ? ` → ${target.title}` : "（独立素材）"}</h3>
          <div className="flex gap-1">
            {(["upload", "library", "url"] as const).map((item) => (
              <button
                className={`rounded-md px-2 py-1 text-xs ${tab === item ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
                key={item}
                onClick={() => setTab(item)}
                type="button"
              >
                {item === "upload" ? "上传" : item === "library" ? "素材库" : "URL"}
              </button>
            ))}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
          {tab === "upload" && (
            <div
              className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void uploadFiles(Array.from(event.dataTransfer.files));
              }}
            >
              <Upload className="size-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">拖入或选择图片 / 视频 / 音频文件</p>
              <button className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => fileRef.current?.click()} type="button">
                选择文件
              </button>
              <input
                className="hidden"
                multiple
                onChange={(event) => void uploadFiles(Array.from(event.target.files ?? []))}
                ref={fileRef}
                type="file"
              />
            </div>
          )}
          {tab === "library" && (
            <div>
              <input
                className="mb-2 w-full rounded-md border bg-background p-1.5 text-xs outline-none focus:border-primary"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索素材…"
                value={query}
              />
              <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto">
                {filtered.map((asset) => (
                  <button
                    className="group overflow-hidden rounded-md border text-left hover:border-primary/60"
                    disabled={busy}
                    key={asset.id}
                    onClick={() => void deliver(assetModality(asset.kind)!, asset.id, undefined, asset.name)}
                    type="button"
                  >
                    {asset.kind.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt={asset.name} className="h-16 w-full object-cover" src={mediaSource(apiBase, { assetId: asset.id })} />
                    ) : (
                      <div className="grid h-16 w-full place-items-center bg-muted text-lg">{asset.kind.startsWith("video/") ? "🎬" : "🎵"}</div>
                    )}
                    <p className="truncate px-1.5 py-1 text-[10px] text-muted-foreground">{asset.name}</p>
                  </button>
                ))}
                {!filtered.length && <p className="col-span-4 py-6 text-center text-xs text-muted-foreground">素材库暂无可用素材</p>}
              </div>
            </div>
          )}
          {tab === "url" && (
            <div className="space-y-2">
              <input
                className="w-full rounded-md border bg-background p-2 text-xs outline-none focus:border-primary"
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://…（图片 / 视频 / 音频直链）"
                value={url}
              />
              {url && (
                <div className="grid h-32 place-items-center rounded-md border bg-muted/40">
                  <span className="text-xs text-muted-foreground">将以此链接作为素材真相（不复制文件）</span>
                </div>
              )}
              <button
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                disabled={!/^https:\/\//.test(url) || busy}
                onClick={() => void deliver(url.includes(".mp4") || url.includes("video") ? "video" : url.includes(".mp3") || url.includes("audio") ? "audio" : "image", undefined, url)}
                type="button"
              >
                添加
              </button>
            </div>
          )}
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}

// 预览浮层：图片 lightbox / video controls / audio controls（面板证据区与画布双击共用）
export function MediaPreviewDialog() {
  const preview = useWorldCanvasStore((state) => state.mediaPreview);
  const setMediaPreview = useWorldCanvasStore((state) => state.setMediaPreview);
  if (!preview) return null;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/80 p-8 backdrop-blur" onMouseDown={() => setMediaPreview(null)}>
      <button aria-label="关闭预览" className="absolute right-4 top-4 grid size-8 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20" onClick={(event) => { event.stopPropagation(); setMediaPreview(null); }} type="button">
        ✕
      </button>
      <div className="flex max-h-full max-w-full flex-col items-center gap-3" onMouseDown={(event) => event.stopPropagation()}>
        {preview.modality === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={preview.name} className="max-h-[80vh] max-w-full rounded-lg" src={preview.src} />
        ) : preview.modality === "video" ? (
          <video className="max-h-[80vh] max-w-full rounded-lg" controls src={preview.src} />
        ) : (
          <audio className="w-80" controls src={preview.src} />
        )}
        <p className="text-xs text-white/70">{preview.name}</p>
      </div>
    </div>
  );
}

// 视口中心的世界坐标（独立媒体元素落点）
function viewportCenterWorld(editor: PomeloEditor): { x: number; y: number } {
  const adapter = editor.renderAdapter as PixiRendererAdapter;
  const view = adapter.app.view as HTMLCanvasElement;
  const rect = view.getBoundingClientRect();
  const t = adapter.transform;
  return { x: (rect.width / 2 - t.x) / t.scale, y: (rect.height / 2 - t.y) / t.scale };
}
