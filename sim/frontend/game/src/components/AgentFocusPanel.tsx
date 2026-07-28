import type { ReplayData } from "@shared/replay/types";
import { useMemo } from "react";
import { buildAgentTrajectory } from "../aitown/agentFocus";
import { MiniLineChart } from "./MiniLineChart";

interface AgentFocusPanelProps {
  data: ReplayData;
  agentId: string;
  focusEnabled: boolean;
  focusedStepCount: number;
  totalStepCount: number;
  onToggleFocus: () => void;
  onSelectAgent: (agentId: string) => void;
}

const COLORS = {
  cash: "#f0c36a",
  wealth: "#8fd3b0",
  debt: "#e07a7a",
  face: "#f6c76c",
  prestige: "#b86f50",
  reputation: "#c5b0a2",
  mood: "#7eb8da",
  stress: "#d9896c",
  energy: "#9ecf8c",
  belief: "#b8a1d9",
  desire: "#d4a0c7",
  intention: "#8bb8c9",
};

export function AgentFocusPanel({
  data,
  agentId,
  focusEnabled,
  focusedStepCount,
  totalStepCount,
  onToggleFocus,
  onSelectAgent,
}: AgentFocusPanelProps) {
  const agentOptions = useMemo(() => {
    const source =
      data.checkpoints[data.checkpoints.length - 1]?.agents ??
      data.initialState.agents;
    return Object.values(source)
      .slice()
      .sort((a, b) => a.public.name.localeCompare(b.public.name, "zh"));
  }, [data.checkpoints, data.initialState.agents]);

  const agent = agentId
    ? agentOptions.find((item) => item.public.id === agentId) ??
      data.initialState.agents[agentId]
    : undefined;

  const name = agent?.public.name ?? agentId;
  const trajectory = useMemo(
    () => buildAgentTrajectory(data, agentId),
    [data, agentId],
  );

  const labels = trajectory.map((point) =>
    point.label === "start" ? "始" : `D${point.day}`,
  );

  if (!agentId) {
    return (
      <section className="focus-panel pixel-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">AGENT FOCUS</span>
            <h2>聚焦一人</h2>
          </div>
        </div>
        <p className="empty-state">请先在排序榜或场景中选择一位村民</p>
      </section>
    );
  }

  return (
    <section className={`focus-panel pixel-panel ${focusEnabled ? "is-active" : ""}`}>
      <div className="panel-heading compact">
        <div>
          <span className="eyebrow">AGENT FOCUS</span>
          <h2>聚焦一人</h2>
        </div>
        <button
          type="button"
          className={`focus-toggle ${focusEnabled ? "is-on" : ""}`}
          onClick={onToggleFocus}
          aria-pressed={focusEnabled}
        >
          {focusEnabled ? "聚焦中" : "开启聚焦"}
        </button>
      </div>

      <div className="focus-subject">
        <div>
          <strong>{name}</strong>
          <span>
            {agent?.public.occupation ?? "—"} · {agentId}
          </span>
        </div>
        <select
          value={agentId}
          onChange={(event) => onSelectAgent(event.target.value)}
          aria-label="选择聚焦对象"
        >
          {agentOptions.map((candidate) => (
            <option key={candidate.public.id} value={candidate.public.id}>
              {candidate.public.name} · {candidate.public.occupation}
            </option>
          ))}
        </select>
      </div>

      <p className="focus-stats">
        {focusEnabled ? (
          <>
            时间轴仅显示与其相关的 <strong>{focusedStepCount}</strong> /{" "}
            {totalStepCount} 步
          </>
        ) : (
          <>
            相关事件约 <strong>{focusedStepCount}</strong> 步 · 轨迹采样{" "}
            {trajectory.length} 点（检查点）
          </>
        )}
      </p>

      {trajectory.length >= 2 ? (
        <div className="focus-charts">
          <MiniLineChart
            title="经济 · 现金 / 总资产 / 负债"
            labels={labels}
            fromZero
            valuePrefix="¥"
            series={[
              {
                name: "现金",
                values: trajectory.map((point) => point.cash),
                color: COLORS.cash,
              },
              {
                name: "总资产",
                values: trajectory.map((point) => point.wealth),
                color: COLORS.wealth,
              },
              {
                name: "负债",
                values: trajectory.map((point) => point.debt),
                color: COLORS.debt,
              },
            ]}
          />
          <MiniLineChart
            title="公开属性 · 脸面 / 声望 / 声誉"
            labels={labels}
            series={[
              {
                name: "脸面",
                values: trajectory.map((point) => point.face),
                color: COLORS.face,
              },
              {
                name: "声望",
                values: trajectory.map((point) => point.prestige),
                color: COLORS.prestige,
              },
              {
                name: "声誉",
                values: trajectory.map((point) => point.reputation),
                color: COLORS.reputation,
              },
            ]}
          />
          <MiniLineChart
            title="情绪 E · 心情 / 压力 / 精力"
            labels={labels}
            series={[
              {
                name: "心情",
                values: trajectory.map((point) => point.mood),
                color: COLORS.mood,
              },
              {
                name: "压力",
                values: trajectory.map((point) => point.stress),
                color: COLORS.stress,
              },
              {
                name: "精力",
                values: trajectory.map((point) => point.energy),
                color: COLORS.energy,
              },
            ]}
          />
          <MiniLineChart
            title="BDI 规模 · Belief数 / Desire总和 / Intention数"
            labels={labels}
            fromZero
            series={[
              {
                name: "Belief#",
                values: trajectory.map((point) => point.beliefCount),
                color: COLORS.belief,
              },
              {
                name: "DesireΣ",
                values: trajectory.map((point) => point.desireSum),
                color: COLORS.desire,
              },
              {
                name: "Intention#",
                values: trajectory.map((point) => point.intentionCount),
                color: COLORS.intention,
              },
            ]}
          />
        </div>
      ) : (
        <p className="empty-state">轨迹点不足（需要至少 2 个检查点）</p>
      )}
    </section>
  );
}
