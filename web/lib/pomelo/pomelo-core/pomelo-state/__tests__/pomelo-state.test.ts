import { PomeloBlockRecord } from '../../pomelo-renderer';
import { PomeloDoc } from '../../pomelo-types/doc.types';
import { PomeloEditorState } from '../pomelo-state';

describe('PomeloEditorState', () => {
  let state: PomeloEditorState;

  beforeEach(() => {
    state = new PomeloEditorState();
  });

  test('初始化时应创建一个空文档', () => {
    const rootBlock = state.getRootBlock();
    expect(rootBlock.id).toEqual('document');
    expect(rootBlock.children.length).toEqual(0);
  });

  test('fromJSON 应正确导入文档', () => {
    const b = generateRandomBlock();
    const json: PomeloDoc = {
      id: 'document',
      attrs: { 
        ...b.attrs,
        title: 'Test Document' 
      },
      children: [
        { id: 'child1', type: 'text', attrs: { 
          ...b.attrs,
          content: 'Hello' 
        } }
      ]
    };

    state = PomeloEditorState.fromJSON(json);
    expect(state.getRootBlock()).toEqual(json);
  });

  test('addBlock 应正确添加新块', () => {
    const newBlock = generateRandomBlock();

    state.transact((hook) => {
      hook.addBlock(newBlock, 'document');
    });

    const rootBlock = state.getRootBlock();
    expect(rootBlock.children).toHaveLength(1);
    expect(rootBlock.children[0]).toEqual(newBlock);
  });

  test('updateBlock 应正确更新现有块', () => {
    const b = generateRandomBlock();
    state = PomeloEditorState.fromJSON({
      id: 'document',
      attrs: {
        ...b.attrs,
      },
      children: [
        { id: 'child1', type: 'text', attrs: { ...b.attrs, content: 'Original' } }
      ]
    });

    state.transact((hook) => {
      hook.updateBlock('child1', { content: 'Updated' });
    });

    const updatedBlock = state.getBlockById('child1');
    expect(updatedBlock.attrs.content).toBe('Updated');
  });

  test('removeBlock 应正确删除块', () => {
    const b = generateRandomBlock();
    state = PomeloEditorState.fromJSON({
      id: 'document',
      attrs: b.attrs,
      children: [
        { 
          id: 'child1', type: 'text', attrs: { ...b.attrs }, children: [] 
        }
      ]
    });

    state.transact((hook) => {
      hook.removeBlock('child1');
    });

    const rootBlock = state.getRootBlock();
    expect(rootBlock.children).toHaveLength(0);
  });

  test('undo 和 redo 应正确工作', () => {
    const b = generateRandomBlock();
    state = PomeloEditorState.fromJSON({ id: 'document', attrs: b.attrs, children: [] });

    state.transact((hook) => {
      hook.addBlock({ id: 'block1', type: 'text', attrs: { ...b.attrs, content: 'Test' }, children: [] }, 'document');
    });

    expect(state.getRootBlock().children).toHaveLength(1);

    state.undo();
    expect(state.getRootBlock().children).toHaveLength(0);

    state.redo();
    expect(state.getRootBlock().children).toHaveLength(1);
  });

  test('generateBlockId 应返回唯一ID', () => {
    const id1 = state.generateBlockId();
    const id2 = state.generateBlockId();
    expect(id1).not.toBe(id2);
  });

  test('getBlockLocalState 应返回正确的本地状态', () => {
    const blockId = 'testBlock';
    const state = { selected: true };

    state.transact((hook) => {
      hook.updateBlockState(blockId, state);
    });

    expect(state.getBlockLocalState(blockId)).toEqual(state);
  });
});

function generateRandomBlock(parentId?: string): PomeloBlockRecord {
  const blockTypes = ['text', 'image', 'shape', 'group'];
  const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];

  const randomType = blockTypes[Math.floor(Math.random() * blockTypes.length)];
  const randomColor = colors[Math.floor(Math.random() * colors.length)];

  const block: PomeloBlockRecord = {
    id: Math.random().toString(36).substr(2, 9),
    pid: parentId,
    type: randomType,
    attrs: {
      x: Math.floor(Math.random() * 1000),
      y: Math.floor(Math.random() * 1000),
      rotate: Math.floor(Math.random() * 360),
      width: Math.floor(Math.random() * 200) + 50,
      height: Math.floor(Math.random() * 200) + 50,
      color: randomColor,
    },
  };

  // 添加一些基于类型的额外随机属性
  switch (randomType) {
    case 'text':
      block.attrs.content = 'Random text ' + Math.random().toString(36).substr(2, 5);
      block.attrs.fontSize = Math.floor(Math.random() * 24) + 12;
      break;
    case 'image':
      block.attrs.src = `https://picsum.photos/${block.attrs.width}/${block.attrs.height}`;
      break;
    case 'shape':
      const shapes = ['rectangle', 'circle', 'triangle'];
      block.attrs.shape = shapes[Math.floor(Math.random() * shapes.length)];
      break;
    case 'group':
      // 为组添加一些子块
      for (let i = 0; i < Math.floor(Math.random() * 3) + 1; i++) {
        block.children = []
        block.children.push(generateRandomBlock(block.id));
      }
      break;
  }

  return block;
}

// 生成随机块的函数
export function generateRandomBlocks(count: number): PomeloBlockRecord[] {
  const blocks: PomeloBlockRecord[] = [];
  for (let i = 0; i < count; i++) {
    blocks.push(generateRandomBlock());
  }
  return blocks;
}