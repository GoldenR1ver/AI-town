import {
  logsForStep,
  replayStateAtStep,
} from "@shared/replay/reducer";
import type { ReplayData } from "@shared/replay/types";
import { useEffect, useMemo, useState } from "react";
import { BdieInspector } from "./components/BdieInspector";
import { DialoguePanel } from "./components/DialoguePanel";
import { EventTimeline } from "./components/EventTimeline";
import { PlaybackControls } from "./components/PlaybackControls";
import { RelationshipGraph } from "./components/RelationshipGraph";
import { ReplayHeader } from "./components/ReplayHeader";
import { TownScene } from "./components/TownScene";
import { useStepController } from "./hooks/useStepController";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ReplayData };

function ReplayExperience({ data }: { data: ReplayData }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [pinned, setPinned] = useState(false);
  const controller = useStepController({
    steps: data.steps,
    index: stepIndex,
    setIndex: setStepIndex,
  });
  const step = data.steps[stepIndex] ?? data.steps[0];
  const state = useMemo(
    () => replayStateAtStep(data, stepIndex),
    [data, stepIndex],
  );
  const previousState = useMemo(
    () => replayStateAtStep(data, stepIndex - 1),
    [data, stepIndex],
  );

  useEffect(() => {
    if (!step || pinned) return;
    const nextFocus =
      step.dialogue?.speakerId ??
      step.focusAgentIds.find((agentId) => state.agents[agentId]) ??
      selectedAgentId ??
      Object.keys(state.agents)[0];
    if (nextFocus && nextFocus !== selectedAgentId) {
      setSelectedAgentId(nextFocus);
    }
  }, [pinned, selectedAgentId, state.agents, step]);

  if (!step) {
    return (
      <div className="fatal-screen">
        <h1>没有可播放的步骤</h1>
        <p>请重新运行 npm run frontend:export。</p>
      </div>
    );
  }

  const stepLogs = logsForStep(data, step);
  const selectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    setPinned(true);
  };
  const togglePin = () => {
    const nextPinned = !pinned;
    setPinned(nextPinned);
    if (!nextPinned) {
      const focus = step.dialogue?.speakerId ?? step.focusAgentIds[0];
      if (focus) setSelectedAgentId(focus);
    }
  };

  return (
    <div className={`replay-app time-${step.simTime.slot.toLowerCase()}`}>
      <ReplayHeader runId={data.runId} step={step} state={state} />
      <main className="replay-layout">
        <EventTimeline
          steps={data.steps}
          currentIndex={stepIndex}
          onJump={controller.jumpTo}
        />
        <div className="stage-column">
          <section className="game-frame">
            <TownScene
              agents={state.agents}
              step={step}
              selectedAgentId={selectedAgentId}
              onSelectAgent={selectAgent}
            />
          </section>
          <DialoguePanel
            step={step}
            agents={state.agents}
            canNext={controller.canNext}
          />
          <PlaybackControls
            index={stepIndex}
            total={data.steps.length}
            canPrevious={controller.canPrevious}
            canNext={controller.canNext}
            onPrevious={controller.previous}
            onNext={controller.next}
            onJump={controller.jumpTo}
            onReplayAct={controller.replayAct}
          />
        </div>
        <aside className="analysis-column">
          <RelationshipGraph
            state={state}
            step={step}
            stepLogs={stepLogs}
            selectedAgentId={selectedAgentId}
            onSelectAgent={selectAgent}
          />
          <BdieInspector
            state={state}
            previousState={previousState}
            step={step}
            selectedAgentId={selectedAgentId}
            pinned={pinned}
            onSelectAgent={selectAgent}
            onTogglePin={togglePin}
          />
        </aside>
      </main>
      <footer className="replay-footer">
        <span>Env JSONL / Snapshot 为唯一真理源</span>
        <span>
          像素渲染改编自 AI-town ·{" "}
          <a href="./AI_TOWN_LICENSE.txt" target="_blank" rel="noreferrer">
            MIT License
          </a>
        </span>
        <span>
          <kbd>←</kbd> 上一步 · <kbd>Space</kbd>/<kbd>→</kbd> 下一步
        </span>
      </footer>
    </div>
  );
}

export default function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL}replay_data.json`,
        );
        if (!response.ok) {
          throw new Error(
            `无法加载 replay_data.json（HTTP ${response.status}）。请先运行 npm run frontend:export。`,
          );
        }
        const data = (await response.json()) as ReplayData;
        if (data.schemaVersion !== 1 || !Array.isArray(data.steps)) {
          throw new Error("回放数据版本不兼容，请重新导出。");
        }
        if (!cancelled) setLoadState({ status: "ready", data });
      } catch (error) {
        if (!cancelled) {
          setLoadState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadState.status === "loading") {
    return (
      <div className="loading-screen">
        <div className="loading-village" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h1>正在载入村庄记忆</h1>
        <p>整理事件、对话与关系网络…</p>
      </div>
    );
  }
  if (loadState.status === "error") {
    return (
      <div className="fatal-screen">
        <h1>回放载入失败</h1>
        <p>{loadState.message}</p>
      </div>
    );
  }
  return <ReplayExperience data={loadState.data} />;
}
