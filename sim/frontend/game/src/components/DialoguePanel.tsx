import type { AgentState } from "@shared/types";
import type { ReplayStep } from "@shared/replay/types";

interface DialoguePanelProps {
  step: ReplayStep;
  agents: Record<string, AgentState>;
  canNext: boolean;
}

function percentage(value: number | undefined, signed = false): string {
  if (value == null) return "—";
  const normalized = signed ? (value + 1) / 2 : value;
  return `${Math.round(Math.max(0, Math.min(1, normalized)) * 100)}%`;
}

export function DialoguePanel({ step, agents, canNext }: DialoguePanelProps) {
  const dialogue = step.dialogue;
  const speaker = dialogue?.speakerId
    ? agents[dialogue.speakerId]?.public
    : undefined;
  const isMessage = step.kind === "dialogue_message" && dialogue?.text;

  return (
    <section
      className={`dialogue-panel ${isMessage ? "is-message" : "is-event"}`}
      aria-live="polite"
    >
      <div className="dialogue-portrait" aria-hidden="true">
        {speaker?.name?.slice(0, 1) ?? step.title.slice(0, 1)}
      </div>
      <div className="dialogue-content">
        <div className="dialogue-meta">
          <span className="dialogue-speaker">
            {speaker
              ? `${speaker.name} · ${dialogue?.speakerId}`
              : step.title}
          </span>
          <span className="dialogue-kind">
            {isMessage
              ? `第 ${dialogue?.turn ?? "?"} 轮`
              : step.kind.replaceAll("_", " ")}
          </span>
        </div>
        <p className="dialogue-text">
          {isMessage ? dialogue.text : step.summary}
        </p>
        {dialogue?.keyFacts?.length ? (
          <ul className="key-facts">
            {dialogue.keyFacts.slice(0, 3).map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        ) : null}
        <div className="dialogue-footer">
          {isMessage ? (
            <div className="tone-meters">
              <span>
                情感
                <i style={{ width: percentage(dialogue.sentiment, true) }} />
              </span>
              <span>
                礼貌
                <i style={{ width: percentage(dialogue.politeness) }} />
              </span>
            </div>
          ) : (
            <span className="sequence-range">
              seq {step.seqStart}
              {step.seqEnd !== step.seqStart ? `–${step.seqEnd}` : ""}
            </span>
          )}
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
