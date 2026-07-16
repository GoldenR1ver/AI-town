/**
 * R7: public ritual / gift memories (queryable shared narrative).
 */
import type { PublicMemory, SimTime } from "../../../shared/types/index.js";

export class PublicMemoryManager {
  constructor(private memories: PublicMemory[] = []) {}

  all(): PublicMemory[] {
    return this.memories;
  }

  setMemories(memories: PublicMemory[]): void {
    this.memories = memories;
  }

  add(memory: PublicMemory): void {
    this.memories.push(memory);
  }

  /** Recent memories involving any of the agents, highest salience first. */
  queryForAgents(agentIds: string[], limit = 10): PublicMemory[] {
    const set = new Set(agentIds);
    return this.memories
      .filter((m) => m.participants.some((p) => set.has(p)))
      .sort((a, b) => b.salience - a.salience || b.createdAt.day - a.createdAt.day)
      .slice(0, limit);
  }

  queryByOccasion(occasion: string, limit = 20): PublicMemory[] {
    return this.memories.filter((m) => m.occasion === occasion).slice(-limit);
  }
}

export function makePublicMemoryId(hint: string): string {
  return `pm_${hint}`;
}

export function ritualGiftMemory(input: {
  time: SimTime;
  from: string;
  to: string;
  value: number;
  occasion: string;
  gid: string;
  eid?: string;
  belowNorm?: boolean;
  seqHint: string;
}): PublicMemory {
  const breach = input.belowNorm ? "（低于场合规范）" : "";
  return {
    mid: makePublicMemoryId(input.seqHint),
    eventType: "ritual",
    title: `${input.occasion}随礼 ${input.from}→${input.to}`,
    description: `${input.from} 在 ${input.occasion} 场合向 ${input.to} 赠礼 ¥${input.value}${breach}`,
    participants: [input.from, input.to],
    salience: input.belowNorm ? 0.7 : 0.85,
    createdAt: { ...input.time },
    relatedGids: [input.gid],
    relatedEids: input.eid ? [input.eid] : undefined,
    occasion: input.occasion,
  };
}
