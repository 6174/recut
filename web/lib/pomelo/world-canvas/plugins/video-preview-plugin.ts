/*
 * [INPUT]: 依赖 pomelo-core（PomeloPlugin / PomeloEditor）与 world-canvas 的矩形约定（media 元素 / 视频属性卡）
 * [OUTPUT]: 对外提供 VideoPreviewPlugin：悬停到「已就绪的视频节点」（独立媒体卡 modality=video、或视频属性卡
 *           attrMedia=video，且已有可渲染 src）时，在卡片位置盖一个同尺寸 <video> 循环播放（优先带声；
 *           自动播放策略拒绝时回退静音，保证悬停一定有画面）；指针移出该节点 / 离开画布即收起。
 *           播放器与包裹层都是 pointer-events:none（不接收任何鼠标事件），显示与否完全由画布自己的 hover
 *           命中判定——与 SelectionPlugin 同一套纪律：屏幕空间定位（世界→屏幕按适配器 transform）、
 *           transform / 文档变化按最后指针位置重排、pointermove 经 editor.ticker 合帧。
 * [POS]: lib/pomelo/world-canvas/plugins 的视频悬停播放插件（真实世界画布经 canvas-pomelo 注册）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloEditor } from "../../pomelo-core/pomelo-editor";
import { PomeloPlugin } from "../../pomelo-core/pomelo-plugin";

type Rect = { x: number; y: number; width: number; height: number };
type VideoHit = { blockId: string; src: string; rect: Rect; radius: number };

// 媒体卡内容盒内缩/圆角：与 RealMediaBlockV / FreeElementBlockV 的 cover 盒（含实体卡头图）保持一致，
// 首帧与播放器不出现错位——这类节点的图都在卡面内缩 6px、自身圆角 8。
const MEDIA_INSET = 6;
const MEDIA_RADIUS = 8;

/** 悬停播放：把已就绪的视频节点对应的 <video> 覆盖到卡片上播放。 */
export class VideoPreviewPlugin extends PomeloPlugin {
  Name = "VideoPreviewPlugin";
  #video: HTMLVideoElement | null = null;
  #cleanup?: () => void;
  // 当前挂载的 src（切视频时才重设 <video>.src，避免每次重排都重新加载）
  #src = "";
  #lastClient: { x: number; y: number } | null = null;
  #pendingEvent: PointerEvent | null = null;
  static readonly #HOVER_KEY = "video-preview-hover";

  onEditorDidMount(editor: PomeloEditor) {
    const adapter = editor.renderAdapter;
    const view = adapter.getView();
    if (!view) return;
    const container = editor.getContainerDom();

    const wrap = document.createElement("div");
    wrap.dataset.videoPreview = "true";
    Object.assign(wrap.style, { position: "absolute", inset: "0", overflow: "hidden", pointerEvents: "none" } as CSSStyleDeclaration);
    const video = document.createElement("video");
    // 播放不靠 autoplay 属性，由 paint 显式 play()（要能拿到被拒时回退静音的机会）
    video.loop = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.dataset.videoPreviewPlayer = "true";
    Object.assign(video.style, {
      position: "absolute",
      display: "none",
      objectFit: "cover",
      background: "#000",
      pointerEvents: "none",
    } as CSSStyleDeclaration);
    wrap.appendChild(video);
    // 插在画布之后、其它 overlay 之前：播放器压在画布内容上，但不遮住选区框/「+」手柄
    container.insertBefore(wrap, view.nextSibling);
    this.#video = video;

    const toScreen = (world: { x: number; y: number }) => {
      const t = adapter.transform;
      return { x: world.x * t.scale + t.x, y: world.y * t.scale + t.y };
    };

    // 悬停命中：只有「有 src 的视频节点」参与；自上而下取最上层命中。
    const videoHitAt = (clientX: number, clientY: number): VideoHit | null => {
      const rect = view.getBoundingClientRect();
      const t = adapter.transform;
      const world = { x: (clientX - rect.left - t.x) / t.scale, y: (clientY - rect.top - t.y) / t.scale };
      const records = editor.state.getAllBlocks(
        (record) => !record.isRoot && (record.type === "media" || record.type === "free-element"),
      );
      for (let index = records.length - 1; index >= 0; index--) {
        const attrs = records[index].attrs as Record<string, unknown>;
        let src = "";
        let rect: Rect;
        let radius = MEDIA_RADIUS;
        if (records[index].type === "media") {
          if (String(attrs.modality ?? "image") !== "video") continue;
          src = String(attrs.src ?? "");
          const x = Number(attrs.x) || 0;
          const y = Number(attrs.y) || 0;
          const width = Number(attrs.width) || 0;
          const height = Number(attrs.height) || 0;
          // 挂接角标占用的高度与 RealMediaBlockV 的 innerH 一致
          rect = {
            x: x + MEDIA_INSET,
            y: y + MEDIA_INSET,
            width: Math.max(0, width - MEDIA_INSET * 2),
            height: Math.max(0, height - MEDIA_INSET * 2 - (attrs.attached ? 18 : 0)),
          };
          radius = MEDIA_RADIUS;
        } else {
          if (String(attrs.elementKind ?? "") !== "attr" || String(attrs.attrMedia ?? "") !== "video") continue;
          src = String(attrs.mediaSrc ?? "");
          // 视频属性卡的首帧同样在卡面内缩 6px（free-element-block-v），播放器必须盖同一个盒子
          const x = Number(attrs.x) || 0;
          const y = Number(attrs.y) || 0;
          const width = Number(attrs.width) || 0;
          const height = Number(attrs.height) || 0;
          rect = {
            x: x + MEDIA_INSET,
            y: y + MEDIA_INSET,
            width: Math.max(0, width - MEDIA_INSET * 2),
            height: Math.max(0, height - MEDIA_INSET * 2),
          };
        }
        if (!src || rect.width <= 0 || rect.height <= 0) continue;
        if (world.x < rect.x || world.x > rect.x + rect.width || world.y < rect.y || world.y > rect.y + rect.height) continue;
        return { blockId: records[index].id, src, rect, radius };
      }
      return null;
    };

    const hide = () => {
      const node = this.#video;
      if (!node) return;
      node.pause();
      node.style.display = "none";
    };

    const paint = () => {
      const node = this.#video;
      if (!node || !this.#lastClient) {
        hide();
        return;
      }
      const hit = videoHitAt(this.#lastClient.x, this.#lastClient.y);
      if (!hit) {
        hide();
        return;
      }
      const t = adapter.transform;
      const topLeft = toScreen({ x: hit.rect.x, y: hit.rect.y });
      node.style.left = `${topLeft.x}px`;
      node.style.top = `${topLeft.y}px`;
      node.style.width = `${hit.rect.width * t.scale}px`;
      node.style.height = `${hit.rect.height * t.scale}px`;
      // 圆角与世界坐标一致：vello 的 roundRect/clip radius 是世界单位（随视口缩放），
      // 屏幕空间覆盖层必须同样乘 scale，否则放大/缩小后与卡片圆角对不上。
      node.style.borderRadius = `${hit.radius * t.scale}px`;
      node.style.display = "block";
      if (this.#src !== hit.src) {
        this.#src = hit.src;
        node.src = hit.src;
      }
      if (node.paused) {
        // 优先带声：浏览器只在「本次会话已有用户手势」后允许带声自动播放；被拒则回退静音，
        // 保证悬停一定有画面（下次悬停再试一次带声）。
        node.muted = false;
        void node.play().catch(() => {
          node.muted = true;
          void node.play().catch(() => undefined);
        });
      }
    };

    const schedulePaint = () => {
      editor.ticker.schedule(VideoPreviewPlugin.#HOVER_KEY, () => {
        const pending = this.#pendingEvent;
        this.#pendingEvent = null;
        if (pending) this.#lastClient = { x: pending.clientX, y: pending.clientY };
        paint();
      });
    };

    const onPointerMove = (event: PointerEvent) => {
      this.#pendingEvent = event;
      schedulePaint();
    };
    const onPointerLeave = () => {
      this.#lastClient = null;
      this.#pendingEvent = null;
      editor.ticker.cancel(VideoPreviewPlugin.#HOVER_KEY);
      hide();
    };
    // transform（缩放/平移）变化：指针没动但节点动了——按最后指针位置重排/收起
    const unsubscribeTransform = adapter.onTransformEvent.on(() => schedulePaint());
    // 文档变化（悬停期间素材就绪、节点被删/移位）：同样按最后指针位置重排/收起
    const unsubscribeDoc = editor.state.onDocUpdateEvent.on(() => schedulePaint());

    view.addEventListener("pointermove", onPointerMove);
    view.addEventListener("pointerleave", onPointerLeave);

    this.#cleanup = () => {
      editor.ticker.cancel(VideoPreviewPlugin.#HOVER_KEY);
      view.removeEventListener("pointermove", onPointerMove);
      view.removeEventListener("pointerleave", onPointerLeave);
      unsubscribeTransform.dispose();
      unsubscribeDoc.dispose();
      this.#video = null;
      this.#src = "";
      wrap.remove();
    };
  }

  onEditorWillUnmount() {
    this.#cleanup?.();
    this.#cleanup = undefined;
  }

  dispose() {
    this.#cleanup?.();
    this.#cleanup = undefined;
  }
}
