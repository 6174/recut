"use client";

import { useCurrentFrame, useVideoConfig } from "remotion";

export default function GradientShift() {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const t = frame / fps;

  // Slowly cycle through hue phases using sin waves
  const phase1 = Math.sin(t * 0.3) * 0.5 + 0.5;
  const phase2 = Math.sin(t * 0.3 + 2) * 0.5 + 0.5;
  const phase3 = Math.sin(t * 0.3 + 4) * 0.5 + 0.5;

  // Interpolate between deep blues, purples, teals
  const colors = [
    { r: 26, g: 26, b: 46 },   // #1a1a2e
    { r: 22, g: 33, b: 62 },   // #16213e
    { r: 15, g: 52, b: 96 },   // #0f3460
    { r: 26, g: 26, b: 46 },   // #1a1a2e
  ];

  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

  const idx1 = Math.floor(phase1 * 2);
  const frac1 = phase1 * 2 - idx1;
  const c1 = colors[idx1];
  const c1Next = colors[idx1 + 1];
  const color1 = `rgb(${lerp(c1.r, c1Next.r, frac1)}, ${lerp(c1.g, c1Next.g, frac1)}, ${lerp(c1.b, c1Next.b, frac1)})`;

  const idx2 = Math.floor(phase2 * 2);
  const frac2 = phase2 * 2 - idx2;
  const c2 = colors[idx2];
  const c2Next = colors[idx2 + 1];
  const color2 = `rgb(${lerp(c2.r, c2Next.r, frac2)}, ${lerp(c2.g, c2Next.g, frac2)}, ${lerp(c2.b, c2Next.b, frac2)})`;

  const idx3 = Math.floor(phase3 * 2);
  const frac3 = phase3 * 2 - idx3;
  const c3 = colors[idx3];
  const c3Next = colors[idx3 + 1];
  const color3 = `rgb(${lerp(c3.r, c3Next.r, frac3)}, ${lerp(c3.g, c3Next.g, frac3)}, ${lerp(c3.b, c3Next.b, frac3)})`;

  // Slowly rotate the gradient angle
  const angle = (frame * 0.5) % 360;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `linear-gradient(${angle}deg, ${color1}, ${color2}, ${color3})`,
      }}
    />
  );
}
