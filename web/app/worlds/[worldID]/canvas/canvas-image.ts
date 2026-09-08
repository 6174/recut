/*
 * [INPUT]: 依赖 recut-worlds-client（WorldEvidence 类型）与 canvas-theme（loadPixiTexture 等纹理工具）
 * [OUTPUT]: 对外提供 entityImageUrls / evidenceSource：实体证据（modality=image）→ 可渲染 URL
 * （asset 行走媒体库 content 流，url 行直连远程资源）；纹理加载与 cover-fit 工具在 canvas-theme
 * [POS]: worlds/[worldID]/canvas 的画布图片辅助（canvas-pomelo.tsx 组装 attrs，EntityCardBlock 渲染）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { WorldEntity, WorldEvidence } from "@/lib/recut-worlds-client";

// 证据双源解析为可渲染 URL（与 world-detail-panels.tsx 的 evidenceSource 同一约定）
export function evidenceSource(apiBase: string, item: WorldEvidence): string {
  if (item.source === "url" || (!item.assetId && item.url)) return item.url ?? "";
  return item.assetId ? `${apiBase}/v1/media/assets/${encodeURIComponent(item.assetId)}/content` : "";
}

// 实体图片证据 → URL 列表（primary/appearance 优先，archived 排除）
export function entityImageUrls(apiBase: string, entity: WorldEntity): string[] {
  const images = (entity.references ?? []).filter(
    (item) => item.modality === "image" && item.status !== "archived" && evidenceSource(apiBase, item),
  );
  const rank = (item: WorldEvidence) => (item.status === "primary" ? 0 : 1) * 10 + (item.purpose === "appearance" ? 0 : 1);
  return images.sort((a, b) => rank(a) - rank(b)).map((item) => evidenceSource(apiBase, item));
}
