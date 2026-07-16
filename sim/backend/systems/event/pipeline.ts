import type { EventInstance, PersonalGoal, SimTime } from "../../../shared/types/index.js";
import type { LogWriter } from "../../log/log_writer.js";
import type { RuleEngine } from "../../rules/rule_engine.js";
import type { WorldState } from "../../store/world_state.js";
import { applyGoalsToBdi } from "../../cognition/bdi.js";
import { AgentDecisionEngine } from "../../cognition/decision.js";
import { PersonalEventTableManager } from "./pet.js";

/**
 * Process one event: PET → Belief → D/I from goals → execute actionable goals via RuleEngine.
 * Forced dialogue is orchestrated by Experiment (P5) before this pipeline runs.
 */
export class EventPipeline {
  private readonly pet: PersonalEventTableManager;
  private readonly decisions = new AgentDecisionEngine();

  constructor(
    private readonly rules: RuleEngine,
    private readonly log?: LogWriter,
  ) {
    this.pet = new PersonalEventTableManager(log);
  }

  process(world: WorldState, time: SimTime, event: EventInstance): void {
    const affected = this.pet.propagate(world, time, event);
    this.pet.syncBeliefs(world, time, affected);

    // Write D/I for goal assignees
    for (const goal of event.goals) {
      const agent = world.agents[goal.agentId];
      if (!agent) continue;
      const beforeI = Object.keys(agent.private.intentions).length;
      agent.private = applyGoalsToBdi(agent.private, [goal]);
      if (Object.keys(agent.private.intentions).length !== beforeI) {
        this.log?.append(
          time,
          "bdi.updated",
          {
            agentId: goal.agentId,
            kind: "desire_intention",
            goalId: goal.goalId,
            goalType: goal.goalType,
            priority: goal.priority,
          },
          { affectedAgents: [goal.agentId], affectedEids: [event.eid] },
        );
      }
    }

    // Execute goals (P1: gift/repay/donate/attend)
    for (const goal of event.goals) {
      this.executeGoal(world, time, event, goal);
    }

    this.log?.append(
      time,
      "event.completed",
      {
        eid: event.eid,
        templateId: event.templateId,
        summary: event.summary,
        goals: event.goals.map((g) => ({
          goalId: g.goalId,
          agentId: g.agentId,
          type: g.goalType,
          status: g.status,
        })),
      },
      {
        affectedEids: [event.eid],
        affectedAgents: [...new Set(event.goals.map((g) => g.agentId))],
      },
    );
  }

  private executeGoal(
    world: WorldState,
    time: SimTime,
    event: EventInstance,
    goal: PersonalGoal,
  ): void {
    goal.status = "in_progress";
    switch (goal.goalType) {
      case "give_gift": {
        const occasion = String(event.payload.occasion ?? event.subType);
        const refined = this.decisions.refineGiveGift(world, goal.agentId, goal.params, occasion);
        const to = String(goal.params.to ?? refined?.to ?? "");
        const value = Number(refined?.value ?? goal.params.value ?? 0);
        const expressiveScore = Number(refined?.expressiveScore ?? goal.params.expressiveScore ?? 0.5);
        if (!to || !(value > 0)) {
          goal.status = goal.optional ? "waived" : "failed";
          return;
        }
        if (refined?.rationale) {
          this.log?.append(
            time,
            "bdi.updated",
            {
              agentId: goal.agentId,
              kind: "agent_decision",
              action: "give_gift",
              to,
              value,
              rationale: refined.rationale,
              brief: refined.brief,
            },
            { affectedAgents: [goal.agentId, to], affectedEids: [event.eid] },
          );
        }
        const replyWindowSlots = Number(
          goal.params.replyWindowSlots ?? event.payload.replyWindowSlots ?? 9,
        );
        const minGiftNormRaw = goal.params.minGiftNorm ?? event.payload.minGiftNorm;
        const minGiftNorm =
          typeof minGiftNormRaw === "number"
            ? minGiftNormRaw
            : minGiftNormRaw != null
              ? Number(minGiftNormRaw)
              : undefined;
        const r = this.rules.commit(world, time, {
          kind: "give_gift",
          from: goal.agentId,
          to,
          value,
          expressiveScore,
          description: goal.description,
          eid: event.eid,
          replyWindowSlots,
          occasion,
          minGiftNorm: Number.isFinite(minGiftNorm) ? minGiftNorm : undefined,
        });
        goal.status = r.ok ? "completed" : goal.optional ? "waived" : "failed";
        break;
      }
      case "reply_gift": {
        const refined = this.decisions.refineRepayGift(world, goal.agentId, goal.params);
        const to = String(goal.params.to ?? refined?.to ?? "");
        const open = world.giftLedger.find(
          (g) => g.to === goal.agentId && g.from === to && g.status === "pending_reply",
        );
        if (!open) {
          goal.status = goal.optional ? "waived" : "failed";
          return;
        }
        if (refined?.rationale) {
          this.log?.append(
            time,
            "bdi.updated",
            {
              agentId: goal.agentId,
              kind: "agent_decision",
              action: "reply_gift",
              to,
              value: refined.value,
              rationale: refined.rationale,
              brief: refined.brief,
            },
            { affectedAgents: [goal.agentId, to], affectedEids: [event.eid] },
          );
        }
        const minValue = Number(goal.params.minAdjustedValue ?? open.adjustedValue);
        const value = Number(refined?.value ?? goal.params.value ?? minValue);
        const r = this.rules.commit(world, time, {
          kind: "repay_gift",
          from: goal.agentId,
          to: open.from,
          value,
          originalGid: open.gid,
        });
        goal.status = r.ok ? "completed" : "failed";
        break;
      }
      case "donate_cash": {
        const amount = Number(goal.params.amount ?? 0);
        const host =
          event.roleBindings.initiator?.[0] ??
          event.roleBindings.host?.[0] ??
          event.sourceAgentId;
        if (!host || !(amount > 0) || host === goal.agentId) {
          goal.status = "waived";
          return;
        }
        // Reuse give_gift with high instrumental score as community donation
        const r = this.rules.commit(world, time, {
          kind: "give_gift",
          from: goal.agentId,
          to: host,
          value: amount,
          expressiveScore: 0.2,
          description: `donate for ${event.eid}`,
          eid: event.eid,
          replyWindowSlots: 18,
          occasion: "donation",
        });
        goal.status = r.ok ? "completed" : goal.optional ? "waived" : "failed";
        break;
      }
      case "attend":
      case "complete_dialogue":
      case "spread_info":
      case "work_shift":
      case "update_belief":
      case "custom":
        goal.status = "completed";
        break;
      default:
        goal.status = "waived";
    }

    // Clear completed intention keys
    const agent = world.agents[goal.agentId];
    if (agent && (goal.status === "completed" || goal.status === "waived")) {
      const key = `${goal.goalType}:${goal.goalId}`;
      delete agent.private.intentions[key];
      delete agent.private.desires[`goal:${goal.goalId}`];
    }
  }
}
