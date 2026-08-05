import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { InternalThemeProps } from "../types";

const seededRandom = (seed: number) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

const getHighlightedWordIndices = (
  words: { text: string }[],
  lineSeed: number
) => {
  if (words.length === 0) return new Set<number>();

  const highlightCount = words.length <= 4 ? 1 : 2;

  const scored = words.map((w, i) => ({
    i,
    len: w.text.replace(/[^a-zA-Z0-9]/g, "").length,
    tieBreak: seededRandom(lineSeed * 97 + i * 13),
  }));

  scored.sort((a, b) => {
    if (b.len !== a.len) return b.len - a.len;
    return b.tieBreak - a.tieBreak;
  });

  return new Set(scored.slice(0, Math.min(highlightCount, words.length)).map((s) => s.i));
};

export const AaritTheme: React.FC<InternalThemeProps> = ({
  primaryColor,
  secondaryColor,
  data,
  fontSize,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const time = frame / fps;

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

  const scaleFactor = width / 1080;
  const baseSize = typeof fontSize === "number" ? fontSize : 72;
  const scaledFontSize = `${baseSize * scaleFactor}px`;

  const lineStart = activeLine.words[0].start;
  const lineEnd = activeLine.words[activeLine.words.length - 1].end;
  const lineStartFrame = Math.round(lineStart * fps);
  const lineEndFrame = Math.round(lineEnd * fps);
  const lineDuration = Math.max(1, lineEndFrame - lineStartFrame);

  const containerScale = interpolate(
    frame - lineStartFrame,
    [0, lineDuration],
    [1.0, 1.15],
    { extrapolateRight: "clamp" }
  );

  const highlightedWordIndices = getHighlightedWordIndices(
    activeLine.words,
    activeLineIdx
  );

  // ── Gap reduced by 90% ──────────────────────────────────────────────
  const letterGapPx = 3 * scaleFactor;
  const wordGapPx = 14 * scaleFactor;
  // ────────────────────────────────────────────────────────────────────
  const letterStaggerFrames = 1.5;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        maxWidth: "85%",
        textAlign: "center",
        transform: `scale(${containerScale}) perspective(800px)`,
        transition: "transform 0.05s ease-out",
      }}
    >
      {activeLine.words.map((word, wordIndex) => {
        const wordStartFrame = Math.round(word.start * fps);
        const isHighlighted = highlightedWordIndices.has(wordIndex);
        const isLastWord = wordIndex === activeLine.words.length - 1;

        const letters = word.text.split("");

        const wordRelativeFrame = frame - wordStartFrame;
        const wordOpacity = interpolate(
          wordRelativeFrame,
          [0, 8],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );
        const wordTranslateY = interpolate(
          wordRelativeFrame,
          [0, 10],
          [22 * scaleFactor, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        return (
          <span
            key={wordIndex}
            style={{
              display: "inline-flex",
              marginBottom: `${10 * scaleFactor}px`,
              opacity: wordOpacity,
              transform: `translateY(${wordTranslateY}px)`,
            }}
          >
            {letters.map((letter, letterIndex) => {
              const letterStartFrame =
                wordStartFrame + letterIndex * letterStaggerFrames;
              const letterRelativeFrame = frame - letterStartFrame;

              const restingScale = isHighlighted ? 1.12 : 1.0;
              const zoomOutScale = restingScale + 0.35;
              const letterScale = interpolate(
                letterRelativeFrame,
                [0, 10],
                [zoomOutScale, restingScale],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
              );

              const isLastLetterOfWord = letterIndex === letters.length - 1;

              // ── Highlighted letters: flat secondaryColor, no shine ──
              const textShadow = `0 ${4 * scaleFactor}px ${8 * scaleFactor}px rgba(0,0,0,0.85), 0 ${2 * scaleFactor}px ${4 * scaleFactor}px rgba(0,0,0,0.7)`;

              return (
                <span
                  key={letterIndex}
                  style={{
                    display: "inline-block",
                    fontFamily: '"Poppins", sans-serif',
                    fontSize: scaledFontSize,
                    fontWeight: 900,
                    textTransform: "uppercase",
                    letterSpacing: "-0.02em",
                    marginRight: `${letterGapPx + (isLastLetterOfWord && !isLastWord ? wordGapPx : 0)}px`,
                    transform: `scale(${letterScale})`,
                    transition: "transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.1)",
                    color: isHighlighted ? secondaryColor : primaryColor,
                    textShadow,
                  }}
                >
                  {letter}
                </span>
              );
            })}
          </span>
        );
      })}
    </div>
  );
};