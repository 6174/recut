import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { InternalThemeProps } from "../types";

export const PoppinTheme: React.FC<InternalThemeProps> = ({
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
  const baseSize = typeof fontSize === "number" ? fontSize : 82;
  const scaledFontSize = `${baseSize * scaleFactor}px`;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: `${10 * scaleFactor}px ${16 * scaleFactor}px`,
        maxWidth: "95%",
        textAlign: "center",
      }}
    >
      {activeLine.words.map((word, index) => {
        const isActive = time >= word.start && time < word.end;

        // Use passed colors directly
        const color = isActive ? secondaryColor : primaryColor;

        return (
          <span
            key={index}
            style={{
              color,
              fontFamily: "'Poppins', sans-serif",
              fontSize: scaledFontSize,
              fontWeight: 900,
              textTransform: "uppercase",
              textShadow: `0 ${10 * scaleFactor}px ${20 * scaleFactor}px rgba(0,0,0,0.5)`,
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
