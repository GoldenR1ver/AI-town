import {
  bgtiles,
  mapheight,
  mapwidth,
  objmap,
  tiledim,
  tilesetpxh,
  tilesetpxw,
} from "./gentle";

export interface ReplayWorldMap {
  width: number;
  height: number;
  tileDim: number;
  tileSetUrl: string;
  tileSetDimX: number;
  tileSetDimY: number;
  bgTiles: number[][][];
  objectTiles: number[][][];
}

export const replayWorldMap: ReplayWorldMap = {
  width: mapwidth,
  height: mapheight,
  tileDim: tiledim,
  tileSetUrl: `${import.meta.env.BASE_URL}assets/gentle-obj.png`,
  tileSetDimX: tilesetpxw,
  tileSetDimY: tilesetpxh,
  bgTiles: bgtiles,
  objectTiles: objmap,
};

export const WORLD_PIXEL_WIDTH = replayWorldMap.width * replayWorldMap.tileDim;
export const WORLD_PIXEL_HEIGHT = replayWorldMap.height * replayWorldMap.tileDim;
