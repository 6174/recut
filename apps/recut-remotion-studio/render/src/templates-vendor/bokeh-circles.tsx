"use client";

import { useCurrentFrame, useVideoConfig } from "remotion";

export default function BokehCircles() {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const t = frame / fps;

  const circles = Array.from({ length: 15 }, (_, i) => {
    // Fixed positions spread across the canvas
    const baseX = ((i * 173 + 53) % 100) / 100;
    const baseY = ((i * 241 + 97) % 100) / 100;

    // Slow drift using sin waves at different phases
    const driftX = Math.sin(t * 0.2 + i * 1.3) * 30;
    const driftY = Math.cos(t * 0.15 + i * 0.9) * 25;

    const x = baseX * width + driftX;
    const y = baseY * height + driftY;

    // Pulsing size
    const baseSize = 40 + ((i * 37 + 11) % 80); // 40-120px
    const pulse = Math.sin(t * 0.4 + i * 0.7) * 0.2 + 1;
    const size = baseSize * pulse;

    // Varying opacity between 0.1-0.3
    const opacity = 0.1 + ((i * 19 + 7) % 20) / 100;

    // Color selection: soft blues, purples, teals
    const colorOptions = [
      [59, 130, 246],  // blue
      [139, 92, 246],  // purple
      [20, 184, 166],  // teal
    ];
    const rgb = colorOptions[i % 3];

    return { x, y, size, opacity, rgb, key: i };
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "#111827",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {circles.map((circle) => (
        <div
          key={circle.key}
          style={{
            position: "absolute",
            left: circle.x,
            top: circle.y,
            width: circle.size,
            height: circle.size,
            borderRadius: "50%",
            background: `radial-gradient(circle, rgba(${circle.rgb[0]}, ${circle.rgb[1]}, ${circle.rgb[2]}, ${circle.opacity + 0.1}) 0%, rgba(${circle.rgb[0]}, ${circle.rgb[1]}, ${circle.rgb[2]}, 0) 100%)`,
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}
    </div>
  );
}
