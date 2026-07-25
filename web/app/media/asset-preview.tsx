/*
 * [INPUT]: 依赖素材资产元数据、资产内容 API 与 lucide-react 图标
 * [OUTPUT]: 对外提供 AssetPreview 详情弹框，展示生成提示词、参考素材和再次生成操作
 * [POS]: web/app/media 的素材详情视图；由 page.tsx 提供素材集合并接收再次生成回调
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ImageIcon, Music2, RotateCcw, X } from "lucide-react";
import type { Asset } from "./media-types";

export function AssetPreview({
  asset,
  assets,
  onClose,
  onRegenerate,
}: {
  asset: Asset;
  assets: Asset[];
  onClose: () => void;
  onRegenerate: (asset: Asset) => void;
}) {
  const referenceIDs = Array.isArray(asset.metadata.referenceIds)
    ? asset.metadata.referenceIds.filter(
        (id): id is string => typeof id === "string",
      )
    : [];
  const references = referenceIDs
    .map((id) => assets.find((item) => item.id === id))
    .filter((item): item is Asset => Boolean(item));

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-8 backdrop-blur-[1px]"
      onMouseDown={onClose}
      role="dialog"
    >
      <section
        className="w-full max-w-4xl overflow-hidden rounded-sm border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <p className="text-sm font-medium">{asset.name}</p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              {asset.kind.toUpperCase()} · {asset.origin.toUpperCase()}
            </p>
          </div>
          <button
            aria-label="关闭预览"
            className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="grid max-h-[78vh] overflow-y-auto md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid min-h-80 place-items-center bg-muted/30 p-5">
            {asset.kind === "image" ? (
              <img
                alt={asset.name}
                className="max-h-[65vh] max-w-full object-contain"
                src={contentURL(asset.id)}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                {asset.kind.toUpperCase()} 预览将在此显示。
              </p>
            )}
          </div>
          <aside className="border-l p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium">生成信息</p>
              {asset.metadata.prompt && (
                <button
                  className="flex h-7 items-center gap-1 rounded-xs border px-2 text-[11px] hover:bg-muted"
                  onClick={() => onRegenerate(asset)}
                  type="button"
                >
                  <RotateCcw className="size-3" />
                  再次生成
                </button>
              )}
            </div>
            <dl className="mt-4 space-y-4 text-xs">
              <div>
                <dt className="text-muted-foreground">提示词</dt>
                <dd className="mt-1 leading-5">
                  {asset.metadata.prompt ?? "无"}
                </dd>
              </div>
              {referenceIDs.length > 0 && (
                <div>
                  <dt className="text-muted-foreground">参考素材</dt>
                  <dd className="mt-2 grid grid-cols-2 gap-2">
                    {references.map((reference) => (
                      <div className="min-w-0" key={reference.id}>
                        {reference.kind === "image" ? (
                          <img
                            alt={reference.name}
                            className="aspect-square w-full rounded-xs border object-cover"
                            src={contentURL(reference.id)}
                          />
                        ) : (
                          <div className="grid aspect-square place-items-center rounded-xs border bg-muted text-muted-foreground">
                            {reference.kind === "audio" ? (
                              <Music2 className="size-4" />
                            ) : (
                              <ImageIcon className="size-4" />
                            )}
                          </div>
                        )}
                        <p
                          className="mt-1 truncate text-[10px]"
                          title={reference.name}
                        >
                          {reference.name}
                        </p>
                      </div>
                    ))}
                    {references.length < referenceIDs.length && (
                      <p className="col-span-2 text-[11px] text-muted-foreground">
                        部分参考素材已不可用。
                      </p>
                    )}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">创建时间</dt>
                <dd className="mt-1">
                  {new Date(asset.createdAt).toLocaleString()}
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>
    </div>
  );
}

function contentURL(assetID: string) {
  const apiBase =
    process.env.NEXT_PUBLIC_RECUT_API_URL ?? "http://127.0.0.1:17373";
  return `${apiBase}/v1/media/assets/${assetID}/content`;
}
