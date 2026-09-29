/*
 * [INPUT]: 依赖 arrow-geometry（addNodeRectResolver）
 * [OUTPUT]: 对外提供音频块的固定几何单一真源：AUDIO_BLOCK_WIDTH / AUDIO_BLOCK_HEIGHT（260×140）、
 *           isAudioBlockRecord（独立媒体元素 media+modality=audio，或音频属性卡 free-element+attrMedia=audio）、
 *           audioBlockRect（宽高恒定，x/y 取 attrs）。
 *           音频块**不支持 resize**（四角手柄白名单见 world-canvas/resize-policy）：渲染、命中/选区、连线锚点、对齐吸附都走这条固定矩形
 *           （经 addNodeRectResolver 注册进 arrow-geometry），旧数据里存的 width/height 一律以固定值为准。
 * [POS]: lib/pomelo/world-canvas/blocks 的音频块几何（渲染器无关；audio-block-ops 与宿主插件共用）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { addNodeRectResolver, type RectLike } from "../arrow-geometry";

export const AUDIO_BLOCK_WIDTH = 260;
export const AUDIO_BLOCK_HEIGHT = 140;

type RecordLike = { type?: string; attrs: Record<string, unknown> };

/** 是否音频块：独立媒体元素（type=media, modality=audio）或音频属性卡（free-element, elementKind=attr, attrMedia=audio）。 */
export function isAudioBlockRecord(record: RecordLike | null | undefined): boolean {
  if (!record) return false;
  if (record.type === "media") return String(record.attrs.modality ?? "image") === "audio";
  if (record.type === "free-element") {
    return String(record.attrs.elementKind ?? "") === "attr" && String(record.attrs.attrMedia ?? "text") === "audio";
  }
  return false;
}

/** 音频块固定矩形：宽高恒定（不随 attrs 变化），x/y 取 attrs。 */
export function audioBlockRect(attrs: Record<string, unknown>): RectLike {
  return {
    x: Number(attrs.x) || 0,
    y: Number(attrs.y) || 0,
    width: AUDIO_BLOCK_WIDTH,
    height: AUDIO_BLOCK_HEIGHT,
  };
}

// 注册连线几何的音频块固定矩形（箭头锚点/边界与渲染所见一致）
addNodeRectResolver((record) => (isAudioBlockRecord(record) ? audioBlockRect(record.attrs as Record<string, unknown>) : null));
