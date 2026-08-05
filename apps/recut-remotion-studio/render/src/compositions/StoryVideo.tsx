import React from "react";
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from "remotion";
import { mediaSrc } from "../media";
import { Palette } from "../effects/registry";
import { SceneSequence } from "./SceneLayer";
import { CaptionLayer, computeSceneTimings, buildGlobalCaptions } from "./CaptionLayer";
import { BackgroundFX } from "../effects/registry";
import { Design, MediaMap, StoryVideoProps } from "../types";

const TEMPLATE_PALETTES: Record<string, Palette> = {
  "paper-collage": { background: "#f4efe7", primary: "#14120f", accent: "#c46a2b", text: "#14120f", fontFamily: "Georgia, 'Times New Roman', serif" },
  "cinematic-dark": { background: "#0b0b12", primary: "#f5f2ea", accent: "#e8b341", text: "#f5f2ea", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  "clean-editorial": { background: "#f7f7f4", primary: "#111314", accent: "#1d5bd6", text: "#111314", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  "vibrant-tech": { background: "#12002a", primary: "#ffffff", accent: "#22d3ee", text: "#ffffff", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
};

export const resolvePalette = (design: Design): Palette => {
  const fallback = TEMPLATE_PALETTES[design.template] ?? TEMPLATE_PALETTES["clean-editorial"];
  const style = design.style || {};
  return {
    background: style.background || fallback.background,
    primary: style.primary || fallback.primary,
    accent: style.accent || fallback.accent,
    text: style.text || fallback.text,
    fontFamily: style.fontFamily || fallback.fontFamily,
    captionTheme: style.captionTheme,
    captionPrimary: style.captionPrimary,
    captionSecondary: style.captionSecondary,
  };
};

/**
 * StoryVideo — the single Remotion composition behind Remotion Studio.
 *
 * A scripted documentary: style template drives the palette/background, scenes
 * drive image + typography, and every content scene contributes to one global
 * word-level caption stream. Fully deterministic (no Math.random/Date.now).
 */
export const StoryVideo: React.FC<StoryVideoProps> = ({ design, media }) => {
  const { fps, width } = useVideoConfig();
  const palette = resolvePalette(design);
  const timings = computeSceneTimings(design, fps);
  const captionsData = buildGlobalCaptions(design, timings, fps);

  return (
    <AbsoluteFill style={{ background: palette.background }}>
      <BackgroundFX effectId={design.style?.effectId} palette={palette} />
      {timings.map(({ scene, start, frames }) => (
        <SceneSequence key={scene.id} scene={scene} media={media} palette={palette} frames={frames} start={start} />
      ))}
      <CaptionLayer data={captionsData} palette={palette} width={width} />
      {design.style?.bgmAssetId ? <Audio src={mediaSrc(media, design.style.bgmAssetId) || ""} /> : null}
    </AbsoluteFill>
  );
};
