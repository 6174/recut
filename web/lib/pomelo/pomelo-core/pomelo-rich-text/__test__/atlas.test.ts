
import PIXI from 'pixi.js'; // 假设你使用了 Pixi.js
import { TextTileManager } from '../rich-text-atlas';
import { TextAttributes } from '../pixi-rich-text.types';

describe('TextTileManager', () => {
  let textTileManager: TextTileManager;

  beforeEach(() => {
    textTileManager = new TextTileManager();
  });

  afterEach(() => {
    textTileManager.cleanupUnusedAtlases();
  });

  test('getTextTexture should return correct texture for single character', () => {
    const attributes: TextAttributes = {
      fontSize: 20,
      fontFamily: 'Arial',
      color: 0x000000
    };

    const texture = textTileManager.getTextTexture('A', attributes);

    expect(texture).toBeInstanceOf(PIXI.Texture);
    expect(texture.width).toBe(TextTileManager.GLYPH_SIZE);
    expect(texture.height).toBe(TextTileManager.GLYPH_SIZE);
  });

  test('getTextTexture should return correct texture for large text', () => {
    const longText = 'This is a long text.';
    const attributes: TextAttributes = {
      fontSize: 30,
      fontFamily: 'Arial',
      color: 0x0000FF
    };

    const texture = textTileManager.getTextTexture(longText, attributes);

    expect(texture).toBeInstanceOf(PIXI.Texture);
    expect(texture.width).toBeGreaterThan(TextTileManager.GLYPH_SIZE);
    expect(texture.height).toBeGreaterThan(TextTileManager.GLYPH_SIZE);
  });

  test('cleanupUnusedAtlases should remove unused atlases', () => {
    const attributes: TextAttributes = {
      fontSize: 20,
      fontFamily: 'Arial',
      color: 0x000000
    };

    // Generate some textures
    const textures = [];
    for (let i = 0; i < 10; i++) {
      textures.push(textTileManager.getTextTexture('A', attributes));
    }

    // Release all textures
    for (const texture of textures) {
      textTileManager.releaseTexture(texture);
    }

    // Call cleanupUnusedAtlases
    textTileManager.cleanupUnusedAtlases();

    // Assert that all atlases are cleaned up
    expect(textTileManager['atlases'].size).toBe(0);
  });

  // Add more tests as needed for edge cases, error handling, etc.
});
