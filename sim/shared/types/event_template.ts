/** Event template schema (Phase 1) — RoleSlot + GoalTemplate. */

import type { GoalType, SimTime, TimeSlot } from "../../shared/types/index.js";

export type RoleResolverSpec =
  | { type: "fixed"; agentId: string }
  | { type: "self" }
  | { type: "kinship"; ofSlot: string; relation?: string }
  | { type: "relationship"; ofSlot: string; metric: "trust" | "affection"; topK: number }
  | { type: "same_community"; communityId?: string }
  | { type: "same_workplace"; ofSlot: string }
  | { type: "neighbor"; ofSlot: string; topK?: number }
  | { type: "random_adult"; excludeSlots?: string[]; minAge?: number; maxAge?: number }
  | { type: "tag_match"; tag: string; count: number };

export interface RoleSlot {
  slotId: string;
  label: string;
  cardinality: number | { min: number; max: number };
  required: boolean;
  resolver: RoleResolverSpec;
  occupancy: "required" | "optional";
}

export interface GoalTemplate {
  goalTemplateId: string;
  assignedToSlot: string;
  goalType: GoalType;
  params: Record<string, number | string | boolean>;
  deadline?: { offsetSlots: number };
  priority: number;
  optional: boolean;
  descriptionTemplate?: string;
}

export interface EventTemplate {
  templateId: string;
  category: "public" | "private";
  subType: string;
  visibility: "public" | "private" | "semi";
  trigger: {
    method: "manual" | "scheduled" | "agent_driven";
    schedule?: {
      probabilityPerSlot?: number;
      validSlots?: TimeSlot[];
      /** Force on these absolute days (for demos). */
      forceOnDays?: number[];
    };
  };
  roleSlots: RoleSlot[];
  goalTemplates: GoalTemplate[];
  dialogue: {
    mode: "dialogue" | "host" | "random";
    minParticipants: number;
    maxParticipants: number;
    maxTurns: number;
    forced: boolean;
  };
  locationType: "home" | "workplace" | "community" | "venue" | "abstract";
  durationSlots: number;
  contentSummaryTemplate: string;
  /** Gift / ritual params carried into EventInstance.payload */
  params?: Record<string, unknown>;
  basePriority?: number;
}

export interface ResolveContext {
  time: SimTime;
  sourceAgentId?: string;
  /** Manual overrides: slotId → agentIds */
  roleOverrides?: Record<string, string[]>;
  rng: () => number;
}
