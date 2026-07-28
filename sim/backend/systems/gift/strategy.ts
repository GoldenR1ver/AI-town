/**
 * P4-10 GiftStrategyLLM + P4-08 R6 debt-modulated heuristics.
 * LLM proposes; RuleEngine still commits.
 */
import type { SimTime } from "../../../shared/types/index.js";
import type { LlmClient } from "../../llm/client.js";
import type { WorldState } from "../../store/world_state.js";
import { RelationshipGraph } from "../relationship/graph.js";
import { GiftLedgerManager } from "./ledger.js";
import { AgentDecisionEngine } from "../../cognition/decision.js";
import { round2 } from "../../../shared/format.js";
import { DEFAULT_MIN_GIFT_NORMS, resolveMinGiftNorm } from "./norms.js";
import {
  shouldPreferRepay,
  windowProximityUrgency,
} from "../../cognition/gift_debt_align.js";
import { slotDistance } from "./flow_effects.js";

export interface GiftStrategyProposal {
  targetAgentId: string;
  value: number;
  expressiveScore: number;
  occasion?: string;
  description?: string;
  reason: string;
  source: "heuristic" | "llm";
}

export interface ClippedGiftProposal extends GiftStrategyProposal {
  clipped: boolean;
  clipReason?: string;
  rejected: boolean;
  rejectReason?: string;
}

export interface DebtActionBias {
  agentId: string;
  /** Urgency to repay open debts (0–1). */
  repayUrgency: number;
  /** Willingness to initiate new gifts (0–1); lowered by high outbound social pressure. */
  giftWillingness: number;
  preferredRepayTargets: string[];
  /** Prefer giving to high-debt creditors (owe us) or high-intimacy peers. */
  preferredGiftTargets: string[];
  openDebtTotal: number;
  owedToUsTotal: number;
  formula: string;
}

/** R6: giftDebt / open ledger modulate action tendency. */
export function computeDebtActionBias(
  world: WorldState,
  agentId: string,
  now: SimTime = { day: 1, slot: "AM" },
): DebtActionBias {
  const ledger = new GiftLedgerManager(world.giftLedger);
  const openDebts = ledger.getOpenDebts(agentId);
  const openDebtTotal = openDebts.reduce((s, g) => s + g.adjustedValue, 0);
  const owedToUs = world.giftLedger.filter(
    (g) => g.from === agentId && g.status === "pending_reply",
  );
  const owedToUsTotal = owedToUs.reduce((s, g) => s + g.adjustedValue, 0);

  const graph = new RelationshipGraph(world.relationships);
  const outgoingDebt = graph
    .neighbors(agentId)
    .reduce((s, e) => s + Math.max(0, e.giftDebt), 0);

  const income = world.agents[agentId]?.economy.income ?? 1;
  const maxProx = openDebts.reduce(
    (m, g) => Math.max(m, windowProximityUrgency(g, now)),
    0,
  );
  const amountUrgency = Math.min(1, openDebtTotal / Math.max(200, income * 0.15));
  // Alignment: window proximity dominates over raw amount.
  let repayUrgency = Math.min(1, Math.max(amountUrgency, maxProx * 0.95));
  if (shouldPreferRepay(world, agentId, now)) {
    repayUrgency = Math.max(repayUrgency, 0.72);
  }
  const giftWillingness = Math.max(
    0.08,
    1 -
      0.55 * repayUrgency -
      0.2 * Math.min(1, outgoingDebt / Math.max(400, income * 0.2)) -
      (maxProx >= 0.85 ? 0.2 : 0),
  );

  const preferredRepayTargets = openDebts
    .slice()
    .sort((a, b) => slotDistance(now, a.replyWindowEnd) - slotDistance(now, b.replyWindowEnd))
    .map((g) => g.from);

  const preferredGiftTargets = [
    ...owedToUs.map((g) => g.to),
    ...graph
      .neighbors(agentId)
      .filter((e) => e.intimacy >= 40 || e.giftDebt > 0)
      .sort((a, b) => b.intimacy - a.intimacy)
      .map((e) => e.to),
  ].filter((id, i, arr) => id !== agentId && arr.indexOf(id) === i);

  return {
    agentId,
    repayUrgency,
    giftWillingness,
    preferredRepayTargets,
    preferredGiftTargets,
    openDebtTotal,
    owedToUsTotal,
    formula:
      "repayUrgency=max(amount,windowProx); giftWillingness↓ when 欠情临窗",
  };
}

export class GiftStrategyLLM {
  private readonly decisions = new AgentDecisionEngine();

  constructor(
    private readonly llm: LlmClient,
    private readonly defaults: Record<string, number> = DEFAULT_MIN_GIFT_NORMS,
  ) {}

  /**
   * Propose a gift. Mock/heuristic always available; live LLM may refine target/value.
   * Never writes world state — caller must RuleEngine.commit.
   */
  async propose(
    world: WorldState,
    fromAgentId: string,
    time: SimTime,
    opts: {
      occasion?: string;
      minGiftNorm?: number;
      preferredTarget?: string;
      forceHeuristic?: boolean;
    } = {},
  ): Promise<GiftStrategyProposal | null> {
    const agent = world.agents[fromAgentId];
    if (!agent) return null;

    const bias = computeDebtActionBias(world, fromAgentId, time);
    // Alignment: near-window 欠情 → skip voluntary (non-occasion) gifts.
    if (
      (bias.giftWillingness < 0.2 || shouldPreferRepay(world, fromAgentId, time)) &&
      !opts.preferredTarget &&
      !opts.occasion
    ) {
      return null;
    }

    const heuristic = this.heuristicPropose(world, fromAgentId, bias, opts);
    if (!heuristic) return null;
    if (opts.forceHeuristic || this.llm.mode === "mock") return heuristic;

    try {
      const refined = await this.llmRefine(world, fromAgentId, time, heuristic, opts);
      return refined ?? heuristic;
    } catch {
      return heuristic;
    }
  }

  /** Clip to cash/income bounds and occasion floor; mark reject if impossible. */
  clipProposal(
    world: WorldState,
    fromAgentId: string,
    proposal: GiftStrategyProposal,
  ): ClippedGiftProposal {
    const agent = world.agents[fromAgentId];
    if (!agent) {
      return {
        ...proposal,
        clipped: false,
        rejected: true,
        rejectReason: `unknown agent ${fromAgentId}`,
      };
    }
    if (!world.agents[proposal.targetAgentId]) {
      return {
        ...proposal,
        clipped: false,
        rejected: true,
        rejectReason: `unknown target ${proposal.targetAgentId}`,
      };
    }

    const cash = agent.economy.cash;
    const income = agent.economy.income;
    const minBound = Math.max(1, Math.round(income * 0.01));
    const maxBound = Math.max(minBound, Math.floor(cash * 0.5));
    const occasionFloor =
      resolveMinGiftNorm(proposal.occasion, undefined, this.defaults) ?? 0;

    let value = Math.round(proposal.value);
    let clipped = false;
    const notes: string[] = [];

    if (value < minBound) {
      value = minBound;
      clipped = true;
      notes.push(`raise to income*0.01=${minBound}`);
    }
    if (occasionFloor > 0 && value < occasionFloor && cash >= occasionFloor) {
      value = occasionFloor;
      clipped = true;
      notes.push(`raise to minGiftNorm=${occasionFloor}`);
    }
    if (value > maxBound) {
      value = maxBound;
      clipped = true;
      notes.push(`cap at cash*0.5=${maxBound}`);
    }
    if (value > cash) {
      return {
        ...proposal,
        value,
        clipped: true,
        clipReason: notes.join("; "),
        rejected: true,
        rejectReason: `insufficient cash ${cash} < ${value}`,
      };
    }
    if (!(value > 0)) {
      return {
        ...proposal,
        value,
        clipped,
        rejected: true,
        rejectReason: "value must be > 0",
      };
    }

    const expressiveScore = Math.max(0, Math.min(1, proposal.expressiveScore));
    return {
      ...proposal,
      value,
      expressiveScore,
      clipped,
      clipReason: clipped ? notes.join("; ") : undefined,
      rejected: false,
    };
  }

  private heuristicPropose(
    world: WorldState,
    fromAgentId: string,
    bias: DebtActionBias,
    opts: {
      occasion?: string;
      minGiftNorm?: number;
      preferredTarget?: string;
    },
  ): GiftStrategyProposal | null {
    const agent = world.agents[fromAgentId]!;
    const target =
      opts.preferredTarget ??
      bias.preferredGiftTargets[0] ??
      new RelationshipGraph(world.relationships).neighbors(fromAgentId).sort(
        (a, b) => b.affection - a.affection,
      )[0]?.to;
    if (!target) return null;

    const norm =
      resolveMinGiftNorm(opts.occasion, opts.minGiftNorm, this.defaults) ??
      Math.round(agent.economy.income * 0.04);
    const willingness = bias.giftWillingness;
    const raw = Math.round(norm * (0.85 + 0.4 * willingness));
    const expressiveScore = opts.occasion ? 0.7 : 0.35;

    return {
      targetAgentId: target,
      value: raw,
      expressiveScore,
      occasion: opts.occasion,
      description: opts.occasion
        ? `${opts.occasion}随礼（策略提案）`
        : "人情往来（策略提案）",
      reason: `R6 heuristic willingness=${willingness.toFixed(2)} norm≈${norm}`,
      source: "heuristic",
    };
  }

  private async llmRefine(
    world: WorldState,
    fromAgentId: string,
    time: SimTime,
    base: GiftStrategyProposal,
    opts: { occasion?: string; minGiftNorm?: number },
  ): Promise<GiftStrategyProposal | null> {
    const self = world.agents[fromAgentId]!;
    const bias = computeDebtActionBias(world, fromAgentId, time);
    const brief = this.decisions.buildBrief(world, fromAgentId, {
      occasion: opts.occasion,
      preferredTarget: base.targetAgentId,
      action: "give_gift",
    });
    const decisionText = brief ? this.decisions.toPromptText(brief) : "";
    const prompt = [
      "你是礼物策略助手。只输出 JSON：",
      '{"targetAgentId":"...","value":number,"expressiveScore":0-1,"description":"...","reason":"..."}',
      `from=${fromAgentId} name=${self.public.name} cash=${round2(self.economy.cash)} income=${round2(self.economy.income)}`,
      `time=D${time.day}-${time.slot} occasion=${opts.occasion ?? "none"} minGiftNorm=${opts.minGiftNorm ?? "n/a"}`,
      `candidates=${bias.preferredGiftTargets.slice(0, 5).join(",") || base.targetAgentId}`,
      decisionText,
      `baseline=${JSON.stringify(base)}`,
      "综合礼单、关系网络、个人属性决策；不要超过 cash 的一半；仪式场合尽量不低于 minGiftNorm。",
    ].join("\n");

    const raw = await this.llm.complete([
      { role: "system", content: "输出严格 JSON，不要 Markdown。" },
      { role: "user", content: prompt },
    ]);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as Partial<GiftStrategyProposal>;
    if (!parsed.targetAgentId || !(Number(parsed.value) > 0)) return null;
    return {
      targetAgentId: String(parsed.targetAgentId),
      value: Number(parsed.value),
      expressiveScore: Number(parsed.expressiveScore ?? base.expressiveScore),
      occasion: opts.occasion ?? base.occasion,
      description: String(parsed.description ?? base.description),
      reason: String(parsed.reason ?? "llm proposal"),
      source: "llm",
    };
  }
}
