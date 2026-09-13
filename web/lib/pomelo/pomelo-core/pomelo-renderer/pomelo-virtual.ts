// virtual-dom.ts
// Bug 修复记录（2026-09-09）：容器切换后画布全是外层 context 的残留块——根因是
// BlockPatcher.removeBlock/replaceBlock 用 block.parent（get: renderedBlockMap.get(record.pid)）
// 解析父块，但顶层块 record.pid 为空 → parent undefined → 删除分支整体跳过：
// 块既不销毁也不从 renderedBlockMap 移除，Pixi 舞台留下全部旧块。
// 修复：parent 为空时回退 mountpointBlock（顶层块都挂在挂载点下），删除/替换真正生效。
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

      // children 按 key 对账（不按下标）：列表中间插入/删除元素不会引发后续整段错位 REPLACE
      const oldChildren = oldNode.children;
      const newChildren = newNode.children;
      const oldKeyMap = new Map<string, { vnode: VNode; index: number }>();
      oldChildren.forEach((child, index) => oldKeyMap.set(String(child.key), { vnode: child, index }));

      // 先移除已消失的 key；维护模拟顺序 sim，保证 CREATE 插入 index 与逐 patch 应用后的真实位置一致
      const sim: string[] = oldChildren.map((child) => String(child.key));
      for (const key of sim.slice()) {
        if (!newChildren.some((child) => String(child.key) === key)) {
          patches.push({ type: 'REMOVE', vNode: null, blockId: key });
          sim.splice(sim.indexOf(key), 1);
        }
      }

      newChildren.forEach((child, index) => {
        const key = String(child.key);
        const oldChild = oldKeyMap.get(key);
        if (oldChild) {
          patches.push(...this.diff(oldChild.vnode, child, currentId, index));
        } else {
          // 插到新顺序里前一个已存在节点的后面
          let insertIndex = sim.length;
          for (let j = index - 1; j >= 0; j--) {
            const prev = String(newChildren[j].key);
            const position = sim.indexOf(prev);
            if (position !== -1) {
              insertIndex = position + 1;
              break;
            }
          }
          patches.push({ type: 'CREATE', vNode: child, blockId: currentId, index: insertIndex });
          sim.splice(insertIndex, 0, key);
        }
      });
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
      // 构造期 blockState 由基类默认 selector 计算（子类字段尚未初始化），这里重算一次再渲染，
      // 否则新 block 首帧渲染为空，要等下一次文档更新才出现
      newBlock.computeBlockState(adapter.editor.state);
      newBlock.render();
      adapter.onBlockInvalidated?.(patch.vNode!.key as string, "content");
    }
  }

  updateBlock(patch: Patch) {
    const adapter = this.adapter;
    const blockMap = adapter.renderedBlockMap;
    const block = blockMap.get(patch.blockId);
    if (block) {
      // 仅 x/y 变化时只重定位、不重建内容容器（拖拽高频路径：
      // renderBlock 全量重建 + 文本重栅格代价大且视觉无差异）
      const changed = Object.keys(patch.vNode!.record.attrs).filter(
        (key) => block.record.attrs[key] !== patch.vNode!.record.attrs[key],
      );
      block.updateProps(patch.vNode!.props);
      // attrs 落地后必须重算 blockState：子类 selector 会读取自身 attrs（如 RelationArrowBlock
      // 的 fromId/toId/label），而 onDocUpdateEvent 的 handleBlockUpdate 在 updateProps 之前
      // 已经扫过一遍，此处不重算会让连线按上一帧属性渲染（换类型/换方向后画布不更新）。
      const stateChanged = block.computeBlockState(adapter.editor.state);
      const positionOnly = changed.length > 0 && changed.every((key) => key === "x" || key === "y");
      if (positionOnly && !stateChanged && typeof (block as unknown as { reposition?: () => void }).reposition === "function") {
        (block as unknown as { reposition: () => void }).reposition();
        adapter.onBlockInvalidated?.(patch.blockId, "position");
      } else {
        block.render();
        adapter.onBlockInvalidated?.(patch.blockId, "content");
      }
    }
  }

  replaceBlock(patch: Patch) {
    const adapter = this.adapter;
    const blockMap = adapter.renderedBlockMap;
    const oldBlock = blockMap.get(patch.blockId);
    if (!oldBlock) return;
    // 顶层块的 record.pid 不指向真实父块（pid 为空），parent getter 会取不到；
    // 回退到挂载点，否则旧块永远不会被移除（容器切换时新 context 里全是外层残留）
    const parent = oldBlock.parent ?? adapter.mountpointBlock;
    const index = parent.children.indexOf(oldBlock);

    // Remove old block
    blockMap.delete(patch.blockId);
    if (index !== -1) {
      oldBlock.destroy();
      parent.removeChild(index);
    } else {
      oldBlock.destroy();
    }

    // Create and insert new block
    const newBlock = adapter.createBlock(patch.vNode!.record);
    parent.insertChild(newBlock, index === -1 ? parent.children.length : index);
    blockMap.set(patch.vNode!.key as string, newBlock);
    adapter.onBlockInvalidated?.(oldBlock.record.id, "removed");
    adapter.onBlockInvalidated?.(patch.vNode!.key as string, "content");
  }

  removeBlock(patch: Patch) {
    const adapter = this.adapter;
    const block = adapter.renderedBlockMap.get(patch.blockId);
    if (!block) return;
    // 同 replaceBlock：顶层块 pid 为空时回退挂载点，保证删除真正生效
    const parent = block.parent ?? adapter.mountpointBlock;
    const index = parent.children.indexOf(block);
    adapter.renderedBlockMap.delete(patch.blockId);
    if (index !== -1) {
      parent.removeChild(index);
    } else {
      block.destroy();
    }
  }
}