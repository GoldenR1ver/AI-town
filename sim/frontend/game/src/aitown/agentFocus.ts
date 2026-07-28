import type { GiftRecord } from "@shared/types";
import type {
  ReplayCheckpoint,
  ReplayData,
  ReplayStep,
  ReplayWorldState,
} from "@shared/replay/types";

export interface AgentTrajectoryPoint {
  label: string;
  day: number;
  slot: string;
  seq: number;
  cash: number;
  deposit: number;
  debt: number;
  wealth: number;
  income: number;
  face: number;
  prestige: number;
  reputation: number;
  mood: number;
  stress: number;
  energy: number;
  arousal: number;
  beliefCount: number;
  desireSum: number;
  intentionCount: number;
}

export function stepInvolvesAgent(
  step: ReplayStep,
  agentId: string,
  gifts: GiftRecord[],
): boolean {
  if (!agentId) return false;
  if (step.focusAgentIds.includes(agentId)) return true;
  if (step.dialogue?.speakerId === agentId) return true;
  if (step.dialogue?.participants?.includes(agentId)) return true;
  if (
    step.affectedEdgeKeys.some(
      (key) => key.startsWith(`${agentId}->`) || key.endsWith(`->${agentId}`),
    )
  ) {
    return true;
  }
  if (step.affectedGiftIds.length) {
    const giftMap = new Map(gifts.map((gift) => [gift.gid, gift]));
    for (const gid of step.affectedGiftIds) {
      const gift = giftMap.get(gid);
      if (gift && (gift.from === agentId || gift.to === agentId)) return true;
    }
  }
  return false;
}

function pointFromState(
  state: ReplayWorldState,
  agentId: string,
  label?: string,
): AgentTrajectoryPoint | null {
  const agent = state.agents[agentId];
  if (!agent) return null;
  const beliefs = agent.private.beliefs ?? {};
  const desires = agent.private.desires ?? {};
  const intentions = agent.private.intentions ?? {};
  const beliefCount =
    typeof (beliefs as { __count?: unknown }).__count === "number"
      ? Number((beliefs as { __count: number }).__count)
      : Object.keys(beliefs).filter((key) => key !== "__count").length;
  const desireSum =
    typeof (desires as { __sum?: unknown }).__sum === "number"
      ? Number((desires as { __sum: number }).__sum)
      : Object.entries(desires)
          .filter(([key]) => key !== "__count" && key !== "__sum")
          .reduce((sum, [, value]) => sum + value, 0);
  return {
    label: label ?? `D${state.simTime.day}-${state.simTime.slot}`,
    day: state.simTime.day,
    slot: state.simTime.slot,
    seq: state.seq,
    cash: agent.economy.cash,
    deposit: agent.economy.deposit,
    debt: agent.economy.debt,
    wealth: agent.economy.cash + agent.economy.deposit,
    income: agent.economy.income,
    face: agent.public.face ?? 50,
    prestige: agent.public.prestige ?? 50,
    reputation: agent.public.reputation ?? 50,
    mood: agent.private.emotion.mood,
    stress: agent.private.emotion.stress,
    energy: agent.private.emotion.energy,
    arousal: agent.private.emotion.arousal,
    beliefCount,
    desireSum,
    intentionCount: Object.keys(intentions).length,
  };
}

/** Build attribute trajectory from checkpoints (+ initial state). */
export function buildAgentTrajectory(
  data: ReplayData,
  agentId: string,
): AgentTrajectoryPoint[] {
  if (!agentId) return [];
  const points: AgentTrajectoryPoint[] = [];
  const initial = pointFromState(data.initialState, agentId, "start");
  if (initial) points.push(initial);

  const checkpoints: ReplayCheckpoint[] = data.checkpoints ?? [];
  for (const checkpoint of checkpoints) {
    const point = pointFromState(checkpoint, agentId);
    if (!point) continue;
    const last = points[points.length - 1];
    if (last && last.seq === point.seq) continue;
    points.push(point);
  }
  return points;
}

export function filterStepsForAgent(
  steps: ReplayStep[],
  agentId: string,
  gifts: GiftRecord[],
): ReplayStep[] {
  if (!agentId) return steps;
  return steps.filter((step) => stepInvolvesAgent(step, agentId, gifts));
}

/** Nearest step index (original) among focused steps at/after current. */
export function nearestFocusedStepIndex(
  focusedSteps: ReplayStep[],
  currentIndex: number,
): number | null {
  if (!focusedSteps.length) return null;
  const atOrAfter = focusedSteps.find((step) => step.index >= currentIndex);
  if (atOrAfter) return atOrAfter.index;
  return focusedSteps[focusedSteps.length - 1]!.index;
}
