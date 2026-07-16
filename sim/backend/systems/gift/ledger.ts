import type { GiftRecord, SimTime } from "../../../shared/types/index.js";
import { SLOT_ORDER, nextSimTime } from "../../../shared/types/index.js";

/** Ledger + reply-window state machine: pending_reply → replied | defaulted. */
export class GiftLedgerManager {
  constructor(private ledger: GiftRecord[] = []) {}

  all(): GiftRecord[] {
    return this.ledger;
  }

  setLedger(ledger: GiftRecord[]): void {
    this.ledger = ledger;
  }

  add(record: GiftRecord): void {
    this.ledger.push(record);
  }

  get(gid: string): GiftRecord | undefined {
    return this.ledger.find((g) => g.gid === gid);
  }

  /** Open debts where `agentId` is the receiver who owes a reply (replyRequired≠false). */
  getOpenDebts(agentId: string): GiftRecord[] {
    return this.ledger.filter(
      (g) =>
        g.to === agentId &&
        g.status === "pending_reply" &&
        g.replyRequired !== false,
    );
  }

  /** R7: all gifts between A and B (either direction), newest last. */
  queryBetween(a: string, b: string): GiftRecord[] {
    return this.ledger.filter(
      (g) => (g.from === a && g.to === b) || (g.from === b && g.to === a),
    );
  }

  /** Gifts for a ritual occasion (optional host filter). */
  queryByOccasion(occasion: string, hostId?: string): GiftRecord[] {
    return this.ledger.filter(
      (g) => g.occasion === occasion && (!hostId || g.to === hostId),
    );
  }

  markReplied(originalGid: string, replyGid: string): GiftRecord | undefined {
    const g = this.get(originalGid);
    if (!g || g.status !== "pending_reply") return undefined;
    g.status = "replied";
    g.replyGid = replyGid;
    return g;
  }

  /** Mark gifts past replyWindowEnd as defaulted. Returns newly defaulted records.
   * W1/W6: skip when replyRequired === false (vertical / non-reciprocal gifts).
   */
  checkWindows(now: SimTime): GiftRecord[] {
    const newly: GiftRecord[] = [];
    for (const g of this.ledger) {
      if (g.status !== "pending_reply") continue;
      if (g.replyRequired === false) continue;
      if (isAfter(now, g.replyWindowEnd)) {
        g.status = "defaulted";
        newly.push(g);
      }
    }
    return newly;
  }
}

export function isAfter(a: SimTime, b: SimTime): boolean {
  if (a.day !== b.day) return a.day > b.day;
  return SLOT_ORDER.indexOf(a.slot) > SLOT_ORDER.indexOf(b.slot);
}

export function isBeforeOrEqual(a: SimTime, b: SimTime): boolean {
  return !isAfter(a, b);
}

export function advanceSimTime(t: SimTime, slots: number): SimTime {
  let cur = { ...t };
  for (let i = 0; i < slots; i++) cur = nextSimTime(cur);
  return cur;
}

export function makeGiftId(seqHint: string): string {
  return `g_${seqHint}`;
}
