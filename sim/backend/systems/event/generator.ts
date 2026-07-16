import type { EventInstance, EventSource, SimTime } from "../../../shared/types/index.js";
import type { EventTemplate } from "../../../shared/types/event_template.js";
import type { WorldState } from "../../store/world_state.js";
import type { LogWriter } from "../../log/log_writer.js";
import { EventTemplateLibrary } from "./library.js";
import { RoleResolver } from "./resolver.js";
import {
  GoalInstantiator,
  buildSummary,
  eventPriority,
  requiredAgentsFromBindings,
} from "./goals.js";

let eidCounter = 0;

export function resetEidCounter(): void {
  eidCounter = 0;
}

export interface ManualOverrides {
  roleOverrides?: Record<string, string[]>;
  payload?: Record<string, unknown>;
  sourceAgentId?: string;
}

export class EventGenerator {
  private readonly resolver = new RoleResolver();
  private readonly goals = new GoalInstantiator();

  constructor(
    private readonly library: EventTemplateLibrary,
    private readonly log?: LogWriter,
  ) {}

  generateManual(
    world: WorldState,
    templateId: string,
    time: SimTime,
    rng: () => number,
    overrides?: ManualOverrides,
  ): EventInstance | null {
    const template = this.library.get(templateId);
    if (!template) return null;
    return this.materialize(world, template, time, "manual", rng, overrides);
  }

  generateScheduled(world: WorldState, time: SimTime, rng: () => number): EventInstance[] {
    if (!world.config.enableScheduledEvents) return [];
    const out: EventInstance[] = [];
    for (const template of this.library.scheduledTemplates()) {
      const sched = template.trigger.schedule;
      if (sched?.validSlots && !sched.validSlots.includes(time.slot)) continue;
      const forced = sched?.forceOnDays?.includes(time.day) ?? false;
      const p = sched?.probabilityPerSlot ?? 0;
      if (!forced && rng() > p) continue;
      const ev = this.materialize(world, template, time, "scheduled", rng);
      if (ev) out.push(ev);
    }
    return out;
  }

  /** Phase 6 stub — Intention → template (not used in P1 verify). */
  generateFromIntention(): EventInstance | null {
    return null;
  }

  private materialize(
    world: WorldState,
    template: EventTemplate,
    time: SimTime,
    source: EventSource,
    rng: () => number,
    overrides?: ManualOverrides,
  ): EventInstance | null {
    const resolved = this.resolver.resolveAll(world, template.roleSlots, {
      time,
      sourceAgentId: overrides?.sourceAgentId,
      roleOverrides: overrides?.roleOverrides,
      rng,
    });
    if (resolved.error) {
      this.log?.append(time, "event.rejected", {
        templateId: template.templateId,
        reason: resolved.error,
        stage: "resolve",
      });
      return null;
    }

    const payload = { ...(template.params ?? {}), ...(overrides?.payload ?? {}) };
    const eid = `e_${time.day}${time.slot}_${++eidCounter}`;
    const goals = this.goals.instantiate(
      template,
      eid,
      resolved.bindings,
      time,
      world,
      payload,
    );
    const requiredAgentIds = requiredAgentsFromBindings(template, resolved.bindings);
    const initiatorId =
      resolved.bindings.initiator?.[0] ??
      resolved.bindings.host?.[0] ??
      requiredAgentIds[0] ??
      Object.keys(world.agents)[0]!;

    const instance: EventInstance = {
      eid,
      templateId: template.templateId,
      category: template.category,
      subType: template.subType,
      visibility: template.visibility,
      time: { ...time },
      location: template.locationType,
      status: "queued",
      roleBindings: resolved.bindings,
      goals,
      summary: buildSummary(template, resolved.bindings, world),
      payload,
      source,
      sourceAgentId: overrides?.sourceAgentId ?? initiatorId,
      requiredAgentIds,
      priority: eventPriority(template, source),
      dialogue: { ...template.dialogue },
    };

    this.log?.append(
      time,
      "event.created",
      {
        eid,
        templateId: template.templateId,
        source,
        summary: instance.summary,
        roleBindings: resolved.bindings,
        goalCount: goals.length,
      },
      { affectedEids: [eid], affectedAgents: [...new Set(goals.map((g) => g.agentId))] },
    );
    world.metrics.eventsCreated += 1;
    return instance;
  }
}
