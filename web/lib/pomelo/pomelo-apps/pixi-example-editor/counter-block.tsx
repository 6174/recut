import * as PIXI from "pixi.js";
import { PixiBlock } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-block";
import { Container, Text} from "@pixi/react";
import { useEffect, useState } from "react";

function CounterBlockContent() {
  console.debug("renderme")
  const [counter, setCounter] = useState(0);
  const style = new PIXI.TextStyle({
    align: 'center',
    fill: '0xffffff',
    fontSize: 16
  });

  useEffect(() => {
    setInterval(() => {
      setCounter(v => v + 1)
    }, 1000)
  }, [])

  return ( 
    <Container>
      <Text
        text={`Hello World ${counter}`}
        anchor={0.5}
        x={220}
        y={150}
        style={style as any}
      />
    </Container>
  )
}

export class CounterBlock extends PixiBlock {
  static type = 'CounterBlock';
  renderBlockReact()  {
    return (<CounterBlockContent />)
  };

  renderBlock() {
    const container = new PIXI.Container();
    const text = new PIXI.Text('Hello World', {
      fontSize: 50,
      fill: 0xffffff,
      align: 'center',
      letterSpacing: 20
    });
    text.anchor.set(0.5);
    text.position.set(220, 150);
    container.addChild(text);
    return container;
  }
}