/**

 * Agent-driven repay events from open gift debts (Intention → Event).

 * Models Yan-style delayed reciprocity: not immediate, not guaranteed.

 *

 * Per-slot attempt probability is modulated by economy / identity / relationship.

 */

import type { EventInstance, GiftRecord, SimTime } from "../../../shared/types/index.js";

import type { WorldState } from "../../store/world_state.js";

import type { LogWriter } from "../../log/log_writer.js";

import { GiftLedgerManager } from "../gift/ledger.js";

import { computeDebtActionBias } from "../gift/strategy.js";

import { slotDistance } from "../gift/flow_effects.js";

import { isHighStatusReceiver } from "../gift/norms.js";

import type { EventGenerator } from "./generator.js";



export interface RepayDriveOptions {

  maxPerSlot: number;

  /** Force attempt when remaining slots ≤ this (W9). */

  urgentSlots: number;

  /**

   * Fraction of total window that must elapse before repay is considered.

   * Yan: reciprocity is cross-event / delayed, not same-day.

   */

  minElapsedFraction: number;

  /**

   * Sticky residual default: once decided, debtor never attempts this gift.

   * Produces ~10–20% defaults among closed reciprocal gifts (Yan mid-state).

   */

  abandonRate: number;

}



const DEFAULT_OPTS: RepayDriveOptions = {

  maxPerSlot: 12,

  urgentSlots: 3,

  minElapsedFraction: 0.35,

  abandonRate: 0.16,

};



function windowLengthSlots(gift: GiftRecord): number {

  return Math.max(1, slotDistance(gift.givenAt, gift.replyWindowEnd));

}



function abandonKey(gid: string): string {

  return `abandon_repay:${gid}`;

}



function relationBoost(

  world: WorldState,

  debtorId: string,

  creditorId: string,

): number {

  const edge = world.relationships.find((e) => e.from === debtorId && e.to === creditorId);

  if (!edge) return 0.85;

  let b = 1;

  // Closer ties → more reliable reciprocity

  if (edge.intimacy >= 60 || edge.affection >= 60) b *= 1.25;

  else if (edge.intimacy < 30) b *= 0.85;

  if (edge.socialBasis === "kin") b *= 1.2;

  else if (edge.socialBasis === "friend") b *= 1.1;

  else if (edge.socialBasis === "neighbor") b *= 1.05;

  if (edge.trust >= 55) b *= 1.1;

  return b;

}



function economyAffordFactor(world: WorldState, debtorId: string, gift: GiftRecord): number {

  const agent = world.agents[debtorId];

  if (!agent) return 0.2;

  const need = Math.max(1, gift.adjustedValue * 0.5);

  const cash = agent.economy.cash;

  const income = Math.max(1, agent.economy.income);

  const liquid = cash + agent.economy.deposit * 0.15;

  if (cash >= gift.adjustedValue) return 1.15;

  if (liquid >= need) return 0.95;

  if (cash >= need) return 0.75;

  if (cash < income * 0.08) return 0.25;

  return 0.45;

}



function identityCapacity(world: WorldState, debtorId: string): {

  statusBoost: number;

  maxRepaysThisSlot: number;

} {

  const agent = world.agents[debtorId];

  if (!agent) return { statusBoost: 1, maxRepaysThisSlot: 1 };

  const high = isHighStatusReceiver({

    prestige: agent.public.prestige,

    face: agent.public.face,

    socialTags: agent.public.socialTags,

    occupation: agent.public.occupation,

  });

  const cash = agent.economy.cash;

  const income = Math.max(1, agent.economy.income);

  // Cadres / hosts: more social capacity; wealthy: can clear several debts/slot

  let maxRepays = 1;

  if (high) maxRepays += 1;

  if (cash >= income * 0.35) maxRepays += 1;

  if (cash >= income * 0.8) maxRepays += 1;

  return {

    statusBoost: high ? 1.2 : 1,

    maxRepaysThisSlot: Math.min(4, maxRepays),

  };

}



/**

 * Sticky decision: with abandonRate, mark this debt as never repaid (moral lapse / hardship).

 * Decision is made once when first considered after the delay floor.

 * High-status debtors abandon less (面子约束); cash-poor abandon more.

 */

function maybeAbandon(

  world: WorldState,

  debtorId: string,

  gift: GiftRecord,

  rng: () => number,

  abandonRate: number,

): boolean {

  const agent = world.agents[debtorId];

  if (!agent) return true;

  const key = abandonKey(gift.gid);

  if (agent.private.beliefs[key] === 1) return true;

  if (agent.private.beliefs[key] === 0) return false;



  const cash = agent.economy.cash;

  const hardship =

    agent.economy.income > 0 && cash < agent.economy.income * 0.08 ? 0.08 : 0;

  const high = isHighStatusReceiver({

    prestige: agent.public.prestige,

    face: agent.public.face,

    socialTags: agent.public.socialTags,

    occupation: agent.public.occupation,

  });

  // Leaders delay more than they abandon — face requires eventual reciprocity among close ties.

  const statusDiscount = high ? 0.55 : 1;

  const conscientiousness = agent.private.bigFive.C ?? 0.5;

  const rate = Math.min(

    0.32,

    (abandonRate + hardship) * statusDiscount * (1.15 - 0.3 * conscientiousness),

  );

  const abandon = rng() < rate;

  agent.private.beliefs[key] = abandon ? 1 : 0;

  if (abandon) {

    agent.private.beliefs[`gift_will_default:${gift.gid}`] = 1;

  }

  return abandon;

}



/**

 * Probability a debtor attempts repay this slot (given not abandoned).

 * Factors: window urgency × debt bias × economy × relationship × identity.

 */

export function repayAttemptProbability(

  world: WorldState,

  debtorId: string,

  gift: GiftRecord,

  now: SimTime,

  opts: RepayDriveOptions,

): number {

  const bias = computeDebtActionBias(world, debtorId, now);

  const afford = economyAffordFactor(world, debtorId, gift);

  const rel = relationBoost(world, debtorId, gift.from);

  const { statusBoost } = identityCapacity(world, debtorId);



  const total = windowLengthSlots(gift);

  const elapsed = slotDistance(gift.givenAt, now);

  const slotsLeft = slotDistance(now, gift.replyWindowEnd);

  const elapsedFrac = elapsed / total;

  // Decision alignment: explicit window-proximity boost (W9).
  const prox =
    slotsLeft <= 0 ? 1 : slotsLeft <= 3 ? 0.9 : slotsLeft <= 6 ? 0.65 : Math.min(0.5, elapsedFrac);



  // Yan delay: almost no early repay

  if (elapsedFrac < opts.minElapsedFraction) {

    return 0.02 * bias.repayUrgency * rel * statusBoost;

  }



  let p: number;

  if (slotsLeft <= 0) {

    p = 0.7 + 0.2 * bias.repayUrgency;

  } else if (slotsLeft <= opts.urgentSlots) {

    p = 0.42 + 0.32 * bias.repayUrgency;

  } else if (elapsedFrac < 0.55) {

    p = 0.1 + 0.24 * bias.repayUrgency;

  } else {

    p = 0.22 + 0.28 * bias.repayUrgency;

  }

  p = Math.max(p, p * (0.85 + 0.15 * prox));



  p *= afford * rel * statusBoost;



  // Many concurrent debts: still try, but each individual debt competes

  const openN = new GiftLedgerManager(world.giftLedger).getOpenDebts(debtorId).length;

  if (openN >= 4) {

    p *= Math.max(0.55, 1 - 0.06 * (openN - 3));

  }



  return Math.max(0, Math.min(0.92, p));

}



/**

 * Materialize repay events for open reciprocal debts (replyRequired≠false).

 */

export function generateRepayFromDebts(args: {

  world: WorldState;

  time: SimTime;

  generator: EventGenerator;

  rng: () => number;

  log?: LogWriter;

  options?: Partial<RepayDriveOptions>;

}): EventInstance[] {

  const opts: RepayDriveOptions = { ...DEFAULT_OPTS, ...args.options };

  const ledger = new GiftLedgerManager(args.world.giftLedger);

  const open = args.world.giftLedger

    .filter((g) => g.status === "pending_reply" && g.replyRequired !== false)

    .slice()

    .sort((a, b) => {

      const da = slotDistance(args.time, a.replyWindowEnd);

      const db = slotDistance(args.time, b.replyWindowEnd);

      if (da !== db) return da - db;

      return b.adjustedValue - a.adjustedValue;

    });



  const out: EventInstance[] = [];

  const repayCountByDebtor = new Map<string, number>();



  for (const gift of open) {

    if (out.length >= opts.maxPerSlot) break;

    const debtorId = gift.to;

    const creditorId = gift.from;

    if (!args.world.agents[debtorId] || !args.world.agents[creditorId]) continue;



    const { maxRepaysThisSlot } = identityCapacity(args.world, debtorId);

    const used = repayCountByDebtor.get(debtorId) ?? 0;

    if (used >= maxRepaysThisSlot) continue;



    const total = windowLengthSlots(gift);

    const elapsed = slotDistance(gift.givenAt, args.time);

    if (elapsed / total < opts.minElapsedFraction) continue;



    if (maybeAbandon(args.world, debtorId, gift, args.rng, opts.abandonRate)) {

      continue;

    }



    const slotsLeft = slotDistance(args.time, gift.replyWindowEnd);

    const p = repayAttemptProbability(args.world, debtorId, gift, args.time, opts);

    if (args.rng() > p) continue;



    const ev = args.generator.generateManual(

      args.world,

      "private.repay_gift",

      args.time,

      args.rng,

      {

        source: "agent_driven",

        sourceAgentId: debtorId,

        roleOverrides: {

          debtor: [debtorId],

          creditor: [creditorId],

        },

        payload: {

          originalGid: gift.gid,

          minAdjustedValue: gift.adjustedValue,

          to: creditorId,

          occasion: gift.occasion ?? "repay",

        },

      },

    );

    if (!ev) continue;



    for (const goal of ev.goals) {

      if (goal.goalType === "reply_gift") {

        goal.params.to = creditorId;

        goal.params.minAdjustedValue = gift.adjustedValue;

        goal.params.originalGid = gift.gid;

        goal.optional = false;

      }

    }



    repayCountByDebtor.set(debtorId, used + 1);

    out.push(ev);

    args.log?.append(

      args.time,

      "bdi.updated",

      {

        agentId: debtorId,

        kind: "repay_drive",

        gid: gift.gid,

        creditorId,

        slotsLeft,

        attemptP: p,

        elapsed,

        windowLen: total,

        openDebts: ledger.getOpenDebts(debtorId).length,

        maxRepaysThisSlot,

      },

      { affectedAgents: [debtorId, creditorId], affectedGids: [gift.gid] },

    );

  }



  return out;

}


