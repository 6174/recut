import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { WordTiming, InternalThemeProps } from "../types";
import { computeLayout } from "../layout/layoutEngine";
import { TextElementSpec, AnchorName } from "../layout/types";

// Helper function to group/chunk words of a line if it has more than 4 words
const groupWords = (words: WordTiming[]): WordTiming[][] => {
  if (words.length <= 4) return [words];
  const groups: WordTiming[][] = [];
  let i = 0;
  while (i < words.length) {
    const remaining = words.length - i;
    let chunkSize = 3;
    if (remaining === 5) {
      chunkSize = 3;
    } else if (remaining === 4) {
      chunkSize = 4;
    } else if (remaining < 3) {
      chunkSize = remaining;
    }
    groups.push(words.slice(i, i + chunkSize));
    i += chunkSize;
  }
  return groups;
};

// Check if a word is a filler word
const isFiller = (text: string) => {
  const clean = text.trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").toLowerCase();
  return /^(uhh|aah|um|uh|ah|oh|eh|er)$/i.test(clean);
};

// Check if a word has a visual pocket/cleft at the top-center (like "hook", "book", "look")
const hasTopCleft = (text: string): boolean => {
  const clean = text.trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
  if (clean.length < 3) return false;
  
  const isAscender = (char: string) => /^[bdfhklktA-Z1-9]/.test(char);
  const isShort = (char: string) => /^[aceomnursuvwxz]/.test(char);
  
  const first = clean[0];
  const last = clean[clean.length - 1];
  const middle = clean.slice(1, -1);
  
  const middleShort = middle.split("").every(isShort);
  return isAscender(first) && isAscender(last) && middleShort;
};

// Helper to resolve horizontal overlaps of side words positioned on the same vertical layer
const resolveHorizontalCollisions = (
  layerWords: { idx: number; left: number; top: number; width: number; height: number; layer: string }[]
) => {
  if (layerWords.length <= 1) return layerWords;
  
  // Sort from left to right
  const sorted = [...layerWords].sort((a, b) => a.left - b.left);
  
  // Resolve overlaps in a couple of passes
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const rightA = a.left + a.width;
      if (rightA > b.left) {
        const overlap = rightA - b.left;
        a.left -= overlap / 2;
        b.left += overlap / 2;
      }
    }
  }
  return sorted;
};

// Seeded pseudo-random generator
const seededRandom = (seed: number) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

export const Kinetic01: React.FC<InternalThemeProps> = ({
  primaryColor,
  secondaryColor,
  data,
  fontSize,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const time = frame / fps;

  // 1. Find the active line in captions data
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

  // 2. Chunk/Group active line's words if words count > 4
  const groups = React.useMemo(() => {
    return groupWords(activeLine.words);
  }, [activeLine]);

  // 3. Find which group is active based on time
  const activeGroupIdx = React.useMemo(() => {
    if (groups.length <= 1) return 0;
    const groupTimings = groups.map(g => {
      const start = g[0].start;
      const end = g[g.length - 1].end;
      return { start, end };
    });

    let activeIdx = 0;
    for (let i = 0; i < groupTimings.length; i++) {
      const { start, end } = groupTimings[i];
      if (time >= start && time <= end) {
        activeIdx = i;
        break;
      }
      if (time > end) {
        activeIdx = i;
      }
    }
    return activeIdx;
  }, [groups, time]);

  const activeGroup = groups[activeGroupIdx] || [];
  if (activeGroup.length === 0) return null;

  // 4. Responsive scaling calculation
  const scaleFactor = width / 1080;
  const baseSize = typeof fontSize === "number" ? fontSize : 72;
  const mainBaseSize = baseSize * 1.35;
  const sideBaseSize = baseSize * 0.7;

  // 5. Check if active spoken word is a filler word
  const activeWord = React.useMemo(() => {
    return activeGroup.find(w => time >= w.start && time < w.end) || activeGroup[0];
  }, [activeGroup, time]);

  const isActiveWordFiller = React.useMemo(() => {
    if (!activeWord) return false;
    return isFiller(activeWord.text);
  }, [activeWord]);

  // 6. Compute relational layout using the layout engine
  const layoutData = React.useMemo(() => {
    if (!activeGroup || activeGroup.length === 0) return null;

    // Identify the main word (longest word by letter count, excluding fillers if possible)
    const wordLengths = activeGroup.map(w => {
      const clean = w.text.replace(/[^a-zA-Z0-9]/g, "");
      return {
        length: clean.length,
        isFill: isFiller(w.text)
      };
    });

    let mainWordIdx = 0;
    let maxLength = -1;
    for (let i = 0; i < activeGroup.length; i++) {
      const { length, isFill } = wordLengths[i];
      if (!isFill && length > maxLength) {
        maxLength = length;
        mainWordIdx = i;
      }
    }

    // Fallback if all are fillers
    if (maxLength === -1) {
      for (let i = 0; i < activeGroup.length; i++) {
        const { length } = wordLengths[i];
        if (length > maxLength) {
          maxLength = length;
          mainWordIdx = i;
        }
      }
    }

    const mainWord = activeGroup[mainWordIdx];
    const specs: TextElementSpec[] = [];

    // First element in specs array must be the main word (root target)
    specs.push({
      id: `word_${mainWordIdx}`,
      text: mainWord.text,
      font: {
        family: '"Helvetica Neue", Helvetica, "Montserrat", Arial, sans-serif',
        size: mainBaseSize * scaleFactor,
        weight: 900,
      }
    });

    // Side words: construct relations relative to the main word
    const sideWordIndices = activeGroup
      .map((_, idx) => idx)
      .filter(idx => idx !== mainWordIdx);

    // Dynamic, unique, stable anchor selection for side words based on line index
    const seed = activeLineIdx + 1;
    const anchorOptions: AnchorName[] = [
      "topLeft",
      "topRight",
      "bottomLeft",
      "bottomRight",
      "top",
      "bottom",
      "left",
      "right",
    ];
    
    // Deterministic shuffle
    const shuffledAnchors: AnchorName[] = [...anchorOptions];
    let currentSeed = seed;
    for (let i = shuffledAnchors.length - 1; i > 0; i--) {
      const r = seededRandom(currentSeed);
      currentSeed = r * 10000;
      const j = Math.floor(r * (i + 1));
      const temp = shuffledAnchors[i];
      shuffledAnchors[i] = shuffledAnchors[j];
      shuffledAnchors[j] = temp;
    }

    // Force "top" anchor if main word has a top cleft and there are side words
    if (hasTopCleft(mainWord.text) && sideWordIndices.length > 0) {
      const topIdx = shuffledAnchors.indexOf("top");
      if (topIdx > -1) {
        shuffledAnchors.splice(topIdx, 1);
      }
      shuffledAnchors.unshift("top");
    }

    const sideAnchors: Record<number, string> = {};
    const usedAnchors = new Set<string>();

    const oppositeAnchorsMap: Record<string, string[]> = {
      topLeft: ["bottomRight", "bottom", "right"],
      topRight: ["bottomLeft", "bottom", "left"],
      bottomLeft: ["topRight", "top", "right"],
      bottomRight: ["topLeft", "top", "left"],
      top: ["bottom", "bottomLeft", "bottomRight"],
      bottom: ["top", "topLeft", "topRight"],
      left: ["right", "topRight", "bottomRight"],
      right: ["left", "topLeft", "bottomLeft"],
    };

    if (sideWordIndices.length === 2) {
      const anchor1 = shuffledAnchors[0];
      usedAnchors.add(anchor1);

      const opposites = oppositeAnchorsMap[anchor1] || [];
      const anchor2 = shuffledAnchors.find(a => opposites.includes(a) && !usedAnchors.has(a)) || 
                      shuffledAnchors.find(a => !usedAnchors.has(a)) || 
                      shuffledAnchors[1];
      usedAnchors.add(anchor2);

      const targetAnchors = [anchor1, anchor2];

      sideWordIndices.forEach((sideIdx, i) => {
        const targetAnchor = targetAnchors[i] as any;
        sideAnchors[sideIdx] = targetAnchor;

        specs.push({
          id: `word_${sideIdx}`,
          text: activeGroup[sideIdx].text,
          font: {
            family: '"Dancing Script", cursive',
            size: sideBaseSize * scaleFactor,
            weight: 700,
          },
          relation: {
            type: "anchorTo",
            target: `word_${mainWordIdx}`,
            targetAnchor,
          }
        });
      });
    } else {
      sideWordIndices.forEach((sideIdx) => {
        // Pick the first available unique anchor point
        const targetAnchor = shuffledAnchors.find(a => !usedAnchors.has(a)) || shuffledAnchors[0];
        usedAnchors.add(targetAnchor);
        sideAnchors[sideIdx] = targetAnchor;

        specs.push({
          id: `word_${sideIdx}`,
          text: activeGroup[sideIdx].text,
          font: {
            family: '"Dancing Script", cursive',
            size: sideBaseSize * scaleFactor,
            weight: 700,
          },
          relation: {
            type: "anchorTo",
            target: `word_${mainWordIdx}`,
            targetAnchor,
          }
        });
      });
    }

    const result = computeLayout(specs);

    return {
      result,
      mainWordIdx,
      sideAnchors,
    };
  }, [activeGroup, mainBaseSize, sideBaseSize, scaleFactor, activeLineIdx]);

  // Case A: Render filler words alone in the center, smaller, with simple scale/fade animation
  if (isActiveWordFiller && activeWord) {
    const wordStartFrame = Math.round(activeWord.start * fps);
    const relativeFrame = frame - wordStartFrame;

    const fillerOpacity = interpolate(relativeFrame, [0, 6], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const fillerScale = interpolate(relativeFrame, [0, 8], [0.8, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          width: "100%",
          height: "100%",
        }}
      >
        <div
          style={{
            fontFamily: '"Dancing Script", cursive',
            fontSize: `${sideBaseSize * scaleFactor}px`,
            fontWeight: 700,
            color: secondaryColor,
            opacity: fillerOpacity,
            transform: `scale(${fillerScale})`,
            textAlign: "center",
            textShadow: `0 ${4 * scaleFactor}px ${10 * scaleFactor}px rgba(0,0,0,0.5)`,
          }}
        >
          {activeWord.text}
        </div>
      </div>
    );
  }

  if (!layoutData) return null;
  const { result, mainWordIdx, sideAnchors } = layoutData;

  // 1. Calculate initial positions and layers for all words
  const initialPositions = activeGroup.map((_, idx) => {
    const elementId = `word_${idx}`;
    const box = result.elements[elementId];
    if (!box) return null;

    const isMainWord = idx === mainWordIdx;
    let left = box.x;
    let top = box.y;
    let layer = "middle";

    if (isMainWord) {
      layer = "main";
    } else if (sideAnchors[idx]) {
      const anchor = sideAnchors[idx];
      const mainBox = result.elements[`word_${mainWordIdx}`];
      if (mainBox) {
        const gap = 1 * scaleFactor;

        if (anchor === "topLeft") {
          left = mainBox.x;
          top = mainBox.y - box.height - gap;
          layer = "top";
        } else if (anchor === "topRight") {
          left = mainBox.x + mainBox.width - box.width;
          top = mainBox.y - box.height - gap;
          layer = "top";
        } else if (anchor === "bottomLeft") {
          left = mainBox.x;
          top = mainBox.y + mainBox.height + gap;
          layer = "bottom";
        } else if (anchor === "bottomRight") {
          left = mainBox.x + mainBox.width - box.width;
          top = mainBox.y + mainBox.height + gap;
          layer = "bottom";
        } else if (anchor === "top") {
          left = mainBox.x + (mainBox.width - box.width) / 2;
          const cleftOffset = hasTopCleft(activeGroup[mainWordIdx].text) ? (0.33 * mainBox.height) : 0;
          top = mainBox.y - box.height - gap + cleftOffset;
          layer = "top";
        } else if (anchor === "bottom") {
          left = mainBox.x + (mainBox.width - box.width) / 2;
          top = mainBox.y + mainBox.height + gap;
          layer = "bottom";
        } else if (anchor === "left") {
          left = mainBox.x - box.width - gap;
          top = mainBox.y + (mainBox.height - box.height) / 2;
          layer = "middle";
        } else if (anchor === "right") {
          left = mainBox.x + mainBox.width + gap;
          top = mainBox.y + (mainBox.height - box.height) / 2;
          layer = "middle";
        }
      }
    }

    return {
      idx,
      left,
      top,
      width: box.width,
      height: box.height,
      layer,
    };
  }).filter(Boolean) as { idx: number; left: number; top: number; width: number; height: number; layer: string }[];

  // 2. Resolve horizontal collisions for top layer
  const topLayerWords = initialPositions.filter(p => p.layer === "top");
  const resolvedTop = resolveHorizontalCollisions(topLayerWords);

  // 3. Resolve horizontal collisions for bottom layer
  const bottomLayerWords = initialPositions.filter(p => p.layer === "bottom");
  const resolvedBottom = resolveHorizontalCollisions(bottomLayerWords);

  // Create a map of final left coordinates
  const finalLeftMap: Record<number, number> = {};
  initialPositions.forEach(p => {
    finalLeftMap[p.idx] = p.left;
  });
  resolvedTop.forEach(p => {
    finalLeftMap[p.idx] = p.left;
  });
  resolvedBottom.forEach(p => {
    finalLeftMap[p.idx] = p.left;
  });

  // Decide line-wide animation category deterministically based on line index
  // If the active group only has a single word, force the slide up animation (animType = 1)
  const animType = activeGroup.length === 1 ? 1 : (activeLineIdx % 3); // 0 = none, 1 = slide up, 2 = fade

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div style={{ position: "relative", width: 0, height: 0 }}>
        {activeGroup.map((word, idx) => {
          const elementId = `word_${idx}`;
          const box = result.elements[elementId];
          if (!box) return null;

          const isCurrentWordActive = time >= word.start && time < word.end;
          const wordStartFrame = Math.round(word.start * fps);
          const relativeFrame = frame - wordStartFrame;

          // Only reveal word when it is spoken
          if (relativeFrame < 0) return null;

          const isMainWord = idx === mainWordIdx;

          // Get final collision-resolved coordinates
          const left = finalLeftMap[idx] !== undefined ? finalLeftMap[idx] : box.x;
          const posObj = initialPositions.find(p => p.idx === idx);
          const top = posObj ? posObj.top : box.y;

          // Animations calculation
          let opacity = 1;
          let transform = "none";
          let filter = "none";

          if (isMainWord) {
            if (animType === 1) {
              // Slide Up
              opacity = interpolate(relativeFrame, [0, 6], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              const translateY = interpolate(relativeFrame, [0, 10], [25 * scaleFactor, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              transform = `translateY(${translateY}px)`;
            } else if (animType === 2) {
              // Blur In + Fade In
              opacity = interpolate(relativeFrame, [0, 8], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              const blurPx = interpolate(relativeFrame, [0, 8], [12, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              filter = `blur(${blurPx}px)`;
            }
          } else {
            // Alternate side word animations based on index to show some side words without animation (instant reveal)
            const isSideAnimated = (idx + activeLineIdx) % 2 === 0;

            if (isSideAnimated) {
              opacity = interpolate(relativeFrame, [0, 6], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              const translateY = interpolate(relativeFrame, [0, 8], [15 * scaleFactor, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              const scale = interpolate(relativeFrame, [0, 8], [0.85, 1.0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              transform = `translateY(${translateY}px) scale(${scale})`;
            } else {
              // No animation - instant reveal
              opacity = relativeFrame >= 0 ? 1 : 0;
              transform = "none";
            }
          }

          const font = isMainWord
            ? '"Helvetica Neue", Helvetica, "Montserrat", Arial, sans-serif'
            : '"Dancing Script", cursive';
          const size = isMainWord ? mainBaseSize : sideBaseSize;
          const weight = isMainWord ? 900 : 700;
          const color = isCurrentWordActive ? secondaryColor : primaryColor;
          
          const textShadow = isMainWord
            ? `0 ${8 * scaleFactor}px ${18 * scaleFactor}px rgba(0,0,0,0.6)`
            : `0 ${4 * scaleFactor}px ${10 * scaleFactor}px rgba(0,0,0,0.5)`;

          return (
            <div
              key={idx}
              style={{
                position: "absolute",
                left,
                top,
                width: box.width,
                height: box.height,
                fontFamily: font,
                fontSize: `${size * scaleFactor}px`,
                fontWeight: weight,
                color,
                opacity,
                transform,
                filter,
                textAlign: "center",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                textShadow,
                whiteSpace: "nowrap",
                transition: "color 0.1s ease",
              }}
            >
              {word.text}
            </div>
          );
        })}
      </div>
    </div>
  );
};
