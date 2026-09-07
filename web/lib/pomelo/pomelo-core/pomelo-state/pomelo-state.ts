import * as Y from "yjs";
import { PomeloDoc, PomeloTransform } from "../pomelo-types/doc.types";
import { Slot } from "../pomelo-common";
import { PomeloBlockRecord } from "../pomelo-renderer";
export type PomeloTransactionHook = {
  addBlock: (block: PomeloBlockRecord, parentId?: string) => void;
  updateBlock: (blockId: string, updates: Partial<PomeloBlockRecord["attrs"]>) => void;
  removeBlock: (blockId: string) => void;
  updateBlockState: (blockId: string, state: any) => void;
}

export type PomeloStateSelector<T> = (state: PomeloEditorState) => T;

export type PomeloDocUpdateEvent = {
  payload: {
    addedBlocks?: PomeloBlockRecord[],
    removedBlocks?: string[],
    updatedBlocks?: { id: string, updates: Partial<PomeloBlockRecord["attrs"]> }[],
  }
}

export type PomeloSelectionChangeEvent = {
  payload: any
}

export type PomeloViewportChangeEvent = {
  payload: {
    transform: PomeloTransform
  }
}

export type PomeloUndoRedoEvent = {
  payload: {
    canUndo: boolean;
    canRedo: boolean;
  }
}

export type PomeloModeChangeEvent = {
  payload: {
    mode: string;
    enabled: boolean;
  }
}

export class PomeloEditorState {
  ydoc: Y.Doc;
  blockLocalAttrsState: Map<string, any> = new Map();
  undoManager: Y.UndoManager;

  // 编辑器模式，比如画笔模式，拖拽模式
  editorModes: Map<string, any> = new Map();

  // 选区状态
  selection: string[];
  onSelectionChangeEvent = new Slot<PomeloSelectionChangeEvent>();
  onModeChangeEvent = new Slot<PomeloModeChangeEvent>();

  // viewport 状态
  transform: PomeloTransform = { x: 0, y: 0, scale: 1 };
  onViewportChangeEvent = new Slot<PomeloViewportChangeEvent>();

  // Block 关系和缓存，方便读取，写扩散
  blockMap: Map<string, Y.Map<any>> = new Map();
  blockRecordMap: Map<string, PomeloBlockRecord> = new Map();
  parentChildMap: Map<string, { parentId: string | null, childIds: Set<string>, root?: boolean }> = new Map();
  
  // 关键的几个事件
  onDocUpdateEvent = new Slot<PomeloDocUpdateEvent>();
  onDocSyncStateEvent = new Slot();
  onUndoRedoEvent = new Slot<PomeloUndoRedoEvent>();

  rootBlockId: string = "document";
  
  constructor() {
    this.ydoc = new Y.Doc();
    this.#createEmptyDocRoot()

    this.undoManager = new Y.UndoManager([this.ydoc.getMap("document")], {
      captureTimeout: 500,
    });

    this.ydoc.on('update', (update: Uint8Array, origin: any) => {
      if (origin === this.undoManager) {
        this.#syncState();
      }
    });
  }

  /**
   * 对外最重要的方法，通过 transact 的方式来更新文档
   * @param callback 
   */
  transact(callback: (transactionHook: PomeloTransactionHook) => void) {
    const transactionUpdates = {
      removedBlocks: [] as string[],
      addedBlocks: [] as PomeloBlockRecord[],
      updatedBlocks: [] as { id: string, updates: Partial<PomeloBlockRecord["attrs"]> }[],
      updatedBlockStates: [] as { id: string, state: any }[],
      affectedBlocks: [] as string[],
    };

    const transactionHook: PomeloTransactionHook = {
      addBlock: (block: PomeloBlockRecord, parentId?: string) => {
        transactionUpdates.addedBlocks.push(block);
        this.#addBlock(block, parentId);
      },
      updateBlock: (blockId: string, updates: Partial<PomeloBlockRecord["attrs"]>) => {
        transactionUpdates.updatedBlocks.push({ id: blockId, updates });
        this.#updateBlock(blockId, updates);
      },
      removeBlock: (blockId: string) => {
        transactionUpdates.removedBlocks.push(blockId);
        this.#removeBlock(blockId);
      },
      updateBlockState(blockId, state) {
        transactionUpdates.updatedBlockStates.push({ id: blockId, state });
        this.blockLocalAttrsState.set(blockId, {
          ...this.blockLocalAttrsState.get(blockId),
          ...state,
        });
      },
    }

    this.ydoc.transact(tr => {
      callback(transactionHook);
    })

    // 如果有发现 update 的话，就触发事件
    if ( transactionUpdates.removedBlocks.length > 0 || 
         transactionUpdates.addedBlocks.length > 0 || 
         transactionUpdates.updatedBlocks.length > 0) {
      this.#updateBlockRecordMap();
      this.onDocUpdateEvent.emit({
        payload: transactionUpdates
      });
    }
  }

  /**
   * 获取所有 Block
   * @param filter 
   * @returns 
   */
  getAllBlocks(filter: (block: PomeloBlockRecord) => boolean = () => true) {
    return Array.from(this.blockRecordMap.values()).filter(filter);
  }

  /**
   * 通过 JSON 来导入文档，主要用于编辑器初始化时需要
   * @param json 
   */
  static fromJSON(json: PomeloDoc) {
    const state = new PomeloEditorState();
    const doc = state.ydoc;
    const map = doc.getMap<any>("document");
    map.set("id", json.id);
    setAttributes(map, json.attrs);

    const childrenArray = new Y.Array();
    json.children.forEach(child => {
      processChildRelation(child, childrenArray, json.id);
    });
    map.set("children", childrenArray);

    state.blockMap.set(json.id, map);
    state.rootBlockId = json.id;

    state.#updateParentChildRelation(json.id, null, true);
    state.#updateBlockRecordMap();
    return state
    function processChildRelation(child: PomeloBlockRecord, parentArray: Y.Array<any>, parentId: string) {
      const childMap = new Y.Map();
      childMap.set("id", child.id);
      childMap.set("type", child.type);

      setAttributes(childMap, child.attrs || {});

      if (child.children && child.children.length > 0) {
        const childrenArray = new Y.Array();
        child.children.forEach(subChild => {
          processChildRelation(subChild, childrenArray, child.id);
        });
        childMap.set("children", childrenArray);
      }
      parentArray.push([childMap]);
      state.blockMap.set(child.id, childMap);
      state.#updateParentChildRelation(child.id, parentId);
    }
  }

  /**
   * 创建 BlockId
   * @returns 
   */
  generateBlockId() {
    return Math.random().toString(36).substr(2, 9);
  }

  enableMode(mode: string) {
    this.editorModes.set(mode, true);
    this.onModeChangeEvent.emit({
      payload: {
        mode,
        enabled: true,
      }
    });
  }

  disableMode(mode: string) {
    this.editorModes.set(mode, false);
    this.onModeChangeEvent.emit({
      payload: {
        mode,
        enabled: false,
      }
    });
  }

  /**
   * 通过 ID 获取 Block
   * @param blockId 
   * @returns 
   */
  getBlockById(blockId: string) { 
    const blockData = this.blockRecordMap.get(blockId);
    if (!blockData) return null;
    const state = this.blockLocalAttrsState.get(blockId);
    return {
      ...blockData,
      isRoot: blockId === this.rootBlockId,
      pid: this.parentChildMap.get(blockId)?.parentId || "",
      attrs: {
        ...blockData.attrs,
        ...state
      }
    } as PomeloBlockRecord;
  }

  /**
   * 获取根 Block
   * @returns 
   */
  getRootBlock() {
    return this.blockRecordMap.get(this.rootBlockId);
  }

  undo() {
    this.undoManager.undo();
    this.#syncState();
  }

  redo() {
    this.undoManager.redo();
    this.#syncState();
  }

  canUndo() {
    return this.undoManager.undoStack.length > 0;
  }

  canRedo() {
    return this.undoManager.redoStack.length > 0;
  }

  /**
   * 重新同步 doc 状态
   */
  #syncState() {
    const docRoot = this.ydoc.getMap("document");
    this.blockMap.clear();
    this.parentChildMap.clear();
    this.#rebuildBlockMapCache(docRoot, null);
    this.#updateBlockRecordMap();
    this.onDocSyncStateEvent.emit();
  }

  /**
   * 构建 Map 缓存，方便读取和更新
   * @param blockMap 
   * @param parentId 
   */
  #rebuildBlockMapCache(blockMap: Y.Map<any>, parentId: string | null) {
    const id = blockMap.get("id");
    this.blockMap.set(id, blockMap);
    this.#updateParentChildRelation(id, parentId);

    const children = blockMap.get("children") as Y.Array<any>;
    if (children) {
      children.forEach((childMap: Y.Map<any>) => {
        this.#rebuildBlockMapCache(childMap, id);
      });
    }
  }

  /**
   * 添加 Block
   * @param block 
   * @param parentId 
   */
  #addBlock(block: PomeloBlockRecord, parentId?: string) {
    const parentMap = parentId ? this.blockMap.get(parentId) : this.ydoc.getMap("document");
    if (!parentMap) throw new Error(`Parent block with id ${parentId} not found`);

    const newBlockMap = new Y.Map();
    newBlockMap.set("id", block.id);
    newBlockMap.set("type", block.type);

    setAttributes(newBlockMap, block.attrs || {});

    if (block.children && block.children.length > 0) {
      const childrenArray = new Y.Array();
      block.children.forEach(child => {
        this.#addBlock(child, block.id);
      });
      newBlockMap.set("children", childrenArray);
    }
    let parentChildren = parentMap.get("children") as Y.Array<any>;
    if (!parentChildren) {
      parentChildren = new Y.Array();
      parentMap.set("children", parentChildren);
    }
    parentChildren.push([newBlockMap]);
    this.blockMap.set(block.id, newBlockMap);
    this.#updateParentChildRelation(block.id, parentId || null);
  }

  /**
   * 更新 Block 属性
   * @param blockId 
   * @param updates 
   */
  #updateBlock(blockId: string, updates: Partial<PomeloBlockRecord["attrs"]>) {
    const blockMap = this.blockMap.get(blockId);
    if (!blockMap) throw new Error(`Block with id ${blockId} not found`);

    updateAttributes(blockMap, updates);
  }

  /**
   * 删除 Block
   * @param blockId 
   */
  #removeBlock(blockId: string) {
    const blockMap = this.blockMap.get(blockId);
    if (!blockMap) throw new Error(`Block with id ${blockId} not found`);

    const relation = this.parentChildMap.get(blockId);
    if (!relation) throw new Error(`Relation for block with id ${blockId} not found`);

    const parentId = relation.parentId;
    if (parentId) {
      const parentMap = this.blockMap.get(parentId);
      if (parentMap) {
        const parentChildren = parentMap.get("children") as Y.Array<any>;
        const index = parentChildren.toArray().findIndex(child => child.get("id") === blockId);
        if (index !== -1) {
          parentChildren.delete(index, 1);
        }
        const parentRelation = this.parentChildMap.get(parentId);
        if (parentRelation) {
          parentRelation.childIds.delete(blockId);
        }
      }
    }

    this.#removeBlockAndChildrenRecursive(blockId);
  }

  /**
   * 删除父子关系记录
   * @param blockId 
   */
  #removeBlockAndChildrenRecursive(blockId: string) {
    const relation = this.parentChildMap.get(blockId);
    if (relation) {
      relation.childIds.forEach(childId => {
        this.#removeBlockAndChildrenRecursive(childId);
      });
      this.blockMap.delete(blockId);
      this.parentChildMap.delete(blockId);
    }
  }
  
  /**
   * 更新父子关系缓存，方便后续查询
   */
  #updateParentChildRelation(childId: string, parentId: string | null, isRoot: boolean = false) {
    let childRelation = this.parentChildMap.get(childId);
    if (!childRelation) {
      childRelation = { parentId: null, childIds: new Set(), root: isRoot };
      this.parentChildMap.set(childId, childRelation);
    }
    childRelation.parentId = parentId;

    if (parentId) {
      let parentRelation = this.parentChildMap.get(parentId);
      if (!parentRelation) {
        parentRelation = { parentId: null, childIds: new Set() };
        this.parentChildMap.set(parentId, parentRelation);
      }
      parentRelation.childIds.add(childId);
    }
  }

  #updateBlockRecordMap() {
    this.blockRecordMap.clear();
    const rootBlock = this.blockMap.get(this.rootBlockId).toJSON() as PomeloBlockRecord;
    // 使用箭头函数来保持正确的 this 绑定
    const traverse = (block: PomeloBlockRecord) => {
      this.blockRecordMap.set(block.id, block);
      if (block.children) {
        block.children.forEach(child => traverse(child));
      }
    }
    traverse(rootBlock);
  }


  /**
   * 创建空的 YJS document 结构
   * @returns 
   */
  #createEmptyDocRoot() {
    const doc = this.ydoc;
    const docRoot = doc.getMap("document");
    docRoot.set("id", "document");
    docRoot.set("isRoot", true);
    docRoot.set("attrs", new Y.Map());
    docRoot.set("children", new Y.Array());

    this.blockMap.set("document", docRoot);
    return docRoot;
  }
}

/**
 * 只更新需要更新的部分
 * @param map 
 * @param attrs 
 */
function updateAttributes(map: Y.Map<any>, attrs: Record<string, any> = {}) {
  const oldAttrsMap = map.get("attrs") as Y.Map<any> | undefined;
  const needsUpdate = !oldAttrsMap || Object.entries(attrs).some(([key, value]) => oldAttrsMap.get(key) !== value);
  if (needsUpdate) {
    const newAttrsMap = new Y.Map();
    if (oldAttrsMap) {
      oldAttrsMap.forEach((value, key) => newAttrsMap.set(key, value));
    }
    Object.entries(attrs).forEach(([key, value]) => newAttrsMap.set(key, value));
    map.set("attrs", newAttrsMap);
  }
}

/**
 * 全量更新属性
 * @param map 
 * @param attrs 
 */
function setAttributes(map: Y.Map<any>, attrs: Record<string, any> = {}) {
  const newAttrsMap = new Y.Map();
  Object.entries(attrs).forEach(([key, value]) => newAttrsMap.set(key, value));
  map.set("attrs", newAttrsMap);
}