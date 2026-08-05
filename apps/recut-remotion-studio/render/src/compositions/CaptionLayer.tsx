import React from "react";
import { CaptionTheme, buildCaptionsData, CaptionsData } from "../captions";
import { Palette } from "../effects/registry";
import { Design, Scene } from "../types";

export interface SceneTiming {
  scene: Scene;
  start: number;
  frames: number;
}

/** Deterministic scene timeline; the last scene absorbs rounding remainder. */
export const computeSceneTimings = (design: Design, fps: number): SceneTiming[] => {
  const scenes = Array.isArray(design.scenes) ? design.scenes : [];
  if (!scenes.length) return [];
  const raw = scenes.map((scene) => ({
    scene,
    frames: Math.max(1, Math.round((scene.durationSec || 2) * fps)),
  }));
  const total = raw.reduce((sum, item) => sum + item.frames, 0);
  const target = Math.max(1, Math.round((design.durationSec || 2) * fps));
  const remainder = target - total;
  if (remainder !== 0) {
    raw[raw.length - 1].frames = Math.max(1, raw[raw.length - 1].frames + remainder);
  }
  let cursor = 0;
  return raw.map((item) => {
    const timing = { scene: item.scene, start: cursor, frames: item.frames };
    cursor += item.frames;
    return timing;
  });
};

const toWords = (text: string, start: number, end: number): CaptionsData => {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return { lines: [] };
  const span = Math.max(end - start, 0.1);
  const unit = span / words.length;
  const lines: CaptionsData["lines"] = [];
  for (let index = 0; index < words.length; index += 5) {
    const group = words.slice(index, index + 5);
    lines.push({
      words: group.map((word, offset) => {
        const startAt = start + (index + offset) * unit;
        return { text: word, start: startAt, end: startAt + unit };
      }),
    });
  }
  return { lines };
};

/** One global, absolute-time caption stream built from every content scene. */
export const buildGlobalCaptions = (design: Design, timings: SceneTiming[], fps: number): CaptionsData => {
  const lines: CaptionsData["lines"] = [];
  for (const { scene, start, frames } of timings) {
    if (scene.kind !== "content") continue;
    if (scene.caption && scene.caption.text) {
      lines.push(...toWords(scene.caption.text, scene.caption.start, scene.caption.end).lines);
      continue;
    }
    if (scene.narration) {
      const data = buildCaptionsData(scene.narration, start / fps, frames / fps);
      lines.push(...data.lines);
    }
  }
  return { lines };
};

export const CaptionLayer: React.FC<{ data: CaptionsData; palette: Palette; width: number }> = ({ data, palette, width }) => {
  if (!data.lines.length) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: "7%", zIndex: 10, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ width: "100%", maxWidth: Math.round(width * 0.86) }}>
        <CaptionTheme data={data} theme={palette.captionTheme || "pop"} primaryColor={palette.captionPrimary || palette.text} secondaryColor={palette.captionSecondary || palette.accent} fontSize={Math.max(40, Math.round(width / 26))} />
      </div>
    </div>
  );
};
