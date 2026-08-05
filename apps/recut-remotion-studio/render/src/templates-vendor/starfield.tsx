"use client";

import { useCurrentFrame, useVideoConfig } from "remotion";

export default function Starfield() {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const cx = width / 2;
  const cy = height / 2;
  const totalStars = 80;

  // Generate stars with deterministic positions based on index
  const stars = Array.from({ length: totalStars }, (_, i) => {
    // Deterministic seed values using index
    const seedAngle = ((i * 137.508) % 360) * (Math.PI / 180);
    const seedRadius = ((i * 31 + 17) % 50) / 50; // 0 to 1
    const speed = 0.5 + ((i * 7 + 3) % 10) / 10; // 0.5 to 1.5
    const baseSize = 1 + ((i * 13 + 5) % 3);

    // Progress of this star outward (loops every ~5 seconds)
    const cycleLength = fps * 5;
    const rawProgress = ((frame * speed + i * 15) % cycleLength) / cycleLength;
    const progress = rawProgress;

    // Start near center, move outward
    const maxRadius = Math.max(cx, cy) * 1.2;
    const radius = seedRadius * 20 + progress * maxRadius;

    const x = cx + Math.cos(seedAngle) * radius;
    const y = cy + Math.sin(seedAngle) * radius;

    // Stars grow as they move outward (perspective)
    const scale = 1 + progress * 2;
    const size = baseSize * scale;

    // Fade in as they leave center, fade out at edges
    const opacity = Math.min(progress * 4, 1) * Math.max(1 - progress * 0.8, 0.2);

    return { x, y, size, opacity, key: i };
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "#0a0a1a",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {stars.map((star) => (
        <div
          key={star.key}
          style={{
            position: "absolute",
            left: star.x,
            top: star.y,
            width: star.size,
            height: star.size,
            borderRadius: "50%",
            backgroundColor: "white",
            opacity: star.opacity,
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}
    </div>
  );
}
