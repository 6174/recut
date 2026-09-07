/*
 * [INPUT]: 依赖 pomelo-core（PomeloPlugin / PomeloEditor）与 demo-store
 * [OUTPUT]: 对外提供 KeyboardPlugin：Delete/Backspace 删除选中、Escape 退出 connect 模式并取消选择、
 * Cmd/Ctrl+Z 与 Cmd/Ctrl+Shift+Z 走编辑器 yjs undo/redo（输入框内不劫持按键）
 * [POS]: lib/pomelo/world-canvas 的键盘插件
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloEditor } from "../../pomelo-core/pomelo-editor";
import { PomeloPlugin } from "../../pomelo-core/pomelo-plugin";
import { useWorldDemoStore } from "../demo-store";

export class KeyboardPlugin extends PomeloPlugin {
  Name = "KeyboardPlugin";
  #cleanup?: () => void;

  onEditorDidMount(editor: PomeloEditor) {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const store = useWorldDemoStore.getState();
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        store.removeSelected();
        return;
      }
      if (event.key === "Escape") {
        store.setMode("select");
        store.select(null);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) editor.state.redo();
        else editor.state.undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    this.#cleanup = () => window.removeEventListener("keydown", onKeyDown);
  }

  onEditorWillUnmount() {
    this.#cleanup?.();
    this.#cleanup = undefined;
  }

  dispose() {
    this.#cleanup?.();
  }
}
