import { Delta, LayoutLine, LayoutManagerOptions, LayoutResult, TextAttributes } from "./pixi-rich-text.types";

export class LayoutManager {
  private cache: Map<string, LayoutResult>;

  constructor() {
    this.cache = new Map();
  }

  public calculateLayout(delta: Delta, options: LayoutManagerOptions): LayoutResult {
    const key = this.getCacheKey(delta, options);
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const { width, height } = options;

    // 实际的布局计算逻辑
    const lines: LayoutLine[] = [];
    let currentY = 0;
    let currentLine: LayoutLine = { texts: [] };

    for (const segment of delta) {
      const { insert, attributes } = segment;
      const textMetrics = this.measureText(insert, attributes);

      if (currentLine.texts.length === 0) {
        currentLine.position = { x: 0, y: currentY };
      }

      if (currentLine.texts.length > 0 && currentLine.width + textMetrics.width > width) {
        // Check if text exceeds line width, then move to next line
        lines.push(currentLine);
        currentY += textMetrics.height; // Move to next line
        currentLine = { texts: [] };
      }

      const positionX = this.calculatePositionX(attributes, width, textMetrics.width);
      const positionY = this.calculatePositionY(attributes, height, textMetrics.height);

      currentLine.texts.push({
        text: insert,
        attributes,
        position: { x: positionX, y: positionY }
      });

      currentLine.width += textMetrics.width;
      currentLine.height = Math.max(currentLine.height || 0, textMetrics.height);
    }

    if (currentLine.texts.length > 0) {
      lines.push(currentLine);
    }

    const layoutResult: LayoutResult = {
      lines,
      width,
      height
    };

    this.cache.set(key, layoutResult);
    return layoutResult;
  }

  public clearCache() {
    this.cache.clear();
  }

  private getCacheKey(delta: Delta, options: LayoutManagerOptions): string {
    return JSON.stringify({ delta, ...options });
  }

  private measureText(text: string, attributes: TextAttributes): { width: number; height: number } {
    // Placeholder method to measure text metrics, replace with actual implementation
    const { fontSize } = attributes;
    return { width: text.length * fontSize * 0.6, height: fontSize }; // Example implementation
  }

  private calculatePositionX(attributes: TextAttributes, containerWidth: number, textWidth: number): number {
    const { textAlign = 'left' } = attributes; // Assume textAlign is part of TextAttributes
    switch (textAlign) {
      case 'left':
        return 0;
      case 'center':
        return (containerWidth - textWidth) / 2;
      case 'right':
        return containerWidth - textWidth;
      default:
        return 0;
    }
  }

  private calculatePositionY(attributes: TextAttributes, containerHeight: number, textHeight: number): number {
    const { verticalAlign = 'top' } = attributes; // Assume verticalAlign is part of TextAttributes
    switch (verticalAlign) {
      case 'top':
        return 0;
      case 'middle':
        return (containerHeight - textHeight) / 2;
      case 'bottom':
        return containerHeight - textHeight;
      default:
        return 0;
    }
  }
}
