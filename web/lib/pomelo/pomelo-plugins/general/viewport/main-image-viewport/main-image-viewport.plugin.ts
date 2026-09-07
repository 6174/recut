/**
 * 主图片视图插件
 * 1. 主图片视图插件，用于显示主图片
 * 2. 主图片插件加载后
 *  - 会将 0.0 坐标设置为图片的中心
 *  - 会根据图片的尺寸，调整视图的尺寸, 使得视图能够恰当的刚好容纳下图片
 * 3. 插件可以传递图片的 src 属性，用于加载图片作为参数
 */

/**
 * Main Image Viewport Plugin
 * Handles viewport positioning and scaling for the main image
 */
import { PixiRendererAdapter, PomeloPlugin } from "../../../../pomelo-core";
import { PomeloEditor } from "../../../../pomelo-core/pomelo-editor";
import { measureImageSize } from "../../../../pomelo-utils/measure-image-size";

interface ViewportConfig {
  padding: number;  // Padding around the image
  maxScale: number; // Maximum allowed scale
  minScale: number; // Minimum allowed scale
}

export class MainImageViewportPlugin extends PomeloPlugin {
  private config: ViewportConfig = {
    padding: 40,
    maxScale: 2,
    minScale: 0.1
  };

  constructor(private readonly imageSrc: string) {
    super();
  }

  async onEditorDidMount(editor: PomeloEditor) {
    const imageSize = await measureImageSize(this.imageSrc);
    const container = editor.getContainerDom();

    // Initial adjustment
    this.adjustViewport(container, imageSize);
    const adapter = this.editor.renderAdapter as PixiRendererAdapter;
    adapter.onResizeEvent.on(e => {
      this.adjustViewport(container, imageSize);
    });
  }

  private adjustViewport(
    container: HTMLElement,
    imageSize: { width: number; height: number }
  ) {
    const adapter = this.editor.renderAdapter as PixiRendererAdapter;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // Calculate available space considering padding
    const availableWidth = containerWidth - (this.config.padding * 2);
    const availableHeight = containerHeight - (this.config.padding * 2);

    // Calculate scale to fit the image within the available space
    const scaleX = availableWidth / imageSize.width;
    const scaleY = availableHeight / imageSize.height;
    let scale = Math.min(scaleX, scaleY);

    // Clamp scale within min/max bounds
    scale = Math.min(Math.max(scale, this.config.minScale), this.config.maxScale);

    // Calculate center position
    const x = (containerWidth - (imageSize.width * scale)) / 2;
    const y = (containerHeight - (imageSize.height * scale)) / 2;

    // Update viewport transform
    adapter.setTransform(x, y, scale);
  }
}