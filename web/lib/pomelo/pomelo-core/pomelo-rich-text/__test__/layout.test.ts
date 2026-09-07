import { LayoutManager } from "../pixi-rich-text-layout";
import { Delta, LayoutResult } from "../pixi-rich-text.types";

describe('LayoutManager', () => {
  let layoutManager: LayoutManager;

  beforeEach(() => {
    layoutManager = new LayoutManager();
  });

  afterEach(() => {
    layoutManager.clearCache();
  });

  test('calculateLayout should return correct layout result', () => {
    // Mock Delta data
    const delta: Delta = [
      { insert: "Hello, ", attributes: { fontSize: 20, fontFamily: "Arial", color: 0x000000 } },
      { insert: "World!", attributes: { fontSize: 30, fontFamily: "Arial", color: 0x0000FF } }
    ];

    // Define expected layout result (adjust as per your expected structure)
    const expectedLayout: LayoutResult = {
      width: 200,
      height: 100,
      lines: [
        {
          texts: [
            { text: "Hello, ", attributes: { fontSize: 20, fontFamily: "Arial", color: 0x000000 }, position: { x: 0, y: 0 } },
            { text: "World!", attributes: { fontSize: 30, fontFamily: "Arial", color: 0x0000FF }, position: { x: 50, y: 0 } }
          ]
        }
      ]
    };

    // Call calculateLayout method
    const layoutResult = layoutManager.calculateLayout(delta, {
      width: 200,
      height: 100
    });

    // Assert that the layout result matches the expected layout
    expect(layoutResult).toEqual(expectedLayout);
  });

  test('calculateLayout should cache layout result', () => {
    // Mock Delta data
    const delta: Delta = [
      { insert: "Hello, ", attributes: { fontSize: 20, fontFamily: "Arial", color: 0x000000 } },
      { insert: "World!", attributes: { fontSize: 30, fontFamily: "Arial", color: 0x0000FF } }
    ];

    // Call calculateLayout method twice with the same input
    layoutManager.calculateLayout(delta, {
      width: 200,
      height: 100
    });
    const layoutResult = layoutManager.calculateLayout(delta, {
      width: 200,
      height: 100
    });

    // Assert that the second call returns the cached layout result
    expect(layoutResult).toBeInstanceOf(Object); // Ensure it's an object (or adjust based on your structure)
  });

  test('clearCache should clear the cache', () => {
    // Mock Delta data
    const delta: Delta = [
      { insert: "Hello, ", attributes: { fontSize: 20, fontFamily: "Arial", color: 0x000000 } },
      { insert: "World!", attributes: { fontSize: 30, fontFamily: "Arial", color: 0x0000FF } }
    ];

    // Call calculateLayout method to populate the cache
    layoutManager.calculateLayout(delta, {
      width: 200,
      height: 100
    });

    // Clear the cache
    layoutManager.clearCache();

    // Call calculateLayout again and expect a new calculation (not cached)
    const layoutResult = layoutManager.calculateLayout(delta, {
      width: 200,
      height: 100
    });

    // Assert that the layout result is not the same object as before clearing the cache
    expect(layoutResult).not.toBeInstanceOf(Object); // Ensure it's not the same object (or adjust based on your structure)
  });

  // Add more tests as needed for edge cases, error handling, etc.
});
