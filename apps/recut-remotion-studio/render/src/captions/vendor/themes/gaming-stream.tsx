import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { InternalThemeProps } from "../types";

export const GamingStreamTheme: React.FC<InternalThemeProps> = ({
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
  const baseSize = typeof fontSize === "number" ? fontSize : 74;
  const scaledFontSize = `${baseSize * scaleFactor}px`;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: `${8 * scaleFactor}px ${14 * scaleFactor}px`,
        maxWidth: "85%",
        textAlign: "center",
      }}
    >
      {activeLine.words.map((word, index) => {
        const isActive = time >= word.start && time < word.end;
        const wordStartFrame = Math.round(word.start * fps);

        const relativeFrame = frame - wordStartFrame;
        const scale = interpolate(relativeFrame, [0, 8], [0.5, 1.0], {
          extrapolateRight: "clamp",
        });
        const opacity = interpolate(relativeFrame, [0, 6], [0, 1], {
          extrapolateRight: "clamp",
        });

        // Use passed colors directly
        const color = isActive ? secondaryColor : primaryColor;
        const glowColor = isActive ? secondaryColor : "transparent";

        return (
          <span
            key={index}
            style={{
              color,
              fontFamily: '"Rajdhani", sans-serif',
              fontSize: scaledFontSize,
              fontWeight: 900,
              textTransform: "uppercase",
              textShadow: isActive ? `0 0 ${20 * scaleFactor}px ${glowColor}` : "none",
              opacity,
              transform: `scale(${scale})`,
              display: "inline-block",
              transition: "color 0.1s ease",
            }}
          >
            {word.text}
          </span>
        );
      })}
    </div>
  );
};
