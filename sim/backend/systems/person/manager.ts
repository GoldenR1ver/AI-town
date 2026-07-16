import type { AgentState, PrivateState, PersonalGoal, PersonalEventRecord } from "../../../shared/types/index.js";
import { applyGoalsToBdi, applyPetBeliefs } from "../../cognition/bdi.js";

/** Thin person-state facade for BDI short-term updates. */
export class PersonStateManager {
  constructor(private agents: Record<string, AgentState>) {}

  get(id: string): AgentState | undefined {
    return this.agents[id];
  }

  applyGoals(agentId: string, goals: PersonalGoal[]): PrivateState | null {
    const a = this.agents[agentId];
    if (!a) return null;
    a.private = applyGoalsToBdi(a.private, goals);
    return a.private;
  }

  syncBeliefsFromPet(agentId: string, pets: PersonalEventRecord[]): string[] {
    const a = this.agents[agentId];
    if (!a) return [];
    const { next, changed } = applyPetBeliefs(a.private, pets);
    a.private = next;
    return changed;
  }
}
