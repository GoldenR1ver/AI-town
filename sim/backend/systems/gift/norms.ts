/**
 * Yan gift-flow norms: R1 occasion minGiftNorm, R3/R4 axis repay, P4-11 debt kind.
 */
import type {
  GiftRecord,
  RelationAxis,
  SimTime,
  SocialBasis,
} from "../../../shared/types/index.js";

/** Default minimum gift norms by occasion (R1). */
export const DEFAULT_MIN_GIFT_NORMS: Record<string, number> = {
  wedding: 200,
  funeral: 150,
  birthday: 100,
  ritual: 100,
};

export interface GiftDebtComputation {
  giftKind: "expressive" | "instrumental";
  adjustedValue: number;
  debtAmount: number;
  formula: string;
}

/** P4-11: expressive vs instrumental → different debt on receiver→giver edge. */
export function computeGiftDebt(
  value: number,
  expressiveScore: number,
  occasion?: string,
): GiftDebtComputation {
  const instrumentalScore = 1 - expressiveScore;
  const adjustedValue = value * instrumentalScore;
  const instrumentalOccasion =
    occasion === "instrumental" ||
    occasion === "donation" ||
    occasion === "instrumental_gift";
  const giftKind: "expressive" | "instrumental" =
    instrumentalOccasion || expressiveScore < 0.4 ? "instrumental" : "expressive";

  if (giftKind === "instrumental") {
    // Material debt tracks closer to cash value.
    const debtAmount = value * (0.55 + 0.45 * instrumentalScore);
    return {
      giftKind,
      adjustedValue,
      debtAmount,
      formula: "instrumental: debt=value*(0.55+0.45*instrumental)",
    };
  }
  // Ritual/expressive: debt softens with expressiveScore (adjustedValue already lower).
  const debtAmount = adjustedValue * 0.9;
  return {
    giftKind,
    adjustedValue,
    debtAmount,
    formula: "expressive: debt=adjustedValue*0.9; adjusted=value*(1-expressive)",
  };
}

export function resolveMinGiftNorm(
  occasion: string | undefined,
  explicit?: number,
  defaults: Record<string, number> = DEFAULT_MIN_GIFT_NORMS,
): number | undefined {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  if (!occasion) return undefined;
  return defaults[occasion];
}

export interface EtiquetteAssessment {
  belowNorm: boolean;
  minGiftNorm?: number;
  facePenalty: number;
  trustPenalty: number;
  affectionPenalty: number;
  formula: string;
}

/** R1: value below occasion norm → 失礼 penalties (gift still commits). */
export function assessOccasionEtiquette(
  value: number,
  occasion: string | undefined,
  minGiftNorm?: number,
): EtiquetteAssessment {
  const norm = resolveMinGiftNorm(occasion, minGiftNorm);
  if (!norm || !occasion) {
    return {
      belowNorm: false,
      minGiftNorm: norm,
      facePenalty: 0,
      trustPenalty: 0,
      affectionPenalty: 0,
      formula: "R1 skipped (no occasion norm)",
    };
  }
  if (value >= norm) {
    return {
      belowNorm: false,
      minGiftNorm: norm,
      facePenalty: 0,
      trustPenalty: 0,
      affectionPenalty: 0,
      formula: `R1 ok value>=minGiftNorm(${norm})`,
    };
  }
  const shortfallRatio = (norm - value) / norm;
  return {
    belowNorm: true,
    minGiftNorm: norm,
    facePenalty: clamp(2 + 6 * shortfallRatio, 2, 8),
    trustPenalty: clamp(3 + 5 * shortfallRatio, 3, 8),
    affectionPenalty: clamp(4 + 6 * shortfallRatio, 4, 10),
    formula: `R1 belowNorm: face-=2..8 trust-=3..8 affection-=4..10 (shortfall=${shortfallRatio.toFixed(2)})`,
  };
}

export interface RepaySufficiency {
  sufficient: boolean;
  requiredMin: number;
  axis: RelationAxis;
  tolerance: number;
  formula: string;
}

/**
 * R3 horizontal: repay within relative tolerance of adjustedValue.
 * R4 vertical_up (debtor→creditor looks up): symbolic repay OK (lower ratio).
 * R4 vertical_down: expect full adjustedValue (or prestige hit handled elsewhere).
 */
export function assessRepaySufficiency(
  repayValue: number,
  original: GiftRecord,
  axis: RelationAxis,
  opts: {
    enableAxisReciprocity: boolean;
    horizontalTolerance?: number;
    verticalUpMinRatio?: number;
    verticalDownMinRatio?: number;
  },
): RepaySufficiency {
  const target = original.adjustedValue;
  if (!opts.enableAxisReciprocity) {
    return {
      sufficient: repayValue >= target,
      requiredMin: target,
      axis,
      tolerance: 0,
      formula: "axis rules off: repay>=adjustedValue",
    };
  }

  const hTol = opts.horizontalTolerance ?? 0.15;
  const upRatio = opts.verticalUpMinRatio ?? 0.3;
  const downRatio = opts.verticalDownMinRatio ?? 1.0;

  if (axis === "vertical_up") {
    const requiredMin = target * upRatio;
    return {
      sufficient: repayValue >= requiredMin,
      requiredMin,
      axis,
      tolerance: 1 - upRatio,
      formula: `R4 vertical_up: repay>=${upRatio}*adjustedValue`,
    };
  }
  if (axis === "vertical_down") {
    const requiredMin = target * downRatio;
    return {
      sufficient: repayValue >= requiredMin,
      requiredMin,
      axis,
      tolerance: 0,
      formula: `R4 vertical_down: repay>=${downRatio}*adjustedValue`,
    };
  }
  const requiredMin = target * (1 - hTol);
  return {
    sufficient: repayValue >= requiredMin,
    requiredMin,
    axis: "horizontal",
    tolerance: hTol,
    formula: `R3 horizontal: repay>=(1-${hTol})*adjustedValue`,
  };
}

/** Default reply window: instrumental shorter than expressive (Yan window bands). */
export function defaultReplyWindowSlots(
  giftKind: "expressive" | "instrumental",
  explicit?: number,
): number {
  if (typeof explicit === "number" && explicit > 0) return explicit;
  // Midpoints of rule-of-return-gift §二 bands (slots; 3 slots ≈ 1 day).
  return giftKind === "instrumental" ? 15 : 30;
}

export interface ReplyWindowContext {
  intimacy?: number;
  socialBasis?: SocialBasis;
  /** Debtor = original gift receiver who owes the reply. */
  debtorPrestige?: number;
  debtorFace?: number;
  debtorSocialTags?: string[];
  debtorOccupation?: string;
  debtorOpenDebtCount?: number;
  debtorCash?: number;
  debtorIncome?: number;
  /** Creditor = original giver. */
  creditorPrestige?: number;
}

export interface ReplyPolicy {
  replyRequired: boolean;
  /** Final ledger status when created. */
  initialStatus: "pending_reply" | "closed";
  windowSlots: number;
  /** Whether to accumulate bilateral giftDebt on receiver→giver edge. */
  recordDebt: boolean;
  formula: string;
}

/** High-status / host / cadre roles get longer reciprocity windows in village life. */
export function isHighStatusReceiver(ctx: {
  prestige?: number;
  face?: number;
  socialTags?: string[];
  occupation?: string;
}): boolean {
  const tags = ctx.socialTags ?? [];
  if (tags.some((t) => /authority|host|community_leader|cadre|official/i.test(t))) {
    return true;
  }
  const occ = ctx.occupation ?? "";
  if (/主任|村长|书记|支书|会长|干部/.test(occ)) return true;
  return (ctx.prestige ?? 50) >= 65 || (ctx.face ?? 50) >= 70;
}

/**
 * Prestige-asymmetric "tribute-like" gifts: weak-tie → high-status looks like vertical_up.
 * Kin / close friends still keep reciprocal windows (面子往来).
 */
export function isQuasiVerticalUp(args: {
  relationAxis: RelationAxis;
  intimacy?: number;
  socialBasis?: SocialBasis;
  debtorPrestige?: number;
  creditorPrestige?: number;
  debtorSocialTags?: string[];
  debtorOccupation?: string;
}): boolean {
  if (args.relationAxis === "vertical_up") return true;
  const intimacy = args.intimacy ?? 40;
  const basis = args.socialBasis ?? "other";
  const close =
    basis === "kin" || basis === "friend" || intimacy >= 55;
  if (close) return false;
  const gap = (args.debtorPrestige ?? 50) - (args.creditorPrestige ?? 50);
  if (gap >= 18) return true;
  return (
    isHighStatusReceiver({
      prestige: args.debtorPrestige,
      socialTags: args.debtorSocialTags,
      occupation: args.debtorOccupation,
    }) &&
    intimacy < 45 &&
    (basis === "neighbor" || basis === "colleague" || basis === "other" || basis === "subordinate")
  );
}

/**
 * Apply identity / relation / economy modulators on a base window (rule-of-return-gift W2/W10).
 * Probe windows (≤3 slots) stay locked for tests.
 */
export function modulateReplyWindowSlots(
  baseSlots: number,
  ctx: ReplyWindowContext = {},
): { windowSlots: number; factor: number; notes: string[] } {
  if (baseSlots <= 3) {
    return { windowSlots: baseSlots, factor: 1, notes: ["probe window locked"] };
  }
  const notes: string[] = [];
  let factor = 1;

  const intimacy = ctx.intimacy ?? 40;
  // High intimacy → expect slightly sooner; distant ties → more patience.
  if (intimacy >= 65) {
    factor *= 0.9;
    notes.push("intimacy↓window");
  } else if (intimacy < 30) {
    factor *= 1.25;
    notes.push("lowIntimacy↑window");
  }

  const basis = ctx.socialBasis;
  if (basis === "kin") {
    factor *= 1.15;
    notes.push("kin+15%");
  } else if (basis === "neighbor") {
    factor *= 1.1;
    notes.push("neighbor+10%");
  } else if (basis === "other") {
    factor *= 1.2;
    notes.push("weakTie+20%");
  }

  if (
    isHighStatusReceiver({
      prestige: ctx.debtorPrestige,
      face: ctx.debtorFace,
      socialTags: ctx.debtorSocialTags,
      occupation: ctx.debtorOccupation,
    })
  ) {
    factor *= 1.4;
    notes.push("highStatus×1.4");
  }

  const open = ctx.debtorOpenDebtCount ?? 0;
  if (open >= 2) {
    const load = Math.min(2.2, 1 + 0.18 * Math.min(8, open));
    factor *= load;
    notes.push(`debtLoad×${load.toFixed(2)}(n=${open})`);
  }

  const income = ctx.debtorIncome ?? 0;
  const cash = ctx.debtorCash ?? Infinity;
  if (income > 0 && cash < income * 0.12) {
    factor *= 1.35;
    notes.push("cashHardship×1.35");
  }

  const windowSlots = Math.max(
    6,
    Math.min(240, Math.round(baseSlots * factor)),
  );
  return { windowSlots, factor, notes };
}

/**
 * W1/W6/W8 + wedding-host rule: decide whether a gift enters the default window.
 *
 * - donation / public gift → closed, no debt, no window (W8)
 * - wedding / funeral ceremonial receive → closed, no one-to-one window (Yan host)
 * - vertical axis → no window-default (W6/R28); status closed
 * - prestige-asymmetric weak-tie tribute → closed (quasi vertical_up)
 * - otherwise horizontal reciprocal → pending_reply with modulated window
 */
export function resolveReplyPolicy(args: {
  occasion?: string;
  giftKind: "expressive" | "instrumental";
  relationAxis: RelationAxis;
  explicitWindowSlots?: number;
  expressiveScore: number;
  windowContext?: ReplyWindowContext;
}): ReplyPolicy {
  const occ = (args.occasion ?? "").toLowerCase();
  const ctx = args.windowContext ?? {};

  if (
    occ === "donation" ||
    occ === "donate" ||
    occ === "public_donation" ||
    occ === "road_maintenance" ||
    occ.startsWith("public.")
  ) {
    return {
      replyRequired: false,
      initialStatus: "closed",
      windowSlots: 0,
      recordDebt: false,
      formula: "W8 donation/public: no bilateral debt/window",
    };
  }

  if (occ === "wedding" || occ === "funeral") {
    return {
      replyRequired: false,
      initialStatus: "closed",
      windowSlots: 0,
      recordDebt: false,
      formula: "Yan ceremonial host-receive: no one-to-one reply window",
    };
  }

  if (args.relationAxis === "vertical_up" || args.relationAxis === "vertical_down") {
    return {
      replyRequired: false,
      initialStatus: "closed",
      windowSlots: 0,
      recordDebt: false,
      formula: "W6/R28 vertical: replyRequired=false",
    };
  }

  if (
    isQuasiVerticalUp({
      relationAxis: args.relationAxis,
      intimacy: ctx.intimacy,
      socialBasis: ctx.socialBasis,
      debtorPrestige: ctx.debtorPrestige,
      creditorPrestige: ctx.creditorPrestige,
      debtorSocialTags: ctx.debtorSocialTags,
      debtorOccupation: ctx.debtorOccupation,
    })
  ) {
    return {
      replyRequired: false,
      initialStatus: "closed",
      windowSlots: 0,
      recordDebt: false,
      formula: "quasi vertical_up (prestige/status tribute): replyRequired=false",
    };
  }

  let baseSlots: number;
  if (typeof args.explicitWindowSlots === "number" && args.explicitWindowSlots > 0) {
    // Explicit is a base band; identity/relation modulators still apply (except probe ≤3).
    baseSlots = args.explicitWindowSlots;
  } else {
    baseSlots = defaultReplyWindowSlots(args.giftKind);
    // W2: high expressive → longer window
    if (args.expressiveScore >= 0.8) {
      baseSlots = Math.max(baseSlots, 45);
    }
    // W3: high instrumental → shorter band 9–21
    if (args.giftKind === "instrumental" || args.expressiveScore <= 0.3) {
      baseSlots = Math.min(Math.max(baseSlots, 9), 21);
    }
    // Birthday / seasonal mid-long
    if (occ === "birthday" || occ === "ritual" || occ === "new_year") {
      baseSlots = Math.max(baseSlots, 45);
    }
    // Daily neighbor traffic: keep windows inside short-run horizons (~8d).
    if (occ === "daily" || occ === "neighbor" || occ === "visit") {
      baseSlots = Math.min(baseSlots, 18);
    }
  }

  const mod = modulateReplyWindowSlots(baseSlots, {
    ...ctx,
    socialBasis: ctx.socialBasis,
  });

  return {
    replyRequired: true,
    initialStatus: "pending_reply",
    windowSlots: mod.windowSlots,
    recordDebt: true,
    formula: `horizontal reciprocal base=${baseSlots}→${mod.windowSlots} kind=${args.giftKind} [${mod.notes.join(",") || "no-mod"}]`,
  };
}

/** Ritual / ceremonial occasions (public ledger, higher visibility). */
export function isRitualOccasion(occasion?: string): boolean {
  if (!occasion) return false;
  return (
    occasion === "wedding" ||
    occasion === "funeral" ||
    occasion === "birthday" ||
    occasion === "ritual"
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function simTimeLabel(t: SimTime): string {
  return `D${t.day}-${t.slot}`;
}
