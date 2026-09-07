import { PomeloRendererAdapter } from ".";
import { IElement } from "../pomelo-types/render.types";
import { PomeloBlock } from "./pomelo-block";

export class MountPointBlock extends PomeloBlock {
  constructor(adapter: PomeloRendererAdapter) {
    super({ id: 'virtual-root', type: 'virtual-root', attrs: {} as any }, adapter);
  }

  render() {
    return this.hostElement;
  }
}