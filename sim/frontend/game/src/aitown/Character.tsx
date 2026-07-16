import {
  AnimatedSprite,
  Container,
  Graphics,
  Text,
} from "@pixi/react";
import {
  BaseTexture,
  SCALE_MODES,
  Spritesheet,
  TextStyle,
  type AnimatedSprite as PixiAnimatedSprite,
  type Graphics as PixiGraphics,
  type ISpritesheetData,
} from "pixi.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const nameStyle = new TextStyle({
  fill: 0xfff2d8,
  fontFamily: "monospace",
  fontSize: 9,
  fontWeight: "600",
});

const bubbleStyle = new TextStyle({
  fill: 0x181425,
  fontFamily: "monospace",
  fontSize: 12,
  fontWeight: "700",
  stroke: 0xffffff,
  strokeThickness: 4,
});

const idStyle = new TextStyle({
  fill: 0xffffff,
  fontFamily: "monospace",
  fontSize: 8,
  stroke: 0x181425,
  strokeThickness: 3,
});

export interface CharacterProps {
  agentId: string;
  name: string;
  textureUrl: string;
  spritesheetData: ISpritesheetData;
  x: number;
  y: number;
  orientation?: number;
  isMoving?: boolean;
  isSpeaking?: boolean;
  isThinking?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  onClick: () => void;
}

/**
 * AI-town Character adapted to a read-only replay actor.
 */
export function Character({
  agentId,
  name,
  textureUrl,
  spritesheetData,
  x,
  y,
  orientation = 90,
  isMoving = false,
  isSpeaking = false,
  isThinking = false,
  selected = false,
  dimmed = false,
  onClick,
}: CharacterProps) {
  const [sheet, setSheet] = useState<Spritesheet>();
  const spriteRef = useRef<PixiAnimatedSprite | null>(null);

  useEffect(() => {
    let disposed = false;
    const next = new Spritesheet(
      BaseTexture.from(textureUrl, { scaleMode: SCALE_MODES.NEAREST }),
      spritesheetData,
    );
    void next.parse().then(() => {
      if (!disposed) setSheet(next);
    });
    return () => {
      disposed = true;
    };
  }, [spritesheetData, textureUrl]);

  const direction = useMemo(() => {
    const index = Math.round((((orientation % 360) + 360) % 360) / 90) % 4;
    return ["right", "down", "left", "up"][index]!;
  }, [orientation]);

  useEffect(() => {
    if (isMoving) spriteRef.current?.play();
    else spriteRef.current?.gotoAndStop(0);
  }, [direction, isMoving]);

  const drawIndicator = useCallback(
    (graphics: PixiGraphics) => {
      graphics.clear();
      if (selected) {
        graphics.lineStyle(2, 0xffe083, 1);
        graphics.beginFill(0x20182a, 0.42);
        graphics.drawEllipse(0, 13, 17, 7);
        graphics.endFill();
      } else if (!dimmed) {
        graphics.beginFill(0x171321, 0.25);
        graphics.drawEllipse(0, 13, 13, 5);
        graphics.endFill();
      }
    },
    [dimmed, selected],
  );

  const drawNamePlate = useCallback((graphics: PixiGraphics) => {
    graphics.clear();
    graphics.beginFill(0x181425, 0.86);
    graphics.lineStyle(1, 0xb86f50, 0.95);
    graphics.drawRoundedRect(-30, -35, 60, 14, 2);
    graphics.endFill();
  }, []);

  if (!sheet) return null;
  const textures =
    sheet.animations[direction] ??
    sheet.animations.down ??
    Object.values(sheet.animations)[0];
  if (!textures?.length) return null;

  return (
    <Container
      x={x}
      y={y}
      alpha={dimmed ? 0.48 : 1}
      eventMode="static"
      cursor="pointer"
      pointertap={onClick}
      sortableChildren
    >
      <Graphics draw={drawIndicator} zIndex={0} />
      {selected && <Graphics draw={drawNamePlate} zIndex={4} />}
      {selected && (
        <Text
          text={name.slice(0, 5)}
          x={0}
          y={-28}
          anchor={0.5}
          zIndex={5}
          style={nameStyle}
        />
      )}
      <AnimatedSprite
        ref={spriteRef}
        textures={textures}
        isPlaying={isMoving}
        animationSpeed={0.1}
        anchor={0.5}
        zIndex={2}
      />
      {(isSpeaking || isThinking) && (
        <Text
          text={isSpeaking ? "..." : "?"}
          x={14}
          y={-24}
          anchor={0.5}
          zIndex={6}
          tint={isSpeaking ? 0xffffff : 0xb99bdd}
          style={bubbleStyle}
        />
      )}
      <Text
        text={agentId}
        x={0}
        y={22}
        anchor={0.5}
        zIndex={3}
        tint={selected ? 0xffe083 : 0xffffff}
        style={idStyle}
      />
    </Container>
  );
}
