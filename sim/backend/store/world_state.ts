import type {
  AgentState,
  CognitiveNode,
  ExperimentConfig,
  RelationshipEdge,
  GiftRecord,
  PublicMemory,
  EventInstance,
  PersonalEventRecord,
  ConversationRecord,
  SlotMetrics,
  SimTime,
  WorldSnapshot,
} from "../../shared/types/index.js";

/** Env workspace = single source of truth for world state. */
export class WorldState {
  agents: Record<string, AgentState> = {};
  relationships: RelationshipEdge[] = [];
  giftLedger: GiftRecord[] = [];
  /** R7 public ritual / gift memories. */
  publicMemories: PublicMemory[] = [];
  eventQueue: EventInstance[] = [];
  personalEventTables: Record<string, PersonalEventRecord[]> = {};
  conversations: ConversationRecord[] = [];
  /** Per-agent cognitive trees (subjective memory; not truth of world edges). */
  cognitiveTrees: Record<string, CognitiveNode[]> = {};
  metrics: SlotMetrics = {
    giftGiven: 0,
    giftReplied: 0,
    giftDefaulted: 0,
    eventsCreated: 0,
    eventsCompleted: 0,
    eventsRejected: 0,
    dialoguesCompleted: 0,
    dialogueMessages: 0,
    cognitivePromotions: 0,
  };

  constructor(public readonly config: ExperimentConfig) {}

  snapshot(simTime: SimTime, seq: number): WorldSnapshot {
    return {
      snapshotId: `snap-${simTime.day}-${simTime.slot}-${seq}`,
      simTime: { ...simTime },
      seq,
      agents: structuredClone(this.agents),
      relationships: structuredClone(this.relationships),
      personalEventTables: structuredClone(this.personalEventTables),
      conversations: structuredClone(this.conversations),
      cognitiveTrees: structuredClone(this.cognitiveTrees),
      giftLedger: structuredClone(this.giftLedger),
      publicMemories: structuredClone(this.publicMemories),
      eventQueue: structuredClone(this.eventQueue),
      metrics: { ...this.metrics },
    };
  }
}
