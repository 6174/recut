import { Container, Graphics, Sprite, Text } from "@pixi/react";
import { PixiBlock, PomeloBlockRecord, useBlockContext } from "../../../pomelo-core";
import { useEffect, useState } from "react";
import { measureImageSize } from "../../../pomelo-utils/measure-image-size";
import * as PIXI from 'pixi.js';
export const AI_IMAGE_BLOCK_NAME = 'AIImageBlock';

function AIImageBlockContent() {
  const block = useBlockContext();
  const { width = 100, height = 100, src, mask } = block.props;
  const [imageSize, setImageSize] = useState({ width: 100, height: 100 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    measureImageSize(src).then(setImageSize).finally(() => setLoading(false));
  }, [src]);

  return (
    <Container position={[0, 0]}>
      {loading && <Text text="Loading..." />}

      <Sprite image={src} x={0} y={0} width={imageSize.width} height={imageSize.height} />

      {mask && (
        <Sprite
          image={mask}
          x={0}
          y={0}
          width={imageSize.width}
          height={imageSize.height}
          alpha={0.5}
          blendMode={PIXI.BLEND_MODES.MULTIPLY}
        />
      )}
    </Container>
  );
}

export class AIImageBlock extends PixiBlock {
  static type = AI_IMAGE_BLOCK_NAME;
  renderBlockReact() {
    return <AIImageBlockContent />;
  }
}