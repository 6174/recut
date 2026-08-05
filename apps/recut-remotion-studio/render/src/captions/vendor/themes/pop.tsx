import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { InternalThemeProps } from "../types";

export const PopTheme: React.FC<InternalThemeProps> = ({
  primaryColor,
  secondaryColor,
  data,
  fontSize,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
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

  const size = typeof fontSize === "number" ? `${fontSize}px` : (fontSize ?? "4.5rem");

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: "15px 25px",
        fontSize: size,
        fontWeight: 900,
        fontFamily: "'Outfit', sans-serif",
        textAlign: "center",
        padding: "20px 40px",
        textShadow: "2px 2px 10px rgba(0, 0, 0, 0.5)",
        width: "100%",
        height: "100%",
      }}
    >
      {activeLine.words.map((word, index) => {
        const startFrame = Math.round(word.start * fps);
        const isActive = time >= word.start && time < word.end;

        const scale = spring({
          frame: frame - startFrame,
          fps,
          config: {
            damping: 10,
            mass: 0.4,
            stiffness: 150,
          },
        });

        const color = isActive ? secondaryColor : primaryColor;
        const transform = isActive ? `scale(${1 + scale * 0.2})` : "scale(1)";
        const opacity = isActive ? 1 : 0.6;

        return (
          <span
            key={index}
            style={{
              color,
              transform,
              opacity,
              display: "inline-block",
              transition: "transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275), color 0.1s ease",
            }}
          >
            {word.text}
          </span>
        );
      })}
    </div>
  );
};
