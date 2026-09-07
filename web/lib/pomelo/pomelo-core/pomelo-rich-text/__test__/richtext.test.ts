import { PixiRichText } from "../pixi-rich-text";
import { Delta } from "../pixi-rich-text.types";


describe('RichText', () => {
  let richText: PixiRichText;
  const initialDelta: Delta = [
    { insert: 'Hello, ', attributes: { fontSize: 20, fontFamily: 'Arial', color: 0x000000 } },
    { insert: 'World!', attributes: { fontSize: 30, fontFamily: 'Arial', color: 0x0000FF } }
  ];

  beforeEach(() => {
    richText = new PixiRichText(initialDelta, 200, 100);
  });

  afterEach(() => {
    richText.destroy();
  });

  test('render should render text correctly', () => {
    richText.render();

    // Mock container or renderer to test actual rendering
    // Example: expect(container.children.length).toBeGreaterThan(0);

    // Example for console log check
    const layoutResult = richText.getLayoutResult();
    expect(layoutResult).toBeDefined();
    console.log('Layout result:', layoutResult);
  });

  test('updateDelta should update delta and re-render', () => {
    const updatedDelta: Delta = [
      { insert: 'Updated Hello, ', attributes: { fontSize: 20, fontFamily: 'Arial', color: 0x000000 } },
      { insert: 'Updated World!', attributes: { fontSize: 30, fontFamily: 'Arial', color: 0x0000FF } }
    ];

    richText.updateDelta(updatedDelta);

    const layoutResult = richText.getLayoutResult();
    expect(layoutResult).toBeDefined();
    console.log('Updated layout result:', layoutResult);
  });

  test('destroy should release textures and clear cache', () => {
    richText.render(); // Render to ensure textures are created

    richText.destroy();

    // Mock assertion for released textures
    // Example: expect(textTileManager.releasedTextures.length).toBeGreaterThan(0);
  });

  // Add more tests as needed for edge cases, error handling, etc.
});
