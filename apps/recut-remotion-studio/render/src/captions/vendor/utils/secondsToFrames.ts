export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}
