/*
 * [INPUT]: 依赖 service endpoint 与共享素材详情模态框
 * [OUTPUT]: 对外提供兼容的 AssetPreview 别名
 * [POS]: web/app/media 的迁移边界；实际查看逻辑位于 components/asset-preview-dialog.tsx
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { AssetPreviewDialog } from "@/components/asset-preview-dialog";
import { useServiceStore } from "@/lib/service-store";
import type { Asset } from "./media-types";

export function AssetPreview({ asset, assets, onClose, onRegenerate }: { asset: Asset; assets: Asset[]; onClose: () => void; onRegenerate: (asset: Asset) => void }) {
  const apiBase = useServiceStore((state) => state.endpoint);
  return <AssetPreviewDialog apiBase={apiBase} asset={asset} assets={assets} onClose={onClose} onRegenerate={onRegenerate} />;
}
