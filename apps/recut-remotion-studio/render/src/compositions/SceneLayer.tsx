import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { MediaImage } from "../media";
import { Palette, useImageMotion } from "../effects/registry";
import { TextFX } from "../effects/text";
import { Scene, MediaMap } from "../types";

export interface SceneLayerProps {
  scene: Scene;
  media: MediaMap;
  palette: Palette;
  frames: number;
}

const FADE = 6;

const TitleLayer: React.FC<{ scene: Scene; palette: Palette }> = ({ scene, palette }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(frame, [0, 12], [20, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", opacity, transform: `translateY(${y}px)`, padding: "0 8%" }}>
      <h1 style={{ fontSize: "5rem", fontWeight: 900, color: palette.text, margin: 0, lineHeight: 1.05, fontFamily: palette.fontFamily, letterSpacing: "-0.02em" }}>{scene.title}</h1>
      <div style={{ width: 140, height: 6, background: palette.accent, borderRadius: 3, marginTop: 24 }} />
    </div>
  );
};

const ContentHeading: React.FC<{ scene: Scene; palette: Palette }> = ({ scene, palette }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", top: "6%", left: "5%", right: "5%", opacity }}>
      <h2 style={{ fontSize: "2.6rem", fontWeight: 800, color: palette.text, margin: 0, fontFamily: palette.fontFamily, lineHeight: 1.15 }}>{scene.title}</h2>
    </div>
  );
};

const OutroLayer: React.FC<{ scene: Scene; palette: Palette }> = ({ scene, palette }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = interpolate(frame, [0, 20], [0.96, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", opacity, transform: `scale(${scale})`, padding: "0 8%" }}>
      <div style={{ width: 60, height: 60, borderRadius: 30, background: palette.accent, marginBottom: 28, opacity: 0.9 }} />
      <h1 style={{ fontSize: "4rem", fontWeight: 900, color: palette.text, margin: 0, fontFamily: palette.fontFamily, lineHeight: 1.1 }}>{scene.title}</h1>
    </div>
  );
};

export const SceneLayer: React.FC<SceneLayerProps> = ({ scene, media, palette, frames }) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, FADE], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [frames - FADE, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const motion = scene.imageAssetId ? useImageMotion("push-in", frames) : null;

  const isTextEffect = Boolean(scene.effectId && ["bounce-text", "typewriter", "glitch", "cinematic-title", "slide-text", "lower-third"].includes(scene.effectId));

  return (
    <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}>
      {scene.imageAssetId ? (
        <AbsoluteFill>
          <MediaImage media={media} assetId={scene.imageAssetId} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", ...motion }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.45) 100%)" }} />
        </AbsoluteFill>
      ) : null}

      {scene.kind === "content" ? (
        <>
          <ContentHeading scene={scene} palette={palette} />
          {isTextEffect && scene.effectId ? <TextFX effectId={scene.effectId} text={scene.title} subtitle={scene.narration} palette={palette} /> : null}
        </>
      ) : isTextEffect && scene.effectId ? (
        <TextFX effectId={scene.effectId} text={scene.title} subtitle={scene.kind === "outro" ? undefined : scene.narration} palette={palette} />
      ) : scene.kind === "outro" ? (
        <OutroLayer scene={scene} palette={palette} />
      ) : (
        <TitleLayer scene={scene} palette={palette} />
      )}
    </AbsoluteFill>
  );
};

export const SceneSequence: React.FC<{ start: number; frames: number } & SceneLayerProps> = ({ start, frames, ...props }) => (
  <Sequence from={start} durationInFrames={frames}>
    <SceneLayer frames={frames} {...props} />
  </Sequence>
);
