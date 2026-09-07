export interface PenPoint {
  x: number;
  y: number;
}

export interface PenPath {
  points: PenPoint[];
  color: string;
  width: number;
}