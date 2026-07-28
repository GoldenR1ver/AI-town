import type { AgentState, ConversationRecord } from "@shared/types";
import type { ReplayStep } from "@shared/replay/types";
import { useEffect, useMemo, useRef } from "react";

interface DialoguePanelProps {
  step: ReplayStep;
  agents: Record<string, AgentState>;
  steps: ReplayStep[];
  conversations: ConversationRecord[];
  canNext: boolean;
}

export interface TranscriptLine {
  turn: number;
  speakerId: string;
  text: string;
  sentiment?: number;
  politeness?: number;
  stepIndex: number;
}

function percentage(value: number | undefined, signed = false): string {
  if (value == null) return "0%";
  const normalized = signed ? (value + 1) / 2 : value;
  return `${Math.round(Math.max(0, Math.min(1, normalized)) * 100)}%`;
}

/** Collect dialogue lines for a cid up to (and including) current step. */
export function buildTranscript(
  steps: ReplayStep[],
  cid: string | undefined,
  currentIndex: number,
  conversations: ConversationRecord[],
): TranscriptLine[] {
  if (!cid) return [];

  const fromSteps = steps
    .filter(
      (step) =>
        step.kind === "dialogue_message" &&
        step.dialogue?.cid === cid &&
        step.index <= currentIndex &&
        Boolean(step.dialogue.text?.trim()),
    )
    .map((step) => ({
      turn: step.dialogue?.turn ?? 0,
      speakerId: step.dialogue?.speakerId ?? "",
      text: step.dialogue?.text ?? "",
      sentiment: step.dialogue?.sentiment,
      politeness: step.dialogue?.politeness,
      stepIndex: step.index,
    }))
    .filter((line) => line.speakerId && line.text);

  if (fromSteps.length) return fromSteps;

  // Fallback: completed conversation record (e.g. jumped to result step).
  const record = conversations.find((item) => item.cid === cid);
  if (!record?.messages?.length) return [];
  return record.messages.map((message, index) => ({
    turn: message.turn ?? index + 1,
    speakerId: message.speakerId,
    text: message.text,
    sentiment: message.meta?.sentiment,
    politeness: message.meta?.politeness,
    stepIndex: currentIndex,
  }));
}

export function DialoguePanel({
  step,
  agents,
  steps,
  conversations,
  canNext,
}: DialoguePanelProps) {
  const dialogue = step.dialogue;
  const cid = dialogue?.cid;
  const speaker = dialogue?.speakerId
    ? agents[dialogue.speakerId]?.public
    : undefined;
  const isMessage = step.kind === "dialogue_message" && Boolean(dialogue?.text);
  const isDialogueKind = step.kind.startsWith("dialogue");

  const transcript = useMemo(
    () => buildTranscript(steps, cid, step.index, conversations),
    [cid, conversations, step.index, steps],
  );

  const record = useMemo(
    () => (cid ? conversations.find((item) => item.cid === cid) : undefined),
    [cid, conversations],
  );

  const participants = dialogue?.participants?.length
    ? dialogue.participants
    : record?.participants ?? [];

  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [step.index, transcript.length]);

  const titleSpeaker = speaker
    ? `${speaker.name}`
    : participants
        .map((id) => agents[id]?.public.name ?? id)
        .filter(Boolean)
        .slice(0, 3)
        .join(" · ") || step.title;

  return (
    <section
      className={`dialogue-panel ${isMessage ? "is-message" : "is-event"} ${
        isDialogueKind ? "has-thread" : ""
      }`}
      aria-live="polite"
    >
      <div className="dialogue-portrait" aria-hidden="true">
        {speaker?.name?.slice(0, 1) ??
          agents[participants[0] ?? ""]?.public.name?.slice(0, 1) ??
          step.title.slice(0, 1)}
      </div>
      <div className="dialogue-content">
        <div className="dialogue-meta">
          <span className="dialogue-speaker">{titleSpeaker}</span>
          <span className="dialogue-kind">
            {isMessage
              ? `第 ${dialogue?.turn ?? "?"} 轮`
              : step.kind === "dialogue_start"
                ? "对话开始"
                : step.kind === "dialogue_result"
                  ? "对话结果"
                  : step.kind.replaceAll("_", " ")}
            {cid ? ` · ${cid}` : ""}
          </span>
        </div>

        {participants.length > 0 ? (
          <p className="dialogue-participants">
            参与者：
            {participants
              .map((id) => agents[id]?.public.name ?? id)
              .join("、")}
          </p>
        ) : null}

        {transcript.length > 0 ? (
          <div className="dialogue-thread" ref={scrollRef} role="log" aria-label="对话内容">
            {transcript.map((line) => {
              const name = agents[line.speakerId]?.public.name ?? line.speakerId;
              const active = line.stepIndex === step.index;
              return (
                <div
                  key={`${line.stepIndex}-${line.turn}-${line.speakerId}`}
                  ref={active ? activeRef : undefined}
                  className={`dialogue-bubble ${active ? "is-active" : ""}`}
                >
                  <header>
                    <strong>{name}</strong>
                    <span>第 {line.turn} 轮</span>
                  </header>
                  <p>{line.text}</p>
                  {active && (line.sentiment != null || line.politeness != null) ? (
                    <div className="tone-meters compact">
                      <span>
                        情感
                        <i style={{ width: percentage(line.sentiment, true) }} />
                      </span>
                      <span>
                        礼貌
                        <i style={{ width: percentage(line.politeness) }} />
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="dialogue-text">
            {isDialogueKind
              ? step.summary || "等待发言…"
              : step.summary || "本步无对话内容"}
          </p>
        )}

        {(dialogue?.summary || record?.summary) && step.kind === "dialogue_result" ? (
          <p className="dialogue-summary">
            <strong>摘要</strong>
            {dialogue?.summary ?? record?.summary}
          </p>
        ) : null}

        {(dialogue?.keyFacts?.length || record?.keyFacts?.length) ? (
          <ul className="key-facts">
            {(dialogue?.keyFacts ?? record?.keyFacts ?? []).slice(0, 5).map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        ) : null}

        <div className="dialogue-footer">
          <span className="sequence-range">
            {transcript.length
              ? `${transcript.length} 句`
              : `seq ${step.seqStart}${
                  step.seqEnd !== step.seqStart ? `–${step.seqEnd}` : ""
                }`}
          </span>
          <span className={`space-hint ${canNext ? "" : "is-finished"}`}>
            {canNext ? (
              <>
                按 <kbd>Space</kbd> 继续
              </>
            ) : (
              "回放结束"
            )}
          </span>
        </div>
      </div>
    </section>
  );
}
