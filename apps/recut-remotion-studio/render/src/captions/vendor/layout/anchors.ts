import { AnchorName } from "./types";

export function resolveAnchors(
  x: number,
  y: number,
  width: number,
  height: number
): Record<AnchorName, { x: number; y: number }> {
  return {
    center: { x: x + width / 2, y: y + height / 2 },
    top: { x: x + width / 2, y },
    bottom: { x: x + width / 2, y: y + height },
    left: { x, y: y + height / 2 },
    right: { x: x + width, y: y + height / 2 },
    topLeft: { x, y },
    topRight: { x: x + width, y },
    bottomLeft: { x, y: y + height },
    bottomRight: { x: x + width, y: y + height },
  };
}
