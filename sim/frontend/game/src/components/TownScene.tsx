import { Container, Graphics, Stage } from "@pixi/react";
import type { AgentState } from "@shared/types";
import type { ReplayStep } from "@shared/replay/types";
import type { Graphics as PixiGraphics } from "pixi.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Character } from "../aitown/Character";
import { skinForAgent } from "../aitown/characters";
import { positionForReplayActor } from "../aitown/sceneLayout";
import { StaticMap } from "../aitown/StaticMap";
import {
  replayWorldMap,
  WORLD_PIXEL_HEIGHT,
  WORLD_PIXEL_WIDTH,
} from "../aitown/worldMap";

interface TownSceneProps {
  agents: Record<string, AgentState>;
  step: ReplayStep;
  selectedAgentId: string;
  onSelectAgent: (agentId: string) => void;
}

function useElementSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 560 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize({
          width: Math.max(320, Math.floor(rect.width)),
          height: Math.max(280, Math.floor(rect.height)),
        });
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

function timeTint(slot: ReplayStep["simTime"]["slot"]) {
  if (slot === "EVE") return { color: 0x151b45, alpha: 0.38 };
  if (slot === "PM") return { color: 0xffa14a, alpha: 0.08 };
  return { color: 0xffefb0, alpha: 0.025 };
}

export function TownScene({
  agents,
  step,
  selectedAgentId,
  onSelectAgent,
}: TownSceneProps) {
  const { ref, size } = useElementSize();
  const scale = Math.min(
    size.width / WORLD_PIXEL_WIDTH,
    size.height / WORLD_PIXEL_HEIGHT,
  );
  const offsetX = (size.width - WORLD_PIXEL_WIDTH * scale) / 2;
  const offsetY = (size.height - WORLD_PIXEL_HEIGHT * scale) / 2;
  const tint = timeTint(step.simTime.slot);
  const speakerId = step.dialogue?.speakerId;

  const drawTint = useCallback(
    (graphics: PixiGraphics) => {
      graphics.clear();
      graphics.beginFill(tint.color, tint.alpha);
      graphics.drawRect(0, 0, WORLD_PIXEL_WIDTH, WORLD_PIXEL_HEIGHT);
      graphics.endFill();
    },
    [tint.alpha, tint.color],
  );

  const actors = useMemo(
    () =>
      Object.entries(agents)
        .map(([agentId, agent]) => ({
          agentId,
          agent,
          position: positionForReplayActor(agentId, step),
        }))
        .sort((left, right) => left.position.y - right.position.y),
    [agents, step],
  );

  return (
    <div className="town-scene" ref={ref}>
      <Stage
        width={size.width}
        height={size.height}
        options={{
          antialias: false,
          autoDensity: true,
          backgroundAlpha: 0,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
        }}
      >
        <Container
          x={offsetX}
          y={offsetY}
          scale={scale}
          sortableChildren
        >
          <StaticMap map={replayWorldMap} />
          <Graphics draw={drawTint} zIndex={1} />
          {actors.map(({ agentId, agent, position }, index) => {
            const skin = skinForAgent(agentId);
            const focused = step.focusAgentIds.includes(agentId);
            return (
              <Character
                key={agentId}
                agentId={agentId}
                name={agent.public.name}
                textureUrl={skin.textureUrl}
                spritesheetData={skin.spritesheetData}
                x={position.x}
                y={position.y}
                orientation={position.orientation}
                isMoving={focused && step.kind !== "time"}
                isSpeaking={speakerId === agentId}
                isThinking={
                  !speakerId &&
                  focused &&
                  (step.kind === "intent" || step.kind === "dialogue_result")
                }
                selected={selectedAgentId === agentId}
                dimmed={
                  step.focusAgentIds.length > 0 &&
                  !focused &&
                  selectedAgentId !== agentId
                }
                onClick={() => onSelectAgent(agentId)}
              />
            );
          })}
        </Container>
      </Stage>
      <div className="scene-hud scene-hud-left">
        <span className="scene-day">第 {step.simTime.day} 天</span>
        <strong>{step.simTime.slot}</strong>
      </div>
      <div className="scene-hud scene-hud-right">
        {step.kind === "dialogue_message" ? "对话进行中" : step.title}
      </div>
    </div>
  );
}
