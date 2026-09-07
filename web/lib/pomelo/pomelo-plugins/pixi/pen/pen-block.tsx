import { Container, Graphics } from "@pixi/react";
import { PixiBlock, PomeloBlockRecord } from "../../../pomelo-core";
import { useEffect, useRef } from "react";
import * as PIXI from 'pixi.js';
import { generateSmoothPath } from "./pen-utils";
import { PenPath } from "./pen.type";

export const PEN_BLOCK_NAME = 'PenBlock';

function PenBlockContent(props: { paths: PenPath[] }) {
  const { paths } = props;
  const graphicsRef = useRef<PIXI.Graphics>();
  const containerRef = useRef<PIXI.Container>();

  useEffect(() => {
    if (graphicsRef.current) {
      const graphics = graphicsRef.current;
      graphics.clear();

      paths.forEach(path => {
        const pathCommands = generateSmoothPath(path.points);
        if (pathCommands.length === 0) return;

        graphics.lineStyle({
          width: path.width,
          color: parseInt(path.color.replace('#', '0x')),
          cap: PIXI.LINE_CAP.ROUND,    // 设置线条端点为圆形
          join: PIXI.LINE_JOIN.ROUND,  // 设置线条连接处为圆形
        });
        // graphics.blendMode = PIXI.BLEND_MODES.COLOR_DODGE;

        pathCommands.forEach(command => {
          if (command.type === 'moveTo') {
            graphics.moveTo(command.points[0].x, command.points[0].y);
          } else {
            graphics.quadraticCurveTo(
              command.points[0].x,
              command.points[0].y,
              command.points[1].x,
              command.points[1].y
            );
          }
        });
      });
    }
  }, [paths]);

  return (
    <Container ref={containerRef} >
      <Graphics ref={graphicsRef} />
    </Container>
  );
}

export class PenBlock extends PixiBlock {
  static type = PEN_BLOCK_NAME;

  renderBlockReact() {
    const record: PomeloBlockRecord = this.record;
    const paths = record.attrs.paths || [];
    return <PenBlockContent paths={paths} />;
  }
}