/**
 * Lightweight agent decision helpers (gift give/repay refinement + prompt brief).
 * RuleEngine remains the only writer of world state.
 */
import type { WorldState } from "../store/world_state.js";
import { GiftLedgerManager } from "../systems/gift/ledger.js";
import { RelationshipGraph } from "../systems/relationship/graph.js";
import { round2 } from "../../shared/format.js";
import { dailyLivingCost } from "../systems/person/daily_vitals.js";
import { derivePersonality } from "./personality.js";
import { buildPersonalStateNarrative } from "../systems/dialogue/state_narrative.js";
import {
  formatGiftDebtNarrative,
  shouldPreferRepay,
  windowProximityUrgency,
} from "./gift_debt_align.js";
import { slotDistance } from "../systems/gift/flow_effects.js";

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
      now?: { day: number; slot: "AM" | "PM" | "EVE" };
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

    let simNow = opts.now ?? { day: 1, slot: "AM" as const };
    if (!opts.now) {
      for (const g of world.giftLedger) {
        if (
          g.givenAt.day > simNow.day ||
          (g.givenAt.day === simNow.day &&
            ["AM", "PM", "EVE"].indexOf(g.givenAt.slot) >
              ["AM", "PM", "EVE"].indexOf(simNow.slot))
        ) {
          simNow = { ...g.givenAt };
        }
      }
    }

    const targets = graph
      .neighbors(agentId)
      .map((edge) => {
        const other = world.agents[edge.to];
        const useAttrs = world.config.enableBdieDrive !== false;
        const kinBonus = edge.socialBasis === "kin" ? 0.25 : 0;
        const faceP = useAttrs
          ? (other?.public.face ?? 50) * 0.05 + (other?.public.prestige ?? 50) * 0.08
          : 2.5;
        const debt = openDebts.find((g) => g.from === edge.to);
        const prox = debt ? windowProximityUrgency(debt, simNow) : 0;
        const score =
          edge.trust * 0.25 +
          edge.affection * 0.15 +
          edge.intimacy * 0.1 +
          edge.reciprocityScore * 20 +
          kinBonus * 40 +
          faceP +
          prox * 35;
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
            openDebtUrgency: prox,
            facePrestige: useAttrs
              ? ((other?.public.face ?? 50) + (other?.public.prestige ?? 50)) / 200
              : 0.5,
          },
          reason: `${edge.relationAxis !== "horizontal" ? `轴=${edge.relationAxis};` : ""}${edge.socialBasis} trust=${round2(edge.trust)}${
            debt
              ? `;欠情临窗prox=${prox.toFixed(2)} slotsLeft=${slotDistance(simNow, debt.replyWindowEnd)}`
              : ""
          }`,
        };
      })
      .sort((a, b) => b.score - a.score);

    const preferred =
      (opts.preferredTarget && targets.find((t) => t.targetId === opts.preferredTarget)) ||
      targets[0];
    const preferRepay =
      openDebtTotal > 0 &&
      (shouldPreferRepay(world, agentId, simNow) || opts.action === "repay_gift");
    const action =
      opts.action ?? (preferRepay || openDebtTotal > 0 ? "repay_gift" : "give_gift");
    const infinite = world.config.infiniteEconomy === true;
    const prestige = agent.public.prestige ?? 50;
    const income = agent.economy.income;
    const traits = derivePersonality(agent);
    const em = agent.private.emotion;
    const living = infinite ? 0 : dailyLivingCost(agent);
    const bufferDays = infinite ? 999 : agent.economy.cash / Math.max(1, living);
    const stressPayPenalty = Math.max(0, em.stress - 0.6) * 0.28;
    const cashTightPenalty =
      infinite ? 0 : Math.max(0, 1 - agent.economy.cash / Math.max(1, income * 0.25)) * 0.22;
    const introvertPenalty = traits.introversion * 0.08;
    const debtHoldPenalty =
      action === "give_gift" && preferRepay ? 0.35 : action === "give_gift" && openDebtTotal > 0 ? 0.15 : 0;
    const rawBudget = infinite
      ? Math.max(80, income * 0.12 + prestige * 2.5)
      : Math.min(agent.economy.cash * 0.18, 50 + (preferred?.score ?? 0) * 8);
    const expectedBudget =
      rawBudget *
      Math.max(0.35, 1 - stressPayPenalty - cashTightPenalty - introvertPenalty - debtHoldPenalty);
    const recommendedValue = preferred ? round2(expectedBudget) : undefined;
    const giftDebtLines = formatGiftDebtNarrative(world, agentId, simNow);
    const narrative = buildPersonalStateNarrative({
      agent,
      edges: preferred
        ? world.relationships.filter(
            (e) => e.from === agentId && e.to === preferred.targetId,
          )
        : [],
      infiniteEconomy: infinite,
      extraLines: giftDebtLines,
    });
    const rationale = preferred
      ? `action=${action};target=${preferred.targetId}(${preferred.targetName}) score=${preferred.score};openDebt=${round2(openDebtTotal)} owedToUs=${round2(owedToUsTotal)};preferRepay=${preferRepay};stress=${em.stress.toFixed(2)};bufferDays=${bufferDays.toFixed(1)};${preferred.reason}${infinite ? ";infiniteEconomy" : ""}`
      : `action=${action}; no targets`;

    return {
      agentId,
      agentName: agent.public.name,
      selfAttributes: {
        occupation: agent.public.occupation,
        age: agent.public.age,
        face: agent.public.face ?? 50,
        prestige: agent.public.prestige ?? 50,
        cash: infinite ? "∞" : agent.economy.cash,
        income: agent.economy.income,
        dailyLivingCost: living,
        bufferDays: round2(bufferDays),
        personality: traits,
        bigFive: world.config.enableBdieDrive === false ? { O: 0.5, C: 0.5, E: 0.5, A: 0.5, N: 0.5 } : agent.private.bigFive,
        emotion: world.config.enableBdieDrive === false
          ? { mood: 0.5, arousal: 0.3, stress: 0.2, energy: 0.7 }
          : agent.private.emotion,
        stateNarrative: narrative,
        giftDebtNarrative: giftDebtLines,
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
    const infinite = world.config.infiniteEconomy === true;
    const value = Math.max(
      1,
      infinite
        ? Number.isFinite(baseValue)
          ? baseValue
          : 100
        : Math.min(agent.economy.cash, Number.isFinite(baseValue) ? baseValue : 100),
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
    const infinite = world.config.infiniteEconomy === true;
    const value = Math.max(1, infinite ? need : Math.min(agent.economy.cash, need));
    return {
      to: target,
      value,
      rationale: brief.rationale,
      brief,
    };
  }
}
