// virtual-dom.ts
import { PomeloBlockRecord } from "./pomelo-block";

export interface VNode {
  type: string;
  props: Record<string, any>;
  children: VNode[];
  record: PomeloBlockRecord;
  key?: string | number;
}

export type PatchType = 'CREATE' | 'UPDATE' | 'REPLACE' | 'REMOVE';

export interface Patch {
  type: PatchType;
  vNode: VNode | null;
  blockId: string;
  index?: number;
}

export class VirtualDOM {
  static createVNode(record: PomeloBlockRecord, type: string, props: Record<string, any> = {}, key?: string | number, ...children: VNode[]): VNode {
    return { type, props, children, key, record };
  }

  static diff(oldNode: VNode | null, newNode: VNode | null, parentId: string = 'root', index: number = 0): Patch[] {
    const patches: Patch[] = [];

    if (oldNode === null) {
      patches.push({ type: 'CREATE', vNode: newNode, blockId: parentId, index });
      return patches;
    }

    if (newNode === null) {
      patches.push({ type: 'REMOVE', vNode: null, blockId: oldNode.key as string });
      return patches;
    }

    const currentId = newNode.key as string;

    if (oldNode.type !== newNode.type || oldNode.key !== newNode.key) {
      patches.push({ type: 'REPLACE', vNode: newNode, blockId: parentId, index });
    } else {
      if (!this.shallowEqual(oldNode.props, newNode.props)) {
        patches.push({ type: 'UPDATE', vNode: newNode, blockId: currentId });
      }

      const oldChildren = oldNode.children;
      const newChildren = newNode.children;
      const maxLength = Math.max(oldChildren.length, newChildren.length);

      for (let i = 0; i < maxLength; i++) {
        if (i >= oldChildren.length) {
          patches.push({ type: 'CREATE', vNode: newChildren[i], blockId: currentId, index: i });
        } else if (i >= newChildren.length) {
          patches.push({ type: 'REMOVE', vNode: null, blockId: oldChildren[i].key as string });
        } else {
          patches.push(...this.diff(oldChildren[i], newChildren[i], currentId, i));
        }
      }
    }

    return patches;
  }

  private static shallowEqual(obj1: Record<string, any>, obj2: Record<string, any>): boolean {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) {
      return false;
    }

    for (let key of keys1) {
      if (obj1[key] !== obj2[key]) {
        return false;
      }
    }

    return true;
  }
}

// block-patcher.ts
import { PomeloRendererAdapter } from './pomelo-renderer-adapter';

export class BlockPatcher {
  constructor(public adapter: PomeloRendererAdapter) {}
  applyPatches(patches: Patch[]) {
    for (const patch of patches) {
      switch (patch.type) {
        case 'CREATE':
          this.createBlock(patch);
          break;
        case 'UPDATE':
          this.updateBlock(patch);
          break;
        case 'REPLACE':
          this.replaceBlock(patch);
          break;
        case 'REMOVE':
          this.removeBlock(patch);
          break;
      }
    }
  }

  createBlock(patch: Patch) {
    const adapter = this.adapter;
    const blockMap = adapter.renderedBlockMap;
    const parentBlock = blockMap.get(patch.blockId);
    if (parentBlock) {
      const newBlock = adapter.createBlock(patch.vNode!.record);
      parentBlock.insertChild(newBlock, patch.index ?? 0);
      blockMap.set(patch.vNode!.key as string, newBlock);
      newBlock.render()
    }
  }

  updateBlock(patch: Patch) {
    const adapter = this.adapter;
    const blockMap = adapter.renderedBlockMap;
    const block = blockMap.get(patch.blockId);
    if (block) {
      block.updateProps(patch.vNode!.props);
      block.render()
    }
  }

  replaceBlock(patch: Patch) {
    const adapter = this.adapter;
    const blockMap = adapter.renderedBlockMap;
    const oldBlock = blockMap.get(patch.blockId);
    if (oldBlock && oldBlock.parent) {
      const parent = oldBlock.parent;
      const index = parent.children.indexOf(oldBlock);

      // Remove old block
      oldBlock.destroy();
      blockMap.delete(patch.blockId);
      parent.removeChild(index);

      // Create and insert new block
      const newBlock = adapter.createBlock(patch.vNode!.record);
      parent.insertChild(newBlock, index);
      blockMap.set(patch.vNode!.key as string, newBlock);
    }
  }

  removeBlock(patch: Patch) {
    const adapter = this.adapter;
    const blockMap = adapter.renderedBlockMap;
    const block = blockMap.get(patch.blockId);
    if (block && block.parent) {
      const parent = block.parent;
      const index = parent.children.indexOf(block);
      block.destroy();
      blockMap.delete(patch.blockId);
      parent.removeChild(index);
    }
  }
}