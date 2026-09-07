// pomelo-renderer.ts
import { PomeloEditor } from "../pomelo-editor";
import { Diposables, Slot } from "../pomelo-common";
import { PomeloRendererAdapter } from "./pomelo-renderer-adapter";

export class PomeloRenderer extends Diposables {
  onRenderEvent = new Slot();
  constructor(
    public editor: PomeloEditor,
    public adapter: PomeloRendererAdapter
  ) {
    super();
    const state = this.editor.state;
    this.willDispose(state.onDocUpdateEvent.on(this.handleBlockUpdate));
    this.willDispose(state.onDocSyncStateEvent.on(this.handleBlockUpdate));
  }

  render() {
    this.adapter.render();
    this.onRenderEvent.emit();
  }

  handleBlockUpdate = () => {
    this.adapter.handleBlockUpdate();
    this.render();
  }

  destroy() {
    this.diposeAll();
  }
}