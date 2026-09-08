import * as PIXI from 'pixi.js';
import { PomeloRendererAdapter } from '../pomelo-renderer/pomelo-renderer-adapter';
import { IElement } from '../pomelo-types/render.types';
import { PixiElement } from './pomelo-pixi-element';
import type { PixiBlock } from './pomelo-pixi-block';
import { PomeloBlock, PomeloRenderer } from '../pomelo-renderer';
import { pomeloPerf } from '../pomelo-perf';

// 拖拽会话快照：被排除块的容器坐标链表（恢复 reparent 用）
type SessionEntry = {
  container: PIXI.Container;
  parent: PIXI.Container;
  index: number;
};

type ContentSession = {
  entries: SessionEntry[];
  live: PIXI.Container;
  liveInner: PIXI.Container;
  snapshot: PIXI.Sprite;
  renderTexture: PIXI.RenderTexture;
};

export class PixiRendererAdapter extends PomeloRendererAdapter {
  app: PIXI.Application = null!;
  // 透明背景：画布底色交给宿主容器 CSS（如 var(--background)），引擎不再涂 init 默认蓝黑色
  #transparentBackground: boolean;
  // MSAA 开关：大画布 + 高分辨率下 GPU fill-rate 成本约 4 倍像素 × N 倍采样，
  // 拖拽这类全帧重绘场景是主瓶颈；允许宿主按视觉需要关闭（曲线/矢量边缘会轻微锯齿）
  #antialias: boolean;

  // ---- demand-driven flush：数据/transform 变化只置脏，ticker 帧首统一 GPU 提交 ----
  #dirty = true;
  // ---- 拖拽会话快照（M1）：见 beginContentSession ----
  #session: ContentSession | null = null;

  constructor(options: { transparentBackground?: boolean; antialias?: boolean } = {}) {
    super();
    this.#transparentBackground = options.transparentBackground ?? false;
    this.#antialias = options.antialias ?? true;
  }

  /**
   * PIXI V7 初始化
   */
  async onInit(renderer: PomeloRenderer) {
    super.onInit(renderer);
    const container = this.editor.getContainerDom();
    this.app = new PIXI.Application({
      width: 800,
      height: 600,
      resizeTo: container,
      backgroundColor: 0x0b0f19,
      backgroundAlpha: this.#transparentBackground ? 0 : 1,
      autoDensity: true, // 添加 autoDensity 以更好地处理显示比例
      antialias: this.#antialias,    // 添加抗锯齿
      resolution: window.devicePixelRatio || 1,  // 设置分辨率以匹配设备
      autoStart: false, // 统一 ticker 需求驱动渲染：空闲零 GPU，每帧至多一次 flush
    });

    this.app.stage.addChild(this.mountpointBlock.hostElement.el);
    // @ts-ignore
    container.appendChild(this.app.view);

    // 帧首 flush：vdom patch / transact 后散落的 #dirty 在 update 相合并成单次 GPU 提交
    this.editor?.ticker?.add?.(() => this.#flushFrame(), "update");
  }

  // 上层任何数据/变换变化后调用的最终 API；这里只标记脏，不等下一帧不执行 GPU 工作
  invalidate() {
    this.#dirty = true;
  }

  #flushFrame() {
    if (!this.#dirty || !this.app?.renderer) return;
    this.#dirty = false;
    this.#validateSession();
    pomeloPerf.time("adapter.flush", () => {
      this.app.renderer.render(this.app.stage);
    });
  }

  /**
   * 文字分辨率跟随视口缩放：Text 按 dpr × zoom 栅格化，避免 stage 放大后纹理拉伸发虚
   */
  refreshTextResolution() {
    if (!this.app?.renderer) return;
    pomeloPerf.time("text.refresh", () => {
      const target = Math.min(4, Math.max(2, (window.devicePixelRatio || 1) * this.transform.scale));
      const visit = (container: PIXI.Container) => {
        for (const child of container.children as PIXI.Container[]) {
          if (child instanceof PIXI.Text) {
            if (child.resolution !== target) child.resolution = target;
          } else if (child.children?.length > 0) {
            visit(child);
          }
        }
      };
      visit(this.mountpointBlock.hostElement.el);
    });
  }

  /**
   * 实现 createIElement 方法
   * @param tag
   * @param block
   * @param props
   * @returns
   */
  createIElement(tag: string, block: PomeloBlock, props?: any): IElement {
    console.debug('Creating element', { tag, block, props });
    return new PixiElement(tag, block, props);
  }

  render() {
    super.render();
    // 新渲染的 Text 需要按当前视口缩放重设分辨率，否则缩放后模糊
    this.refreshTextResolution();
    this.invalidate();
  }

  /**
   * 设置视图的 transform
   * @param x
   * @param y
   * @param scale
   */
  setTransform(x: number, y: number, scale: number): void {
    // 拖拽会话建立在「本次 pointer 生命周期视口不变」假设上；视口一动立即回退全量路径
    if (this.#session) this.endContentSession();
    // 对齐设备像素：亚像素偏移会让 Text 纹理采样发虚
    const dpr = window.devicePixelRatio || 1;
    x = Math.round(x * dpr) / dpr;
    y = Math.round(y * dpr) / dpr;
    const hostElement = this.mountpointBlock.hostElement.el;
    this.transform = { x, y, scale };
    hostElement.x = x;
    hostElement.y = y;
    hostElement.scale.set(scale);
    this.onTransformEvent.emit({ x, y, scale });
    // 缩放变化后重设文字分辨率
    this.refreshTextResolution();
    this.invalidate();
  }

  /**
   * 设置容器的大小
   * @param width
   * @param height
   */
  setContainerSize(width: number, height: number): void {
    if (!this.app?.renderer) return;
    this.containerSize = { width, height };
    const resolution = this.app.renderer.resolution;
    this.app.renderer.resize(width, height);
    this.app.renderer.resolution = resolution;
    this.onResizeEvent.emit({ width, height });
    this.invalidate();
  }

  // ---- 拖拽会话快照（M1）----
  // 场景除 excluded 外的全部内容栅格化为一张全屏纹理，excluded 块留在「心里可动的 LiveLayer」。
  // 拖拽帧 GPU = 快照 1 个 quad + LiveLayer 小范围重绘；文档/插件的数据纪律完全不感知。
  // excluded：被拖块 + 与之相连的箭头 blockId（箭头每帧随被拖块重算，留在快照里会跟丢）。
  beginContentSession(excludedBlockIds: string[]) {
    if (!this.app?.renderer || this.#session) return;
    const content = this.mountpointBlock.hostElement.el;
    try {
      const entries: SessionEntry[] = [];
      const containers: PIXI.Container[] = [];
      for (const blockId of excludedBlockIds) {
        const block = this.getBlockById(blockId) as PixiBlock | undefined;
        const container = (block as PixiBlock | undefined)?.contentElement?.el as PIXI.Container | undefined;
        if (!container || !container.parent) continue;
        containers.push(container);
      }
      if (containers.length === 0) return;

      // 1) 快照：隐藏 excluded → 渲一张 RT → 恢复可见
      pomeloPerf.time("snapshot.hide", () => {
        for (const container of containers) container.visible = false;
      });
      const resolution = this.app.renderer.resolution;
      const renderTexture = pomeloPerf.time("snapshot.alloc", () =>
        PIXI.RenderTexture.create({
          width: this.app.screen.width,
          height: this.app.screen.height,
          resolution,
        }),
      );
      pomeloPerf.time("snapshot.render", () => {
        this.app.renderer.render(content, { renderTexture });
      });
      for (const container of containers) container.visible = true;

      // 2) 快照精灵插到 content 原索引位（网格等更底层元素保持在其下方）；live 挂其后
      const contentParent = content.parent ?? this.app.stage;
      const contentIndex = contentParent.getChildIndex(content);
      content.visible = false;
      const snapshot = new PIXI.Sprite(renderTexture);
      contentParent.addChildAt(snapshot, contentIndex);
      const live = new PIXI.Container();
      const liveInner = new PIXI.Container();
      // live 还原 content 的世界变换：excluded 块的自身 x/y 是世界坐标，语义不变
      liveInner.position.set(content.x, content.y);
      liveInner.scale.copyFrom(content.scale);
      live.addChild(liveInner);
      contentParent.addChild(live);
      for (const container of containers) {
        entries.push({ container, parent: container.parent!, index: container.parent!.getChildIndex(container) });
        container.parent.removeChild(container);
        liveInner.addChild(container);
      }

      this.#session = { entries, live, liveInner, snapshot, renderTexture };
      this.#dirty = true;
    } catch (error) {
      console.warn("[pixi-adapter] beginContentSession failed, fallback to full render", error);
      this.endContentSession();
    }
  }

  endContentSession() {
    const session = this.#session;
    if (!session) return;
    this.#session = null;
    const content = this.mountpointBlock.hostElement.el;
    try {
      // 恢复 reparent：严格按记录的 (parent, index) 放回，保证 z 序与原状一致
      for (let i = session.entries.length - 1; i >= 0; i--) {
        const { container, parent, index } = session.entries[i];
        if (container.destroyed) continue;
        if (parent && !parent.destroyed) {
          const at = Math.min(index, parent.children.length);
          parent.addChildAt(container, at);
        } else {
          content.addChild(container);
        }
      }
      session.live.parent?.removeChild(session.live);
      session.live.destroy({ children: false });
      session.snapshot.parent?.removeChild(session.snapshot);
      session.snapshot.destroy({ texture: true, baseTexture: true });
      session.renderTexture.destroy(true);
    } catch (error) {
      console.warn("[pomelo-pixi-adapter] endContentSession cleanup error", error);
    }
    content.visible = true;
    this.#dirty = true;
  }

  // 会话健壮兜底：文档全量重建（dataVersion++）会替换块容器，快照引用的 excluded 容器
  // 不在 LiveLayer 里了（被重建覆盖/移除）时回退全量路径，绝不闪错
  #validateSession() {
    if (!this.#session || !this.#dirty) return;
    const valid = this.#session.entries.every(({ container }) =>
      !container.destroyed && container.parent === this.#session!.liveInner
    );
    if (!valid) this.endContentSession();
  }
}
