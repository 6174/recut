import { useEffect, useState } from "react";
import { PixiRendererAdapter, PomeloBlockRecord, useEditorContext } from "../../../pomelo-core";
import { PomeloReactPlugin } from "../../../pomelo-core";
import { SvgLayer } from "./pen-svg-layer";
import { PEN_BLOCK_NAME, PenBlock } from "./pen-block";
import { calculatePathBounds, isPathIntersectWithBlock } from "./pen-utils";
import { PenPoint } from "./pen.type";
import { PEN_GROUP_BLOCK_NAME, PenGroupBlock } from "./pen-group";
import * as PIXI from 'pixi.js';

export const PEN_PLUGIN_NAME = "PenPlugin";

interface PenToolbarProps {
  color: string;
  width: number;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
}

function PenToolbar({ color, width, onColorChange, onWidthChange }: PenToolbarProps) {
  return (
    <div className="pen-toolbar" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      <input
        type="color"
        value={color}
        onChange={(e) => onColorChange(e.target.value)}
        style={{ width: '32px', height: '32px' }}
      />
      <input
        type="range"
        min="1"
        max="20"
        value={width}
        onChange={(e) => onWidthChange(Number(e.target.value))}
        style={{ width: '100px' }}
      />
      <span>{width}px</span>
    </div>
  );
}

export const ERASER_MODE = "eraserMode";
export const PEN_MODE = "penMode";

function PenPluginUI(props: { penGroupId: string }) {
  const { penGroupId } = props;

  console.debug("PenPluginUI", penGroupId);

  const editor = useEditorContext();
  const [mode, setMode] = useState<'pen' | 'eraser'>('pen');
  const [penModeEnabled, setPenModeEnabled] = useState(true);
  const [penColor, setPenColor] = useState("#000000");
  const [penWidth, setPenWidth] = useState(10);

  useEffect(() => {
    const unsubscribe = editor.state.onModeChangeEvent.on((event) => {
      if (event.payload.mode === PEN_MODE) {
        setPenModeEnabled(event.payload.enabled);
      }
    });
    return () => unsubscribe.dispose();
  }, [editor]);

  useEffect(() => {
    const containerDom = editor.getContainerDom();
    if (penModeEnabled) {
      containerDom.style.cursor = 'crosshair';
    } else {
      containerDom.style.cursor = 'default';
    }
  }, [penModeEnabled]);

  // 处理擦除路径与现有 PenBlock 的交集
  const handleEraserPath = (points: PenPoint[]) => {
    const blocks = editor.state.getAllBlocks();
    const penBlocks = blocks.filter(block => block.type === PEN_BLOCK_NAME);

    const blocksToRemove: PomeloBlockRecord[] = [];
    editor.state.transact((transact) => {
      penBlocks.forEach(block => {
        // 如果擦除路径与 block 相交，删除该 block
        if (isPathIntersectWithBlock(points, block)) {
          blocksToRemove.push(block);
        }
      });
      blocksToRemove.forEach(block => {
        transact.removeBlock(block.id);
      });
    });

  };
  
  const handlePathComplete = (points: PenPoint[]) => {
    if (mode === 'eraser') {
      handleEraserPath(points);
      return;
    }

    const blockId = editor.state.generateBlockId();
    const bounds = calculatePathBounds(points);

    // 不需要再调整点的坐标，因为在 SVG 层中已经转换为画布坐标
    editor.state.transact((transact) => {
      transact.addBlock({
        id: blockId,
        type: PEN_BLOCK_NAME,
        attrs: {
          paths: [{
            points: points,  // 直接使用原始点
            color: penColor,
            width: penWidth
          }],
          x: 0,            // 不需要额外的偏移
          y: 0,
          width: bounds.width,
          height: bounds.height,
        }
      }, props.penGroupId);
    })

    requestAnimationFrame(() => {
      const penGroup = editor.renderAdapter.getBlockById(penGroupId) as PenGroupBlock;
      if (penGroup) {
        const el = penGroup.hostElement.el as PIXI.Container;
        el.cacheAsBitmap = false;
        el.cacheAsBitmap = true;
        // requestAnimationFrame(() => {
        // });
      }
    });
  };

  return (
    <>
      <div className="pen-plugin" style={{
        position: 'absolute',
      }}>
        <PenToolbar
          color={penColor}
          width={penWidth}
          onColorChange={setPenColor}
          onWidthChange={setPenWidth}
        />
      </div>
      {penModeEnabled && (
        <SvgLayer
          color={penColor}
          width={penWidth}
          onPathComplete={handlePathComplete}
        />
      )}
    </>
  );
}

export class PenPlugin extends PomeloReactPlugin {
  Name: string = PEN_PLUGIN_NAME;
  blocks = [PenBlock, PenGroupBlock];

  penGroupId: string | null = null;

  onEditorDidMount() {
    super.onEditorDidMount();
    const adapter = this.editor.renderAdapter as PixiRendererAdapter;
    console.debug("PenPlugin onEditorDidMount", adapter);
    this.ensurePenGroup();
    // 添加快捷键支持
    document.addEventListener('keydown', this.handleKeyDown);
  }

  onEditorWillUnmount() {
    super.onEditorWillUnmount();
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    // 按 P 键切换画笔模式
    if (e.key.toLowerCase() === 'p') {
      const currentEnabled = this.editor.state.editorModes.get(PEN_MODE);
      if (currentEnabled) {
        this.editor.state.disableMode(PEN_MODE);
      } else {
        this.editor.state.enableMode(PEN_MODE);
      }
    }
  };

  private ensurePenGroup() {
    const blocks = this.editor.state.getAllBlocks();
    const penGroup = blocks.find(block => block.type === PEN_GROUP_BLOCK_NAME);

    if (!penGroup) {
      const groupId = this.editor.state.generateBlockId();
      this.penGroupId = groupId;

      this.editor.state.transact((transact) => {
        transact.addBlock({
          id: groupId,
          type: PEN_GROUP_BLOCK_NAME,
          attrs: {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
          }
        });
      });
    } else {
      this.penGroupId = penGroup.id;
    }
    this.forceUpdate()
  }

  render(): JSX.Element {
    return <PenPluginUI penGroupId={this.penGroupId} />;
  }
}