import React from "react";
import { CaptionTheme, CaptionsData } from "./vendor";

export { CaptionTheme } from "./vendor";
export { themeRegistry } from "./vendor";
export type { ThemeName } from "./vendor";
export type { CaptionsData, CaptionLine, WordTiming } from "./vendor";

/**
 * Deterministic word-level caption timing for a narration.
 *
 * Words are grouped into lines (default 5 words) and their duration is
 * proportional to their length. Timing is always derived from scene position +
 * text, never from Date.now()/Math.random(), so preview and render stay stable.
 */
export const buildCaptionsData = (
  narration: string,
  sceneStart: number,
  sceneDuration: number,
  wordsPerLine = 5,
): CaptionsData => {
  const words = String(narration || "")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return { lines: [] };

  const weight = words.reduce((sum, word) => sum + word.length, 0);
  const unit = Math.max((sceneDuration * 0.68) / Math.max(weight, 1), 0.02);
  const gap = Math.min(0.04, unit * 0.5);
  const lines: CaptionsData["lines"] = [];

  let cursor = sceneStart + Math.min(sceneDuration * 0.08, 0.4);
  for (let index = 0; index < words.length; index += wordsPerLine) {
    const group = words.slice(index, index + wordsPerLine);
    const lineWords = group.map((word) => {
      const start = cursor;
      const end = cursor + Math.max(word.length * unit, 0.12);
      cursor = end + gap;
      return { text: word, start, end };
    });
    lines.push({ words: lineWords });
  }
  return { lines };
};
