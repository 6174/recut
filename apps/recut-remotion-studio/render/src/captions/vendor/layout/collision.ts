import { LayoutBox } from "./types";

export function collisionRate(a: LayoutBox, b: LayoutBox): number {
  const xOverlap = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  );
  const yOverlap = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  );
  const overlapArea = xOverlap * yOverlap;
  
  if (overlapArea <= 0) return 0;
  
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const smallerArea = Math.min(areaA, areaB);
  
  return smallerArea > 0 ? overlapArea / smallerArea : 0;
}
