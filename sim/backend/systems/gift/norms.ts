/**
 * Yan gift-flow norms: R1 occasion minGiftNorm, R3/R4 axis repay, P4-11 debt kind.
 */
import type { GiftRecord, RelationAxis, SimTime } from "../../../shared/types/index.js";

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

/** Default reply window: instrumental shorter than expressive. */
export function defaultReplyWindowSlots(
  giftKind: "expressive" | "instrumental",
  explicit?: number,
): number {
  if (typeof explicit === "number" && explicit > 0) return explicit;
  return giftKind === "instrumental" ? 6 : 9;
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
