import type {
  AgentBdieImpact,
  ConversationMessage,
  EmotionState,
} from "../../../shared/types/index.js";
import type { LlmClient } from "../../llm/client.js";
import { round2 } from "../../../shared/format.js";

export interface DialogueSummary {
  summary: string;
  keyFacts: string[];
  averageSentiment: number;
  bdieImpact: Record<string, AgentBdieImpact>;
}

export class DialogueSummarizer {
  constructor(private readonly llm?: LlmClient) {}

  /** Heuristic summary (sync fallback). */
  summarize(messages: ConversationMessage[], participants: string[]): DialogueSummary {
    return this.heuristicSummary(messages, participants);
  }

  /** LLM-assisted summary when client available; falls back to heuristic. */
  async summarizeAsync(
    messages: ConversationMessage[],
    participants: string[],
    agents?: Record<string, { name: string }>,
  ): Promise<DialogueSummary> {
    const base = this.heuristicSummary(messages, participants);
    if (!this.llm || this.llm.mode === "mock") return base;

    try {
      const transcript = messages
        .map((m) => {
          const name = agents?.[m.speakerId]?.name ?? m.speakerId;
          return `${name}：${m.text}`;
        })
        .join("\n");
      const raw = await this.llm.complete([
        {
          role: "system",
          content:
            "你是社会学对话摘要助手。输出严格 JSON：{\"summary\":\"80-200字摘要\",\"keyFacts\":[\"事实1\",\"事实2\",...]}。摘要需涵盖主要议题、情感走向与礼俗/人情相关内容。",
        },
        {
          role: "user",
          content: `参与者：${participants.join("、")}\n对话全文：\n${transcript}\n请生成摘要与3-5条关键事实。`,
        },
      ]);
      const fenced = raw.trim().match(/```(?:json)?\s*([\s\S]*?)```/i);
      const text = fenced ? fenced[1]!.trim() : raw.trim();
      const parsed = JSON.parse(text) as { summary?: string; keyFacts?: string[] };
      const summary = String(parsed.summary ?? base.summary).trim();
      const keyFacts = Array.isArray(parsed.keyFacts)
        ? parsed.keyFacts.map(String).filter(Boolean).slice(0, 6)
        : base.keyFacts;
      if (summary.length < 10) return base;
      return {
        ...base,
        summary,
        keyFacts: keyFacts.length ? keyFacts : base.keyFacts,
      };
    } catch {
      return base;
    }
  }

  private heuristicSummary(
    messages: ConversationMessage[],
    participants: string[],
  ): DialogueSummary {
    const sentiments = messages.map((m) => m.meta?.sentiment ?? 0);
    const averageSentiment =
      sentiments.length > 0
        ? round2(sentiments.reduce((a, b) => a + b, 0) / sentiments.length)
        : 0;
    const mentioned = [...new Set(messages.flatMap((m) => m.meta?.mentionedEids ?? []))];
    const keyFacts = [
      ...mentioned.map((eid) => `谈及事务 ${eid}`),
      ...messages.slice(-2).map((m) => `${m.speakerId}表示：${m.text}`),
    ].slice(0, 5);
    const bdieImpact: Record<string, AgentBdieImpact> = {};
    for (const id of participants) {
      const emotionDelta: Partial<EmotionState> = {
        mood: round2(clamp(averageSentiment * 0.08, -0.1, 0.1)),
        stress: round2(clamp(-averageSentiment * 0.04, -0.05, 0.05)),
      };
      bdieImpact[id] = {
        beliefDelta: Object.fromEntries(mentioned.map((eid) => [`event:${eid}`, round2(0.1)])),
        desireDelta: {},
        intentionDelta: {},
        emotionDelta,
        influenceScore: Math.min(
          20,
          round2(4 + messages.length * 2 + Math.abs(averageSentiment) * 6),
        ),
      };
    }
    const fullTranscript = messages.map((m) => `${m.speakerId}:${m.text}`).join("；");
    return {
      summary: fullTranscript,
      keyFacts,
      averageSentiment,
      bdieImpact,
    };
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
