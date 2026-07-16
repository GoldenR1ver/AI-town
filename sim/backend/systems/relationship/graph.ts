import type { RelationshipEdge, RelationAxis, SocialBasis, SimTime } from "../../../shared/types/index.js";

/** Bidirectional directed graph — A→B and B→A are independent. */
export class RelationshipGraph {
  constructor(private edges: RelationshipEdge[] = []) {}

  all(): RelationshipEdge[] {
    return this.edges;
  }

  setEdges(edges: RelationshipEdge[]): void {
    this.edges = edges;
  }

  getEdge(from: string, to: string): RelationshipEdge | undefined {
    return this.edges.find((e) => e.from === from && e.to === to);
  }

  /** Outgoing edges from ego (social circle query). */
  neighbors(agentId: string): RelationshipEdge[] {
    return this.edges.filter((e) => e.from === agentId);
  }

  /** Incoming edges to ego. */
  incoming(agentId: string): RelationshipEdge[] {
    return this.edges.filter((e) => e.to === agentId);
  }

  upsert(edge: RelationshipEdge): void {
    const i = this.edges.findIndex((e) => e.from === edge.from && e.to === edge.to);
    if (i >= 0) this.edges[i] = edge;
    else this.edges.push(edge);
  }

  remove(from: string, to: string): boolean {
    const before = this.edges.length;
    this.edges = this.edges.filter((e) => !(e.from === from && e.to === to));
    return this.edges.length < before;
  }

  ensureEdge(
    from: string,
    to: string,
    defaults?: Partial<Pick<RelationshipEdge, "socialBasis" | "relationAxis">>,
  ): RelationshipEdge {
    const existing = this.getEdge(from, to);
    if (existing) return existing;
    const edge: RelationshipEdge = {
      from,
      to,
      socialBasis: defaults?.socialBasis ?? "other",
      intimacy: 20,
      trust: 20,
      affection: 20,
      authority: 10,
      giftDebt: 0,
      reciprocityScore: 0.3,
      relationAxis: defaults?.relationAxis ?? "horizontal",
    };
    this.edges.push(edge);
    return edge;
  }
}

export function clampScore(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

/** Gift → relationship deltas (plan.md §4.2). */
export function giftRelationshipDelta(value: number, expressiveScore: number): {
  trust: number;
  affection: number;
  intimacy: number;
  formula: string;
} {
  const adjustedValue = value * (1 - expressiveScore);
  return {
    trust: 2 + 0.001 * adjustedValue,
    affection: 3 + 0.002 * expressiveScore * value,
    intimacy: 1 + 0.001 * expressiveScore * 100,
    formula: "trust+=2+0.001*adj; affection+=3+0.002*expr*value; intimacy+=1+0.001*expr*100",
  };
}

/** Legacy flat underpay baseline (kept for callers that pass raw deltas). */
export const GIFT_DEFAULT_PENALTY = { trust: -8, affection: -12, intimacy: -5 } as const;

/**
 * @deprecated Prefer computeRelationPenalty from default_penalty.ts (rule-of-return-gift).
 * Kept as intimacy-scaled fallback: trust-8 affection-12 intimacy-5 × [1.0, 1.5].
 */
export function scaledGiftDefaultPenalty(intimacy: number): {
  trust: number;
  affection: number;
  intimacy: number;
  scale: number;
  formula: string;
} {
  const scale = 1 + Math.min(1, Math.max(0, intimacy / 100)) * 0.5;
  return {
    trust: GIFT_DEFAULT_PENALTY.trust * scale,
    affection: GIFT_DEFAULT_PENALTY.affection * scale,
    intimacy: GIFT_DEFAULT_PENALTY.intimacy * scale,
    scale,
    formula: `default trust-8 affection-12 intimacy-5 × intimacyScale(${scale.toFixed(2)})`,
  };
}

export function applyEdgeDelta(
  edge: RelationshipEdge,
  delta: { trust?: number; affection?: number; intimacy?: number },
  at: SimTime,
): RelationshipEdge {
  return {
    ...edge,
    trust: clampScore(edge.trust + (delta.trust ?? 0)),
    affection: clampScore(edge.affection + (delta.affection ?? 0)),
    intimacy: clampScore(edge.intimacy + (delta.intimacy ?? 0)),
    lastChangedAt: { ...at },
  };
}

export type { RelationAxis, SocialBasis };
