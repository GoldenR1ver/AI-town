/** Shared simulation types — Phase 0/1 contract (see reference/project-plan-board.md). */

export type TimeSlot = "AM" | "PM" | "EVE";

export interface SimTime {
  day: number;
  slot: TimeSlot;
}

export type SocialBasis =
  | "kin"
  | "friend"
  | "colleague"
  | "neighbor"
  | "superior"
  | "subordinate"
  | "other";

export type RelationAxis = "horizontal" | "vertical_up" | "vertical_down";

export interface PublicProfile {
  id: string;
  name: string;
  education?: string;
  age: number;
  gender: string;
  occupation: string;
  address?: string;
  birthday?: string;
  hobbies?: string[];
  habits?: string[];
  kinship?: string[];
  socialTags?: string[];
  workplaceId?: string;
  communityId?: string;
  /** Goffman situational dignity — short-horizon, ceremony/competition driven. */
  face?: number;
  /** Yan long-horizon status / ritual hosting capital. */
  prestige?: number;
  /** Slow public moral evaluation (default / compliance). */
  reputation?: number;
}

export interface BigFive {
  O: number;
  C: number;
  E: number;
  A: number;
  N: number;
}

export interface EmotionState {
  mood: number;
  arousal: number;
  stress: number;
  energy: number;
}

export interface IntentionRecord {
  slotDue?: SimTime;
  actionType?: string;
  params?: Record<string, unknown>;
  priority?: number;
  eid?: string;
}

/** BDI short-term state: B←PET, D←Goals, I←high-priority/due goals + reply windows. */
export interface PrivateState {
  bigFive: BigFive;
  svoAngle?: number;
  svoLength?: number;
  beliefs: Record<string, number>;
  desires: Record<string, number>;
  intentions: Record<string, IntentionRecord>;
  emotion: EmotionState;
}

export interface EconomyState {
  agentId: string;
  cash: number;
  deposit: number;
  debt: number;
  creditLimit: number;
  income: number;
  essentialExpenseRatio: number;
  savingsRatio: number;
  lastSettlementDay: number;
}

export interface AgentState {
  public: PublicProfile;
  private: PrivateState;
  economy: EconomyState;
}

export interface RelationshipEdge {
  from: string;
  to: string;
  socialBasis: SocialBasis;
  intimacy: number;
  trust: number;
  affection: number;
  authority: number;
  giftDebt: number;
  reciprocityScore: number;
  relationAxis: RelationAxis;
  lastChangedAt?: SimTime;
  interactionSummary?: string;
}

export type GiftStatus = "pending_reply" | "replied" | "defaulted" | "closed";

export interface GiftRecord {
  gid: string;
  eid?: string;
  from: string;
  to: string;
  expressiveScore: number;
  instrumentalScore: number;
  value: number;
  adjustedValue: number;
  description: string;
  givenAt: SimTime;
  replyWindowEnd: SimTime;
  status: GiftStatus;
  replyGid?: string;
  occasion?: string;
  /** P4-11: expressive (ritual) vs instrumental debt branch. */
  giftKind?: "expressive" | "instrumental";
  /** R1: true when value < minGiftNorm for the occasion. */
  belowNorm?: boolean;
  minGiftNorm?: number;
  /**
   * rule-of-return-gift W1: false → never window-default (vertical gifts).
   * Defaults to true when omitted (legacy records).
   */
  replyRequired?: boolean;
}

/** R7: shared ritual / gift public memory (distinct from private PET). */
export interface PublicMemory {
  mid: string;
  eventType: "gift" | "ritual" | "default" | "rule_change";
  title: string;
  description: string;
  participants: string[];
  salience: number;
  createdAt: SimTime;
  relatedGids?: string[];
  relatedEids?: string[];
  occasion?: string;
}

/* ---------- Event / Goal / PET (Phase 1) ---------- */

export type GoalType =
  | "attend"
  | "donate_cash"
  | "reply_gift"
  | "give_gift"
  | "spread_info"
  | "complete_dialogue"
  | "work_shift"
  | "update_belief"
  | "custom";

export type GoalStatus = "pending" | "in_progress" | "completed" | "failed" | "waived";

export interface PersonalGoal {
  goalId: string;
  eid: string;
  agentId: string;
  roleSlot: string;
  goalType: GoalType;
  description: string;
  params: Record<string, unknown>;
  deadline?: SimTime;
  priority: number;
  status: GoalStatus;
  optional: boolean;
}

export type EventStatus = "queued" | "processing" | "completed" | "rejected" | "expired";
export type EventVisibility = "public" | "private" | "semi";
export type EventSource = "manual" | "scheduled" | "agent_driven";

export interface EventInstance {
  eid: string;
  templateId: string;
  category: "public" | "private";
  subType: string;
  visibility: EventVisibility;
  time: SimTime;
  location: string;
  status: EventStatus;
  roleBindings: Record<string, string[]>;
  goals: PersonalGoal[];
  summary: string;
  payload: Record<string, unknown>;
  source: EventSource;
  sourceAgentId?: string;
  /** Agents with occupancy=required in this event (for conflict detection). */
  requiredAgentIds: string[];
  priority: number;
  dialogue: {
    mode: DialogueMode;
    minParticipants: number;
    maxParticipants: number;
    maxTurns: number;
    forced: boolean;
  };
}

export type PetSource = "direct" | "dialogue" | "public_broadcast" | "kin_network";

export interface PersonalEventRecord {
  id: string;
  agentId: string;
  eid: string;
  learnedAt: SimTime;
  source: PetSource;
  channel: string;
  sourceAgentId?: string;
  confidence: number;
  contentSnapshot: string;
  lastUpdatedAt: SimTime;
}

/* ---------- Dialogue / conversation (Phase 2) ---------- */

export type DialogueMode = "dialogue" | "host" | "random";

export interface StyleProfile {
  talkativeness: number;
  formality: number;
  directness: number;
  cooperationBias: number;
  riskTolerance: number;
  emotionalExpressiveness: number;
}

export interface ConversationMessage {
  turn: number;
  speakerId: string;
  text: string;
  timestamp: SimTime;
  meta?: {
    mentionedEids?: string[];
    sentiment?: number;
    politeness?: number;
  };
}

export interface AgentBdieImpact {
  beliefDelta: Record<string, number>;
  desireDelta: Record<string, number>;
  intentionDelta: Record<string, number>;
  emotionDelta: Partial<EmotionState>;
  influenceScore: number;
}

export interface ConversationRecord {
  cid: string;
  type: DialogueMode;
  mode: DialogueMode;
  participants: string[];
  relatedEids: string[];
  time: SimTime;
  messages: ConversationMessage[];
  summary: string;
  keyFacts: string[];
  status: "active" | "completed" | "aborted";
  bdieImpact: Record<string, AgentBdieImpact>;
  relationshipDeltas: Array<{
    from: string;
    to: string;
    before: Partial<RelationshipEdge>;
    after: Partial<RelationshipEdge>;
    reason: string;
  }>;
}

export interface KnowledgeEntry {
  kid: string;
  category: "norm" | "vocabulary" | "ritual" | "occupation";
  key: string;
  content: string;
  tags: string[];
}

/* ---------- Cognitive tree (Phase 3) ---------- */

export type CognitiveLayer = "social" | "circle" | "relation" | "dialogue";

/** Per-agent subjective layered memory; promotion is Rule-gated, content may be LLM-assisted. */
export interface CognitiveNode {
  nodeId: string;
  agentId: string;
  layer: CognitiveLayer;
  /** Other agent id (dialogue/relation) or circle/social scope key. */
  scope?: string;
  content: string;
  influenceSum: number;
  sourceRefs: string[];
  parentId?: string;
  childIds: string[];
  createdAt: SimTime;
  updatedAt: SimTime;
  archived: boolean;
}

export type LogEventType =
  | "experiment.start"
  | "experiment.end"
  | "timeslot.start"
  | "timeslot.end"
  | "event.created"
  | "event.propagated"
  | "event.completed"
  | "event.rejected"
  | "dialogue.start"
  | "dialogue.message"
  | "dialogue.end"
  | "relationship.delta"
  | "gift.given"
  | "gift.replied"
  | "gift.defaulted"
  | "economy.monthly"
  | "bdi.updated"
  | "cognitive.promoted"
  | "public_memory.created"
  | "rule.rejected";

export interface LogEntry {
  seq: number;
  simTime: SimTime;
  type: LogEventType;
  payload: unknown;
  statePointers?: {
    snapshotId?: string;
    affectedAgents?: string[];
    affectedEids?: string[];
    affectedGids?: string[];
    affectedCids?: string[];
  };
}

export interface SlotMetrics {
  giftGiven: number;
  giftReplied: number;
  giftDefaulted: number;
  eventsCreated: number;
  eventsCompleted: number;
  eventsRejected: number;
  dialoguesCompleted: number;
  dialogueMessages: number;
  cognitivePromotions: number;
  reciprocityRate?: number;
  avgRepayDelaySlots?: number;
}

export interface WorldSnapshot {
  snapshotId: string;
  simTime: SimTime;
  seq: number;
  agents: Record<string, AgentState>;
  relationships: RelationshipEdge[];
  personalEventTables: Record<string, PersonalEventRecord[]>;
  conversations: ConversationRecord[];
  cognitiveTrees: Record<string, CognitiveNode[]>;
  giftLedger: GiftRecord[];
  publicMemories: PublicMemory[];
  eventQueue: EventInstance[];
  metrics: SlotMetrics;
}

/** Contrast experiment variant ids (Phase 5 E1–E4). */
export type ExperimentVariant =
  | "baseline"
  | "E1_memory_on"
  | "E1_memory_off"
  | "E2_reciprocity_on"
  | "E2_reciprocity_off"
  | "E3_horizontal_only"
  | "E3_with_vertical"
  | "E4_occasion_off"
  | "E4_occasion_on";

export interface ExperimentConfig {
  runId: string;
  name: string;
  startDay: number;
  endDay: number;
  seed: number;
  enableReciprocityRules: boolean;
  enableGiftMemory: boolean;
  enableScheduledEvents: boolean;
  llmMode: "mock" | "live";
  /** R1: enforce occasion minGiftNorm etiquette penalties. */
  enableOccasionNorms?: boolean;
  /** R3/R4: axis-specific repay tolerances. */
  enableAxisReciprocity?: boolean;
  /** P5: run forced dialogue inside the main clock pipeline (default true). */
  enableDialogue?: boolean;
  /** P5 E3: when false, collapse all relationAxis to horizontal at load. */
  enableVerticalRelations?: boolean;
  /** Max dialogue turns per forced event in batch runs (default 4). */
  dialogueMaxTurns?: number;
  /** Contrast / batch label. */
  variant?: ExperimentVariant;
}

export const SLOT_ORDER: TimeSlot[] = ["AM", "PM", "EVE"];

export function nextSimTime(t: SimTime): SimTime {
  const idx = SLOT_ORDER.indexOf(t.slot);
  if (idx < SLOT_ORDER.length - 1) {
    return { day: t.day, slot: SLOT_ORDER[idx + 1]! };
  }
  return { day: t.day + 1, slot: "AM" };
}

export function simTimeKey(t: SimTime): string {
  return `D${t.day}-${t.slot}`;
}

export function advanceSimTime(t: SimTime, slots: number): SimTime {
  let cur = { ...t };
  for (let i = 0; i < slots; i++) cur = nextSimTime(cur);
  return cur;
}
