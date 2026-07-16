import type {
  AgentState,
  ConversationRecord,
  GiftRecord,
  LogEntry,
  RelationshipEdge,
  SimTime,
  SlotMetrics,
} from "../types/index.js";

export type ReplayStepKind =
  | "intro"
  | "time"
  | "event"
  | "dialogue_start"
  | "dialogue_message"
  | "dialogue_result"
  | "intent"
  | "gift"
  | "event_result"
  | "checkpoint"
  | "system";

export interface ReplayCognitiveSummary {
  active: number;
  dialogue: number;
  relation: number;
  archived: number;
  promotions: number;
}

/**
 * The replay UI only needs a compact projection of a WorldSnapshot.
 * Slot checkpoints remain authoritative and correct any state inferred from logs.
 */
export interface ReplayWorldState {
  seq: number;
  simTime: SimTime;
  agents: Record<string, AgentState>;
  relationships: RelationshipEdge[];
  giftLedger: GiftRecord[];
  cognitiveSummary: Record<string, ReplayCognitiveSummary>;
  petCounts: Record<string, number>;
  metrics: SlotMetrics;
}

export interface ReplayCheckpoint extends ReplayWorldState {
  key: string;
  snapshotId: string;
}

export interface ReplayDialogueStep {
  cid: string;
  participants: string[];
  mode?: string;
  speakerId?: string;
  turn?: number;
  text?: string;
  sentiment?: number;
  politeness?: number;
  summary?: string;
  keyFacts?: string[];
}

export interface ReplayStep {
  id: string;
  index: number;
  kind: ReplayStepKind;
  simTime: SimTime;
  seqStart: number;
  seqEnd: number;
  logSeqs: number[];
  title: string;
  summary: string;
  focusAgentIds: string[];
  affectedEdgeKeys: string[];
  affectedGiftIds: string[];
  affectedEventIds: string[];
  act?: number;
  actTitle?: string;
  dialogue?: ReplayDialogueStep;
  checkpointSeq?: number;
}

export interface ReplayStoryAct {
  act: number;
  title: string;
  time: SimTime;
  tip?: string;
  notes?: string[];
}

export interface ReplayStory {
  title?: string;
  acts?: ReplayStoryAct[];
  [key: string]: unknown;
}

export interface ReplayData {
  schemaVersion: 1;
  runId: string;
  generatedAt: string;
  initialState: ReplayWorldState;
  checkpoints: ReplayCheckpoint[];
  logs: LogEntry[];
  steps: ReplayStep[];
  conversations: ConversationRecord[];
  story: ReplayStory | null;
  metrics: Record<string, unknown> | null;
}
