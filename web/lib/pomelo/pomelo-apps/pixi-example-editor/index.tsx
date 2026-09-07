import { useEffect, useRef, useState } from "react";
import { PomeloEditor } from "../../pomelo-core/pomelo-editor";
import { PixiRendererAdapter } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-adapter";
import { PomeloEditorState } from "../../pomelo-core/pomelo-state";
import { CounterBlock } from "./counter-block";
import { CounterPlugin } from "./counter-plugin";

export function ExampleEditor() {
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
    <div className={`wrapper`} >
      <div>Hello world editor:</div>
      <div className="editor" ref={ref} />
    </div>
  );
}

function createEditor(container: HTMLElement) {
  const state = createState();
  const adapter = new PixiRendererAdapter();
  const editor = new PomeloEditor({
    state,
    container: container,
    plugins: [
      new CounterPlugin()
    ],
    blockTypes: [CounterBlock],
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
        type: CounterBlock.type,
        attrs: {
          x: 0,
          y: 0,
          width: 100,
          height: 100
        }
      }
    ]
  })
}
