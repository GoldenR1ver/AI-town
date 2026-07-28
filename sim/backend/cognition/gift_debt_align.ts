/**
 * Decision-alignment helpers: gift-debt urgency + Chinese "欠情未还" narrative.
 */
import type { AgentState, GiftRecord, SimTime } from "../../shared/types/index.js";
import { slotDistance } from "../systems/gift/flow_effects.js";
import { GiftLedgerManager } from "../systems/gift/ledger.js";
import type { WorldState } from "../store/world_state.js";

export interface OpenGiftDebtView {
  gid: string;
  creditorId: string;
  value: number;
  adjustedValue: number;
  occasion?: string;
  slotsLeft: number;
  urgent: boolean;
  overdue: boolean;
}

export function listOpenGiftDebts(
  world: WorldState,
  agentId: string,
  now: SimTime,
  urgentSlots = 3,
): OpenGiftDebtView[] {
  return new GiftLedgerManager(world.giftLedger)
    .getOpenDebts(agentId)
    .map((g) => {
      const slotsLeft = slotDistance(now, g.replyWindowEnd);
      return {
        gid: g.gid,
        creditorId: g.from,
        value: g.value,
        adjustedValue: g.adjustedValue,
        occasion: g.occasion,
        slotsLeft,
        urgent: slotsLeft <= urgentSlots,
        overdue: slotsLeft <= 0,
      };
    })
    .sort((a, b) => a.slotsLeft - b.slotsLeft);
}

export function hasUrgentGiftDebt(
  world: WorldState,
  agentId: string,
  now: SimTime,
  urgentSlots = 3,
): boolean {
  return listOpenGiftDebts(world, agentId, now, urgentSlots).some(
    (d) => d.urgent || d.overdue,
  );
}

/** Prefer repay over voluntary gift when any debt is near window. */
export function shouldPreferRepay(
  world: WorldState,
  agentId: string,
  now: SimTime,
): boolean {
  const debts = listOpenGiftDebts(world, agentId, now, 5);
  if (!debts.length) return false;
  if (debts.some((d) => d.urgent || d.overdue)) return true;
  const total = debts.reduce((s, d) => s + d.adjustedValue, 0);
  const income = world.agents[agentId]?.economy.income ?? 1;
  return total >= income * 0.12;
}

export function formatGiftDebtNarrative(
  world: WorldState,
  agentId: string,
  now: SimTime,
  nameOf: (id: string) => string = (id) =>
    world.agents[id]?.public.name ?? id,
): string[] {
  const debts = listOpenGiftDebts(world, agentId, now, 5);
  if (!debts.length) return [];
  const lines: string[] = [
    `你当前有 ${debts.length} 笔未还礼债（欠情未还），应优先考虑回礼而非额外请客。`,
  ];
  for (const d of debts.slice(0, 4)) {
    const who = nameOf(d.creditorId);
    const occ = d.occasion ? `（${d.occasion}）` : "";
    if (d.overdue) {
      lines.push(`欠情未还：对${who}${occ}约¥${d.adjustedValue.toFixed(0)}，回礼窗口已过/将到，务必尽快偿还。`);
    } else if (d.urgent) {
      lines.push(
        `欠情未还：对${who}${occ}约¥${d.adjustedValue.toFixed(0)}，窗口仅剩约 ${d.slotsLeft} 个时段，不宜再主动破费。`,
      );
    } else {
      lines.push(
        `欠情未还：对${who}${occ}约¥${d.adjustedValue.toFixed(0)}，剩余约 ${d.slotsLeft} 个时段。`,
      );
    }
  }
  return lines;
}

export function isCeremonyOccasion(occasionOrSubType: string): boolean {
  return /wedding|funeral|丧|婚|嫁|娶|寿|满月/i.test(occasionOrSubType);
}

export function isFestivalOccasion(occasion?: string): boolean {
  if (!occasion) return false;
  return /new_year|festival|birthday|年|节|寿|生日|中秋|春节/i.test(occasion);
}

/** Window-proximity component for repay urgency ∈ [0,1]. */
export function windowProximityUrgency(gift: GiftRecord, now: SimTime): number {
  const total = Math.max(1, slotDistance(gift.givenAt, gift.replyWindowEnd));
  const left = slotDistance(now, gift.replyWindowEnd);
  if (left <= 0) return 1;
  if (left <= 3) return 0.85;
  if (left <= 6) return 0.65;
  const elapsed = slotDistance(gift.givenAt, now) / total;
  return Math.max(0, Math.min(0.55, elapsed));
}

export function agentCashHardship(agent: AgentState): boolean {
  // W10: only truly tight cash (stricter than narrative cash_tight).
  return agent.economy.cash < Math.max(1, agent.economy.income) * 0.08;
}
