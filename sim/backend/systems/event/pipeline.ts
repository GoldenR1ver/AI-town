import type { EventInstance, PersonalGoal, SimTime } from "../../../shared/types/index.js";
import type { LogWriter } from "../../log/log_writer.js";
import type { RuleEngine } from "../../rules/rule_engine.js";
import type { WorldState } from "../../store/world_state.js";
import { applyGoalsToBdi } from "../../cognition/bdi.js";
import { stampBeliefDays } from "../../cognition/forget.js";
import { AgentDecisionEngine } from "../../cognition/decision.js";
import { derivePersonality, isPicky } from "../../cognition/personality.js";
import { decideRefuse } from "../../cognition/refuse.js";
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
    private readonly rng: () => number = Math.random,
  ) {
    this.pet = new PersonalEventTableManager(log);
  }

  process(world: WorldState, time: SimTime, event: EventInstance): void {
    const affected = this.pet.propagate(world, time, event);
    this.pet.syncBeliefs(world, time, affected);

    // Stamp belief ages for newly synced event beliefs.
    for (const agentId of affected) {
      const agent = world.agents[agentId];
      if (!agent) continue;
      const keys = Object.keys(agent.private.beliefs).filter((k) => k.startsWith("event:"));
      agent.private = stampBeliefDays(agent.private, keys, time.day);
    }

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

    // Execute goals (P1: gift/repay/donate/attend + refuse)
    for (const goal of event.goals) {
      this.executeGoal(world, time, event, goal);
    }

    this.applySocialEffects(world, time, event);
    this.applyGossipEffects(world, time, event);

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

  /** Apply BDIE/relationship deltas from random social events (串门/闲谈等). */
  private applySocialEffects(world: WorldState, time: SimTime, event: EventInstance): void {
    const raw = event.payload.socialEffects as
      | {
          moodDelta?: number;
          stressDelta?: number;
          energyDelta?: number;
          arousalDelta?: number;
          trustDelta?: number;
          affectionDelta?: number;
          intimacyDelta?: number;
          valence?: string;
        }
      | undefined;
    if (!raw) return;
    if (event.payload.gossip) return; // gossip uses dedicated path

    const initiator =
      event.roleBindings.initiator?.[0] ??
      event.roleBindings.host?.[0] ??
      event.sourceAgentId;
    const partner =
      event.roleBindings.partner?.[0] ??
      event.roleBindings.guest?.[0] ??
      (typeof event.payload.partnerId === "string" ? event.payload.partnerId : undefined);
    if (!initiator || !partner) return;

    const reason = `social ${event.subType} (${raw.valence ?? "mixed"}) eid=${event.eid}`;

    for (const [from, to, scale] of [
      [initiator, partner, 1] as const,
      [partner, initiator, 0.85] as const,
    ]) {
      this.rules.commit(world, time, {
        kind: "relationship_delta",
        from,
        to,
        trust: (raw.trustDelta ?? 0) * scale,
        affection: (raw.affectionDelta ?? 0) * scale,
        intimacy: (raw.intimacyDelta ?? 0) * scale,
        reason,
      });
    }

    for (const [agentId, scale] of [
      [initiator, 1] as const,
      [partner, 0.9] as const,
    ]) {
      this.rules.commit(world, time, {
        kind: "dialogue_bdie",
        agentId,
        beliefDelta: {
          [`social:${event.subType}`]: (raw.valence === "negative" ? -0.05 : 0.05) * scale,
        },
        emotionDelta: {
          mood: (raw.moodDelta ?? 0) * scale,
          stress: (raw.stressDelta ?? 0) * scale,
          energy: (raw.energyDelta ?? 0) * scale,
          arousal: (raw.arousalDelta ?? 0) * scale,
        },
        reason,
      });
    }
  }

  /**
   * Gossip: initiator + partner bond slightly; partner→target trust/affection down;
   * initiator dislike toward target reinforced; target gets stress if they "hear wind".
   */
  private applyGossipEffects(world: WorldState, time: SimTime, event: EventInstance): void {
    if (!event.payload.gossip && event.subType !== "social_gossip") return;
    const initiator =
      event.roleBindings.initiator?.[0] ?? event.sourceAgentId;
    const partner =
      event.roleBindings.partner?.[0] ??
      (typeof event.payload.partnerId === "string" ? event.payload.partnerId : undefined);
    const target =
      event.roleBindings.target?.[0] ??
      (typeof event.payload.targetId === "string" ? event.payload.targetId : undefined);
    if (!initiator || !partner || !target) return;

    const effects = (event.payload.socialEffects ?? {}) as Record<string, number>;
    const targetTrust = effects.targetTrustDelta ?? -3.5;
    const targetAffection = effects.targetAffectionDelta ?? -4.5;
    // Tuned: 30d short runs need dislike≥35 reachable on repeated gossip pairs.
    const targetDislike = effects.targetDislikeDelta ?? 12;
    const speaker = world.agents[initiator];
    const pickyBoost = speaker && isPicky(derivePersonality(speaker)) ? 1.35 : 1;

    // Bond between gossipers
    this.rules.commit(world, time, {
      kind: "relationship_delta",
      from: initiator,
      to: partner,
      trust: effects.trustDelta ?? 0.4,
      affection: effects.affectionDelta ?? 0.9,
      intimacy: effects.intimacyDelta ?? 0.7,
      reason: `gossip bond eid=${event.eid}`,
    });
    this.rules.commit(world, time, {
      kind: "relationship_delta",
      from: partner,
      to: initiator,
      trust: (effects.trustDelta ?? 0.4) * 0.8,
      affection: (effects.affectionDelta ?? 0.9) * 0.8,
      intimacy: (effects.intimacyDelta ?? 0.7) * 0.8,
      reason: `gossip listen eid=${event.eid}`,
    });

    // Damage target's standing with listener
    this.rules.commit(world, time, {
      kind: "relationship_delta",
      from: partner,
      to: target,
      trust: targetTrust * pickyBoost,
      affection: targetAffection * pickyBoost,
      dislike: Math.abs(targetDislike) * 0.6 * pickyBoost,
      reason: `gossip against ${target} eid=${event.eid}`,
    });

    // Speaker reinforces dislike of target
    this.rules.commit(world, time, {
      kind: "relationship_delta",
      from: initiator,
      to: target,
      affection: -1.5 * pickyBoost,
      dislike: Math.abs(targetDislike) * pickyBoost,
      reason: `gossip reinforce dislike eid=${event.eid}`,
    });

    // Mild stress on target (rumor reaches them with low intensity)
    this.rules.commit(world, time, {
      kind: "dialogue_bdie",
      agentId: target,
      beliefDelta: { [`gossiped_about_by:${initiator}`]: 0.08 },
      emotionDelta: { mood: -0.03, stress: 0.04 },
      reason: `heard gossip wind eid=${event.eid}`,
    });

    this.rules.commit(world, time, {
      kind: "dialogue_bdie",
      agentId: initiator,
      beliefDelta: { [`dislike:${target}`]: 0.06 },
      emotionDelta: {
        mood: effects.moodDelta ?? 0.02,
        stress: effects.stressDelta ?? -0.02,
        arousal: effects.arousalDelta ?? 0.03,
      },
      reason: `gossip vent eid=${event.eid}`,
    });
  }

  private applyRefusePenalty(
    world: WorldState,
    time: SimTime,
    event: EventInstance,
    goal: PersonalGoal,
    decision: ReturnType<typeof decideRefuse>,
  ): void {
    const others = new Set<string>();
    for (const list of Object.values(event.roleBindings)) {
      for (const id of list) if (id !== goal.agentId) others.add(id);
    }
    if (event.sourceAgentId && event.sourceAgentId !== goal.agentId) {
      others.add(event.sourceAgentId);
    }
    for (const other of others) {
      this.rules.commit(world, time, {
        kind: "relationship_delta",
        from: other,
        to: goal.agentId,
        trust: decision.trustPenalty,
        affection: decision.affectionPenalty,
        intimacy: decision.intimacyPenalty,
        reason: `refuse ${goal.goalType}: ${decision.reason}`,
      });
      // Picky counterparts dislike more when refused.
      const otherAgent = world.agents[other];
      if (otherAgent && isPicky(derivePersonality(otherAgent))) {
        this.rules.commit(world, time, {
          kind: "relationship_delta",
          from: other,
          to: goal.agentId,
          dislike: 2.5 + derivePersonality(otherAgent).pickiness * 3,
          affection: -1.5,
          reason: `picky reaction to refuse eid=${event.eid}`,
        });
      }
    }
    this.log?.append(
      time,
      "event.refused",
      {
        eid: event.eid,
        goalId: goal.goalId,
        agentId: goal.agentId,
        goalType: goal.goalType,
        reason: decision.reason,
      },
      { affectedEids: [event.eid], affectedAgents: [goal.agentId, ...others] },
    );
  }

  private executeGoal(
    world: WorldState,
    time: SimTime,
    event: EventInstance,
    goal: PersonalGoal,
  ): void {
    goal.status = "in_progress";

    const agent = world.agents[goal.agentId];
    if (agent && goal.goalType !== "reply_gift") {
      const refusal = decideRefuse(world, agent, goal, event, this.rng);
      if (refusal.refuse) {
        goal.status = goal.optional ? "waived" : "failed";
        this.applyRefusePenalty(world, time, event, goal, refusal);
        // Clear intention
        delete agent.private.intentions[`${goal.goalType}:${goal.goalId}`];
        delete agent.private.desires[`goal:${goal.goalId}`];
        return;
      }
    }
    // Soft refuse for repay under extreme stress/cash — lighter than full abandon.
    if (agent && goal.goalType === "reply_gift") {
      const refusal = decideRefuse(world, agent, goal, event, this.rng);
      if (refusal.refuse) {
        goal.status = "waived";
        this.applyRefusePenalty(world, time, event, goal, {
          ...refusal,
          trustPenalty: refusal.trustPenalty * 0.5,
          affectionPenalty: refusal.affectionPenalty * 0.5,
          intimacyPenalty: refusal.intimacyPenalty * 0.5,
        });
        delete agent.private.intentions[`${goal.goalType}:${goal.goalId}`];
        delete agent.private.desires[`goal:${goal.goalId}`];
        return;
      }
    }

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
        const originalGid =
          typeof goal.params.originalGid === "string" ? goal.params.originalGid : undefined;
        const open = originalGid
          ? world.giftLedger.find(
              (g) =>
                g.gid === originalGid &&
                g.to === goal.agentId &&
                g.status === "pending_reply" &&
                g.replyRequired !== false,
            )
          : world.giftLedger.find(
              (g) =>
                g.to === goal.agentId &&
                g.from === to &&
                g.status === "pending_reply" &&
                g.replyRequired !== false,
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
              to: open.from,
              value: refined.value,
              rationale: refined.rationale,
              brief: refined.brief,
            },
            { affectedAgents: [goal.agentId, open.from], affectedEids: [event.eid] },
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
    const agentAfter = world.agents[goal.agentId];
    if (agentAfter && (goal.status === "completed" || goal.status === "waived")) {
      const key = `${goal.goalType}:${goal.goalId}`;
      delete agentAfter.private.intentions[key];
      delete agentAfter.private.desires[`goal:${goal.goalId}`];
    }
  }
}
