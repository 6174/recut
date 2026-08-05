import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { InternalThemeProps } from "../types";

export const SoftAITheme: React.FC<InternalThemeProps> = ({
  primaryColor,
  secondaryColor,
  data,
  fontSize,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const time = frame / fps;

  // Find active line
  let activeLineIdx = 0;
  for (let i = 0; i < data.lines.length; i++) {
    const line = data.lines[i];
    if (line.words.length === 0) continue;
    const lineStart = line.words[0].start;
    const lineEnd = line.words[line.words.length - 1].end;
    if (time >= lineStart && time <= lineEnd) {
      activeLineIdx = i;
      break;
    }
    if (time > lineEnd) {
      activeLineIdx = i;
    }
  }

  const activeLine = data.lines[activeLineIdx] || data.lines[0];
  if (!activeLine || !activeLine.words.length) return null;

  // Responsive scaling
  const scaleFactor = width / 1080;
  const baseSize = typeof fontSize === "number" ? fontSize : 72;
  const scaledFontSize = `${baseSize * scaleFactor}px`;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: `${10 * scaleFactor}px ${16 * scaleFactor}px`,
        maxWidth: "85%",
        textAlign: "center",
      }}
    >
      {activeLine.words.map((word, index) => {
        const isActive = time >= word.start && time < word.end;
        const wordStartFrame = Math.round(word.start * fps);

        const relativeFrame = frame - wordStartFrame;
        const opacity = interpolate(relativeFrame, [0, 10], [0, 1], {
          extrapolateRight: "clamp",
        });
        const blur = interpolate(relativeFrame, [0, 12], [25 * scaleFactor, 0], {
          extrapolateRight: "clamp",
        });

        // Use passed colors directly
        const color = isActive ? secondaryColor : primaryColor;

        return (
          <span
            key={index}
            style={{
              color,
              fontFamily: '"Outfit", sans-serif',
              fontSize: scaledFontSize,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              textShadow: `0 ${8 * scaleFactor}px ${24 * scaleFactor}px rgba(0,0,0,0.35)`,
              opacity,
              filter: `blur(${blur}px)`,
              display: "inline-block",
              transition: "color 0.15s ease",
            }}
          >
            {word.text}
          </span>
        );
      })}
    </div>
  );
};
