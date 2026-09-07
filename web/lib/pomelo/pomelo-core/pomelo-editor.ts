import { elem } from "./pomelo-common/dom";
import { PomeloEditorState } from "./pomelo-state/pomelo-state";
import { IPomeloBlockConstructor, PomeloBlock } from "./pomelo-renderer/pomelo-block";
import { PomeloRenderer } from "./pomelo-renderer/pomelo-renderer";
import { PomeloRendererAdapter } from "./pomelo-renderer/pomelo-renderer-adapter";
import { PomeloPlugin } from "./pomelo-plugin";
import { IDisposable, Slot } from "./pomelo-common";

export enum EditorEvents {
  onEditorDidMount = "onEditorDidMount",
}

export type EditorEventPayload = {
  type: string,
  payload?: any
}

/**
 * Editor
 */
export class PomeloEditor {
  blockTypeRegistry: Map<string, IPomeloBlockConstructor> = new Map();
  pluginRegistry: Map<string, PomeloPlugin> = new Map();
  #container: HTMLElement;
  #pluginDOM: HTMLElement;
  #plugins: PomeloPlugin[] = [];
  #renderer: PomeloRenderer;
  renderAdapter: PomeloRendererAdapter;

  state: PomeloEditorState;

  // 事件系统，Plugin 可以通过监听编辑器的事件来扩展行为
  // Plugin 也可以监听 state 的变更事件
  events: Record<string, Slot> = {
    onEditorDidMount: new Slot()
  };

  constructor(params: {
    state: PomeloEditorState,
    container: HTMLElement,
    plugins: PomeloPlugin[],
    blockTypes: IPomeloBlockConstructor[],
    renderAdapter: PomeloRendererAdapter,
  }) {
    const { container, plugins, blockTypes, renderAdapter } = params;
    this.state = params.state;
    this.#container = container;
    this.#pluginDOM = elem("div", "plugin-container");
    this.#container.appendChild(this.#pluginDOM);
    const defaultPlugins = [];
    this.#plugins = [...defaultPlugins, ...plugins];
    this.#plugins.forEach(plugin => {
      this.pluginRegistry.set(plugin.Name, plugin);
    });
    this.#renderer = new PomeloRenderer(this, renderAdapter);
    this.renderAdapter = renderAdapter;

    // 初始化 plugin 的 blocks
    this.#plugins.forEach(plugin => {
      plugin.blocks?.forEach(block => {
        this.blockTypeRegistry.set(block.type, block);
      });
    });
    blockTypes.forEach(block => {
      this.blockTypeRegistry.set(block.type, block);
    });

  }
  
  /**
   * 初始化编辑器
   */
  async onInit() {
    await this.#renderer.adapter.onInit(this.#renderer);
    const container = this.getContainerDom();
    this.renderAdapter.setContainerSize(container.clientWidth, container.clientHeight);

    // Listen for container size changes and update renderer
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        this.renderAdapter.setContainerSize(width, height);
      }
    });

    resizeObserver.observe(this.#container);

    for (let plugin of this.#plugins) {
      await plugin.onInitialized?.(this);
    }

    this.#renderer.render();
    this.#plugins.forEach(plugin => {
      plugin.onEditorDidMount?.(this);
    });
  }

  /**
   * 监听编辑器事件
   * @param event 
   * @param callback 
   * @returns 
   */
  on(event: string, callback: (payload: any) => void): IDisposable {
    let slot = this.events[event];
    if (slot) {
      return slot.on(callback);
    } else {
      slot = new Slot();
      this.events[event] = slot;
      return slot.on(callback);
    }
  }

  getPluginDom() {
    return this.#pluginDOM;
  }

  getContainerDom() {
    return this.#container;
  }

  destroy() {
    while (this.#container.firstChild) {
      this.#container.removeChild(this.#container.firstChild);
    }
  }
}