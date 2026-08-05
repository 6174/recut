import { Player } from "@remotion/player";
import { StoryVideo } from "@compositions/compositions/StoryVideo";
import type { Design, MediaMap } from "@compositions/types";

export function PlayerPanel({ design, mediaMap }: { design: Design; mediaMap: MediaMap }) {
  const fps = design.fps ?? 30;
  const width = design.width ?? 1920;
  const height = design.height ?? 1080;
  const durationInFrames = Math.max(1, Math.round((design.durationSec || 5) * fps));
  return (
    <Player
      acknowledgeRemotionLicense
      component={StoryVideo}
      compositionHeight={height}
      compositionWidth={width}
      controls
      durationInFrames={durationInFrames}
      fps={fps}
      initiallyMuted
      inputProps={{ design, media: mediaMap }}
      loop
      style={{ width: "100%", aspectRatio: `${width} / ${height}` }}
    />
  );
}
