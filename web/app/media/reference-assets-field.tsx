/*
 * [INPUT]: 依赖素材库 Asset、模型允许的引用类型和受控上传回调
 * [OUTPUT]: 对外提供按模型能力筛选的参考素材选择、上传和预览字段
 * [POS]: media 创建弹框的参考素材子组件；不持有 Provider、凭据或生成任务状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Music2, Plus, Upload, X } from "lucide-react";
import {
  ChangeEvent,
  Dispatch,
  SetStateAction,
  useRef,
  useState,
} from "react";
import type { Asset, AssetKind } from "./media-types";

type ReferenceAssetsFieldProps = {
  apiBase: string;
  availableAssets: Asset[];
  referenceIDs: string[];
  referenceKinds: AssetKind[];
  referenceLabel: string;
  selectedAssets: Asset[];
  onReferenceIDsChange: Dispatch<SetStateAction<string[]>>;
  onUpload: (files: File[]) => void;
};

export function ReferenceAssetsField({
  apiBase,
  availableAssets,
  referenceIDs,
  referenceKinds,
  referenceLabel,
  selectedAssets,
  onReferenceIDsChange,
  onUpload,
}: ReferenceAssetsFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const accept = referenceKinds.map((kind) => `${kind}/*`).join(",");
  const uploadLabel =
    referenceKinds.length === 1 ? `上传${referenceLabel}` : "上传参考素材";
  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    onUpload(files);
  }
  return (
    <section>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-medium">参考素材</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            可添加已有或新上传的{referenceLabel}作为创作上下文。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            accept={accept}
            className="hidden"
            multiple
            onChange={chooseFiles}
            ref={fileInput}
            type="file"
          />
          <button
            className="flex h-7 items-center gap-1 rounded-xs border px-2 text-[11px] hover:bg-muted"
            onClick={() => setPickerOpen(true)}
            type="button"
          >
            <Plus className="size-3" />
            添加参考素材
          </button>
          <span className="font-mono text-[10px] text-muted-foreground">
            {referenceIDs.length} SELECTED
          </span>
        </div>
      </div>
      {referenceIDs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {selectedAssets.map((asset) => (
            <div
              className="group relative size-16 overflow-hidden rounded-xs border bg-muted"
              key={asset.id}
            >
              <ReferenceThumbnail
                apiBase={apiBase}
                asset={asset}
                className="h-full w-full object-cover"
              />
              <button
                aria-label={`移除参考素材 ${asset.name}`}
                className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-foreground/75 text-background hover:bg-foreground"
                onClick={() =>
                  onReferenceIDsChange((ids) =>
                    ids.filter((id) => id !== asset.id),
                  )
                }
                type="button"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {pickerOpen && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-[60] grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]"
          onMouseDown={() => setPickerOpen(false)}
          role="dialog"
        >
          <section
            className="w-full max-w-2xl overflow-hidden rounded-sm border bg-card shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between border-b px-5 py-4">
              <div>
                <p className="text-sm font-semibold">选择参考素材</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  点击兼容素材即可添加或移除参考素材；当前模型支持
                  {referenceLabel}。
                </p>
              </div>
              <button
                aria-label="关闭参考素材选择"
                className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted"
                onClick={() => setPickerOpen(false)}
                type="button"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="max-h-[60vh] overflow-y-auto p-5">
              <button
                className="mb-4 flex h-9 items-center gap-2 rounded-xs border px-3 text-xs hover:bg-muted"
                onClick={() => fileInput.current?.click()}
                type="button"
              >
                <Upload className="size-3.5" />
                {uploadLabel}
              </button>
              {availableAssets.length ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  {availableAssets.map((asset) => {
                    const selected = referenceIDs.includes(asset.id);
                    return (
                      <button
                        aria-pressed={selected}
                        className={`overflow-hidden rounded-xs border text-left transition-colors ${selected ? "border-primary ring-1 ring-primary" : "hover:border-foreground/40"}`}
                        key={asset.id}
                        onClick={() =>
                          onReferenceIDsChange((ids) =>
                            ids.includes(asset.id)
                              ? ids.filter((id) => id !== asset.id)
                              : [...ids, asset.id],
                          )
                        }
                        type="button"
                      >
                        <div className="grid aspect-square place-items-center bg-muted">
                          <ReferenceThumbnail
                            apiBase={apiBase}
                            asset={asset}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2 p-2">
                          <span className="truncate text-[11px] font-medium">
                            {asset.name}
                          </span>
                          {selected && (
                            <span className="text-[10px] text-primary">已选</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xs border border-dashed p-4 text-xs text-muted-foreground">
                  暂无可用参考素材，可先上传{referenceLabel}。
                </p>
              )}
            </div>
            <footer className="flex items-center justify-between border-t px-5 py-4">
              <span className="text-xs text-muted-foreground">
                已选 {referenceIDs.length} 个素材
              </span>
              <button
                className="h-8 rounded-xs bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/85"
                onClick={() => setPickerOpen(false)}
                type="button"
              >
                完成选择
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}

function ReferenceThumbnail({
  apiBase,
  asset,
  className,
}: {
  apiBase: string;
  asset: Asset;
  className: string;
}) {
  const source = `${apiBase}/v1/media/assets/${asset.id}/content`;
  if (asset.kind === "image") {
    return <img alt={asset.name} className={className} src={source} />;
  }
  if (asset.kind === "video") {
    return (
      <video
        aria-label={asset.name}
        className={className}
        muted
        preload="metadata"
        src={source}
      />
    );
  }
  return (
    <div
      aria-label={asset.name}
      className="grid h-full w-full place-items-center"
    >
      <Music2 className="size-4 text-muted-foreground" />
    </div>
  );
}
