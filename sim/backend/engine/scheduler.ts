import type { SimTime, TimeSlot } from "../../shared/types/index.js";
import { SLOT_ORDER, nextSimTime } from "../../shared/types/index.js";
import type { LogWriter } from "../log/log_writer.js";
import type { SnapshotStore } from "../store/snapshot_store.js";
import type { WorldState } from "../store/world_state.js";
import type { RuleEngine } from "../rules/rule_engine.js";

type MaybePromise<T> = T | Promise<T>;

export interface SlotHandlers {
  /** Optional hooks; may be async (P5 dialogue in main clock). */
  onMonthStart?: (world: WorldState, time: SimTime) => MaybePromise<void>;
  onGenerateEvents?: (world: WorldState, time: SimTime) => MaybePromise<void>;
  onProcessEvents?: (world: WorldState, time: SimTime) => MaybePromise<void>;
  onGiftWindowCheck?: (world: WorldState, time: SimTime) => MaybePromise<void>;
}

/** How many day×slot steps from start inclusive to reach `count` slots. */
export function endDayForSlotCount(start: SimTime, slotCount: number): number {
  if (slotCount < 1) throw new Error("slotCount must be >= 1");
  let t = { ...start };
  for (let i = 1; i < slotCount; i++) t = nextSimTime(t);
  return t.day;
}

export function countSlotsInclusive(start: SimTime, endDay: number): number {
  let t = { ...start };
  let n = 0;
  while (t.day < endDay || (t.day === endDay && SLOT_ORDER.indexOf(t.slot) <= SLOT_ORDER.indexOf("EVE"))) {
    n++;
    if (t.day === endDay && t.slot === "EVE") break;
    t = nextSimTime(t);
    if (t.day > endDay) break;
  }
  return n;
}

export class TimeScheduler {
  constructor(
    private readonly world: WorldState,
    private readonly log: LogWriter,
    private readonly snapshots: SnapshotStore,
    private readonly rules: RuleEngine,
    private readonly handlers: SlotHandlers = {},
  ) {}

  /** Run inclusive day range: startDay .. endDay, all three slots. */
  async run(start: SimTime, endDay: number): Promise<void> {
    let time: SimTime = { ...start };

    while (time.day <= endDay) {
      await this.step(time);
      if (time.day === endDay && time.slot === "EVE") break;
      const next = nextSimTime(time);
      if (next.day > endDay) break;
      time = next;
    }
  }

  /** Run exactly `slotCount` time slots starting at `start` (D1 default: 30). */
  async runSlots(start: SimTime, slotCount: number): Promise<SimTime> {
    let time: SimTime = { ...start };
    let last = time;
    for (let i = 0; i < slotCount; i++) {
      await this.step(time);
      last = time;
      if (i < slotCount - 1) time = nextSimTime(time);
    }
    return last;
  }

  async step(time: SimTime): Promise<void> {
    this.log.append(time, "timeslot.start", { day: time.day, slot: time.slot });

    // Month-start hook only; do not auto-commit unimplemented economy_monthly on every day-1.
    if (time.slot === "AM" && time.day > 1 && (time.day - 1) % 30 === 0) {
      await this.handlers.onMonthStart?.(this.world, time);
    }

    await this.handlers.onGenerateEvents?.(this.world, time);
    await this.handlers.onProcessEvents?.(this.world, time);
    await this.handlers.onGiftWindowCheck?.(this.world, time);

    const snap = this.world.snapshot(time, this.log.nextSeq());
    this.snapshots.write(snap);
    this.log.append(time, "timeslot.end", { snapshotId: snap.snapshotId }, { snapshotId: snap.snapshotId });
  }
}

export function slotIndex(slot: TimeSlot): number {
  return SLOT_ORDER.indexOf(slot);
}
