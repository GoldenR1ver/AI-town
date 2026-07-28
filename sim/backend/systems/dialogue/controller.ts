import type {
  ConversationMessage,
  ConversationRecord,
  DialogueMode,
  EventInstance,
  SimTime,
} from "../../../shared/types/index.js";
import type { LlmClient } from "../../llm/client.js";
import type { LogWriter } from "../../log/log_writer.js";
import type { RuleEngine, RuleResult } from "../../rules/rule_engine.js";
import type { WorldState } from "../../store/world_state.js";
import { CognitiveTreeManager } from "../../cognition/cognitive_tree.js";
import { derivePersonality } from "../../cognition/personality.js";
import { RelationshipGraph } from "../relationship/graph.js";
import { RelationshipSummarizer } from "../relationship/summarizer.js";
import { PersonalEventTableManager } from "../event/pet.js";
import { DialogPromptBuilder } from "./prompt.js";
import { DialogueSummarizer } from "./summarizer.js";
import { KnowledgeBase } from "./knowledge.js";
import { ConversationTable } from "./table.js";

interface LlmTurn {
  utterance: string;
  sentiment: number;
  politeness: number;
  mentionedEids: string[];
}

export interface RunDialogueArgs {
  world: WorldState;
  event: EventInstance;
  time: SimTime;
  participants?: string[];
  mode?: DialogueMode;
  minTurns?: number;
  maxTurns?: number;
}

let cidCounter = 0;

export class DialogueController {
  private readonly prompts = new DialogPromptBuilder();
  private readonly summarizer = new DialogueSummarizer();
  private readonly relationSummary = new RelationshipSummarizer();
  private readonly pet: PersonalEventTableManager;

  constructor(
    private readonly llm: LlmClient,
    private readonly rules: RuleEngine,
    private readonly knowledge: KnowledgeBase,
    private readonly table: ConversationTable,
    private readonly log?: LogWriter,
  ) {
    this.pet = new PersonalEventTableManager(log);
  }

  async run(args: RunDialogueArgs): Promise<ConversationRecord> {
    const participants = this.selectParticipants(args.world, args.event, args.participants);
    if (participants.length < 2) throw new Error("dialogue requires at least 2 participants");
    const mode = args.mode ?? args.event.dialogue.mode;
    const minTurns = Math.max(4, args.minTurns ?? 4);
    const maxTurns = Math.max(minTurns, Math.min(8, args.maxTurns ?? args.event.dialogue.maxTurns));
    const cid = `c_${args.time.day}${args.time.slot}_${++cidCounter}`;
    const messages: ConversationMessage[] = [];
    const knowledge = this.knowledge.search(
      args.event.subType,
      participants.map((id) => args.world.agents[id]!.public.occupation),
      6,
    );

    this.log?.append(
      args.time,
      "dialogue.start",
      { cid, mode, participants, relatedEids: [args.event.eid], llmMode: this.llm.mode },
      { affectedAgents: participants, affectedEids: [args.event.eid], affectedCids: [cid] },
    );

    for (let turn = 0; turn < maxTurns; turn++) {
      const speakerId = this.pickSpeaker(mode, participants, turn, args.event);
      const others = participants.filter((id) => id !== speakerId);
      const built = this.prompts.build({
        world: args.world,
        selfId: speakerId,
        otherIds: others,
        event: args.event,
        mode,
        history: messages,
        knowledge,
      });
      const raw = await this.llm.complete([
        { role: "system", content: built.system },
        { role: "user", content: built.user },
      ]);
      const parsed = parseTurn(raw, args.event.eid);
      const text = postProcess(parsed.utterance, messages);
      const message: ConversationMessage = {
        turn: turn + 1,
        speakerId,
        text,
        timestamp: { ...args.time },
        meta: {
          mentionedEids: parsed.mentionedEids,
          sentiment: parsed.sentiment,
          politeness: parsed.politeness,
        },
      };
      messages.push(message);
      args.world.metrics.dialogueMessages += 1;
      this.pet.recordDialogueMentions(
        args.world,
        args.time,
        others,
        parsed.mentionedEids,
        speakerId,
        text,
      );
      const speaker = args.world.agents[speakerId];
      this.log?.append(
        args.time,
        "dialogue.message",
        {
          cid,
          ...message,
          style: built.style,
          // Discourse-alignment snapshot for offline checks.
          speakerEmotion: speaker?.private.emotion
            ? { ...speaker.private.emotion }
            : undefined,
          speakerPersonality: speaker
            ? {
                introversion: derivePersonality(speaker).introversion,
                spitefulness: derivePersonality(speaker).spitefulness,
              }
            : undefined,
        },
        {
          affectedAgents: participants,
          affectedEids: parsed.mentionedEids,
          affectedCids: [cid],
        },
      );
    }

    const summary = this.summarizer.summarize(messages, participants);
    const relationshipDeltas: ConversationRecord["relationshipDeltas"] = [];
    for (const from of participants) {
      for (const to of participants) {
        if (from === to) continue;
        const graph = new RelationshipGraph(args.world.relationships);
        const edge = graph.ensureEdge(from, to);
        graph.upsert(edge);
        args.world.relationships = graph.all();
        const delta = dialogueRelationshipDelta(summary.averageSentiment, messages.length);
        const result = this.rules.commit(args.world, args.time, {
          kind: "relationship_delta",
          from,
          to,
          ...delta,
          reason: `dialogue ${cid} sentiment=${summary.averageSentiment.toFixed(3)}`,
        });
        relationshipDeltas.push(toRelationshipRecord(from, to, result));
      }
    }

    for (const [agentId, impact] of Object.entries(summary.bdieImpact)) {
      this.rules.commit(args.world, args.time, {
        kind: "dialogue_bdie",
        agentId,
        beliefDelta: impact.beliefDelta,
        emotionDelta: impact.emotionDelta,
        reason: `dialogue ${cid} summary impact`,
      });
    }

    // P3-05: archive dialogue → relation cognitive tree; update edge interactionSummary.
    const cognitionEnabled = args.world.config.enableCognitiveTree !== false;
    const cognition = new CognitiveTreeManager(args.world.cognitiveTrees, this.log);
    let promotions = 0;
    for (const from of participants) {
      for (const to of participants) {
        if (from === to) continue;
        if (cognitionEnabled) {
          const impact = summary.bdieImpact[from];
          const result = cognition.archiveDialogue({
            agentId: from,
            scope: to,
            cid,
            summary: summary.summary,
            keyFacts: summary.keyFacts,
            influenceScore: impact?.influenceScore ?? messages.length,
            time: args.time,
          });
          if (result.promoted) promotions += 1;
        }

        const graph = new RelationshipGraph(args.world.relationships);
        const edge = graph.getEdge(from, to);
        if (edge) {
          const tip = this.relationSummary
            .summarizeEdge(edge, args.world.agents[from], args.world.agents[to])
            .slice(0, 120);
          graph.upsert({
            ...edge,
            interactionSummary: `对话${cid}：${summary.keyFacts[0] ?? summary.summary.slice(0, 40)}｜${tip}`,
            lastChangedAt: { ...args.time },
          });
          args.world.relationships = graph.all();
        }
      }
    }
    if (cognitionEnabled) {
      args.world.cognitiveTrees = cognition.all();
      args.world.metrics.cognitivePromotions += promotions;
    }

    const record: ConversationRecord = {
      cid,
      type: mode,
      mode,
      participants,
      relatedEids: [args.event.eid],
      time: { ...args.time },
      messages,
      summary: summary.summary,
      keyFacts: summary.keyFacts,
      status: "completed",
      bdieImpact: summary.bdieImpact,
      relationshipDeltas,
    };
    args.world.conversations.push(record);
    args.world.metrics.dialoguesCompleted += 1;
    this.table.append(record);
    this.log?.append(
      args.time,
      "dialogue.end",
      {
        cid,
        status: record.status,
        summary: record.summary,
        keyFacts: record.keyFacts,
        bdieImpact: record.bdieImpact,
        relationshipDeltaCount: relationshipDeltas.length,
        cognitivePromotions: promotions,
      },
      { affectedAgents: participants, affectedEids: [args.event.eid], affectedCids: [cid] },
    );
    return record;
  }

  private selectParticipants(
    world: WorldState,
    event: EventInstance,
    explicit?: string[],
  ): string[] {
    if (explicit) return [...new Set(explicit)].filter((id) => world.agents[id]);
    const ordered = Object.values(event.roleBindings).flat();
    return [...new Set(ordered)]
      .filter((id) => world.agents[id])
      .slice(0, event.dialogue.maxParticipants);
  }

  private pickSpeaker(
    mode: DialogueMode,
    participants: string[],
    turn: number,
    event: EventInstance,
  ): string {
    if (mode === "host") {
      const host = event.roleBindings.host?.[0] ?? event.roleBindings.initiator?.[0];
      if (turn % 2 === 0 && host && participants.includes(host)) return host;
      const rest = participants.filter((id) => id !== host);
      return rest[Math.floor(turn / 2) % rest.length] ?? participants[turn % participants.length]!;
    }
    if (mode === "random") {
      const idx = (turn * 7 + event.eid.length * 3) % participants.length;
      return participants[idx]!;
    }
    return participants[turn % participants.length]!;
  }
}

function parseTurn(raw: string, fallbackEid: string): LlmTurn {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1]!.trim();
  try {
    const value = JSON.parse(text) as Partial<LlmTurn>;
    return {
      utterance: String(value.utterance ?? "我明白了，心意记在心里。"),
      sentiment: clamp(Number(value.sentiment ?? 0.2), -1, 1),
      politeness: clamp(Number(value.politeness ?? 0.7), 0, 1),
      mentionedEids:
        Array.isArray(value.mentionedEids) && value.mentionedEids.length
          ? value.mentionedEids.map(String)
          : [fallbackEid],
    };
  } catch {
    return {
      utterance: raw.slice(0, 160) || "我明白了。",
      sentiment: 0,
      politeness: 0.6,
      mentionedEids: [fallbackEid],
    };
  }
}

function postProcess(text: string, history: ConversationMessage[]): string {
  const compact = text.replace(/\s+/g, " ").trim().slice(0, 160);
  if (!compact) return "我听到了，之后再慢慢商量。";
  if (history.some((m) => m.text === compact)) return `${compact} 我再补充一句，往来要记在心里。`;
  return compact;
}

function dialogueRelationshipDelta(sentiment: number, turns: number) {
  const weight = Math.min(1.5, turns / 4);
  return {
    trust: clamp(sentiment * 2 * weight, -3, 3),
    affection: clamp(sentiment * 3 * weight, -4, 4),
    intimacy: clamp((0.2 + sentiment) * weight, -2, 2),
  };
}

function toRelationshipRecord(
  from: string,
  to: string,
  result: RuleResult,
): ConversationRecord["relationshipDeltas"][number] {
  return {
    from,
    to,
    before: (result.before ?? {}) as Record<string, number>,
    after: (result.after ?? {}) as Record<string, number>,
    reason: result.reason,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : 0));
}
