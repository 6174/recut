// pomelo-renderer-adapter.ts
import { Slot } from "../pomelo-common";
import { PomeloEditor } from "../pomelo-editor";
import { IElement } from "../pomelo-types/render.types";
import { PomeloBlock, PomeloBlockRecord } from "./pomelo-block";
import { MountPointBlock } from "./pomelo-block-mountpoint";
import { PomeloRenderer } from "./pomelo-renderer";
import { VirtualDOM, VNode, BlockPatcher, Patch } from "./pomelo-virtual";
import { pomeloPerf } from "../pomelo-perf";

const MOUNTPOINT_ROOT_ID = "virtual-root";
const VIRTUAL_ROOT_RECORD: PomeloBlockRecord = {
  id: MOUNTPOINT_ROOT_ID,
  type: 'document',
  attrs: {
    x: 0,
    y: 0,
    width: 800,
    height: 600
  }
}

interface LayoutStrategy {
  layout(block: PomeloBlock, children: PomeloBlock[]): void;
}

class DefaultLayoutStrategy implements LayoutStrategy {
  layout(block: PomeloBlock, children: PomeloBlock[]): void {
    // 默认布局逻辑
  }
}

export abstract class PomeloRendererAdapter {
  renderedBlockMap: Map<string, PomeloBlock> = new Map();
  editor: PomeloEditor = null!;
  renderer: PomeloRenderer = null!;
  cachedVNode: VNode = null!;
  mountpointBlock: MountPointBlock = null!;
  blockPatcher: BlockPatcher = null!;
  layoutStrategies: Map<string, LayoutStrategy> = new Map();
  transform: { x: number, y: number, scale: number } = { x: 0, y: 0, scale: 1 };
  containerSize: { width: number, height: number } = { width: 800, height: 600 };

  onResizeEvent = new Slot<{ width: number, height: number }>();
  onTransformEvent = new Slot<{ x: number, y: number, scale: number }>();

  constructor() {
  }

  abstract setTransform(x: number, y: number, scale: number): void;

  abstract setContainerSize(width: number, height: number): void;

  abstract createIElement(tag: string, block: PomeloBlock, props?: any): IElement;

  onInit(renderer: PomeloRenderer) {
    this.renderer = renderer;
    this.editor = renderer.editor;
    this.mountpointBlock = new MountPointBlock(this);
    this.renderedBlockMap.set(MOUNTPOINT_ROOT_ID, this.mountpointBlock);
    this.cachedVNode = this.createVNodeTree();
    this.blockPatcher = new BlockPatcher(this);
    this.layoutStrategies.set('default', new DefaultLayoutStrategy());
  }

  handleBlockUpdate() {
    pomeloPerf.time("block.update", () => {
      let rerendered = 0;
      const scanned = this.renderedBlockMap.size;
      for (const block of this.renderedBlockMap.values()) {
        if (block.computeBlockState(this.editor.state)) {
          block.render();
          rerendered += 1;
        }
      }
      if (rerendered > 0) pomeloPerf.event("block.update.scan", { scanned, rerendered });
    });
  }

  render() {
    pomeloPerf.time("adapter.render", () => {
      const rootBlockRecord = this.editor.state.getRootBlock()!;
      const blockRecords = rootBlockRecord.children || [];
      const newVNode = this.createVNodeTree(blockRecords);
      const patches = VirtualDOM.diff(this.cachedVNode, newVNode, MOUNTPOINT_ROOT_ID);
      this.cachedVNode = newVNode;
      this.blockPatcher.applyPatches(patches);
      this.layoutBlocks();
    });
  }

  createBlock(record: PomeloBlockRecord): PomeloBlock {
    let BlockClass = this.editor.blockTypeRegistry.get(record.type);
    if (!BlockClass) {
      throw new Error(`No block definition found for type: ${record.type}`);
    }
    const block = new BlockClass(record, this);
    this.renderedBlockMap.set(record.id, block);
    return block;
  }

  createVNodeTree(blockRecords: PomeloBlockRecord[] = []): VNode {
    return VirtualDOM.createVNode(VIRTUAL_ROOT_RECORD, 'document', {}, MOUNTPOINT_ROOT_ID,
      ...blockRecords.map(child => this.createVNode(child))
    );
  }

  createVNode(record: PomeloBlockRecord): VNode {
    return VirtualDOM.createVNode(
      record,
      record.type,
      record.attrs,
      record.id,
      ...(record.children || []).map(child => this.createVNode(child))
    );
  }

  layoutBlocks() {
    this.layoutBlock(this.mountpointBlock);
  }

  layoutBlock(block: PomeloBlock) {
    const layoutStrategy = this.layoutStrategies.get(block.type) ?? this.layoutStrategies.get('default');
    const childrenBlocks = block.children;
    // 递归布局子节点
    for (const childBlock of childrenBlocks) {
      this.layoutBlock(childBlock);
    }
    layoutStrategy?.layout(block, childrenBlocks);
  }

  registerLayoutStrategy(blockType: string, strategy: LayoutStrategy) {
    this.layoutStrategies.set(blockType, strategy);
  }

  getBlockById(id: string): PomeloBlock | undefined {
    return this.renderedBlockMap.get(id);
  }
}
