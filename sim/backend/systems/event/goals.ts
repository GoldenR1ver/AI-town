import type { EventInstance, PersonalGoal, SimTime } from "../../../shared/types/index.js";
import { advanceSimTime } from "../../../shared/types/index.js";
import type { EventTemplate, GoalTemplate } from "../../../shared/types/event_template.js";
import type { WorldState } from "../../store/world_state.js";

function fillTemplate(tpl: string, bindings: Record<string, string[]>, world: WorldState): string {
  return tpl.replace(/\{\{(\w+)\.name\}\}/g, (_, slot: string) => {
    const id = bindings[slot]?.[0];
    return id ? world.agents[id]?.public.name ?? id : slot;
  });
}

function resolveParamValue(
  raw: unknown,
  world: WorldState,
  agentId: string,
  payload: Record<string, unknown>,
): unknown {
  if (typeof raw !== "string") return raw;
  if (raw === "from_event") return payload.minAdjustedValue ?? payload.value ?? 100;
  if (raw.startsWith("income*")) {
    const factor = Number(raw.split("*")[1]);
    const income = world.agents[agentId]?.economy.income ?? 0;
    return Math.round(income * factor);
  }
  if (raw.startsWith("{{") && raw.endsWith("}}")) {
    const path = raw.slice(2, -2);
    if (path.startsWith("intention.params.")) {
      return payload[path.replace("intention.params.", "")];
    }
  }
  const n = Number(raw);
  return Number.isFinite(n) && raw.trim() !== "" ? n : raw;
}

export class GoalInstantiator {
  instantiate(
    template: EventTemplate,
    eid: string,
    bindings: Record<string, string[]>,
    time: SimTime,
    world: WorldState,
    payload: Record<string, unknown> = {},
  ): PersonalGoal[] {
    const goals: PersonalGoal[] = [];
    for (const gt of template.goalTemplates) {
      const agents = bindings[gt.assignedToSlot] ?? [];
      for (const agentId of agents) {
        goals.push(this.one(gt, eid, agentId, gt.assignedToSlot, time, world, payload, bindings));
      }
    }
    return goals;
  }

  private one(
    gt: GoalTemplate,
    eid: string,
    agentId: string,
    roleSlot: string,
    time: SimTime,
    world: WorldState,
    payload: Record<string, unknown>,
    bindings: Record<string, string[]>,
  ): PersonalGoal {
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(gt.params)) {
      params[k] = resolveParamValue(v, world, agentId, payload);
    }
    // Default gift target = host/initiator/receiver slot if present
    if (gt.goalType === "give_gift" && !params.to) {
      params.to =
        bindings.host?.[0] ?? bindings.receiver?.[0] ?? bindings.initiator?.[0] ?? payload.hostId;
    }
    if (gt.goalType === "reply_gift" && !params.to) {
      params.to = bindings.creditor?.[0] ?? bindings.initiator?.[0];
    }

    const desc =
      gt.descriptionTemplate ??
      `${gt.goalType} for event ${eid} as ${roleSlot}`;

    return {
      goalId: `${eid}:${gt.goalTemplateId}:${agentId}`,
      eid,
      agentId,
      roleSlot,
      goalType: gt.goalType,
      description: fillTemplate(desc, bindings, world),
      params,
      deadline: gt.deadline ? advanceSimTime(time, gt.deadline.offsetSlots) : undefined,
      priority: gt.priority,
      status: "pending",
      optional: gt.optional,
    };
  }
}

export function requiredAgentsFromBindings(
  template: EventTemplate,
  bindings: Record<string, string[]>,
): string[] {
  const ids = new Set<string>();
  for (const slot of template.roleSlots) {
    if (slot.occupancy !== "required") continue;
    for (const id of bindings[slot.slotId] ?? []) ids.add(id);
  }
  return [...ids];
}

export function buildSummary(
  template: EventTemplate,
  bindings: Record<string, string[]>,
  world: WorldState,
): string {
  return fillTemplate(template.contentSummaryTemplate, bindings, world);
}

export function eventPriority(template: EventTemplate, source: EventInstance["source"]): number {
  const base = template.basePriority ?? (template.category === "public" ? 60 : 40);
  if (source === "agent_driven") return base + 30;
  if (template.dialogue.forced) return base + 10;
  return base;
}
