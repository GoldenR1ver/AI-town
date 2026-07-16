import type { ReplayStep } from "@shared/replay/types";

export interface ActorPosition {
  x: number;
  y: number;
  orientation: number;
}

const villagePositions: ActorPosition[] = [
  { x: 370, y: 305, orientation: 90 },
  { x: 455, y: 335, orientation: 180 },
  { x: 555, y: 310, orientation: 90 },
  { x: 650, y: 350, orientation: 0 },
  { x: 805, y: 305, orientation: 90 },
  { x: 930, y: 340, orientation: 180 },
  { x: 1070, y: 330, orientation: 90 },
  { x: 1180, y: 390, orientation: 180 },
  { x: 350, y: 700, orientation: 0 },
  { x: 470, y: 765, orientation: 270 },
  { x: 600, y: 710, orientation: 0 },
  { x: 760, y: 780, orientation: 270 },
  { x: 900, y: 720, orientation: 180 },
  { x: 1020, y: 790, orientation: 270 },
  { x: 1130, y: 690, orientation: 180 },
  { x: 1240, y: 760, orientation: 270 },
];

const sceneAnchors = {
  dialogue: { x: 710, y: 560 },
  gift: { x: 965, y: 585 },
  event: { x: 505, y: 565 },
  default: { x: 710, y: 560 },
};

function numericAgentIndex(agentId: string): number {
  const numeric = Number.parseInt(agentId.replace(/\D/g, ""), 10);
  return Number.isFinite(numeric) ? Math.max(0, numeric - 1) : 0;
}

export function basePositionForAgent(agentId: string): ActorPosition {
  return villagePositions[numericAgentIndex(agentId) % villagePositions.length]!;
}

function anchorForStep(step: ReplayStep) {
  if (step.kind.startsWith("dialogue")) return sceneAnchors.dialogue;
  if (step.kind === "gift") return sceneAnchors.gift;
  if (step.kind === "event" || step.kind === "event_result" || step.kind === "intent") {
    return sceneAnchors.event;
  }
  return sceneAnchors.default;
}

export function positionForReplayActor(
  agentId: string,
  step: ReplayStep,
): ActorPosition {
  const focusIndex = step.focusAgentIds.indexOf(agentId);
  if (focusIndex < 0) return basePositionForAgent(agentId);

  const anchor = anchorForStep(step);
  const count = Math.max(step.focusAgentIds.length, 1);
  const columns = Math.min(4, count);
  const row = Math.floor(focusIndex / columns);
  const column = focusIndex % columns;
  const width = (columns - 1) * 54;
  const x = anchor.x - width / 2 + column * 54;
  const y = anchor.y + row * 54 - Math.max(0, Math.floor((count - 1) / columns)) * 18;
  const orientation = x < anchor.x ? 0 : x > anchor.x ? 180 : 90;
  return { x, y, orientation };
}
