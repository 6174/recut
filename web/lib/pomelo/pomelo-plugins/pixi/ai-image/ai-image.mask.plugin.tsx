import { useEffect, useState } from "react";
import { useEditorContext } from "../../../pomelo-core";
import { PomeloReactPlugin } from "../../../pomelo-core";
import { MaskCanvas } from "./ai-image.mask.canvas";

export const MASK_PLUGIN_NAME = "AIImageMaskPlugin";
export const MASK_MODE = "AIImageMaskMode";

interface MaskToolbarProps {
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  isEraser: boolean;
  onModeChange: (isEraser: boolean) => void;
}

function MaskToolbar({ brushSize, onBrushSizeChange, isEraser, onModeChange }: MaskToolbarProps) {
  return (
    <div className="mask-toolbar" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      <button onClick={() => onModeChange(!isEraser)}>
        {isEraser ? 'Eraser' : 'Brush'}
      </button>
      <input
        type="range"
        min="1"
        max="50"
        value={brushSize}
        onChange={(e) => onBrushSizeChange(Number(e.target.value))}
      />
      <span>{brushSize}px</span>
    </div>
  );
}

function MaskPluginUI() {
  const editor = useEditorContext();
  const [brushSize, setBrushSize] = useState(20);
  const [isEraser, setIsEraser] = useState(false);
  const [maskEnabled, setMaskEnabled] = useState(false);

  useEffect(() => {
    const unsubscribe = editor.state.onModeChangeEvent.on((event) => {
      if (event.payload.mode === MASK_MODE) {
        setMaskEnabled(event.payload.enabled);
      }
    });
    return () => unsubscribe.dispose();
  }, [editor]);

  const handleMaskComplete = (maskBase64: string) => {
    // Find the AI Image block and update its mask
    const blocks = editor.state.getAllBlocks();
    const aiImageBlock = blocks.find(block => block.type === 'AIImageBlock');
    if (aiImageBlock) {
      editor.state.transact((transact) => {
        transact.updateBlock(aiImageBlock.id, {
          attrs: {
            ...aiImageBlock.attrs,
            mask: maskBase64
          }
        });
      });
    }
  };

  return (
    <>
      <div className="mask-plugin" style={{ position: 'absolute' }}>
        <MaskToolbar
          brushSize={brushSize}
          onBrushSizeChange={setBrushSize}
          isEraser={isEraser}
          onModeChange={setIsEraser}
        />
      </div>
      {maskEnabled && (
        <MaskCanvas
          brushSize={brushSize}
          isEraser={isEraser}
          onMaskComplete={handleMaskComplete}
        />
      )}
    </>
  );
}

export class MaskPlugin extends PomeloReactPlugin {
  Name: string = MASK_PLUGIN_NAME;

  onEditorDidMount() {
    super.onEditorDidMount();
    document.addEventListener('keydown', this.handleKeyDown);
  }

  onEditorWillUnmount() {
    super.onEditorWillUnmount();
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() === 'm') {
      const currentEnabled = this.editor.state.editorModes.get(MASK_MODE);
      if (currentEnabled) {
        this.editor.state.disableMode(MASK_MODE);
      } else {
        this.editor.state.enableMode(MASK_MODE);
      }
    }
  };

  render(): JSX.Element {
    return <MaskPluginUI />;
  }
}