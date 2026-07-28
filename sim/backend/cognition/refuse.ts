import type {
  AgentState,
  EventInstance,
  GoalType,
  PersonalGoal,
  RelationshipEdge,
} from "../../shared/types/index.js";
import type { WorldState } from "../store/world_state.js";
import {
  hasUrgentGiftDebt,
  isCeremonyOccasion,
} from "./gift_debt_align.js";
import { derivePersonality } from "./personality.js";

export interface RefuseDecision {
  refuse: boolean;
  reason: string;
  /** Light relationship penalty applied to counterpart(s). */
  trustPenalty: number;
  affectionPenalty: number;
  intimacyPenalty: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function counterpartIds(event: EventInstance, selfId: string): string[] {
  const ids = new Set<string>();
  for (const list of Object.values(event.roleBindings)) {
    for (const id of list) if (id !== selfId) ids.add(id);
  }
  if (event.sourceAgentId && event.sourceAgentId !== selfId) {
    ids.add(event.sourceAgentId);
  }
  return [...ids];
}

function edgeDislike(edge: RelationshipEdge | undefined): number {
  return edge?.dislike ?? 0;
}

/**
 * Probabilistic refuse for attend / gift / donate / social goals.
 * Decision-aligned: ceremony hard-block; urgent gift-debt suppresses voluntary spend refuse differently.
 */
export function decideRefuse(
  world: WorldState,
  agent: AgentState,
  goal: PersonalGoal,
  event: EventInstance,
  rng: () => number,
): RefuseDecision {
  const no = {
    refuse: false,
    reason: "",
    trustPenalty: 0,
    affectionPenalty: 0,
    intimacyPenalty: 0,
  };
  if (world.config.enableBdieDrive === false) return no;

  const actionable: GoalType[] = [
    "attend",
    "give_gift",
    "donate_cash",
    "complete_dialogue",
    "spread_info",
  ];
  if (!actionable.includes(goal.goalType)) return no;

  const occasion = String(event.payload.occasion ?? event.subType ?? "");
  const ceremony = isCeremonyOccasion(occasion);

  // Alignment: wedding/funeral (and similar) — almost never refuse attend/gift/donate.
  if (
    ceremony &&
    (goal.goalType === "attend" ||
      goal.goalType === "give_gift" ||
      goal.goalType === "donate_cash" ||
      goal.goalType === "complete_dialogue")
  ) {
    return no;
  }

  // Alignment: reply_gift near window — do not refuse obligation lightly.
  if (goal.goalType === "reply_gift") {
    // handled below with strong downweight; never hard-refuse here
  }

  const traits = derivePersonality(agent);
  const em = agent.private.emotion;
  const others = counterpartIds(event, agent.public.id);
  const edges = world.relationships.filter(
    (e) => e.from === agent.public.id && others.includes(e.to),
  );
  const maxDislike = Math.max(0, ...edges.map((e) => edgeDislike(e)));
  const minTrust = edges.length ? Math.min(...edges.map((e) => e.trust)) : 50;
  const kinOrClose = edges.some(
    (e) =>
      e.socialBasis === "kin" ||
      e.intimacy >= 60 ||
      e.affection >= 60,
  );
  const cashHard =
    world.config.infiniteEconomy === true
      ? 0
      : clamp01(1 - agent.economy.cash / Math.max(1, agent.economy.income * 0.2));
  const urgentDebt = hasUrgentGiftDebt(world, agent.public.id, event.time ?? { day: 1, slot: "AM" });

  let p = 0.02;
  p += Math.max(0, em.stress - 0.62) * 0.28;
  p += Math.max(0, 0.35 - em.energy) * 0.25;
  p += Math.max(0, 0.3 - em.mood) * 0.12;
  p += traits.introversion * 0.12;
  p += (maxDislike / 100) * 0.22;
  p += Math.max(0, 35 - minTrust) / 100 * 0.1;
  p += cashHard * (goal.goalType === "give_gift" || goal.goalType === "donate_cash" ? 0.22 : 0.08);

  // Alignment: with urgent 欠情, more willing to refuse *new* voluntary spend / idle social,
  // but must not refuse repay.
  if (urgentDebt) {
    if (goal.goalType === "give_gift" || goal.goalType === "donate_cash") {
      // still allow refuse of *new* gifts when already owing — but prefer completing repay goals
      if (String(goal.params?.originalGid ?? "") === "") p += 0.15;
    }
    if (goal.goalType === "attend" || goal.goalType === "spread_info") p += 0.08;
  }

  if (goal.goalType === "reply_gift") p *= 0.12;
  if (goal.goalType === "give_gift" || goal.goalType === "donate_cash") {
    p += Math.max(0, em.stress - 0.7) * 0.12;
  }
  if (kinOrClose) p *= 0.35;
  if (event.sourceAgentId === agent.public.id || event.roleBindings.initiator?.includes(agent.public.id)) {
    p *= 0.4;
  }
  if (goal.optional) p *= 1.2;

  p = Math.min(0.42, clamp01(p));
  if (rng() >= p) return no;

  const severity = 0.4 + traits.introversion * 0.15 + em.stress * 0.2;
  return {
    refuse: true,
    reason: [
      `refuse ${goal.goalType}`,
      em.stress >= 0.7 ? "高压力不愿参与/出资" : null,
      em.energy <= 0.3 ? "精力不足" : null,
      traits.introversion >= 0.65 ? "性格内向不愿主动" : null,
      maxDislike >= 50 ? "讨厌对方" : null,
      cashHard > 0.55 ? "手头紧" : null,
      urgentDebt && goal.goalType !== "reply_gift" ? "尚有欠情未还" : null,
    ]
      .filter(Boolean)
      .join("；"),
    trustPenalty: -0.55 * severity,
    affectionPenalty: -0.85 * severity,
    intimacyPenalty: -0.35 * severity,
  };
}
