import { PixiRendererAdapter } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-adapter";
import { PomeloPlugin } from "../../pomelo-core/pomelo-plugin";

export class CounterPlugin extends PomeloPlugin {
  Name: string = CounterPlugin.name;
  onEditorDidMount() {
    const adapter = this.editor.renderAdapter as PixiRendererAdapter;
    (window as any).app = adapter.app;
    console.debug("CounterPlugin onEditorDidMount", adapter);
  }
}