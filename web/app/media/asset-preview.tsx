/*
 * [INPUT]: 依赖共享素材详情模态框
 * [OUTPUT]: 对外提供兼容的 AssetPreview 别名
 * [POS]: web/app/media 的迁移边界；实际查看逻辑位于 components/asset-preview-dialog.tsx
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { AssetPreviewDialog } from "@/components/asset-preview-dialog";
import type { Asset } from "./media-types";

export function AssetPreview({ asset, assets, onClose, onRegenerate }: { asset: Asset; assets: Asset[]; onClose: () => void; onRegenerate: (asset: Asset) => void }) {
  const apiBase = process.env.NEXT_PUBLIC_RECUT_API_URL ?? "http://127.0.0.1:17373";
  return <AssetPreviewDialog apiBase={apiBase} asset={asset} assets={assets} onClose={onClose} onRegenerate={onRegenerate} />;
}
