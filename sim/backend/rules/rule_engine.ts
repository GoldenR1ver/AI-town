import type { EmotionState, SimTime } from "../../shared/types/index.js";
import type { LogWriter } from "../log/log_writer.js";
import type { WorldState } from "../store/world_state.js";
import { applyGiftDefaultToBdi, syncRepayIntentionsFromLedger } from "../cognition/bdi.js";
import { CognitiveTreeManager } from "../cognition/cognitive_tree.js";
import { EconomyManager } from "../systems/economy/manager.js";
import {
  GiftLedgerManager,
  advanceSimTime,
  makeGiftId,
} from "../systems/gift/ledger.js";
import {
  assessOccasionEtiquette,
  assessRepaySufficiency,
  computeGiftDebt,
  defaultReplyWindowSlots,
} from "../systems/gift/norms.js";
import {
  computeRelationPenalty,
} from "../systems/gift/default_penalty.js";
import { ritualGiftMemory } from "../systems/gift/public_memory.js";
import {
  applyDefaultSocialEffects,
  applyGiveGiftSocialEffects,
  applyRepaySocialEffects,
  defaultPublicMemory,
  slotDistance,
} from "../systems/gift/flow_effects.js";
import {
  RelationshipGraph,
  applyEdgeDelta,
  giftRelationshipDelta,
} from "../systems/relationship/graph.js";

export type RuleProposal =
  | {
      kind: "give_gift";
      from: string;
      to: string;
      value: number;
      expressiveScore: number;
      description?: string;
      eid?: string;
      /** Reply window length in slots (default by gift kind). */
      replyWindowSlots?: number;
      occasion?: string;
      /** R1: occasion minimum gift norm. */
      minGiftNorm?: number;
    }
  | { kind: "repay_gift"; from: string; to: string; value: number; originalGid: string }
  | {
      kind: "relationship_delta";
      from: string;
      to: string;
      trust?: number;
      affection?: number;
      intimacy?: number;
      reason: string;
    }
  | {
      kind: "dialogue_bdie";
      agentId: string;
      beliefDelta: Record<string, number>;
      emotionDelta: Partial<EmotionState>;
      reason: string;
    }
  | { kind: "economy_monthly" }
  | { kind: "gift_window_check" };

export interface RuleResult {
  ok: boolean;
  reason: string;
  formula?: string;
  applied?: unknown;
  before?: unknown;
  after?: unknown;
}

export interface RuleEngineOptions {
  log?: LogWriter;
  /** When false, reciprocity / repay checks are skipped (experiment E2 off). */
  enableReciprocityRules?: boolean;
  /** R1 occasion etiquette (default true). */
  enableOccasionNorms?: boolean;
  /** R3/R4 axis-specific repay tolerances (default follows enableReciprocityRules). */
  enableAxisReciprocity?: boolean;
  horizontalRepayTolerance?: number;
  verticalUpMinRepayRatio?: number;
  verticalDownMinRepayRatio?: number;
}

/**
 * RuleEngine: only place that mutates cash / trust / gift ledger.
 * D2: give_gift / repay_gift / relationship_delta / economy_monthly / gift_window_check.
 */
export class RuleEngine {
  private readonly economy = new EconomyManager();

  constructor(private readonly options: RuleEngineOptions = {}) {}

  setLog(log: LogWriter): void {
    this.options.log = log;
  }

  commit(world: WorldState, time: SimTime, proposal: RuleProposal): RuleResult {
    const validation = this.validate(world, proposal);
    if (!validation.ok) {
      return this.reject(time, proposal, validation.reason, validation.before);
    }

    switch (proposal.kind) {
      case "give_gift":
        return this.applyGiveGift(world, time, proposal);
      case "repay_gift":
        return this.applyRepayGift(world, time, proposal);
      case "relationship_delta":
        return this.applyRelationshipDelta(world, time, proposal);
      case "dialogue_bdie":
        return this.applyDialogueBdie(world, time, proposal);
      case "economy_monthly":
        return this.applyEconomyMonthly(world, time);
      case "gift_window_check":
        return this.applyGiftWindowCheck(world, time);
      default: {
        const _exhaustive: never = proposal;
        return this.reject(time, proposal as RuleProposal, `unknown: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  validate(world: WorldState, proposal: RuleProposal): RuleResult {
    switch (proposal.kind) {
      case "give_gift":
        return this.validateGiveGift(world, proposal);
      case "repay_gift":
        return this.validateRepayGift(world, proposal);
      case "relationship_delta":
        return this.validateRelationshipDelta(world, proposal);
      case "dialogue_bdie":
        return world.agents[proposal.agentId]
          ? { ok: true, reason: "dialogue_bdie invariants ok" }
          : { ok: false, reason: `dialogue_bdie: unknown agent ${proposal.agentId}` };
      case "economy_monthly":
      case "gift_window_check":
        return { ok: true, reason: "ok", before: null };
      default: {
        const _exhaustive: never = proposal;
        return { ok: false, reason: `unknown proposal: ${JSON.stringify(_exhaustive)}` };
      }
    }
  }

  private validateGiveGift(
    world: WorldState,
    p: Extract<RuleProposal, { kind: "give_gift" }>,
  ): RuleResult {
    const before = {
      fromCash: world.agents[p.from]?.economy.cash ?? null,
      toCash: world.agents[p.to]?.economy.cash ?? null,
    };
    if (!world.agents[p.from]) {
      return { ok: false, reason: `give_gift: unknown from agent ${p.from}`, before };
    }
    if (!world.agents[p.to]) {
      return { ok: false, reason: `give_gift: unknown to agent ${p.to}`, before };
    }
    if (p.from === p.to) {
      return { ok: false, reason: "give_gift: from === to", before };
    }
    if (!(p.value > 0) || !Number.isFinite(p.value)) {
      return { ok: false, reason: `give_gift: value must be > 0, got ${p.value}`, before };
    }
    if (p.expressiveScore < 0 || p.expressiveScore > 1) {
      return {
        ok: false,
        reason: `give_gift: expressiveScore in [0,1], got ${p.expressiveScore}`,
        before,
      };
    }
    const cash = world.agents[p.from]!.economy.cash;
    if (p.value > cash) {
      return { ok: false, reason: `give_gift: insufficient cash ${cash} < ${p.value}`, before };
    }
    return { ok: true, reason: "give_gift invariants ok", before };
  }

  private validateRepayGift(
    world: WorldState,
    p: Extract<RuleProposal, { kind: "repay_gift" }>,
  ): RuleResult {
    const before = {
      fromCash: world.agents[p.from]?.economy.cash ?? null,
      openGift: world.giftLedger.find((g) => g.gid === p.originalGid) ?? null,
    };
    if (!world.agents[p.from] || !world.agents[p.to]) {
      return { ok: false, reason: "repay_gift: unknown agent", before };
    }
    if (!(p.value > 0)) {
      return { ok: false, reason: `repay_gift: value must be > 0, got ${p.value}`, before };
    }
    const gift = world.giftLedger.find((g) => g.gid === p.originalGid);
    if (!gift) {
      return { ok: false, reason: `repay_gift: unknown gid ${p.originalGid}`, before };
    }
    if (gift.status !== "pending_reply") {
      return { ok: false, reason: `repay_gift: gift status is ${gift.status}`, before };
    }
    if (gift.to !== p.from || gift.from !== p.to) {
      return {
        ok: false,
        reason: `repay_gift: direction mismatch (debtor=${gift.to}, creditor=${gift.from})`,
        before,
      };
    }
    const cash = world.agents[p.from]!.economy.cash;
    if (p.value > cash) {
      return { ok: false, reason: `repay_gift: insufficient cash ${cash} < ${p.value}`, before };
    }
    return { ok: true, reason: "repay_gift invariants ok", before };
  }

  private validateRelationshipDelta(
    world: WorldState,
    p: Extract<RuleProposal, { kind: "relationship_delta" }>,
  ): RuleResult {
    const edge = world.relationships.find((e) => e.from === p.from && e.to === p.to);
    const before = edge
      ? { trust: edge.trust, affection: edge.affection, intimacy: edge.intimacy }
      : null;
    if (!edge) {
      return { ok: false, reason: `relationship_delta: no edge ${p.from}->${p.to}`, before };
    }
    if (!p.reason?.trim()) {
      return { ok: false, reason: "relationship_delta: reason required", before };
    }
    return { ok: true, reason: "relationship_delta invariants ok", before };
  }

  private applyGiveGift(
    world: WorldState,
    time: SimTime,
    p: Extract<RuleProposal, { kind: "give_gift" }>,
  ): RuleResult {
    const fromAgent = world.agents[p.from]!;
    const toAgent = world.agents[p.to]!;
    const beforeCash = {
      from: fromAgent.economy.cash,
      to: toAgent.economy.cash,
    };
    // Bilateral transfer: giver pays, receiver receives full gift value.
    fromAgent.economy.cash -= p.value;
    toAgent.economy.cash += p.value;

    const expressive = p.expressiveScore;
    const instrumental = 1 - expressive;
    const debtInfo = computeGiftDebt(p.value, expressive, p.occasion);
    const adjustedValue = debtInfo.adjustedValue;
    const windowSlots = defaultReplyWindowSlots(debtInfo.giftKind, p.replyWindowSlots);
    const gid = makeGiftId(`${time.day}${time.slot}_${p.from}_${p.to}_${world.giftLedger.length}`);

    // R1 occasion etiquette
    const enableR1 = this.options.enableOccasionNorms !== false;
    const etiquette = enableR1
      ? assessOccasionEtiquette(p.value, p.occasion, p.minGiftNorm)
      : assessOccasionEtiquette(p.value, undefined, undefined);

    const graph = new RelationshipGraph(world.relationships);
    // Instrumental: lower trust bump than ritual (rule-of-gift-flow §3.2.B9)
    const trustScale = debtInfo.giftKind === "instrumental" ? 0.55 : 1;
    const baseDelta = giftRelationshipDelta(p.value, expressive);
    const delta = {
      trust: baseDelta.trust * trustScale,
      affection: baseDelta.affection,
      intimacy: baseDelta.intimacy,
      formula:
        debtInfo.giftKind === "instrumental"
          ? `${baseDelta.formula}; instrumental trust×0.55`
          : baseDelta.formula,
    };
    const edgeFwd = graph.ensureEdge(p.from, p.to);
    const edgeBack = graph.ensureEdge(p.to, p.from);
    const axis = edgeFwd.relationAxis;

    // W1 / W6 / R28: vertical gifts are not subject to window-default (replyRequired=false).
    // Keep pending_reply so R4 symbolic repay can still clear the debt voluntarily.
    const replyRequired = axis === "horizontal";
    const record = {
      gid,
      eid: p.eid,
      from: p.from,
      to: p.to,
      expressiveScore: expressive,
      instrumentalScore: instrumental,
      value: p.value,
      adjustedValue,
      description: p.description ?? `gift ${p.value}`,
      givenAt: { ...time },
      replyWindowEnd: advanceSimTime(time, windowSlots),
      status: "pending_reply" as const,
      occasion: p.occasion,
      giftKind: debtInfo.giftKind,
      belowNorm: etiquette.belowNorm,
      minGiftNorm: etiquette.minGiftNorm,
      replyRequired,
    };
    world.giftLedger.push(record);
    world.metrics.giftGiven += 1;

    const beforeFwd = {
      trust: edgeFwd.trust,
      affection: edgeFwd.affection,
      intimacy: edgeFwd.intimacy,
      face: fromAgent.public.face ?? 50,
      prestige: toAgent.public.prestige ?? 50,
      reputation: fromAgent.public.reputation ?? 50,
    };
    const beforeBack = {
      trust: edgeBack.trust,
      affection: edgeBack.affection,
      intimacy: edgeBack.intimacy,
      giftDebt: edgeBack.giftDebt,
    };

    let afterFwd = applyEdgeDelta(edgeFwd, delta, time);
    let afterBack = applyEdgeDelta(edgeBack, delta, time);
    afterBack = {
      ...afterBack,
      giftDebt: afterBack.giftDebt + debtInfo.debtAmount,
      reciprocityScore: Math.min(1, afterBack.reciprocityScore + 0.05),
    };

    // R1 edge penalties (trust/affection); face/reputation via flow_effects
    if (etiquette.belowNorm) {
      afterFwd = applyEdgeDelta(
        afterFwd,
        {
          trust: -etiquette.trustPenalty,
          affection: -etiquette.affectionPenalty,
        },
        time,
      );
    }

    graph.upsert(afterFwd);
    graph.upsert(afterBack);
    world.relationships = graph.all();

    // Intention stub: only inject repay I when reply is required (W1)
    if (replyRequired) {
      toAgent.private.intentions[`repay:${gid}`] = {
        slotDue: record.replyWindowEnd,
        actionType: "repay_gift",
        params: { originalGid: gid, to: p.from, minValue: adjustedValue },
        priority: debtInfo.giftKind === "instrumental" ? 88 : 80,
      };
    }
    const synced = syncRepayIntentionsFromLedger(
      toAgent.private,
      p.to,
      world.giftLedger,
      time,
    );
    toAgent.private = synced.next;

    // rule-of-gift-flow.md §3 — face / prestige / reputation
    const social = applyGiveGiftSocialEffects({
      world,
      from: p.from,
      to: p.to,
      value: p.value,
      expressiveScore: expressive,
      giftKind: debtInfo.giftKind,
      occasion: p.occasion,
      eid: p.eid,
      etiquette,
      relationAxis: axis,
      enableOccasionNorms: enableR1,
    });

    // R7: public ritual memory when gift memory enabled + occasion present
    if (world.config.enableGiftMemory && p.occasion) {
      const mem = ritualGiftMemory({
        time,
        from: p.from,
        to: p.to,
        value: p.value,
        occasion: p.occasion,
        gid,
        eid: p.eid,
        belowNorm: etiquette.belowNorm,
        seqHint: `${gid}_${world.publicMemories.length}`,
      });
      world.publicMemories.push(mem);
      this.options.log?.append(
        time,
        "public_memory.created",
        { memory: mem, reason: "R7 ritual gift ledger visibility" },
        { affectedAgents: [p.from, p.to], affectedGids: [gid], affectedEids: p.eid ? [p.eid] : undefined },
      );
    }

    this.options.log?.append(
      time,
      "gift.given",
      {
        gift: record,
        before: {
          fromCash: beforeCash.from,
          toCash: beforeCash.to,
          social: social.before,
        },
        after: {
          fromCash: fromAgent.economy.cash,
          toCash: toAgent.economy.cash,
          social: social.after,
        },
        socialDeltas: social.deltas,
        socialReasons: social.reasons,
        reason: etiquette.belowNorm
          ? "give_gift committed with R1 etiquette breach"
          : "give_gift committed",
        formula: [
          "from.cash-=value; to.cash+=value",
          debtInfo.formula,
          etiquette.formula,
          social.formula,
        ].join("; "),
        etiquette,
        giftKind: debtInfo.giftKind,
        relationAxis: axis,
      },
      { affectedAgents: [p.from, p.to], affectedGids: [gid] },
    );

    this.options.log?.append(
      time,
      "relationship.delta",
      {
        from: p.from,
        to: p.to,
        before: beforeFwd,
        after: {
          trust: afterFwd.trust,
          affection: afterFwd.affection,
          intimacy: afterFwd.intimacy,
          face: fromAgent.public.face,
          prestige: toAgent.public.prestige,
          reputation: fromAgent.public.reputation,
        },
        reason: etiquette.belowNorm ? `gift ${gid} + R1 belowNorm` : `gift ${gid}`,
        formula: etiquette.belowNorm
          ? `${delta.formula}; ${etiquette.formula}; ${social.formula}`
          : `${delta.formula}; ${social.formula}`,
      },
      { affectedAgents: [p.from, p.to], affectedGids: [gid] },
    );
    this.options.log?.append(
      time,
      "relationship.delta",
      {
        from: p.to,
        to: p.from,
        before: beforeBack,
        after: {
          trust: afterBack.trust,
          affection: afterBack.affection,
          intimacy: afterBack.intimacy,
          giftDebt: afterBack.giftDebt,
        },
        reason: `gift debt + relation from ${gid}`,
        formula: `${delta.formula}; ${debtInfo.formula}`,
      },
      { affectedAgents: [p.from, p.to], affectedGids: [gid] },
    );

    return {
      ok: true,
      reason: etiquette.belowNorm ? "give_gift applied (R1 breach)" : "give_gift applied",
      formula: delta.formula,
      before: { cash: beforeCash, ...beforeFwd, social: social.before },
      after: {
        cash: { from: fromAgent.economy.cash, to: toAgent.economy.cash },
        gift: record,
        edgeFwd: afterFwd,
        edgeBack: afterBack,
        social: social.after,
        etiquette,
      },
      applied: {
        gid,
        social: social.after,
        socialDeltas: social.deltas,
        etiquette,
        giftKind: debtInfo.giftKind,
        relationAxis: axis,
      },
    };
  }

  private applyRepayGift(
    world: WorldState,
    time: SimTime,
    p: Extract<RuleProposal, { kind: "repay_gift" }>,
  ): RuleResult {
    const original = world.giftLedger.find((g) => g.gid === p.originalGid)!;
    const debtor = world.agents[p.from]!;
    const creditor = world.agents[p.to]!;
    const beforeCash = {
      from: debtor.economy.cash,
      to: creditor.economy.cash,
    };
    debtor.economy.cash -= p.value;
    creditor.economy.cash += p.value;

    const expressive = 0.5;
    const adjustedValue = p.value * (1 - expressive);
    const replyGid = makeGiftId(`repay_${p.originalGid}_${world.giftLedger.length}`);
    const reply = {
      gid: replyGid,
      from: p.from,
      to: p.to,
      expressiveScore: expressive,
      instrumentalScore: 0.5,
      value: p.value,
      adjustedValue,
      description: `repay ${p.originalGid}`,
      givenAt: { ...time },
      replyWindowEnd: advanceSimTime(time, 9),
      status: "closed" as const,
    };
    world.giftLedger.push(reply);

    const ledger = new GiftLedgerManager(world.giftLedger);
    ledger.markReplied(p.originalGid, replyGid);
    world.metrics.giftReplied += 1;

    const graph = new RelationshipGraph(world.relationships);
    const edge = graph.ensureEdge(p.from, p.to);
    const edgeBack = graph.ensureEdge(p.to, p.from);
    const axis = edge.relationAxis;
    const enableAxis =
      this.options.enableAxisReciprocity ?? this.options.enableReciprocityRules !== false;
    const repayAssess = assessRepaySufficiency(p.value, original, axis, {
      enableAxisReciprocity: enableAxis && this.options.enableReciprocityRules !== false,
      horizontalTolerance: this.options.horizontalRepayTolerance,
      verticalUpMinRatio: this.options.verticalUpMinRepayRatio,
      verticalDownMinRatio: this.options.verticalDownMinRepayRatio,
    });
    const sufficient =
      this.options.enableReciprocityRules === false ? true : repayAssess.sufficient;

    const before = {
      trust: edge.trust,
      affection: edge.affection,
      intimacy: edge.intimacy,
      giftDebt: edge.giftDebt,
    };

    const debtClear = original.giftKind === "instrumental"
      ? Math.max(original.adjustedValue, original.value * 0.55)
      : original.adjustedValue;

    let after = edge;
    let formula: string;
    let underpaySocial: ReturnType<typeof applyDefaultSocialEffects> | undefined;
    if (sufficient) {
      // §3.2.D18: window-timely repay → trust +5 baseline (Coleman / Yan)
      // R4: window-full repay → reciprocityScore +10 on 0–100 ≈ +0.10
      const delta = giftRelationshipDelta(p.value, expressive);
      after = applyEdgeDelta(
        edge,
        {
          trust: Math.max(delta.trust, 5),
          affection: delta.affection,
          intimacy: delta.intimacy,
        },
        time,
      );
      after = {
        ...after,
        giftDebt: Math.max(0, after.giftDebt - debtClear),
        reciprocityScore: Math.min(1, after.reciprocityScore + 0.1),
      };
      formula = `${delta.formula}; trust+=max(δ,5); giftDebt-=${debtClear}; recip+0.1; ${repayAssess.formula}`;
    } else {
      // rule-of-return-gift: underpay severity + relation penalties (R1/R26)
      underpaySocial = applyDefaultSocialEffects({
        world,
        gift: original,
        kind: "underpay",
        replyValue: p.value,
        requiredReplyValue: repayAssess.requiredMin,
      });
      const relPen = computeRelationPenalty(underpaySocial.severity, {
        kind: "underpay",
        gift: original,
        edge,
        axis,
      });
      after = applyEdgeDelta(
        edge,
        { trust: relPen.trust, affection: relPen.affection, intimacy: relPen.intimacy },
        time,
      );
      // §3.2.D21 / R5: partial repay reduces debt; remainder stays
      const paidToward = Math.min(after.giftDebt, Math.max(0, p.value));
      after = {
        ...after,
        giftDebt: Math.max(0, after.giftDebt - paidToward),
        reciprocityScore: Math.max(0, after.reciprocityScore + relPen.reciprocityScore),
        authority:
          typeof relPen.authority === "number"
            ? Math.max(0, Math.min(100, after.authority + relPen.authority))
            : after.authority,
      };
      // R9: reverse edge trust hit (creditor anger)
      graph.upsert(applyEdgeDelta(edgeBack, { trust: relPen.reverseTrust }, time));
      formula =
        `underpay ${underpaySocial.severity.formula}; ${relPen.formula}; ` +
        `giftDebt-=${paidToward} (residual kept); ${repayAssess.formula}`;
    }
    graph.upsert(after);
    if (sufficient) {
      graph.upsert({
        ...edgeBack,
        reciprocityScore: Math.min(1, edgeBack.reciprocityScore + 0.1),
        lastChangedAt: { ...time },
      });
    } else {
      const eb = graph.getEdge(p.to, p.from) ?? edgeBack;
      graph.upsert({
        ...eb,
        reciprocityScore: Math.max(0, eb.reciprocityScore - 0.1),
        lastChangedAt: { ...time },
      });
    }
    world.relationships = graph.all();

    delete debtor.private.intentions[`repay:${p.originalGid}`];

    const delaySlots = slotDistance(original.givenAt, time);
    // Sufficient repay: light positive social. Underpay social already applied via severity path.
    const social = sufficient
      ? applyRepaySocialEffects({
          world,
          debtorId: p.from,
          creditorId: p.to,
          repayValue: p.value,
          original,
          sufficient,
          axis,
          delaySlots,
        })
      : underpaySocial!;

    this.options.log?.append(
      time,
      "gift.replied",
      {
        originalGid: p.originalGid,
        reply,
        sufficient,
        axis,
        repayAssess,
        delaySlots,
        social: { before: social.before, after: social.after, deltas: social.deltas },
        before: { fromCash: beforeCash.from, toCash: beforeCash.to },
        after: { fromCash: debtor.economy.cash, toCash: creditor.economy.cash },
        reason: sufficient
          ? `repay within ${axis} norm`
          : `repay under ${axis} threshold (need≥${repayAssess.requiredMin})`,
        formula: `${formula}; from.cash-=value; to.cash+=value; ${social.formula}`,
      },
      { affectedAgents: [p.from, p.to], affectedGids: [p.originalGid, replyGid] },
    );
    this.options.log?.append(
      time,
      "relationship.delta",
      {
        from: p.from,
        to: p.to,
        before,
        after: {
          trust: after.trust,
          affection: after.affection,
          intimacy: after.intimacy,
          giftDebt: after.giftDebt,
        },
        reason: `repay ${p.originalGid}`,
        formula,
      },
      { affectedAgents: [p.from, p.to], affectedGids: [p.originalGid] },
    );

    return {
      ok: true,
      reason: "repay_gift applied",
      formula,
      before: { cash: beforeCash, ...before, social: social.before },
      after: {
        cash: { from: debtor.economy.cash, to: creditor.economy.cash },
        edge: after,
        replyGid,
        social: social.after,
      },
      applied: { replyGid, sufficient, axis, repayAssess, social: social.deltas },
    };
  }

  private applyRelationshipDelta(
    world: WorldState,
    time: SimTime,
    p: Extract<RuleProposal, { kind: "relationship_delta" }>,
  ): RuleResult {
    const graph = new RelationshipGraph(world.relationships);
    const edge = graph.getEdge(p.from, p.to)!;
    const before = { trust: edge.trust, affection: edge.affection, intimacy: edge.intimacy };
    const after = applyEdgeDelta(
      edge,
      { trust: p.trust, affection: p.affection, intimacy: p.intimacy },
      time,
    );
    graph.upsert(after);
    world.relationships = graph.all();

    this.options.log?.append(
      time,
      "relationship.delta",
      {
        from: p.from,
        to: p.to,
        before,
        after: { trust: after.trust, affection: after.affection, intimacy: after.intimacy },
        reason: p.reason,
        formula: "manual delta clamp[0,100]",
      },
      { affectedAgents: [p.from, p.to] },
    );

    return {
      ok: true,
      reason: "relationship_delta applied",
      before,
      after: { trust: after.trust, affection: after.affection, intimacy: after.intimacy },
    };
  }

  private applyDialogueBdie(
    world: WorldState,
    time: SimTime,
    p: Extract<RuleProposal, { kind: "dialogue_bdie" }>,
  ): RuleResult {
    const agent = world.agents[p.agentId]!;
    const before = {
      beliefs: { ...agent.private.beliefs },
      emotion: { ...agent.private.emotion },
    };
    for (const [key, rawDelta] of Object.entries(p.beliefDelta)) {
      const delta = Math.max(-0.2, Math.min(0.2, rawDelta));
      agent.private.beliefs[key] = Math.max(
        0,
        Math.min(1, (agent.private.beliefs[key] ?? 0) + delta),
      );
    }
    for (const key of ["mood", "arousal", "stress", "energy"] as const) {
      const raw = p.emotionDelta[key];
      if (typeof raw !== "number") continue;
      const delta = Math.max(-0.1, Math.min(0.1, raw));
      agent.private.emotion[key] = Math.max(0, Math.min(1, agent.private.emotion[key] + delta));
    }
    const after = {
      beliefs: { ...agent.private.beliefs },
      emotion: { ...agent.private.emotion },
    };
    this.options.log?.append(
      time,
      "bdi.updated",
      {
        agentId: p.agentId,
        kind: "dialogue_bdie",
        before,
        after,
        reason: p.reason,
        formula: "beliefΔ clamp[-0.2,0.2]; emotionΔ clamp[-0.1,0.1]; state clamp[0,1]",
      },
      { affectedAgents: [p.agentId] },
    );
    return {
      ok: true,
      reason: "dialogue_bdie applied",
      formula: "clamped dialogue BDIE",
      before,
      after,
    };
  }

  private applyEconomyMonthly(world: WorldState, time: SimTime): RuleResult {
    const before: Record<string, { cash: number; deposit: number; debt: number }> = {};
    const after: Record<string, { cash: number; deposit: number; debt: number }> = {};
    for (const [id, agent] of Object.entries(world.agents)) {
      before[id] = {
        cash: agent.economy.cash,
        deposit: agent.economy.deposit,
        debt: agent.economy.debt,
      };
      agent.economy = this.economy.monthlySettle(agent.economy, time.day);
      after[id] = {
        cash: agent.economy.cash,
        deposit: agent.economy.deposit,
        debt: agent.economy.debt,
      };
    }
    this.options.log?.append(time, "economy.monthly", {
      before,
      after,
      reason: "month start settlement",
      formula: "cash+=income*(1-essential); repay debt; deposit+=cash*savings",
    });
    return { ok: true, reason: "economy_monthly applied", before, after };
  }

  private applyGiftWindowCheck(world: WorldState, time: SimTime): RuleResult {
    const ledger = new GiftLedgerManager(world.giftLedger);
    const newly = ledger.checkWindows(time);
    const graph = new RelationshipGraph(world.relationships);
    const cognition = new CognitiveTreeManager(world.cognitiveTrees, this.options.log);

    for (const g of newly) {
      world.metrics.giftDefaulted += 1;
      const debtorId = g.to; // failed to repay
      const creditorId = g.from;

      const edge = graph.ensureEdge(debtorId, creditorId);
      const edgeBack = graph.ensureEdge(creditorId, debtorId);

      // R28 / W6: vertical_up gifts should not reach pending_reply; skip relation trust if so
      const axis = edge.relationAxis;

      // 1) Severity + relationship penalties (rule-of-return-gift)
      const social = applyDefaultSocialEffects({
        world,
        gift: g,
        kind: "timeout",
      });
      const relPen = computeRelationPenalty(social.severity, {
        kind: "timeout",
        gift: g,
        edge,
        axis,
      });

      const before = {
        trust: edge.trust,
        affection: edge.affection,
        intimacy: edge.intimacy,
        reciprocityScore: edge.reciprocityScore,
      };

      let after = applyEdgeDelta(
        edge,
        { trust: relPen.trust, affection: relPen.affection, intimacy: relPen.intimacy },
        time,
      );
      after = {
        ...after,
        // R5: giftDebt kept in full on timeout; symbolicValue ×1.1 via mild bump
        giftDebt: after.giftDebt * 1.1,
        reciprocityScore: Math.max(0, after.reciprocityScore + relPen.reciprocityScore),
        authority:
          typeof relPen.authority === "number"
            ? Math.max(0, Math.min(100, after.authority + relPen.authority))
            : after.authority,
        interactionSummary: `回礼违约 ${g.gid}（窗口已过，severity=${social.severity.severity.toFixed(2)}）`,
      };
      graph.upsert(after);

      // R9: reverse edge asymmetric trust
      const afterBack = applyEdgeDelta(edgeBack, { trust: relPen.reverseTrust }, time);
      graph.upsert({
        ...afterBack,
        reciprocityScore: Math.max(0, afterBack.reciprocityScore - 0.1 * social.severity.severity),
        interactionSummary: `${debtorId} 对我逾期未回礼 ${g.gid}`,
        lastChangedAt: { ...time },
      });

      // 2) BDIE — both parties, scaled by severity
      const debtor = world.agents[debtorId];
      const creditor = world.agents[creditorId];
      let debtorBdiFormula = "";
      let creditorBdiFormula = "";
      if (debtor) {
        const bdi = applyGiftDefaultToBdi(
          debtor.private,
          "debtor",
          g,
          creditorId,
          social.severity.severity,
        );
        const synced = syncRepayIntentionsFromLedger(
          bdi.next,
          debtorId,
          world.giftLedger,
          time,
        );
        debtor.private = synced.next;
        debtorBdiFormula = bdi.formula;
        this.options.log?.append(
          time,
          "bdi.updated",
          {
            agentId: debtorId,
            kind: "gift_defaulted",
            role: "debtor",
            gid: g.gid,
            severity: social.severity.severity,
            before: bdi.before,
            after: {
              beliefs: debtor.private.beliefs,
              desires: debtor.private.desires,
              intentions: debtor.private.intentions,
              emotion: debtor.private.emotion,
            },
            reason: `reply window exceeded for ${g.gid}`,
            formula: bdi.formula,
          },
          { affectedAgents: [debtorId, creditorId], affectedGids: [g.gid] },
        );
      }
      if (creditor) {
        const bdi = applyGiftDefaultToBdi(
          creditor.private,
          "creditor",
          g,
          debtorId,
          social.severity.severity,
        );
        creditor.private = bdi.next;
        creditorBdiFormula = bdi.formula;
        this.options.log?.append(
          time,
          "bdi.updated",
          {
            agentId: creditorId,
            kind: "gift_defaulted",
            role: "creditor",
            gid: g.gid,
            severity: social.severity.severity,
            before: bdi.before,
            after: bdi.after,
            reason: `${debtorId} defaulted on ${g.gid}`,
            formula: bdi.formula,
          },
          { affectedAgents: [debtorId, creditorId], affectedGids: [g.gid] },
        );
      }

      // 3) Cognitive tree — S1 lapse skips private archive weight; still light archive
      const influenceBase = social.severity.tier === "lapse" ? 4 : social.severity.tier === "moderate" ? 10 : 14;
      const debtorCog = cognition.archiveGiftDefault({
        agentId: debtorId,
        scope: creditorId,
        gid: g.gid,
        summary: `我对 ${creditorId} 逾期未回礼（${g.gid}，¥${g.value}，severity=${social.severity.severity.toFixed(2)}）`,
        time,
        influenceScore: influenceBase,
      });
      const creditorCog = cognition.archiveGiftDefault({
        agentId: creditorId,
        scope: debtorId,
        gid: g.gid,
        summary: `${debtorId} 对我逾期未回礼（${g.gid}，¥${g.value}），不再轻易信任`,
        time,
        influenceScore: influenceBase + 2,
      });
      if (debtorCog.promoted || creditorCog.promoted) {
        world.metrics.cognitivePromotions +=
          (debtorCog.promoted ? 1 : 0) + (creditorCog.promoted ? 1 : 0);
      }

      // 4) Public memory — S3 only (severity ≥ 0.6)
      if (
        world.config.enableGiftMemory &&
        social.socialPenalty.writePublicMemory
      ) {
        const mem = defaultPublicMemory({
          time,
          gift: g,
          seqHint: `${g.gid}_${world.publicMemories.length}`,
          salience: social.socialPenalty.memorySalience,
        });
        world.publicMemories.push(mem);
        this.options.log?.append(
          time,
          "public_memory.created",
          {
            memory: mem,
            reason: `S3 severe default (severity=${social.severity.severity.toFixed(2)})`,
          },
          { affectedAgents: [g.from, g.to], affectedGids: [g.gid] },
        );
      }

      const formula = [
        social.severity.formula,
        relPen.formula,
        social.formula,
        debtorBdiFormula,
        creditorBdiFormula,
        "cognitive.archiveGiftDefault both sides",
      ]
        .filter(Boolean)
        .join("; ");

      this.options.log?.append(
        time,
        "gift.defaulted",
        {
          gift: g,
          severity: social.severity,
          before: { ...before, social: social.before },
          after: {
            trust: after.trust,
            affection: after.affection,
            intimacy: after.intimacy,
            reciprocityScore: after.reciprocityScore,
            social: social.after,
            debtorBeliefs: debtor?.private.beliefs,
            creditorBeliefs: creditor?.private.beliefs,
            cognitive: {
              debtorPromoted: debtorCog.promoted,
              creditorPromoted: creditorCog.promoted,
            },
          },
          socialDeltas: social.deltas,
          reason: `reply window exceeded (severity=${social.severity.tier})`,
          formula,
        },
        { affectedAgents: [g.from, g.to], affectedGids: [g.gid] },
      );
      this.options.log?.append(
        time,
        "relationship.delta",
        {
          from: debtorId,
          to: creditorId,
          before,
          after: {
            trust: after.trust,
            affection: after.affection,
            intimacy: after.intimacy,
            reciprocityScore: after.reciprocityScore,
            face: world.agents[debtorId]?.public.face,
            prestige: world.agents[debtorId]?.public.prestige,
            reputation: world.agents[debtorId]?.public.reputation,
          },
          reason: `defaulted ${g.gid}`,
          formula,
        },
        { affectedAgents: [g.from, g.to], affectedGids: [g.gid] },
      );
    }
    world.relationships = graph.all();
    world.cognitiveTrees = cognition.all();
    return {
      ok: true,
      reason: `gift_window_check: ${newly.length} defaulted`,
      applied: { gids: newly.map((g) => g.gid) },
    };
  }

  private reject(
    time: SimTime,
    proposal: RuleProposal,
    reason: string,
    before?: unknown,
  ): RuleResult {
    const result: RuleResult = {
      ok: false,
      reason,
      before,
      after: before,
    };
    this.options.log?.append(time, "rule.rejected", {
      proposal,
      before,
      after: before,
      reason,
    });
    return result;
  }
}

