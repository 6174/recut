import * as PIXI from "pixi.js"
import { AtlasInfo, TextAttributes } from "./pixi-rich-text.types";

export class TextTileManager {
  static readonly ATLAS_SIZE = 1024;
  static readonly GLYPH_SIZE = 16;
  private static readonly GRID_SIZE = TextTileManager.ATLAS_SIZE / TextTileManager.GLYPH_SIZE;

  private atlases: Map<string, AtlasInfo>;
  private glyphPositions: Map<string, { atlasId: string; x: number; y: number; refCount: number }>;
  private nextPosition: { x: number; y: number };
  private currentAtlasId: string;

  constructor() {
    this.atlases = new Map();
    this.glyphPositions = new Map();
    this.nextPosition = { x: 0, y: 0 };
    this.currentAtlasId = this.addAtlas();
  }

  private addAtlas(): string {
    const id = `atlas_${Date.now()}`;
    const canvas = document.createElement('canvas');
    canvas.width = TextTileManager.ATLAS_SIZE;
    canvas.height = TextTileManager.ATLAS_SIZE;
    const ctx = canvas.getContext('2d')!;
    const texture = PIXI.BaseTexture.from(canvas);

    this.atlases.set(id, {
      texture,
      canvas,
      ctx,
      lastUsed: Date.now()
    });

    return id;
  }

  public getTextTexture(text: string, attributes: TextAttributes): PIXI.Texture {
    if (text.length > 1 || attributes.fontSize > TextTileManager.GLYPH_SIZE) {
      return this.createLargeTextTexture(text, attributes);
    }

    const cacheKey = this.generateCacheKey(text, attributes);
    let position = this.glyphPositions.get(cacheKey);

    if (!position) {
      position = this.cacheGlyph(text, attributes);
    }

    const { atlasId, x, y } = position;
    const atlas = this.atlases.get(atlasId)!;
    atlas.lastUsed = Date.now();
    position.refCount++;

    return new PIXI.Texture(
      atlas.texture,
      new PIXI.Rectangle(
        x * TextTileManager.GLYPH_SIZE,
        y * TextTileManager.GLYPH_SIZE,
        TextTileManager.GLYPH_SIZE,
        TextTileManager.GLYPH_SIZE
      )
    );
  }

  public releaseTexture(texture: PIXI.Texture): void {
    // Decrease ref count for the texture's glyph position
    for (const [key, position] of this.glyphPositions.entries()) {
      if (position.atlasId === texture.baseTexture.textureCacheIds[0]) {
        position.refCount--;
        if (position.refCount === 0) {
          // If ref count reaches zero, release the position
          this.glyphPositions.delete(key);
          // Check if entire atlas can be released
          this.checkAtlasUsage(position.atlasId);
        }
        break;
      }
    }
  }

  private generateCacheKey(text: string, attributes: TextAttributes): string {
    return `${text}-${attributes.fontFamily}-${attributes.fontSize}`;
  }

  private cacheGlyph(text: string, attributes: TextAttributes): { atlasId: string; x: number; y: number; refCount: number } {
    if (this.nextPosition.x >= TextTileManager.GRID_SIZE) {
      this.nextPosition.x = 0;
      this.nextPosition.y++;
    }

    if (this.nextPosition.y >= TextTileManager.GRID_SIZE) {
      this.currentAtlasId = this.addAtlas();
      this.nextPosition = { x: 0, y: 0 };
    }

    const position = {
      atlasId: this.currentAtlasId,
      x: this.nextPosition.x,
      y: this.nextPosition.y,
      refCount: 1
    };

    const atlas = this.atlases.get(this.currentAtlasId)!;
    const { ctx } = atlas;

    ctx.fillStyle = '#ffffff';
    ctx.font = `${TextTileManager.GLYPH_SIZE}px ${attributes.fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.fillText(
      text,
      position.x * TextTileManager.GLYPH_SIZE,
      position.y * TextTileManager.GLYPH_SIZE
    );

    atlas.texture.update();

    const cacheKey = this.generateCacheKey(text, attributes);
    this.glyphPositions.set(cacheKey, position);

    this.nextPosition.x++;
    return position;
  }

  private createLargeTextTexture(text: string, attributes: TextAttributes): PIXI.Texture {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    ctx.font = `${attributes.fontSize}px ${attributes.fontFamily}`;
    const metrics = ctx.measureText(text);
    canvas.width = metrics.width;
    canvas.height = attributes.fontSize * 1.2;

    ctx.fillStyle = '#ffffff';
    ctx.font = `${attributes.fontSize}px ${attributes.fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.fillText(text, 0, 0);

    return PIXI.Texture.from(canvas);
  }

  private checkAtlasUsage(atlasId: string): void {
    const positions = Array.from(this.glyphPositions.values());
    const usedInAtlas = positions.some(pos => pos.atlasId === atlasId);

    if (!usedInAtlas) {
      const atlas = this.atlases.get(atlasId)!;
      atlas.texture.destroy();
      this.atlases.delete(atlasId);
    }
  }

  public cleanupUnusedAtlases(maxAge: number = 60000): void {
    const now = Date.now();
    for (const [id, atlas] of this.atlases.entries()) {
      if (now - atlas.lastUsed > maxAge) {
        atlas.texture.destroy();
        this.atlases.delete(id);
        // Remove glyph positions referencing this atlas
        for (const [key, position] of this.glyphPositions.entries()) {
          if (position.atlasId === id) {
            this.glyphPositions.delete(key);
          }
        }
      }
    }
  }
}
