import { PomeloBlockRecord } from "../pomelo-renderer";

export function generateRandomBlock(parentId?: string): PomeloBlockRecord {
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