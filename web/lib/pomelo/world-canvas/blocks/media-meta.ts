/*
 * [INPUT]: 无外部依赖
 * [OUTPUT]: 对外提供 MEDIA_META 与 mediaMeta：媒体类型（文本/图片/音频/视频）的标签与图标
 * [POS]: lib/pomelo/world-canvas 的媒体元数据（渲染器无关；工具栏/详情面板共用）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export const MEDIA_META: Record<string, { label: string; icon: string }> = {
  text: { label: "文本", icon: "¶" },
  image: { label: "图片", icon: "🖼" },
  audio: { label: "音频", icon: "♪" },
  video: { label: "视频", icon: "▶" },
};

export function mediaMeta(media: string) {
  return MEDIA_META[media] ?? MEDIA_META.image;
}
