import { useEffect, useRef } from "react";
import { PomeloEditor } from "../../pomelo-core/pomelo-editor";
import { PixiRendererAdapter } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-adapter";
import { PomeloEditorState } from "../../pomelo-core/pomelo-state";
import { PenPlugin } from "../../pomelo-plugins/pixi/pen/pen-plugin";
import { PenBlock } from "../../pomelo-plugins/pixi/pen/pen-block";
import { ImageBlock } from "../../pomelo-plugins/pixi/image/image-block";
import { MainImageViewportPlugin } from "../../pomelo-plugins/general/viewport/main-image-viewport/main-image-viewport.plugin";
import { PenGroupBlock } from "../../pomelo-plugins/pixi/pen/pen-group";

export function MaskEditor() {
  const ref = useRef<HTMLDivElement>(null);
  const editorRef = useRef<PomeloEditor>(null);

  useEffect(() => {
    if (ref.current && !editorRef.current) {
      const newEditor = createEditor(ref.current);
      editorRef.current = newEditor;
    }
    return () => {
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
      }
    };
  }, [ref])

  return (
    <div className={"maskEditor"} >
      <div>Hello world mask editor:</div>
      <div className="editor" ref={ref} style={{
        width: "100%",
        height: 600,
        position: 'relative'
      }}/>
    </div>
  );
}

const imageSrc = "https://picsum.photos/520/520";
function createEditor(container: HTMLElement) {
  const state = createState();
  const adapter = new PixiRendererAdapter();
  
  const editor = new PomeloEditor({
    state,
    container: container,
    plugins: [
      new PenPlugin(),
      new MainImageViewportPlugin(imageSrc)
    ],
    blockTypes: [PenBlock, PenGroupBlock, ImageBlock],
    renderAdapter: adapter
  });
  editor.onInit();
  return editor;
}

function createState(): PomeloEditorState { 
  return PomeloEditorState.fromJSON({
    id: "example-editor-doc",
    children: [
      {
        id: "example-editor-block-1",
        type: ImageBlock.type,
        attrs: {
          src: imageSrc,
          x: 0,
          y: 0,
          width: 100,
          height: 100
        }
      }
    ]
  })
}
