import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { InternalThemeProps } from "../types";

export const SimpleOneWordTheme: React.FC<InternalThemeProps> = ({
  primaryColor,
  data,
  fontSize,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const time = frame / fps;

  let activeWordText = "";
  for (const line of data.lines) {
    for (const word of line.words) {
      if (time >= word.start && time < word.end) {
        activeWordText = word.text;
        break;
      }
    }
    if (activeWordText) break;
  }

  if (!activeWordText) return null;

  // Responsive scaling
  const scaleFactor = width / 1080;
  const baseSize = typeof fontSize === "number" ? fontSize : 82;
  const scaledFontSize = `${baseSize * scaleFactor}px`;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        width: "100%",
        height: "100%",
        textAlign: "center",
      }}
    >
      <span
        style={{
          color: primaryColor,
          fontFamily: '"Outfit", "Inter", sans-serif',
          fontSize: scaledFontSize,
          fontWeight: 800,
          textTransform: "uppercase",
        }}
      >
        {activeWordText}
      </span>
    </div>
  );
};
