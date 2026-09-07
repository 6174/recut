import { Container, Graphics, Sprite, Text } from "@pixi/react";
import { PixiBlock, PomeloBlockRecord, useBlockContext } from "../../../pomelo-core";
import { useEffect, useState } from "react";
import { measureImageSize } from "../../../pomelo-utils/measure-image-size";

export const IMAGE_BLOCK_NAME = 'ImageBlock';

function ImageBlockContent() {
  console.debug("ImageBlockContent")
  const block = useBlockContext();

  console.debug("block", block.props);
  const {width = 100, height = 100, src} = block.props;
  const [imageSize, setImageSize] = useState({width: 100, height: 100});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    measureImageSize(src).then(setImageSize).finally(() => setLoading(false));
  }, [src]);

  return (
    <Container position={[0, 0]}>
      {/* 画笔路径在这里渲染 */}
      <Graphics  draw={g => {
        g.clear();
        g.beginFill(0xff0000, 0.5);
        g.drawRect(0, 0, width, height);
        g.endFill();
      }} />

      {loading && <Text text="Loading..." />}

      <Sprite image={src} x={0} y={0} width={imageSize.width} height={imageSize.height} />

    </Container>
  )
}

export class ImageBlock extends PixiBlock {
  static type = IMAGE_BLOCK_NAME;
  renderBlockReact() {
    const record: PomeloBlockRecord = this.record;
    return (<ImageBlockContent />)
  };
}