import { PomeloPlugin } from "./pomelo-plugin";
import { createRoot } from 'react-dom/client';
import { Root } from 'react-dom/client';
import { elem } from "../pomelo-common/dom";
import { createContext, useContext } from "react";
import { PomeloEditor } from "../pomelo-editor";

export abstract class PomeloReactPlugin extends PomeloPlugin {
  Name: string = PomeloReactPlugin.name;
  #domContainer: HTMLDivElement | null = null;
  #root?: Root;

  onEditorDidMount() {
    const container = this.editor.getPluginDom();

    // 创建一个 div 作为 react 的容器
    const domContainer = (this.#domContainer = elem("div", `plugin-view-${this.Name}`));
    container.appendChild(domContainer);

    // 挂在到 dom 上
    this.#root = createRoot(domContainer);
    this.forceUpdate();
  }

  forceUpdate() {
    this.#root?.render(
      <EditorProvider value={this.editor!} >
        {this.render()}
      </EditorProvider>
    );
  }

  onEditorWillUnmount() {
    if (this.#domContainer) {
      this.#root?.unmount();
      this.#domContainer.remove();
      this.#domContainer = null;
    }
  };

  getReactContainer() {
    return this.#domContainer;
  }

  /**
   * render react blocks
   */
  abstract render(): JSX.Element;
}

// 因为 context 必须要有默认值，所以这里先用 null 代替
export const EditorContext = createContext<PomeloEditor | null>(null);
export const EditorProvider = EditorContext.Provider;

// 在真实使用 editor 渲染 view 的时候，顶层需要保证先有 editor，再有 view
export function useEditorContext(): PomeloEditor {
  return useContext(EditorContext)!;
}