import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { InternalThemeProps } from "../types";

const ACCENT_COLORS = [
  "#FF2D6B", // hot pink
  "#FF4500", // red-orange
  "#00E676", // green
  "#FF9100", // amber
  "#E040FB", // purple
  "#00B0FF", // cyan
  "#FFEA00", // yellow
];

export const PodcastTheme: React.FC<InternalThemeProps> = ({
  secondaryColor,
  data,
  fontSize,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const time = frame / fps;

  const scaleFactor = width / 1080;
  const baseSize = typeof fontSize === "number" ? fontSize : 68;
  const scaledFontSize = `${baseSize * scaleFactor}px`;
  const lineHeightPx = baseSize * scaleFactor * 1.3;

  const pairGap = 18 * scaleFactor;
  const wordGap = 12 * scaleFactor;

  // ── Find current line being spoken ───────────────────────────────────
  let currentLineIdx = 0;
  for (let i = 0; i < data.lines.length; i++) {
    const line = data.lines[i];
    if (line.words.length === 0) continue;
    const lineStart = line.words[0].start;
    const lineEnd = line.words[line.words.length - 1].end;
    if (time >= lineStart && time <= lineEnd) { 
      currentLineIdx = i; 
      break; 
    }
    if (time > lineEnd) currentLineIdx = i;
  }

  // Strictly chunk lines into separate 2-line scene blocks (0+1, 2+3, 4+5...)
  const currentPair = Math.floor(currentLineIdx / 2);
  const topLineIdx    = currentPair * 2;
  const bottomLineIdx = currentPair * 2 + 1;

  // ── Pair timing ───────────────────────────────────────────────────────
  const topLine    = data.lines[topLineIdx];
  const bottomLine = data.lines[bottomLineIdx] ?? data.lines[topLineIdx];

  const pairStartTime = topLine?.words[0]?.start ?? 0;
  const pairEndTime   = bottomLine?.words.length
    ? bottomLine.words[bottomLine.words.length - 1].end
    : (topLine?.words.length ? topLine.words[topLine.words.length - 1].end : 0);

  const slideInFrames = 0.2; 
  const fadeOutFrames = 0.2;

  const pairOpacity =
    time < pairStartTime || time > pairEndTime + fadeOutFrames
      ? 0
      : interpolate(
          time,
          [pairStartTime, pairStartTime + slideInFrames, pairEndTime, pairEndTime + fadeOutFrames],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

  const pairSlideY = interpolate(
    time,
    [pairStartTime, pairStartTime + slideInFrames],
    [12 * scaleFactor, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const accentColor =
    secondaryColor && secondaryColor !== "#ffffff"
      ? secondaryColor
      : ACCENT_COLORS[currentPair % ACCENT_COLORS.length];

  // Loop Animation (Subtle independent float cycles)
  const floatAmp   = 1.4 * scaleFactor; 
  const floatSpeed = 0.75; // Hz
  const topFloatY    = Math.sin(time * floatSpeed * Math.PI * 2) * floatAmp;
  const bottomFloatY = Math.sin(time * floatSpeed * Math.PI * 2 + 1.5) * floatAmp;
  
  const swayAmp = 1.0 * scaleFactor;
  const topSwayX    = Math.sin(time * floatSpeed * Math.PI * 2 + 0.5) * swayAmp;
  const bottomSwayX = Math.sin(time * floatSpeed * Math.PI * 2 + 2.1) * swayAmp;

  // ── Render a single line ──────────────────────────────────────────────
  const renderLine = (lineIdx: number, isBottom: boolean) => {
    const line = data.lines[lineIdx];
    if (!line || line.words.length === 0) {
      return <div style={{ height: `${lineHeightPx}px` }} />;
    }

    const isCurrentLine = lineIdx === currentLineIdx;
    const floatY = isBottom ? bottomFloatY : topFloatY;
    const swayX  = isBottom ? bottomSwayX  : topSwayX;

    // Both lines now share the exact same clean typography styling
    const fontFamily = 'Impact';

    // Prominent multi-layered text shadow for extra depth and readability
    const shadow =
      `0 ${4 * scaleFactor}px ${8 * scaleFactor}px hsla(66, 63%, 97%, 0.90), ` +
      `0 ${2 * scaleFactor}px ${4 * scaleFactor}px rgba(0,0,0,0.85), ` +
      `0 0 ${10 * scaleFactor}px rgba(0,0,0,0.5)`;

    return (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "baseline",
          gap: `0 ${wordGap}px`,
          height: `${lineHeightPx}px`,
          overflow: "visible",
          transform: `translateY(${floatY}px)`,
        }}
      >
        {line.words.map((word, wordIndex) => {
          const isFirst = wordIndex === 0;
          const isLast  = wordIndex === line.words.length - 1;
          const wordSwayX = isFirst ? -swayX : isLast ? swayX : 0;

          const isSpoken = isCurrentLine
            ? time >= word.start
            : time >= (line.words[0]?.start ?? 0);

          // Kinetic Word entry spring animation
          const wordSpring = spring({
            frame: frame - word.start * fps,
            fps,
            config: { damping: 12, mass: 0.4, stiffness: 150 },
          });

          const wordScale = isSpoken 
            ? (isCurrentLine ? interpolate(wordSpring, [0, 1], [0.8, 1]) : 1)
            : 0;
          const wordOpacity = isSpoken 
            ? (isCurrentLine ? interpolate(wordSpring, [0, 1], [0, 1]) : 1)
            : 0;

          // Color Assignment: Strict global coloring applied to all elements on the bottom line
          const color = isBottom ? accentColor : "#FFFFFF";

          return (
            <span
              key={wordIndex}
              style={{
                fontFamily,
                fontSize: scaledFontSize,
                fontWeight: 300,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color,
                textShadow: shadow,
                whiteSpace: "nowrap",
                display: "inline-block",
                opacity: wordOpacity,
                transform: `translateX(${wordSwayX}px) scale(${wordScale})`,
                transformOrigin: "center center",
              }}
            >
              {word.text}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: `${pairGap}px`,
        opacity: pairOpacity,
        transform: `translateY(${pairSlideY}px)`,
      }}
    >
      {renderLine(topLineIdx, false)}
      {renderLine(bottomLineIdx, true)}
    </div>
  );
};