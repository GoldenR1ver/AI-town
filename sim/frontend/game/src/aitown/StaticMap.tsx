import { PixiComponent } from "@pixi/react";
import * as PIXI from "pixi.js";
import type { ReplayWorldMap } from "./worldMap";

/**
 * Adapted from AI-town's PixiStaticMap. The Convex world and animated
 * environment layers are intentionally removed for deterministic replay.
 */
export const StaticMap = PixiComponent("ReplayStaticMap", {
  create: ({ map }: { map: ReplayWorldMap }) => {
    const columns = Math.floor(map.tileSetDimX / map.tileDim);
    const rows = Math.floor(map.tileSetDimY / map.tileDim);
    const baseTexture = PIXI.BaseTexture.from(map.tileSetUrl, {
      scaleMode: PIXI.SCALE_MODES.NEAREST,
    });
    const tileTextures: PIXI.Texture[] = [];

    for (let x = 0; x < columns; x++) {
      for (let y = 0; y < rows; y++) {
        tileTextures[x + y * columns] = new PIXI.Texture(
          baseTexture,
          new PIXI.Rectangle(
            x * map.tileDim,
            y * map.tileDim,
            map.tileDim,
            map.tileDim,
          ),
        );
      }
    }

    const container = new PIXI.Container();
    const allLayers = [...map.bgTiles, ...map.objectTiles];
    for (let x = 0; x < map.width; x++) {
      for (let y = 0; y < map.height; y++) {
        for (const layer of allLayers) {
          const tileIndex = layer[x]?.[y] ?? -1;
          if (tileIndex < 0 || !tileTextures[tileIndex]) continue;
          const sprite = new PIXI.Sprite(tileTextures[tileIndex]!);
          sprite.x = x * map.tileDim;
          sprite.y = y * map.tileDim;
          container.addChild(sprite);
        }
      }
    }
    return container;
  },
  applyProps: () => {
    // The replay map is immutable for the lifetime of the Pixi stage.
  },
});
