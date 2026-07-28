/**
 * Return-gift default penalties — aligned with reference/rule-of-return-gift.md
 * (severity S1–S5, relationship R1–R10, social R11–R14, expressive/instrumental R29–R30).
 */
import type {
  GiftRecord,
  RelationAxis,
  RelationshipEdge,
  SocialBasis,
} from "../../../shared/types/index.js";
import type { WorldState } from "../../store/world_state.js";
import { isRitualOccasion } from "./norms.js";

export type DefaultKind = "timeout" | "underpay";

export interface SeverityInput {
  kind: DefaultKind;
  gift: GiftRecord;
  /** For underpay: cash actually repaid toward the debt. */
  replyValue?: number;
  requiredReplyValue?: number;
  /** Debtor → creditor edge (B→A). */
  edge: RelationshipEdge;
  /** Prior defaults by this debtor (any creditor) for repeatFactor. */
  priorDefaultCount: number;
  /** Debtor economy for R27 hardship. */
  debtorCash?: number;
  debtorIncome?: number;
  debtorDebt?: number;
  /** Public ritual ledger underpay (S4). */
  publicLedgerUnderpay?: boolean;
}

export interface DefaultSeverity {
  severity: number;
  tier: "lapse" | "moderate" | "severe";
  timeoutFactor: number;
  underpayRatio: number;
  visibilityFactor: number;
  repeatFactor: number;
  giftTypeWeight: number;
  hardshipScale: number;
  formula: string;
}

export interface RelationPenalty {
  trust: number;
  affection: number;
  intimacy: number;
  reciprocityScore: number;
  /** Reverse edge A→B trust delta (R9: 50–70% of B→A). */
  reverseTrust: number;
  authority?: number;
  basisScale: number;
  formula: string;
}

export interface SocialPenalty {
  face: number;
  reputation: number;
  prestige: number;
  writePublicMemory: boolean;
  memorySalience: number;
  formula: string;
}

const W1 = 0.35;
const W2 = 0.25;
const W3 = 0.15;
const W4 = 0.15;
const W5 = 0.1;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function giftTypeWeight(gift: GiftRecord): number {
  const occ = gift.occasion ?? "";
  if (occ === "wedding" || occ === "funeral") return 1.0;
  if (occ === "instrumental" || gift.giftKind === "instrumental" || gift.instrumentalScore >= 0.7) {
    return 0.9;
  }
  if (gift.expressiveScore >= 0.9 || occ === "symbolic") return 0.3;
  if (occ === "birthday" || occ === "ritual") return 0.7;
  return 0.6; // daily / default
}

function socialBasisScale(basis: SocialBasis): number {
  switch (basis) {
    case "kin":
      return 1.3;
    case "friend":
      return 1.2;
    case "colleague":
      return 1.0;
    case "neighbor":
      return 0.9;
    case "superior":
    case "subordinate":
      return 1.0;
    case "other":
    default:
      return 0.7; // weak_tie
  }
}

/**
 * Compute defaultSeverity ∈ [0,1] (rule-of-return-gift §三).
 */
export function computeDefaultSeverity(input: SeverityInput): DefaultSeverity {
  const { kind, gift, edge } = input;
  const required =
    input.requiredReplyValue ??
    (gift.adjustedValue > 0 ? gift.adjustedValue : gift.value * (1 - gift.expressiveScore));
  const reply = input.replyValue ?? 0;
  const underpayRatio =
    kind === "timeout" ? 1 : clamp01(required <= 0 ? 1 : 1 - reply / required);

  // timeout: full miss; underpay: in-window partial (timeoutFactor = 0)
  const timeoutFactor = kind === "timeout" ? 1 : underpayRatio;

  const visibilityFactor = isRitualOccasion(gift.occasion) ? 1.0 : 0.4;
  const repeatFactor = Math.min(1, 0.3 * Math.max(1, input.priorDefaultCount + 1));
  const typeW = giftTypeWeight(gift);

  let severity =
    W1 * timeoutFactor +
    W2 * underpayRatio +
    W3 * visibilityFactor +
    W4 * repeatFactor +
    W5 * typeW;

  // S4: public ledger underpay
  if (input.publicLedgerUnderpay) severity += 0.2;

  // R26: instrumental underpay reads as deliberate slight
  if (kind === "underpay" && (gift.instrumentalScore >= 0.8 || gift.giftKind === "instrumental")) {
    severity += 0.15;
  }

  // R27: economic hardship — severity ×0.5
  let hardshipScale = 1;
  const cash = input.debtorCash ?? Infinity;
  const income = input.debtorIncome ?? 0;
  const debt = input.debtorDebt ?? 0;
  if (income > 0 && cash < income * 0.05 && debt > income * 0.5) {
    hardshipScale = 0.5;
    severity *= hardshipScale;
  }

  severity = clamp01(severity);

  const tier: DefaultSeverity["tier"] =
    severity < 0.3 ? "lapse" : severity < 0.6 ? "moderate" : "severe";

  return {
    severity,
    tier,
    timeoutFactor,
    underpayRatio,
    visibilityFactor,
    repeatFactor,
    giftTypeWeight: typeW,
    hardshipScale,
    formula:
      `severity=${severity.toFixed(3)} (${tier}) = ` +
      `${W1}*timeout(${timeoutFactor.toFixed(2)})+${W2}*underpay(${underpayRatio.toFixed(2)})` +
      `+${W3}*vis(${visibilityFactor})+${W4}*repeat(${repeatFactor.toFixed(2)})` +
      `+${W5}*type(${typeW})` +
      (hardshipScale < 1 ? `; R27 hardship×${hardshipScale}` : ""),
  };
}

/**
 * Relationship edge penalties (R1–R10, R26, R28–R30).
 * Returns deltas (negative numbers) to apply.
 */
export function computeRelationPenalty(
  severity: DefaultSeverity,
  input: {
    kind: DefaultKind;
    gift: GiftRecord;
    edge: RelationshipEdge;
    axis: RelationAxis;
  },
): RelationPenalty {
  const { kind, gift, edge, axis } = input;
  const s = severity.severity;
  const basisScale = socialBasisScale(edge.socialBasis);

  // R28: vertical_up receiver never defaults via window; if called, no trust hit
  if (axis === "vertical_up") {
    return {
      trust: 0,
      affection: 0,
      intimacy: 0,
      reciprocityScore: 0,
      reverseTrust: 0,
      basisScale,
      formula: "R28 vertical_up: no default relation penalty",
    };
  }

  // Base coefficients (rule-of-return-gift R1–R4)
  let trustCoef = kind === "timeout" ? 8 : 5;
  let affectionCoef = 10;
  let intimacyCoef = 6;
  const reciprocityCoef = 0.15; // reciprocityScore is [0,1] in this codebase

  // R26: underpay relation hit ≈ 65% of timeout (coef already lower for trust; scale rest)
  const underpayScale = kind === "underpay" ? 0.65 : 1;

  // R29: high expressive — trust half, affection/face primary
  if (gift.expressiveScore >= 0.9) {
    trustCoef *= 0.5;
  }
  // R30: high instrumental — trust/reputation primary, affection heavier
  if (gift.instrumentalScore >= 0.8 || gift.giftKind === "instrumental") {
    affectionCoef *= 1.2;
  }

  // R28 vertical_down: prestige path elsewhere; light/no trust
  if (axis === "vertical_down") {
    trustCoef *= 0.25;
  }

  let trust = -trustCoef * s * underpayScale * basisScale;
  let affection = -affectionCoef * s * underpayScale * basisScale;
  let intimacy = -intimacyCoef * s * underpayScale * basisScale;
  let reciprocityScore = -reciprocityCoef * s * underpayScale;

  // R2: close friends — extra affection sting
  if (edge.affection > 60) {
    affection -= 3 * basisScale;
  }

  // Reverse edge anger (R9): 60% of forward trust hit
  const reverseTrust = trust * 0.6;

  let authority: number | undefined;
  // R7: superior who fails downward gratitude loses legitimacy (authority)
  if (axis === "vertical_down" && edge.relationAxis === "vertical_down") {
    authority = -4 * s;
  }

  return {
    trust,
    affection,
    intimacy,
    reciprocityScore,
    reverseTrust,
    authority,
    basisScale,
    formula:
      `R1–R4 trust${trust.toFixed(1)} aff${affection.toFixed(1)} int${intimacy.toFixed(1)} ` +
      `recip${reciprocityScore.toFixed(2)} ×basis(${basisScale}) kind=${kind}`,
  };
}

/**
 * Face / prestige / reputation (R11–R14, S1–S3).
 * Applied to debtor (defaulting party B).
 */
export function computeSocialPenalty(
  severity: DefaultSeverity,
  gift: GiftRecord,
  opts?: {
    prestigeHostBonusRecent?: number;
    /** Concurrent open debts at default time — capacity excuse softens face. */
    debtorOpenDebtCount?: number;
    debtorPrestige?: number;
    debtorSocialTags?: string[];
    debtorOccupation?: string;
  },
): SocialPenalty {
  const s = severity.severity;
  const publicRitual = isRitualOccasion(gift.occasion);
  const faceCoef = publicRitual ? 12 : 4;

  let face = -faceCoef * s;
  let reputation = -8 * s;
  // R27 hardship: reputation still dips a little even when severity halved
  if (severity.hardshipScale < 1) {
    reputation = Math.min(reputation, -2 * s);
  }

  // Capacity / status excuse: leaders with many concurrent debts lose less face per miss
  // (village expects delayed reciprocity, not same-slot clearing of all debts).
  const openN = opts?.debtorOpenDebtCount ?? 0;
  const tags = opts?.debtorSocialTags ?? [];
  const occ = opts?.debtorOccupation ?? "";
  const highStatus =
    (opts?.debtorPrestige ?? 50) >= 65 ||
    tags.some((t) => /authority|host|community_leader|cadre|official/i.test(t)) ||
    /主任|村长|书记|支书|会长|干部/.test(occ);
  if (highStatus && openN >= 3) {
    const soften = Math.max(0.35, 1 - 0.12 * Math.min(6, openN - 2));
    face *= soften;
  } else if (openN >= 5) {
    face *= 0.7;
  }

  // R13: prestige is slow — only severe defaults
  let prestige = 0;
  if (s >= 0.6) {
    prestige = -5 * s;
    if (opts?.prestigeHostBonusRecent && opts.prestigeHostBonusRecent > 0) {
      prestige -= opts.prestigeHostBonusRecent * 0.3;
    }
  }

  // R28 vertical handled by caller for prestige-only paths

  const writePublicMemory = s >= 0.6; // S3
  let memorySalience = writePublicMemory ? Math.min(1, 0.6 + s * 0.3) : 0;
  if (writePublicMemory && (gift.occasion === "wedding" || gift.occasion === "funeral")) {
    memorySalience = Math.min(1, memorySalience + 0.2);
  }

  return {
    face,
    reputation,
    prestige,
    writePublicMemory,
    memorySalience,
    formula:
      `R11–R14 face${face.toFixed(1)} rep${reputation.toFixed(1)} ` +
      `prestige${prestige.toFixed(1)} pubMem=${writePublicMemory}` +
      (highStatus && openN >= 3 ? `; statusLoadFace×open=${openN}` : ""),
  };
}

/** Count prior gift.defaulted where agent was the debtor (to). */
export function countPriorDefaults(
  ledger: GiftRecord[],
  debtorId: string,
  excludeGid?: string,
): number {
  return ledger.filter(
    (g) => g.to === debtorId && g.status === "defaulted" && g.gid !== excludeGid,
  ).length;
}

export function severityFromWorld(
  world: WorldState,
  input: Omit<SeverityInput, "priorDefaultCount" | "debtorCash" | "debtorIncome" | "debtorDebt"> & {
    debtorId: string;
  },
): DefaultSeverity {
  const debtor = world.agents[input.debtorId];
  return computeDefaultSeverity({
    ...input,
    priorDefaultCount: countPriorDefaults(world.giftLedger, input.debtorId, input.gift.gid),
    debtorCash: debtor?.economy.cash,
    debtorIncome: debtor?.economy.income,
    debtorDebt: debtor?.economy.debt,
  });
}
