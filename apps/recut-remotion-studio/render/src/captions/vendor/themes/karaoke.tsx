import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { InternalThemeProps } from "../types";

export const KaraokeTheme: React.FC<InternalThemeProps> = ({
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
        let fillPercent = 0;
        if (time >= word.end) {
          fillPercent = 100;
        } else if (time >= word.start && time < word.end) {
          const duration = word.end - word.start;
          const progress = (time - word.start) / duration;
          fillPercent = Math.min(100, Math.max(0, progress * 100));
        }

        return (
          <span
            key={index}
            style={{
              position: "relative",
              display: "inline-block",
              color: primaryColor,
            }}
          >
            <span>{word.text}</span>
            <span
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                color: secondaryColor,
                overflow: "hidden",
                whiteSpace: "nowrap",
                clipPath: `inset(0% ${100 - fillPercent}% 0% 0%)`,
              }}
            >
              {word.text}
            </span>
          </span>
        );
      })}
    </div>
  );
};
