/**
 * [INPUT]: 依赖 AssetReferenceDialog、MediaAssetEventsProvider 的全局素材缓存、缩略图与稳定 assetId 协议
 * [OUTPUT]: 对外提供 iframe App 可调用、支持按类型单选/多选的全局素材选择器，限制完成态和指定媒体类型；转写稿只允许从库中选择
 * [POS]: 平台与隔离 App 间的素材选择 UI 边界；宿主负责展示、上传和详情，App 只接收稳定选择结果
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { AssetReferenceDialog, type MediaPickerKind } from "@/components/asset-reference-picker";
import { MediaAssetEventsProvider } from "@/components/use-media-asset-events";

export type PlatformMediaPickerRequest = { kinds: MediaPickerKind[]; multiple?: boolean; selectedIDs?: string[] };
export type PlatformMediaPickerSelection = { id: string; name: string; kind: MediaPickerKind; mimeType: string; status: string };
export type PlatformMediaPickerResult = PlatformMediaPickerSelection | PlatformMediaPickerSelection[];

export function PlatformMediaPicker({ apiBase, request, onCancel, onPick }: { apiBase: string; request: PlatformMediaPickerRequest | null; onCancel: () => void; onPick: (asset: PlatformMediaPickerResult) => void }) {
  if (!request) return null;
  const selection = (asset: { id: string; name: string; kind: MediaPickerKind; mimeType: string; status: string }): PlatformMediaPickerSelection => ({ id: asset.id, name: asset.name, kind: asset.kind, mimeType: asset.mimeType, status: asset.status });
  const allowsUpload = !request.kinds.includes("transcript");
  return <MediaAssetEventsProvider apiBase={apiBase}><AssetReferenceDialog allowUpload={allowsUpload} apiBase={apiBase} completedOnly description={request.multiple ? "浏览、上传或查看详情后，选择需要交给当前 App 的素材。" : "浏览或查看详情后，选择一个已完成的素材交给当前 App。"} kinds={request.kinds} multiple={request.multiple} onClose={onCancel} onPick={(asset) => onPick(selection(asset))} onPickMany={(assets) => onPick(assets.map(selection))} open preselectedIDs={request.selectedIDs} projectID={null} selectedIDs={[]} title="选择素材" /></MediaAssetEventsProvider>;
}
