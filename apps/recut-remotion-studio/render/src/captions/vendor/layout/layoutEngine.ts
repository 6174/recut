import { TextElementSpec, LayoutResult, ComputedTextElement } from "./types";
import { resolveAnchors } from "./anchors";
import { resolveRelation } from "./relations";
import { collisionRate } from "./collision";

function measureText(text: string, font: { size: number; family: string }): { width: number; height: number } {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context) {
      context.font = `${font.size}px ${font.family}`;
      const metrics = context.measureText(text);
      
      // Calculate based on the actual visual area the text stroke takes (bounding box)
      const ascent = metrics.actualBoundingBoxAscent ?? (font.size * 0.85);
      const descent = metrics.actualBoundingBoxDescent ?? (font.size * 0.25);
      const height = ascent + descent;

      // Use actual visual width if available, fallback to metrics.width
      const width = (metrics.actualBoundingBoxLeft !== undefined && metrics.actualBoundingBoxRight !== undefined)
        ? (metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight)
        : metrics.width;

      return {
        width: width || metrics.width,
        height: height || (font.size * 1.2),
      };
    }
  }
  return {
    width: text.length * font.size * 0.6,
    height: font.size * 1.2,
  };
}

export function computeLayout(elements: TextElementSpec[]): LayoutResult {
  const computed: Record<string, ComputedTextElement> = {};

  for (const el of elements) {
    const size = measureText(el.text, el.font);
    let x = 0;
    let y = 0;

    if (el.relation && el.relation.target && computed[el.relation.target]) {
      const targetBox = computed[el.relation.target];
      const coords = resolveRelation(el.relation, targetBox, size);
      x = coords.x;
      y = coords.y;
    } else {
      x = -size.width / 2;
      y = -size.height / 2;
    }

    const anchors = resolveAnchors(x, y, size.width, size.height);

    computed[el.id] = {
      id: el.id,
      text: el.text,
      x,
      y,
      width: size.width,
      height: size.height,
      anchors,
    };
  }

  return {
    elements: computed,
    collisionRate: (idA, idB) => {
      const boxA = computed[idA];
      const boxB = computed[idB];
      if (!boxA || !boxB) return 0;
      return collisionRate(boxA, boxB);
    },
  };
}
