export type AssetKind = "image" | "video" | "audio";

export interface MediaRef {
  /** Absolute URL when previewing in the browser; static /media/... path when rendering. */
  url?: string;
  /** Absolute local path when rendering. */
  path?: string;
  kind: AssetKind;
  mimeType?: string;
}

export type MediaMap = Record<string, MediaRef>;

export interface SceneCaption {
  text: string;
  start: number;
  end: number;
}

export interface Scene {
  id: string;
  kind: "title" | "content" | "outro";
  title: string;
  narration?: string;
  caption?: SceneCaption;
  imageAssetId?: string;
  effectId?: string;
  durationSec: number;
}

export interface DesignStyle {
  background?: string;
  primary?: string;
  accent?: string;
  text?: string;
  fontFamily?: string;
  captionTheme?: string;
  captionPrimary?: string;
  captionSecondary?: string;
  effectId?: string;
  bgmAssetId?: string;
}

export interface Design {
  title: string;
  durationSec: number;
  fps?: number;
  width?: number;
  height?: number;
  template: string;
  style: DesignStyle;
  scenes: Scene[];
}

export interface StoryVideoProps {
  design: Design;
  media: MediaMap;
  settings?: { width?: number; height?: number; fps?: number; codec?: string };
}

export const defaultDesign = (): Design => ({
  title: "未命名视频",
  durationSec: 15,
  fps: 30,
  width: 1920,
  height: 1080,
  template: "clean-editorial",
  style: {
    background: "#f7f7f4",
    primary: "#111314",
    accent: "#1d5bd6",
    text: "#111314",
    captionTheme: "pop",
    captionPrimary: "#111314",
    captionSecondary: "#1d5bd6",
    effectId: "geometric",
  },
  scenes: [
    { id: "opening", kind: "title", title: "一个标题", narration: "", durationSec: 5 },
    { id: "body", kind: "content", title: "内容场景", narration: "这里放一段旁白。", durationSec: 5 },
    { id: "closing", kind: "outro", title: "结束", narration: "", durationSec: 5 },
  ],
});
