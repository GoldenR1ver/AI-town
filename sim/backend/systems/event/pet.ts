import type {
  EventInstance,
  EventVisibility,
  PersonalEventRecord,
  PetSource,
  SimTime,
} from "../../../shared/types/index.js";
import type { LogWriter } from "../../log/log_writer.js";
import type { WorldState } from "../../store/world_state.js";
import { applyPetBeliefs } from "../../cognition/bdi.js";

/**
 * Personal Event Table — propagate by visibility, then sync Belief.
 */
export class PersonalEventTableManager {
  constructor(private readonly log?: LogWriter) {}

  propagate(world: WorldState, time: SimTime, event: EventInstance): string[] {
    const targets = this.targets(world, event);
    const affected: string[] = [];
    for (const { agentId, source, channel, sourceAgentId, confidence } of targets) {
      const table = world.personalEventTables[agentId] ?? (world.personalEventTables[agentId] = []);
      const existing = table.find((r) => r.eid === event.eid);
      if (existing) {
        existing.confidence = Math.min(1, Math.max(existing.confidence, confidence));
        existing.lastUpdatedAt = { ...time };
        affected.push(agentId);
        continue;
      }
      const row: PersonalEventRecord = {
        id: `pet_${agentId}_${event.eid}`,
        agentId,
        eid: event.eid,
        learnedAt: { ...time },
        source,
        channel,
        sourceAgentId,
        confidence,
        contentSnapshot: event.summary,
        lastUpdatedAt: { ...time },
      };
      table.push(row);
      affected.push(agentId);
    }

    this.log?.append(
      time,
      "event.propagated",
      {
        eid: event.eid,
        visibility: event.visibility,
        agentCount: affected.length,
        agents: affected,
      },
      { affectedEids: [event.eid], affectedAgents: affected },
    );
    return affected;
  }

  /** After PET write, sync B ← PET for affected agents. */
  syncBeliefs(world: WorldState, time: SimTime, agentIds: string[]): void {
    for (const agentId of agentIds) {
      const agent = world.agents[agentId];
      if (!agent) continue;
      const pets = world.personalEventTables[agentId] ?? [];
      const { next, changed } = applyPetBeliefs(agent.private, pets);
      if (!changed.length) continue;
      agent.private = next;
      this.log?.append(
        time,
        "bdi.updated",
        {
          agentId,
          kind: "belief",
          events: changed,
          beliefs: Object.fromEntries(
            changed.map((eid) => [`event:${eid}`, next.beliefs[`event:${eid}`]]),
          ),
        },
        { affectedAgents: [agentId], affectedEids: changed },
      );
    }
  }

  /** Dialogue mention raises listener PET confidence by 0.1, capped at 1. */
  recordDialogueMentions(
    world: WorldState,
    time: SimTime,
    listenerIds: string[],
    eids: string[],
    speakerId: string,
    content: string,
  ): void {
    const affected = new Set<string>();
    for (const listenerId of listenerIds) {
      const table =
        world.personalEventTables[listenerId] ?? (world.personalEventTables[listenerId] = []);
      for (const eid of eids) {
        const existing = table.find((r) => r.eid === eid);
        if (existing) {
          existing.confidence = Math.min(1, existing.confidence + 0.1);
          existing.lastUpdatedAt = { ...time };
          existing.source = "dialogue";
          existing.channel = "conversation";
          existing.sourceAgentId = speakerId;
        } else {
          table.push({
            id: `pet_${listenerId}_${eid}`,
            agentId: listenerId,
            eid,
            learnedAt: { ...time },
            source: "dialogue",
            channel: "conversation",
            sourceAgentId: speakerId,
            confidence: 0.6,
            contentSnapshot: content.slice(0, 200),
            lastUpdatedAt: { ...time },
          });
        }
        affected.add(listenerId);
      }
    }
    this.syncBeliefs(world, time, [...affected]);
  }

  private targets(
    world: WorldState,
    event: EventInstance,
  ): Array<{
    agentId: string;
    source: PetSource;
    channel: string;
    sourceAgentId?: string;
    confidence: number;
  }> {
    const involved = new Set<string>();
    for (const ids of Object.values(event.roleBindings)) {
      for (const id of ids) involved.add(id);
    }
    for (const g of event.goals) involved.add(g.agentId);

    const vis: EventVisibility = event.visibility;
    if (vis === "public") {
      return Object.keys(world.agents).map((agentId) => ({
        agentId,
        source: "public_broadcast" as const,
        channel: "broadcast",
        sourceAgentId: event.sourceAgentId,
        confidence: 1,
      }));
    }

    if (vis === "private") {
      return [...involved].map((agentId) => ({
        agentId,
        source: "direct" as const,
        channel: "involvement",
        sourceAgentId: event.sourceAgentId,
        confidence: 1,
      }));
    }

    // semi: involved + kin of involved + top affection neighbors
    const targets = new Set(involved);
    for (const id of involved) {
      for (const k of world.agents[id]?.public.kinship ?? []) targets.add(k);
      const neigh = world.relationships
        .filter((e) => e.from === id)
        .sort((a, b) => b.affection - a.affection)
        .slice(0, 3);
      for (const e of neigh) targets.add(e.to);
    }
    return [...targets]
      .filter((id) => world.agents[id])
      .map((agentId) => ({
        agentId,
        source: (involved.has(agentId) ? "direct" : "kin_network") as PetSource,
        channel: involved.has(agentId) ? "involvement" : "kin_or_neighbor",
        sourceAgentId: event.sourceAgentId,
        confidence: involved.has(agentId) ? 1 : 0.7,
      }));
  }
}
