export type AnchorName =
  | "center" | "top" | "bottom" | "left" | "right"
  | "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

export interface FontSpec {
  family: string;
  size: number;
  weight: number | string;
  letterSpacing?: number;
}

export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
  anchors: Record<AnchorName, { x: number; y: number }>;
}

export type RelationType = "above" | "below" | "leftOf" | "rightOf" | "anchorTo";

export interface RelationSpec {
  type: RelationType;
  target: string;
  targetAnchor?: AnchorName;
  gap?: number;
  align?: AnchorName;
}

export interface TextElementSpec {
  id: string;
  text: string;
  font: FontSpec;
  relation?: RelationSpec;
}

export interface ComputedTextElement extends LayoutBox {
  id: string;
  text: string;
}

export interface LayoutResult {
  elements: Record<string, ComputedTextElement>;
  collisionRate: (idA: string, idB: string) => number;
}
