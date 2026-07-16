import type { ISpritesheetData } from "pixi.js";
import { data as f1 } from "./spritesheets/f1";
import { data as f2 } from "./spritesheets/f2";
import { data as f3 } from "./spritesheets/f3";
import { data as f4 } from "./spritesheets/f4";
import { data as f5 } from "./spritesheets/f5";
import { data as f6 } from "./spritesheets/f6";
import { data as f7 } from "./spritesheets/f7";
import { data as f8 } from "./spritesheets/f8";

export interface CharacterSkin {
  name: string;
  textureUrl: string;
  spritesheetData: ISpritesheetData;
}

const textureUrl = `${import.meta.env.BASE_URL}assets/32x32folk.png`;

export const characterSkins: CharacterSkin[] = [
  f1,
  f2,
  f3,
  f4,
  f5,
  f6,
  f7,
  f8,
].map((spritesheetData, index) => ({
  name: `f${index + 1}`,
  textureUrl,
  spritesheetData: spritesheetData as ISpritesheetData,
}));

export function skinForAgent(agentId: string): CharacterSkin {
  const numeric = Number.parseInt(agentId.replace(/\D/g, ""), 10);
  const index = Number.isFinite(numeric) ? Math.max(0, numeric - 1) : 0;
  return characterSkins[index % characterSkins.length]!;
}
