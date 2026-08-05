import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import Starfield from "../templates-vendor/starfield";
import BokehCircles from "../templates-vendor/bokeh-circles";
import GeometricPatterns from "../templates-vendor/geometric-patterns";
import LiquidWave from "../templates-vendor/liquid-wave";
import GradientShift from "../templates-vendor/gradient-shift";
import MatrixRain from "../templates-vendor/matrix-rain";

export interface Palette {
  background: string;
  primary: string;
  accent: string;
  text: string;
  fontFamily?: string;
  captionTheme?: string;
  captionPrimary?: string;
  captionSecondary?: string;
}

/**
 * Background effects. Visuals come from the vendored remotion-templates
 * components (reactvideoeditor.com, free to use); each one is wrapped with a
 * palette-tinted overlay so the design color system stays coherent.
 */
export const BackgroundFX: React.FC<{ effectId?: string; palette: Palette }> = ({ effectId, palette }) => {
  if (!effectId || effectId === "none") {
    return <div style={{ position: "absolute", inset: 0, background: palette.background }} />;
  }
  const body = (() => {
    switch (effectId) {
      case "starfield":
        return <Starfield />;
      case "bokeh":
        return <BokehCircles />;
      case "geometric":
        return <GeometricPatterns />;
      case "liquid-wave":
        return <LiquidWave />;
      case "gradient-shift":
        return <GradientShift />;
      case "matrix-rain":
        return <MatrixRain />;
      case "noise-grain":
        return <GrainOverlay />;
      default:
        return null;
    }
  })();
  if (body === null) {
    return <div style={{ position: "absolute", inset: 0, background: palette.background }} />;
  }
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0 }}>{body}</div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: palette.background,
          opacity: 0.22,
        }}
      />
    </div>
  );
};

/**
 * Film-grain overlay (thin, transparent). Reuses the deterministic cell-noise
 * technique from the vendored noise-grain template without its baked-in
 * background/text so it can sit on top of any scene.
 */
export const GrainOverlay: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const cellSize = 8;
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const noise = ((index * 1237 + frame * 7919) % 997) / 997;
      cells.push({ x: col * cellSize, y: row * cellSize, opacity: 0.02 + noise * 0.06, key: index });
    }
  }
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {cells.map((cell) => (
        <rect key={cell.key} x={cell.x} y={cell.y} width={cellSize} height={cellSize} fill="white" opacity={cell.opacity} />
      ))}
    </svg>
  );
};

/**
 * Deterministic slow push-in / pan for scene images (replaces the CSS-keyframe
 * ken-burns template, which is not frame-driven and therefore not renderable).
 */
export const useImageMotion = (kind: "push-in" | "pan-left" = "push-in", durationFrames: number, delay = 0) => {
  const frame = useCurrentFrame();
  const local = Math.max(0, frame - delay);
  if (kind === "pan-left") {
    const scale = interpolate(local, [0, durationFrames], [1.15, 1.3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const x = interpolate(local, [0, durationFrames], [0, -3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return { transform: `scale(${scale}) translateX(${x}%)` };
  }
  const scale = interpolate(local, [0, durationFrames], [1, 1.12], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return { transform: `scale(${scale})` };
};
