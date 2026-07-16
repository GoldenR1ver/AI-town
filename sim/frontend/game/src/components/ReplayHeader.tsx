import type { ReplayStep, ReplayWorldState } from "@shared/replay/types";

interface ReplayHeaderProps {
  runId: string;
  step: ReplayStep;
  state: ReplayWorldState;
}

export function ReplayHeader({ runId, step, state }: ReplayHeaderProps) {
  return (
    <header className="replay-header">
      <div className="brand-lockup">
        <span className="brand-mark">礼</span>
        <div>
          <span className="eyebrow">MULTI-AGENT SOCIAL SIMULATION</span>
          <h1>礼物的流动</h1>
          <p>AI-town 像素步进回放 · {runId}</p>
        </div>
      </div>
      <div className="act-banner">
        <span>ACT {step.act ?? "—"}</span>
        <strong>{step.actTitle ?? step.title}</strong>
        <small>
          D{step.simTime.day}-{step.simTime.slot} · seq {step.seqEnd}
        </small>
      </div>
      <div className="world-counters">
        <div>
          <span>对话</span>
          <strong>{state.metrics.dialoguesCompleted}</strong>
        </div>
        <div>
          <span>礼物</span>
          <strong>{state.metrics.giftGiven}</strong>
        </div>
        <div>
          <span>回礼</span>
          <strong>{state.metrics.giftReplied}</strong>
        </div>
        <div className={state.metrics.giftDefaulted ? "danger" : ""}>
          <span>违约</span>
          <strong>{state.metrics.giftDefaulted}</strong>
        </div>
      </div>
    </header>
  );
}
