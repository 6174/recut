import { Container } from "@pixi/react";
import { PixiBlock, PomeloBlockRecord, PomeloRendererAdapter, useBlockContext } from "../../../pomelo-core";
import { useEffect, useRef } from "react";
import * as PIXI from 'pixi.js';

export const PEN_GROUP_BLOCK_NAME = 'PenGroupBlock';

function PenGroupBlockContent() {
  const containerRef = useRef<PIXI.Container>();
  const block = useBlockContext();
  useEffect(() => {
    if (containerRef.current) {
      const hostElement = block.hostElement.el as PIXI.Container;
      hostElement.cacheAsBitmap = true;
    }
  }, [block]);

  return (
    <Container ref={containerRef} />
  );
}

export class PenGroupBlock extends PixiBlock {
  static type = PEN_GROUP_BLOCK_NAME;
  constructor(record: PomeloBlockRecord, adapter: PomeloRendererAdapter) {
    super(record, adapter);
    this.hostElement.el.alpha = 0.6;
  }
  renderBlockReact() {
    return <PenGroupBlockContent />;
  }
}