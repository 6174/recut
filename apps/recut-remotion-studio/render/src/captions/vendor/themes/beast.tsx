import React from "react";
import { useCurrentFrame, useVideoConfig, spring } from "remotion";
import { InternalThemeProps } from "../types";

export const BeastTheme: React.FC<InternalThemeProps> = ({
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
  const baseSize = typeof fontSize === "number" ? fontSize : 92;
  const scaledFontSize = `${baseSize * scaleFactor}px`;
  const strokeWidth = `${12 * scaleFactor}px`;
  const shadowOffset = `${6 * scaleFactor}px`;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: `${12 * scaleFactor}px ${22 * scaleFactor}px`,
        maxWidth: "95%",
        textAlign: "center",
      }}
    >
      {activeLine.words.map((word, index) => {
        const isActive = time >= word.start && time < word.end;
        const wordStartFrame = Math.round(word.start * fps);

        const pop = spring({
          frame: frame - wordStartFrame,
          fps,
          config: { damping: 10, stiffness: 180 },
        });

        // Official MrBeast colors: white base, yellow active
        const color = isActive ? "#ffff00" : "#ffffff";

        const transform = isActive
          ? `scale(${1.0 + pop * 0.15}) rotate(-2deg)`
          : "scale(1) rotate(0deg)";

        return (
          <span
            key={index}
            style={{
              color,
              fontFamily: '"Komika Axis", "Montserrat", "Arial Black", sans-serif',
              fontSize: scaledFontSize,
              fontWeight: 900,
              fontStyle: "italic",
              textTransform: "uppercase",
              letterSpacing: `-${2 * scaleFactor}px`,
              WebkitTextStroke: `${strokeWidth} #000000`,
              textShadow: `${shadowOffset} ${shadowOffset} 0px #000000`,
              paintOrder: "stroke fill",
              transform,
              display: "inline-block",
              transition: "transform 0.1s cubic-bezier(0.175, 0.885, 0.32, 1.275), color 0.1s ease",
            }}
          >
            {word.text}
          </span>
        );
      })}
    </div>
  );
};
