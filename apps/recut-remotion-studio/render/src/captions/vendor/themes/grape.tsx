import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { InternalThemeProps } from "../types";

export const GrapeTheme: React.FC<InternalThemeProps> = ({
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

  // Entrance animation: fadeIn over 1.0s
  const lineStart = activeLine.words[0].start;
  const relativeFrame = frame - Math.round(lineStart * fps);
  const opacity = interpolate(relativeFrame, [0, 30], [0, 1], { extrapolateRight: "clamp" });

  // Custom background color matches passed primaryColor
  const backgroundColor = primaryColor;
  // If primary background is white/light, we use dark text for base, otherwise white text
  const isLightBg = primaryColor.toLowerCase() === "#ffffff" || primaryColor.toLowerCase() === "#fff";
  const baseTextColor = isLightBg ? "#111827" : "#ffffff";

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: `${10 * scaleFactor}px ${18 * scaleFactor}px`,
        background: backgroundColor,
        padding: `${12 * scaleFactor}px ${36 * scaleFactor}px`,
        borderRadius: `${8 * scaleFactor}px`,
        boxShadow: `0 ${20 * scaleFactor}px ${40 * scaleFactor}px rgba(0,0,0,0.3)`,
        maxWidth: "85%",
        textAlign: "center",
        opacity,
      }}
    >
      {activeLine.words.map((word, index) => {
        const isActive = time >= word.start && time < word.end;

        const color = isActive ? secondaryColor : baseTextColor;

        return (
          <span
            key={index}
            style={{
              color,
              fontFamily: '"Outfit", sans-serif',
              fontSize: scaledFontSize,
              fontWeight: 900,
              fontStyle: "italic",
              textTransform: "uppercase",
              display: "inline-block",
            }}
          >
            {word.text}
          </span>
        );
      })}
    </div>
  );
};
