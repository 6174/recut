import React from "react";
import { Composition } from "remotion";
import { StoryVideo } from "./compositions/StoryVideo";
import { defaultDesign, Design } from "./types";

/**
 * Remotion root for the server-side render workspace. durationInFrames, fps and
 * canvas size are computed from the design input props so one bundle serves any
 * script, aspect ratio and frame rate.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="StoryVideo"
      component={StoryVideo}
      durationInFrames={30}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ design: defaultDesign(), media: {} }}
      calculateMetadata={({ props }: { props: { design?: Design } }) => {
        const design = props?.design || defaultDesign();
        const fps = design.fps || 30;
        const durationInFrames = Math.max(1, Math.round((design.durationSec || 5) * fps));
        const width = design.width || 1920;
        const height = design.height || 1080;
        return { durationInFrames, fps, width, height };
      }}
    />
  );
};
