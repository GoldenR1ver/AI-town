import type { EventInstance, SimTime } from "../../../shared/types/index.js";
import type { LogWriter } from "../../log/log_writer.js";
import type { WorldState } from "../../store/world_state.js";

/**
 * Serial event queue with occupancy conflict:
 * agents in occupancy=required may only join one required event per slot.
 */
export class EventScheduler {
  private queue: EventInstance[] = [];
  private busyRequired = new Set<string>();

  constructor(private readonly log?: LogWriter) {}

  resetSlotBusy(): void {
    this.busyRequired.clear();
  }

  enqueue(world: WorldState, event: EventInstance): { accepted: boolean; reason?: string } {
    const conflict = this.detectConflict(event);
    if (conflict) {
      event.status = "rejected";
      world.metrics.eventsRejected += 1;
      this.log?.append(
        event.time,
        "event.rejected",
        { eid: event.eid, reason: conflict, templateId: event.templateId },
        { affectedEids: [event.eid], affectedAgents: event.requiredAgentIds },
      );
      return { accepted: false, reason: conflict };
    }
    this.queue.push(event);
    world.eventQueue.push(event);
    for (const id of event.requiredAgentIds) this.busyRequired.add(id);
    return { accepted: true };
  }

  detectConflict(event: EventInstance): string | null {
    for (const id of event.requiredAgentIds) {
      if (this.busyRequired.has(id)) {
        return `occupancy conflict: agent ${id} already required in another event this slot`;
      }
    }
    return null;
  }

  /** Priority: higher first; then earlier deadline (min goal deadline). */
  private sortQueue(): void {
    this.queue.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.eid.localeCompare(b.eid);
    });
  }

  drainQueued(): EventInstance[] {
    this.sortQueue();
    const batch = this.queue.filter((e) => e.status === "queued");
    this.queue = this.queue.filter((e) => e.status !== "queued");
    return batch;
  }

  /** Keep completed/rejected history on world.eventQueue; clear processing queue. */
  clearProcessingQueue(): void {
    this.queue = [];
  }
}

export type EventProcessFn = (
  world: WorldState,
  time: SimTime,
  event: EventInstance,
) => void | Promise<void>;

export async function processQueuedEvents(
  scheduler: EventScheduler,
  world: WorldState,
  time: SimTime,
  processOne: EventProcessFn,
): Promise<void> {
  const batch = scheduler.drainQueued();
  for (const ev of batch) {
    ev.status = "processing";
    await processOne(world, time, ev);
    if (ev.status === "processing") {
      ev.status = "completed";
      world.metrics.eventsCompleted += 1;
    }
  }
  scheduler.clearProcessingQueue();
  scheduler.resetSlotBusy();
}
