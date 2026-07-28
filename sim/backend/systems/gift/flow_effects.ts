/**
 * Gift-flow social effects: face / prestige / reputation.
 * Give/repay formulas align with rule-of-gift-flow.md §3;
 * default path uses severity from rule-of-return-gift.md (via default_penalty).
 */
import type {
  GiftRecord,
  PublicMemory,
  RelationAxis,
  SimTime,
} from "../../../shared/types/index.js";
import type { WorldState } from "../../store/world_state.js";
import {
  computeDefaultSeverity,
  computeSocialPenalty,
  countPriorDefaults,
  type DefaultKind,
} from "./default_penalty.js";
import { isRitualOccasion, type EtiquetteAssessment } from "./norms.js";
import { SLOT_ORDER } from "../../../shared/types/index.js";
import { makePublicMemoryId } from "./public_memory.js";

export { isRitualOccasion };

export interface SocialTriplet {
  face: number;
  prestige: number;
  reputation: number;
}

export interface SocialDeltas {
  giverFace: number;
  giverPrestige: number;
  giverReputation: number;
  receiverFace: number;
  receiverPrestige: number;
  receiverReputation: number;
}

export interface SocialEffectResult {
  before: { giver: SocialTriplet; receiver: SocialTriplet };
  after: { giver: SocialTriplet; receiver: SocialTriplet };
  deltas: SocialDeltas;
  reasons: string[];
  formula: string;
}

function clampSocial(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function readSocial(agent: { public: { face?: number; prestige?: number; reputation?: number } }): SocialTriplet {
  return {
    face: agent.public.face ?? 50,
    prestige: agent.public.prestige ?? 50,
    reputation: agent.public.reputation ?? 50,
  };
}

function applyToAgent(
  agent: { public: { face?: number; prestige?: number; reputation?: number } },
  delta: Partial<SocialTriplet>,
): void {
  if (typeof delta.face === "number") {
    agent.public.face = clampSocial((agent.public.face ?? 50) + delta.face);
  }
  if (typeof delta.prestige === "number") {
    agent.public.prestige = clampSocial((agent.public.prestige ?? 50) + delta.prestige);
  }
  if (typeof delta.reputation === "number") {
    agent.public.reputation = clampSocial((agent.public.reputation ?? 50) + delta.reputation);
  }
}

function emptyDeltas(): SocialDeltas {
  return {
    giverFace: 0,
    giverPrestige: 0,
    giverReputation: 0,
    receiverFace: 0,
    receiverPrestige: 0,
    receiverReputation: 0,
  };
}

/** Slots between two SimTimes (non-negative). */
export function slotDistance(from: SimTime, to: SimTime): number {
  const fromIdx = (from.day - 1) * 3 + SLOT_ORDER.indexOf(from.slot);
  const toIdx = (to.day - 1) * 3 + SLOT_ORDER.indexOf(to.slot);
  return Math.max(0, toIdx - fromIdx);
}

/**
 * R7 / §3.2.D20: public memory of a gift default (severity-gated by caller).
 */
export function defaultPublicMemory(input: {
  time: SimTime;
  gift: GiftRecord;
  seqHint: string;
  salience?: number;
}): PublicMemory {
  const salience = input.salience ?? 0.75;
  return {
    mid: makePublicMemoryId(input.seqHint),
    eventType: "gift",
    title: "回礼违约",
    description: `${input.gift.to} 未按时向 ${input.gift.from} 回礼（${input.gift.gid}，¥${input.gift.value}）`,
    participants: [input.gift.from, input.gift.to],
    salience,
    createdAt: { ...input.time },
    relatedGids: [input.gift.gid],
    occasion: input.gift.occasion,
  };
}

export function applyGiveGiftSocialEffects(input: {
  world: WorldState;
  from: string;
  to: string;
  value: number;
  expressiveScore: number;
  giftKind: "expressive" | "instrumental";
  occasion?: string;
  eid?: string;
  etiquette: EtiquetteAssessment;
  relationAxis: RelationAxis;
  enableOccasionNorms: boolean;
}): SocialEffectResult {
  const giver = input.world.agents[input.from]!;
  const receiver = input.world.agents[input.to]!;
  const before = { giver: readSocial(giver), receiver: readSocial(receiver) };
  const deltas = emptyDeltas();
  const reasons: string[] = [];

  const ritual = isRitualOccasion(input.occasion);

  if (ritual && input.occasion) {
    const cohort = Math.max(
      1,
      input.world.giftLedger.filter(
        (g) => g.to === input.to && g.occasion === input.occasion && isRitualOccasion(g.occasion),
      ).length,
    );
    // Host prestige from ritual gifts (diminishing with cohort size)
    const prestigeGain =
      1.5 + input.value * 0.005 * input.expressiveScore + Math.sqrt(input.value) * 0.02;
    const scaled = prestigeGain / Math.pow(cohort, 0.12);
    deltas.receiverPrestige += scaled;
    reasons.push(`§3.2.A4 host.prestige+=f(value,weight,cohort=${cohort})`);

    deltas.receiverFace += 0.36;
    reasons.push("§3.2.A4/E23 host.face+=small from ritual scene");

    if (input.etiquette.belowNorm && input.enableOccasionNorms) {
      const fp = input.etiquette.facePenalty;
      deltas.giverFace -= fp;
      deltas.giverReputation -= fp;
      // Kin below-norm: extra reputation sting
      const edge = input.world.relationships.find(
        (e) => e.from === input.from && e.to === input.to,
      );
      if (edge?.socialBasis === "kin") {
        deltas.giverReputation -= 3;
      }
      reasons.push(`§3.2.A2 / R1 belowNorm → giver.face-=${fp.toFixed(1)} reputation↓`);
    } else if (!input.etiquette.belowNorm && input.etiquette.minGiftNorm) {
      const norm = input.etiquette.minGiftNorm;
      const overRatio = Math.max(0, (input.value - norm) / norm);
      deltas.giverFace += 0.8 + 0.5 * overRatio;
      reasons.push("§3.2.A3 meet/exceed minGiftNorm → giver.face↑");
      if (cohort === 1) {
        deltas.giverFace += 0.5;
        reasons.push("R5 sole ritual gift mild face↑");
      }
    }

    if (input.relationAxis === "vertical_up") {
      deltas.giverFace += input.etiquette.belowNorm ? 0.6 : 0.8;
      reasons.push("§3.2.C15 vertical_up ritual → giver.face↑, prestige≈0");
    }
  } else if (input.giftKind === "instrumental" || input.occasion === "instrumental") {
    // Limited prestige for instrumental favors
    deltas.receiverPrestige += input.value * 0.00125;
    reasons.push("§3.2.B9/B12 instrumental: receiver.prestige↑ limited");
  }

  applyToAgent(giver, {
    face: deltas.giverFace,
    prestige: deltas.giverPrestige,
    reputation: deltas.giverReputation,
  });
  applyToAgent(receiver, {
    face: deltas.receiverFace,
    prestige: deltas.receiverPrestige,
    reputation: deltas.receiverReputation,
  });

  const after = { giver: readSocial(giver), receiver: readSocial(receiver) };
  return {
    before,
    after,
    deltas,
    reasons,
    formula: reasons.length ? reasons.join("; ") : "no social delta",
  };
}

export function applyRepaySocialEffects(input: {
  world: WorldState;
  debtorId: string;
  creditorId: string;
  repayValue: number;
  original: GiftRecord;
  sufficient: boolean;
  axis: RelationAxis;
  delaySlots: number;
}): SocialEffectResult {
  const giver = input.world.agents[input.debtorId]!;
  const receiver = input.world.agents[input.creditorId]!;
  const before = { giver: readSocial(giver), receiver: readSocial(receiver) };
  const deltas = emptyDeltas();
  const reasons: string[] = [];

  if (input.sufficient) {
    deltas.giverReputation += 1.5;
    reasons.push("§3.2.D18 timely/sufficient repay → reputation↑");
    if (input.delaySlots > 0) {
      deltas.giverFace += 0.3;
      reasons.push("delayed-but-sufficient: mild face↑");
    }
  } else {
    // Underpay social — severity-scaled path preferred via applyDefaultSocialEffects;
    // keep light immediate hit for in-window underpay.
    deltas.giverFace -= 2;
    deltas.giverReputation -= 1.5;
    reasons.push("underpay: face↓ reputation↓");
  }

  applyToAgent(giver, {
    face: deltas.giverFace,
    prestige: deltas.giverPrestige,
    reputation: deltas.giverReputation,
  });
  applyToAgent(receiver, {
    face: deltas.receiverFace,
    prestige: deltas.receiverPrestige,
    reputation: deltas.receiverReputation,
  });

  const after = { giver: readSocial(giver), receiver: readSocial(receiver) };
  return {
    before,
    after,
    deltas,
    reasons,
    formula: reasons.join("; "),
  };
}

/**
 * Window timeout (or severity-driven) default → debtor face/reputation/prestige.
 * Naming: "giver*" = defaulting party (owed the return gift).
 */
export function applyDefaultSocialEffects(input: {
  world: WorldState;
  gift: GiftRecord;
  kind?: DefaultKind;
  replyValue?: number;
  requiredReplyValue?: number;
  severityOverride?: number;
}): SocialEffectResult & {
  severity: ReturnType<typeof computeDefaultSeverity>;
  socialPenalty: ReturnType<typeof computeSocialPenalty>;
} {
  const debtorId = input.gift.to;
  const creditorId = input.gift.from;
  const giver = input.world.agents[debtorId]!;
  const receiver = input.world.agents[creditorId]!;
  const before = { giver: readSocial(giver), receiver: readSocial(receiver) };
  const deltas = emptyDeltas();

  const edge =
    input.world.relationships.find((e) => e.from === debtorId && e.to === creditorId) ??
    ({
      from: debtorId,
      to: creditorId,
      socialBasis: "other" as const,
      intimacy: 20,
      trust: 20,
      affection: 20,
      authority: 10,
      giftDebt: 0,
      reciprocityScore: 0.3,
      relationAxis: "horizontal" as const,
    });

  const severity = computeDefaultSeverity({
    kind: input.kind ?? "timeout",
    gift: input.gift,
    replyValue: input.replyValue,
    requiredReplyValue: input.requiredReplyValue,
    edge,
    priorDefaultCount: countPriorDefaults(input.world.giftLedger, debtorId, input.gift.gid),
    debtorCash: giver.economy.cash,
    debtorIncome: giver.economy.income,
    debtorDebt: giver.economy.debt,
  });

  if (typeof input.severityOverride === "number") {
    severity.severity = Math.max(0, Math.min(1, input.severityOverride));
    severity.tier =
      severity.severity < 0.3 ? "lapse" : severity.severity < 0.6 ? "moderate" : "severe";
  }

  const socialPenalty = computeSocialPenalty(severity, input.gift, {
    debtorOpenDebtCount: input.world.giftLedger.filter(
      (g) =>
        g.to === debtorId &&
        (g.status === "pending_reply" || g.status === "defaulted") &&
        g.replyRequired !== false,
    ).length,
    debtorPrestige: giver.public.prestige,
    debtorSocialTags: giver.public.socialTags,
    debtorOccupation: giver.public.occupation,
  });

  // R28 vertical_down: mainly prestige, light trust handled in relation penalty
  if (edge.relationAxis === "vertical_down") {
    socialPenalty.prestige = Math.min(socialPenalty.prestige, -4 * severity.severity);
    socialPenalty.face *= 0.5;
  }

  deltas.giverFace = socialPenalty.face;
  deltas.giverReputation = socialPenalty.reputation;
  deltas.giverPrestige = socialPenalty.prestige;

  applyToAgent(giver, {
    face: deltas.giverFace,
    prestige: deltas.giverPrestige,
    reputation: deltas.giverReputation,
  });

  const after = { giver: readSocial(giver), receiver: readSocial(receiver) };
  const reasons = [
    `rule-of-return-gift ${severity.formula}`,
    socialPenalty.formula,
  ];

  return {
    before,
    after,
    deltas,
    reasons,
    formula: reasons.join("; "),
    severity,
    socialPenalty,
  };
}
