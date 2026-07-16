/**
 * Lightweight agent decision helpers (gift give/repay refinement + prompt brief).
 * RuleEngine remains the only writer of world state.
 */
import type { WorldState } from "../store/world_state.js";
import { GiftLedgerManager } from "../systems/gift/ledger.js";
import { RelationshipGraph } from "../systems/relationship/graph.js";
import { round2 } from "../../shared/format.js";

export interface DecisionBrief {
  agentId: string;
  agentName: string;
  selfAttributes: Record<string, unknown>;
  giftLedger: {
    openDebts: { gid: string; from: string; value: number; adjustedValue: number }[];
    openDebtTotal: number;
    owedToUsTotal: number;
  };
  relationshipTargets: {
    targetId: string;
    targetName: string;
    score: number;
    factors: Record<string, number>;
    reason: string;
  }[];
  recommendedAction: string;
  recommendedTarget?: string;
  recommendedValue?: number;
  rationale: string;
}

export interface RefinedGiveGift {
  to: string;
  value: number;
  expressiveScore: number;
  rationale: string;
  brief?: DecisionBrief;
}

export interface RefinedRepayGift {
  to: string;
  value: number;
  rationale: string;
  brief?: DecisionBrief;
}

export class AgentDecisionEngine {
  buildBrief(
    world: WorldState,
    agentId: string,
    opts: {
      occasion?: string;
      preferredTarget?: string;
      action?: string;
    } = {},
  ): DecisionBrief | null {
    const agent = world.agents[agentId];
    if (!agent) return null;
    const ledger = new GiftLedgerManager(world.giftLedger);
    const graph = new RelationshipGraph(world.relationships);
    const openDebts = ledger.getOpenDebts(agentId);
    const openDebtTotal = openDebts.reduce((s, g) => s + g.adjustedValue, 0);
    const owedToUs = world.giftLedger.filter(
      (g) => g.from === agentId && g.status === "pending_reply",
    );
    const owedToUsTotal = owedToUs.reduce((s, g) => s + g.adjustedValue, 0);

    const targets = graph
      .neighbors(agentId)
      .map((edge) => {
        const other = world.agents[edge.to];
        const kinBonus = edge.socialBasis === "kin" ? 0.25 : 0;
        const score =
          edge.trust * 0.25 +
          edge.affection * 0.15 +
          edge.intimacy * 0.1 +
          edge.reciprocityScore * 20 +
          kinBonus * 40 +
          (other?.public.face ?? 50) * 0.05;
        return {
          targetId: edge.to,
          targetName: other?.public.name ?? edge.to,
          score: round2(score),
          factors: {
            giftDebt: edge.giftDebt,
            trust: edge.trust,
            affection: edge.affection,
            intimacy: edge.intimacy,
            reciprocity: edge.reciprocityScore,
            kinshipBonus: kinBonus,
            openDebtUrgency: 0,
            facePrestige: ((other?.public.face ?? 50) + (other?.public.prestige ?? 50)) / 200,
          },
          reason: `${edge.relationAxis !== "horizontal" ? `轴=${edge.relationAxis};` : ""}${edge.socialBasis} trust=${round2(edge.trust)}`,
        };
      })
      .sort((a, b) => b.score - a.score);

    const preferred =
      (opts.preferredTarget && targets.find((t) => t.targetId === opts.preferredTarget)) ||
      targets[0];
    const action = opts.action ?? (openDebtTotal > 0 ? "repay_gift" : "give_gift");
    const recommendedValue = preferred
      ? round2(Math.min(agent.economy.cash * 0.15, 50 + preferred.score * 8))
      : undefined;
    const rationale = preferred
      ? `action=${action};target=${preferred.targetId}(${preferred.targetName}) score=${preferred.score};openDebt=${round2(openDebtTotal)} owedToUs=${round2(owedToUsTotal)};${preferred.reason}`
      : `action=${action}; no targets`;

    return {
      agentId,
      agentName: agent.public.name,
      selfAttributes: {
        occupation: agent.public.occupation,
        age: agent.public.age,
        face: agent.public.face ?? 50,
        prestige: agent.public.prestige ?? 50,
        cash: agent.economy.cash,
        income: agent.economy.income,
        bigFive: agent.private.bigFive,
        emotion: agent.private.emotion,
      },
      giftLedger: {
        openDebts: openDebts.map((g) => ({
          gid: g.gid,
          from: g.from,
          value: g.value,
          adjustedValue: g.adjustedValue,
        })),
        openDebtTotal,
        owedToUsTotal,
      },
      relationshipTargets: targets.slice(0, 8),
      recommendedAction: action,
      recommendedTarget: preferred?.targetId,
      recommendedValue,
      rationale,
    };
  }

  toPromptText(brief: DecisionBrief): string {
    return [
      `decisionBrief agent=${brief.agentId} action=${brief.recommendedAction}`,
      `openDebt=${round2(brief.giftLedger.openDebtTotal)} owedToUs=${round2(brief.giftLedger.owedToUsTotal)}`,
      `recommend target=${brief.recommendedTarget ?? "n/a"} value≈${brief.recommendedValue ?? "n/a"}`,
      `rationale=${brief.rationale}`,
    ].join("\n");
  }

  refineGiveGift(
    world: WorldState,
    agentId: string,
    params: Record<string, unknown>,
    occasion?: string,
  ): RefinedGiveGift | null {
    const to = String(params.to ?? "");
    const brief = this.buildBrief(world, agentId, {
      occasion,
      preferredTarget: to || undefined,
      action: "give_gift",
    });
    if (!brief) return null;
    const agent = world.agents[agentId]!;
    const target = to || brief.recommendedTarget || "";
    if (!target) return null;
    const baseValue = Number(params.value ?? brief.recommendedValue ?? 100);
    const value = Math.max(
      1,
      Math.min(agent.economy.cash, Number.isFinite(baseValue) ? baseValue : 100),
    );
    return {
      to: target,
      value,
      expressiveScore: Number(params.expressiveScore ?? (occasion ? 0.7 : 0.5)),
      rationale: brief.rationale,
      brief,
    };
  }

  refineRepayGift(
    world: WorldState,
    agentId: string,
    params: Record<string, unknown>,
  ): RefinedRepayGift | null {
    const to = String(params.to ?? "");
    const brief = this.buildBrief(world, agentId, {
      preferredTarget: to || undefined,
      action: "repay_gift",
    });
    if (!brief) return null;
    const agent = world.agents[agentId]!;
    const open = world.giftLedger.find(
      (g) =>
        g.to === agentId &&
        g.status === "pending_reply" &&
        g.replyRequired !== false &&
        (!to || g.from === to),
    );
    const target = to || open?.from || brief.recommendedTarget || "";
    if (!target) return null;
    const need = open?.adjustedValue ?? Number(params.minValue ?? params.value ?? 50);
    const value = Math.max(1, Math.min(agent.economy.cash, need));
    return {
      to: target,
      value,
      rationale: brief.rationale,
      brief,
    };
  }
}
