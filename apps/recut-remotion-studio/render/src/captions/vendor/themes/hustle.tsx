import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { InternalThemeProps } from "../types";

export const HustleTheme: React.FC<InternalThemeProps> = ({
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
  const strokeWidth = `${12 * scaleFactor}px`;
  const activeStrokeWidth = `${4 * scaleFactor}px`;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: `${10 * scaleFactor}px ${20 * scaleFactor}px`,
        width: "90%",
        textAlign: "center",
      }}
    >
      {activeLine.words.map((word, index) => {
        const isActive = time >= word.start && time < word.end;

        const color = isActive ? secondaryColor : primaryColor;
        const stroke = isActive ? activeStrokeWidth : strokeWidth;

        return (
          <span
            key={index}
            style={{
              color,
              fontFamily: '"Montserrat", "Arial Black", sans-serif',
              fontSize: scaledFontSize,
              fontWeight: 900,
              fontStyle: "italic",
              textTransform: "uppercase",
              letterSpacing: `-${2 * scaleFactor}px`,
              WebkitTextStroke: `${stroke} #000000`,
              paintOrder: "stroke fill",
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
