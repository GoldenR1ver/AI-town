import type { ReplayStep, ReplayStepKind } from "@shared/replay/types";
import { useEffect, useRef } from "react";

interface EventTimelineProps {
  steps: ReplayStep[];
  currentIndex: number;
  onJump: (stepIndex: number) => void;
  focusName?: string;
}

const kindLabels: Record<ReplayStepKind, string> = {
  intro: "序",
  time: "时",
  event: "事",
  dialogue_start: "谈",
  dialogue_message: "言",
  dialogue_result: "变",
  intent: "念",
  gift: "礼",
  event_result: "结",
  checkpoint: "存",
  system: "记",
};

export function EventTimeline({
  steps,
  currentIndex,
  onJump,
  focusName,
}: EventTimelineProps) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentIndex]);

  const position = steps.findIndex((step) => step.index === currentIndex);
  const displayPos = position >= 0 ? position + 1 : "—";

  let previousAct: number | undefined;
  return (
    <aside className="timeline-panel pixel-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">CHRONICLE</span>
          <h2>事件时间轴</h2>
          {focusName ? (
            <p className="timeline-focus-hint">聚焦 · {focusName}</p>
          ) : null}
        </div>
        <span className="counter-badge">
          {displayPos}/{steps.length}
        </span>
      </div>
      <div className="timeline-scroll" role="list" aria-label="回放步骤">
        {!steps.length ? (
          <p className="empty-state">没有与此人相关的事件</p>
        ) : null}
        {steps.map((step) => {
          const showAct = step.act != null && step.act !== previousAct;
          previousAct = step.act;
          const state =
            step.index === currentIndex
              ? "current"
              : step.index < currentIndex
                ? "past"
                : "future";
          return (
            <div key={step.id}>
              {showAct && (
                <div className="act-divider">
                  <span>ACT {step.act}</span>
                  <strong>{step.actTitle}</strong>
                </div>
              )}
              <button
                ref={step.index === currentIndex ? activeRef : undefined}
                type="button"
                className={`timeline-step ${state} kind-${step.kind}`}
                onClick={() => onJump(step.index)}
                aria-current={step.index === currentIndex ? "step" : undefined}
              >
                <span className="step-glyph">{kindLabels[step.kind]}</span>
                <span className="step-copy">
                  <span className="step-time">
                    D{step.simTime.day}-{step.simTime.slot} · #{step.seqEnd}
                  </span>
                  <strong>{step.title}</strong>
                  <small>{step.summary}</small>
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
